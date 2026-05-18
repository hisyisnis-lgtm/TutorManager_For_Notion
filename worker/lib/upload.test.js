import { describe, it, expect } from 'vitest';
import { validateAudioUpload, resolveAudioMime, MAX_AUDIO_BYTES } from './upload.js';

// File 객체를 모킹 — Workers/Vitest 환경에서 Blob의 name·type만 필요.
function makeFile({ name = 'audio.mp3', type = 'audio/mpeg', size = 1024 } = {}) {
  return { name, type, size };
}

describe('validateAudioUpload', () => {
  describe('정상 케이스', () => {
    it('표준 MIME (mp3, m4a, webm, wav 등) 통과', () => {
      const types = [
        'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg',
        'audio/wav', 'audio/x-m4a', 'audio/aac', 'audio/flac',
      ];
      for (const type of types) {
        const r = validateAudioUpload(makeFile({ type }));
        expect(r.ok, type).toBe(true);
      }
    });

    it('MIME 대소문자 무시', () => {
      const r = validateAudioUpload(makeFile({ type: 'AUDIO/MPEG' }));
      expect(r.ok).toBe(true);
    });

    it('Notion 단편 모드 상한 정확히 (20 MiB)', () => {
      const r = validateAudioUpload(makeFile({ size: MAX_AUDIO_BYTES }));
      expect(r.ok).toBe(true);
    });
  });

  describe('MIME 누락 fallback (모바일 브라우저)', () => {
    it('빈 MIME + 허용 확장자 → 통과', () => {
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

    it('빈 MIME + 알 수 없는 확장자 → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'file.pdf', type: '' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(415);
    });

    it('빈 MIME + 확장자 없음 → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'noext', type: '' }));
      expect(r.ok).toBe(false);
    });
  });

  describe('보안 거부 케이스', () => {
    it('image/png → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'photo.png', type: 'image/png' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(415);
    });

    it('application/pdf → 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'doc.pdf', type: 'application/pdf' }));
      expect(r.ok).toBe(false);
    });

    it('video/mp4 → 거부 (오디오만 허용)', () => {
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

    it('확장자만 mp3로 위장한 image MIME → 거부 (MIME이 명시되면 화이트리스트 검증)', () => {
      const r = validateAudioUpload(makeFile({ name: 'fake.mp3', type: 'image/png' }));
      expect(r.ok).toBe(false);
    });
  });

  describe('크기 거부 케이스', () => {
    it('20 MiB + 1바이트 → 413', () => {
      const r = validateAudioUpload(makeFile({ size: MAX_AUDIO_BYTES + 1 }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(413);
        expect(r.error).toContain('20 MB');
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

    it('image/png;charset=utf-8 같은 비-오디오 파라미터 MIME은 여전히 거부', () => {
      const r = validateAudioUpload(makeFile({ name: 'a.png', type: 'image/png;charset=utf-8' }));
      expect(r.ok).toBe(false);
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

  it('MIME도 확장자도 모를 때 audio/mpeg 폴백', () => {
    expect(resolveAudioMime({ name: 'noext', type: '' })).toBe('audio/mpeg');
  });

  it('null·undefined 안전 처리', () => {
    expect(resolveAudioMime(null)).toBe('audio/mpeg');
    expect(resolveAudioMime(undefined)).toBe('audio/mpeg');
    expect(resolveAudioMime({})).toBe('audio/mpeg');
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
