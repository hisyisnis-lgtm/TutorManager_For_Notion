// 잘린 채 읽히는 파일을 감지하고, 가능하면 끝부분을 직접 읽어 되살린다.
//
// 왜 필요한가 (2026-08 강사 녹음 손상 사고):
// 안드로이드는 파일을 직접 주지 않고 미디어 색인을 거쳐 넘긴다. 녹음이 저장되는 도중의 크기가
// 색인에 박제되면 그 뒤로 브라우저는 `file.size`를 짧게 보고하고, 그만큼만 전송한다.
// 강사 갤럭시에서 3,126,011B 원본이 매번 3,103,700B로 잘려 업로드됐고(iOS·curl은 정상),
// 앱과 서버가 같은 짧은 숫자를 믿었기 때문에 크기 대조 검증에도 걸리지 않았다.
//
// MP4(m4a)는 박스 길이가 파일 안에 적혀 있어 **원래 몇 바이트여야 하는지**를 스스로 알려준다.
// 그 값과 `file.size`를 비교하면 잘림을 확실히 잡을 수 있고, 재생 색인(moov)은 파일 끝에 있어
// 조금만 잘려도 파일 전체가 열리지 않으므로 반드시 걸러야 한다.

/** 한 번에 읽어올 헤더 크기 — 64비트 확장 길이(16B)까지 커버. */
const BOX_HEADER_BYTES = 16;
/** 무한 루프 방지 — 정상 m4a의 최상위 박스는 보통 3~6개다. */
const MAX_BOXES = 64;

function isPrintableType(t) {
  return /^[\x20-\x7e]{4}$/.test(t);
}

/**
 * MP4/M4A 최상위 박스를 훑어 파일이 원래 가져야 할 총 바이트 수를 구한다.
 * 박스 헤더만 읽고 본문은 건너뛰므로, 3MB 파일이어도 수십 바이트만 읽는다.
 *
 * @returns {Promise<number|null>} 기대 크기. MP4가 아니거나 구조를 못 읽으면 null.
 */
export async function expectedMp4Size(file) {
  if (!file || typeof file.slice !== 'function') return null;
  let off = 0;
  for (let i = 0; i < MAX_BOXES; i += 1) {
    if (off + 8 > file.size) break; // 헤더를 더 읽을 수 없으면 순회 종료
    let head;
    try {
      head = new DataView(await file.slice(off, off + BOX_HEADER_BYTES).arrayBuffer());
    } catch {
      return null; // 읽기 자체가 실패하면 판단 보류 (기존 흐름 유지)
    }
    if (head.byteLength < 8) break;

    const type = String.fromCharCode(
      head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7),
    );
    // 첫 박스가 ftyp이 아니면 MP4 계열이 아니다 — 검사 대상에서 제외.
    if (i === 0 && type !== 'ftyp') return null;
    if (!isPrintableType(type)) return null;

    let size = head.getUint32(0);
    let headerBytes = 8;
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = Number(head.getBigUint64(8));
      headerBytes = 16;
    } else if (size === 0) {
      // "끝까지" 박스 — 남은 전부를 차지하므로 잘림 판정이 불가능하다.
      return null;
    }
    if (size < headerBytes) return null; // 손상된 길이

    off += size;
  }
  return off > 0 ? off : null;
}

/**
 * 파일이 온전한지 확인하고, 잘렸으면 선언된 크기 너머를 읽어 되살려 본다.
 *
 * 안드로이드가 크기만 짧게 보고하고 실제 스트림엔 뒷부분이 남아있는 경우가 있어
 * `slice(size, expected)`로 한 번 더 요청해 본다. 아무것도 안 나오면 복구 불가로 판정한다.
 *
 * @returns {Promise<{ file: File, ok: boolean, recovered: boolean, actual: number, expected: number|null }>}
 *   ok=false면 잘린 파일이며 복구도 실패한 것 — 호출부는 업로드를 중단해야 한다.
 */
export async function ensureCompleteFile(file) {
  const actual = Number(file?.size) || 0;
  const expected = await expectedMp4Size(file);

  // MP4가 아니거나(=판단 불가) 이미 온전하면 그대로 통과.
  if (expected == null || expected <= actual) {
    return { file, ok: true, recovered: false, actual, expected };
  }

  // 잘렸다 — 선언된 크기 너머를 직접 읽어 본다.
  let tail = null;
  try {
    const buf = await file.slice(actual, expected).arrayBuffer();
    if (buf.byteLength > 0) tail = buf;
  } catch {
    // 읽기 거부 — 복구 불가로 떨어진다
  }

  if (tail && actual + tail.byteLength === expected) {
    // 앞부분은 slice로 다시 집는다 — 원본을 통째로 넘기면 Blob 생성자가 이를 데이터로
    // 다루지 못하는 구현(비표준 File 유사 객체 등)에서 내용이 깨진다.
    const healed = new File([file.slice(0, actual), tail], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    return { file: healed, ok: true, recovered: true, actual, expected };
  }

  return { file, ok: false, recovered: false, actual, expected };
}

/**
 * 잘린 파일을 사용자에게 설명하는 문구 — 대처 방법까지 담는다.
 *
 * ⛔ "복사하거나 이름을 바꿔보라"고 안내하지 말 것 (2026-08-09 실제 피해).
 * 복사·이름 변경도 같은 미디어 색인을 거치므로, 폰이 잘못 기억한 짧은 크기대로
 * **파일이 실제로 잘려 다시 쓰인다**. 그때까지 폰에서 재생되던 원본이 이 안내를 따른 뒤
 * 진짜로 못 쓰게 됐다. 색인을 되살리는 확실한 방법은 재시작이고, 급하면 PC 경로가 안전하다.
 */
export function truncatedFileMessage(name, actual, expected) {
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
  return `"${name}" 녹음이 손상된 상태로 읽혔어요 (${mb(actual)} / 원래 ${mb(expected)}). `
    + '휴대폰이 파일을 끝까지 넘겨주지 못하는 상태예요. '
    + '휴대폰을 다시 켠 뒤 올리거나, PC에서 올려주세요. '
    + '⚠️ 이름을 바꾸거나 복사하면 파일이 그대로 잘려버리니 하지 마세요.';
}
