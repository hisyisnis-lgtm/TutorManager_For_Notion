// Run from the repository root. R2 upload belongs to panda-backup.yml.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { pandaExportArgs, writePandaBundle } from './panda_backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function exportPandaBackup({ output, receipt, run = execFileSync }) {
  if (path.resolve(output) === path.resolve(receipt)) throw new Error('백업과 완료 표식 경로는 달라야 합니다.');
  const work = await mkdtemp(path.join(tmpdir(), 'tutor-panda-backup-'));
  try {
    const sqlFile = path.join(work, 'panda.sql');
    try {
      run(process.execPath, [path.join(ROOT, 'worker/node_modules/wrangler/bin/wrangler.js'), ...pandaExportArgs(sqlFile)], {
        cwd: path.join(ROOT, 'worker'), stdio: 'pipe', windowsHide: true, timeout: 5 * 60 * 1000,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(work, 'wrangler.log') },
      });
    } catch (error) {
      const output = String(error.stderr || '') + String(error.stdout || '');
      const providerCodes = [...new Set([...output.matchAll(/\[code:\s*(\d{3,6})\]/g)].map(match => match[1]))].slice(0, 4);
      throw Object.assign(new Error('D1 판다 테이블 내보내기 실패: DB 준비와 백업 토큰 권한을 확인하세요.'), { providerCodes });
    }
    const source = await readFile(sqlFile);
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await mkdir(path.dirname(path.resolve(receipt)), { recursive: true });
    return await writePandaBundle(source, output, receipt);
  } finally {
    // Only the newly created temp directory is removed; never a computed DB/workspace path.
    if (path.dirname(work) === path.resolve(tmpdir()) && path.basename(work).startsWith('tutor-panda-backup-')) {
      await rm(work, { recursive: true, force: true });
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    remote: { type: 'boolean', default: false }, output: { type: 'string' }, receipt: { type: 'string' },
  } });
  if (!values.remote || !values.output || !values.receipt) {
    throw new Error('명시적인 --remote --output <file.sql.gz> --receipt <file.complete.json>이 필요합니다.');
  }
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('D1 백업 인증 환경변수가 없습니다.');
  const receipt = await exportPandaBackup(values);
  console.log(`판다 백업 검사 완료: 프로필 ${receipt.counts.student_panda_profiles}개, 거래 ${receipt.counts.student_panda_actions}개. R2 업로드는 다음 단계에서 확인합니다.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error('판다 백업 실패. 필수 인자·시크릿·D1 준비·백업 무결성을 확인하세요. 원본 데이터는 출력하지 않습니다.'); if (error.providerCodes?.length) console.error('Cloudflare 오류 코드: ' + error.providerCodes.join(', ')); process.exitCode = 1; });
}
