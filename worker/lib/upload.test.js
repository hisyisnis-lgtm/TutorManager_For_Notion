import { describe, it, expect } from 'vitest';
import { validateAudioUpload, resolveAudioMime, dedupeFileNames, MAX_AUDIO_BYTES } from './upload.js';

// File 객체를 모킹 — Workers/Vitest 환경에서 Blob의 name·type만 필요.
function makeFile({ name = 'audio.mp3', type = 'audio/mpeg', size = 1024 } = {}) {
  return { name, type, size };
}

describe('validateAudioUpload', () => {
  describe('정상 케이스 — 오디오', () => {
    it('표준 MIME (mp3, m4a, webm, wav 등) 통과', () => {
      const types = [
        'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg',
        'audio/wav', 'audio/x-m4a', 'audio/aac', 'audio/flac',
      ];
      for (const type of types) {
        const r = validateAudioUpload(makeFile({ type }));
        expect(r.ok, type).toBe(true);
        if (r.ok) expect(r.category, type).toBe('audio');
      }
    });

    it('MIME 대소문자 무시', () => {
      const r = validateAudioUpload(makeFile({ type: 'AUDIO/MPEG' }));
      expect(r.ok).toBe(true);
    });

    it('상한 경계값(정확히 MAX_AUDIO_BYTES)은 통과', () => {
      const r = validateAudioUpload(makeFile({ size: MAX_AUDIO_BYTES }));
      expect(r.ok).toBe(true);
    });
  });

  // 2026-08 강사 녹음 손상 사고: 안드로이드에서 파일이 재포장되며 뒤가 잘린 채 업로드됐는데
  // 크기·MIME 검증을 모두 통과해 재생 불가 파일이 학생에게 그대로 전달됐다.
  describe('전송 중 잘림 탐지 (declaredSize 대조)', () => {
    it('원본 크기와 수신 크기가 같으면 통과', () => {
      const r = validateAudioUpload(makeFile({ size: 3126011 }), 3126011);
      expect(r.ok).toBe(true);
    });

    it('문자열로 온 크기도 같으면 통과 (FormData 값은 문자열)', () => {
      const r = validateAudioUpload(makeFile({ size: 3126011 }), '3126011');
      expect(r.ok).toBe(true);
    });

    it('수신 크기가 더 작으면 400으로 거부 — 실제 사고값', () => {
      const r = validateAudioUpload(makeFile({ size: 3103700 }), '3126011');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toContain('잘렸');
      }
    });

    it('용량 초과보다 잘림을 먼저 알린다 — 원인이 다른데 "용량 초과"로 오인시키면 안 됨', () => {
      const r = validateAudioUpload(makeFile({ size: MAX_AUDIO_BYTES + 1 }), String(MAX_AUDIO_BYTES + 2));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('잘렸');
    });

    it('declaredSize 미전달(옛 클라이언트)이면 검사를 건너뛴다', () => {
      expect(validateAudioUpload(makeFile({ size: 1024 })).ok).toBe(true);
      expect(validateAudioUpload(makeFile({ size: 1024 }), null).ok).toBe(true);
      expect(validateAudioUpload(makeFile({ size: 1024 }), '').ok).toBe(true);
    });

    it('숫자가 아닌 declaredSize는 무시 — 검증 자체를 깨뜨리지 않는다', () => {
      expect(validateAudioUpload(makeFile({ size: 1024 }), 'abc').ok).toBe(true);
      expect(validateAudioUpload(makeFile({ size: 1024 }), '0').ok).toBe(true);
    });
  });

  describe('정상 케이스 — 이미지·PDF (document)', () => {
    it('image/png → 통과, category=document', () => {
      const r = validateAudioUpload(makeFile({ name: 'photo.png', type: 'image/png' }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.category).toBe('document');
    });

    it('application/pdf → 통과, category=document', () => {
      const r = validateAudioUpload(makeFile({ name: 'doc.pdf', type: 'application/pdf' }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.category).toBe('document');
    });

    it('image/jpeg / image/webp / image/heic → 통과', () => {
      const cases = [
        { name: 'a.jpg', type: 'image/jpeg' },
        { name: 'a.webp', type: 'image/webp' },
        { name: 'a.heic', type: 'image/heic' },
      ];
      for (const c of cases) {
        const r = validateAudioUpload(makeFile(c));
        expect(r.ok, c.type).toBe(true);
        if (r.ok) expect(r.category, c.type).toBe('document');
      }
    });

    it('image/png;charset=utf-8 — MIME 파라미터 strip 후 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'a.png', type: 'image/png;charset=utf-8' }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.category).toBe('document');
    });
  });

  describe('MIME 누락 fallback (모바일 브라우저)', () => {
    it('빈 MIME + 허용 오디오 확장자 → 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'recording.m4a', type: '' }));
      expect(r.ok).toBe(true);
    });

    it('application/octet-stream + 허용 확장자 → 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'song.mp3', type: 'application/octet-stream' }));
      expect(r.ok).toBe(true);
    });

    it('확장자 대소문자 무시', () => {
      const r = validateAudioUpload(makeFile({ name: 'SONG.MP3', type: '' }));
      expect(r.ok).toBe(true);
    });

    it('빈 MIME + document 확장자(pdf) → 통과, category=document', () => {
      const r = validateAudioUpload(makeFile({ name: 'file.pdf', type: '' }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.category).toBe('document');
    });

    it('빈 MIME + 알 수 없는 확장자(.xyz) → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'file.xyz', type: '' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(415);
    });

    it('빈 MIME + 확장자 없음 → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'noext', type: '' }));
      expect(r.ok).toBe(false);
    });
  });

  describe('보안 거부 케이스', () => {
    it('video/mp4 → 거부 (동영상 비허용)', () => {
      const r = validateAudioUpload(makeFile({ name: 'movie.mp4', type: 'video/mp4' }));
      expect(r.ok).toBe(false);
    });

    it('executable (application/x-msdownload) → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'a.exe', type: 'application/x-msdownload' }));
      expect(r.ok).toBe(false);
    });

    it('text/html → 거부 (XSS via 파일명 시도)', () => {
      const r = validateAudioUpload(makeFile({ name: 'a.html', type: 'text/html' }));
      expect(r.ok).toBe(false);
    });

    it('확장자만 mp3로 위장한 video MIME → 거부 (MIME이 명시되면 화이트리스트 검증)', () => {
      const r = validateAudioUpload(makeFile({ name: 'fake.mp3', type: 'video/mp4' }));
      expect(r.ok).toBe(false);
    });

    it('application/zip → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'archive.zip', type: 'application/zip' }));
      expect(r.ok).toBe(false);
    });
  });

  describe('크기 거부 케이스', () => {
    // 상한은 요금제와 맞물린다 — 무료 워크스페이스(파일당 5 MiB)에서 20 MiB를 열어두면
    // 5~20 MiB 파일이 이 검증을 통과한 뒤 Notion 업로드 단계에서 거부된다(2026-08-01 사고).
    // 현재는 플러스 플랜(5 GiB)이라 single_part API 상한인 20 MiB가 실질 관문.
    it('상한은 Notion single_part 상한 20 MiB', () => {
      expect(MAX_AUDIO_BYTES).toBe(20 * 1024 * 1024);
    });

    it('상한 + 1바이트 → 413 + 상한이 문구에 표시', () => {
      const r = validateAudioUpload(makeFile({ size: MAX_AUDIO_BYTES + 1 }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(413);
        expect(r.error).toContain(`${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB`);
      }
    });

    it('size 0 → 400', () => {
      const r = validateAudioUpload(makeFile({ size: 0 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    });

    it('size가 숫자가 아님 → 400', () => {
      const r = validateAudioUpload(makeFile({ size: NaN }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    });
  });

  describe('MIME 파라미터 stripping (MediaRecorder)', () => {
    // MediaRecorder는 codec 정보를 MIME에 포함시킨다: `audio/webm;codecs=opus`.
    // RFC 7231 기준 파라미터는 옵셔널이므로 base만 화이트리스트에 매칭하면 충분.
    it('audio/webm;codecs=opus → 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'rec.webm', type: 'audio/webm;codecs=opus' }));
      expect(r.ok).toBe(true);
    });

    it('audio/ogg;codecs=opus → 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'rec.ogg', type: 'audio/ogg;codecs=opus' }));
      expect(r.ok).toBe(true);
    });

    it('audio/mp4;codecs=mp4a.40.2 (Safari) → 통과', () => {
      const r = validateAudioUpload(makeFile({ name: 'rec.m4a', type: 'audio/mp4;codecs=mp4a.40.2' }));
      expect(r.ok).toBe(true);
    });

    it('파라미터에 공백 끼어도 통과 (audio/webm ; codecs=opus)', () => {
      const r = validateAudioUpload(makeFile({ name: 'rec.webm', type: 'audio/webm ; codecs=opus' }));
      expect(r.ok).toBe(true);
    });
  });
});

describe('resolveAudioMime', () => {
  it('표준 MIME은 그대로 반환', () => {
    expect(resolveAudioMime({ name: 'a.mp3', type: 'audio/mpeg' })).toBe('audio/mpeg');
    expect(resolveAudioMime({ name: 'a.webm', type: 'audio/webm' })).toBe('audio/webm');
  });

  it('codec 파라미터 strip (audio/webm;codecs=opus → audio/webm)', () => {
    expect(resolveAudioMime({ name: 'a.webm', type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
  });

  it('빈 MIME (Windows .webm) → 확장자 기반 보정', () => {
    expect(resolveAudioMime({ name: 'rec.webm', type: '' })).toBe('audio/webm');
    expect(resolveAudioMime({ name: 'song.mp3', type: '' })).toBe('audio/mpeg');
    expect(resolveAudioMime({ name: 'song.m4a', type: '' })).toBe('audio/mp4');
  });

  it('application/octet-stream → 확장자 기반 보정', () => {
    expect(resolveAudioMime({ name: 'rec.webm', type: 'application/octet-stream' })).toBe('audio/webm');
  });

  it('document 확장자도 EXT_TO_MIME으로 보정 (pdf → application/pdf)', () => {
    expect(resolveAudioMime({ name: 'doc.pdf', type: '' })).toBe('application/pdf');
    expect(resolveAudioMime({ name: 'photo.png', type: '' })).toBe('image/png');
  });

  it('MIME도 확장자도 모를 때 application/octet-stream 폴백', () => {
    expect(resolveAudioMime({ name: 'noext', type: '' })).toBe('application/octet-stream');
  });

  it('null·undefined 안전 처리 — application/octet-stream 폴백', () => {
    expect(resolveAudioMime(null)).toBe('application/octet-stream');
    expect(resolveAudioMime(undefined)).toBe('application/octet-stream');
    expect(resolveAudioMime({})).toBe('application/octet-stream');
  });
});

describe('validateAudioUpload — 기타', () => {
  describe('null/undefined 입력', () => {
    it('null → 400', () => {
      const r = validateAudioUpload(null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    });

    it('undefined → 400', () => {
      const r = validateAudioUpload(undefined);
      expect(r.ok).toBe(false);
    });

    it('빈 객체 → 400', () => {
      const r = validateAudioUpload({});
      expect(r.ok).toBe(false);
    });
  });
});

describe('dedupeFileNames', () => {
  it('중복 없으면 그대로 반환', () => {
    expect(dedupeFileNames(['a.jpg', 'b.png', 'c.pdf'])).toEqual(['a.jpg', 'b.png', 'c.pdf']);
  });

  it('같은 이름 3개 → 첫 번째 보존 + (2)/(3) 접미사 (확장자 보존)', () => {
    expect(dedupeFileNames(['image.jpg', 'image.jpg', 'image.jpg']))
      .toEqual(['image.jpg', 'image (2).jpg', 'image (3).jpg']);
  });

  it('녹음 동명 파일도 확장자 보존하며 유일화', () => {
    expect(dedupeFileNames(['숙제_01.webm', '숙제_01.webm']))
      .toEqual(['숙제_01.webm', '숙제_01 (2).webm']);
  });

  it('기존에 이미 번호가 붙은 이름과도 충돌하지 않음', () => {
    expect(dedupeFileNames(['image.jpg', 'image (2).jpg', 'image.jpg']))
      .toEqual(['image.jpg', 'image (2).jpg', 'image (3).jpg']);
  });

  it('대소문자 무시 — 다운로드 라우트가 대소문자 구분 없이 충돌하는 경우 방지', () => {
    expect(dedupeFileNames(['Photo.JPG', 'photo.jpg']))
      .toEqual(['Photo.JPG', 'photo (2).jpg']);
  });

  it('확장자 없는 파일명도 처리', () => {
    expect(dedupeFileNames(['recording', 'recording']))
      .toEqual(['recording', 'recording (2)']);
  });

  it('빈/비문자열 입력 안전 처리', () => {
    expect(dedupeFileNames([])).toEqual([]);
    expect(dedupeFileNames(null)).toEqual([]);
    expect(dedupeFileNames(['', ''])).toEqual(['file', 'file (2)']);
  });
});
