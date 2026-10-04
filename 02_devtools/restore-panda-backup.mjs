// Default: inspect only. Optional output is always a NEW local SQLite file, never D1.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { restorePandaLocally } from '../01_automation/panda_backup.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    input: { type: 'string' }, receipt: { type: 'string' }, 'local-output': { type: 'string' },
  } });
  if (!values.input || !values.receipt) throw new Error('--input <file.sql.gz> --receipt <file.complete.json>이 필요합니다.');
  const checked = await restorePandaLocally(values.input, values.receipt, values['local-output']);
  console.log(`판다 백업 ${checked.restoredLocally ? '로컬 격리 복구' : '검사'} 완료: 프로필 ${checked.counts.student_panda_profiles}개, 거래 ${checked.counts.student_panda_actions}개. 운영 DB 변경 없음.`);
  return checked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('판다 백업 검사/로컬 복구 실패. 인자·완료 표식·해시·데이터 정합성·출력 파일 중복을 확인하세요. 원본 데이터는 출력하지 않습니다.'); process.exitCode = 1; });
}
