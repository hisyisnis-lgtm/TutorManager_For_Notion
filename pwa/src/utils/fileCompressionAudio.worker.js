/* global self */
import { Mp3Encoder } from '@breezystack/lamejs';

// JS 인코딩은 별도 Worker에서 실행해 첨부 모달의 입력/닫기를 막지 않는다.
self.onmessage = ({ data: { samples, sampleRate, kbps } }) => {
  try {
    self.postMessage({ stage: 'compressing' });
    const encoder = new Mp3Encoder(samples.length, sampleRate, kbps);
    const chunks = [];
    const chunkSize = 1152;
    const pcm = samples.map(() => new Int16Array(chunkSize));
    let lastProgress = 0;
    for (let offset = 0; offset < samples[0].length; offset += chunkSize) {
      const length = Math.min(chunkSize, samples[0].length - offset);
      for (let channel = 0; channel < samples.length; channel++) {
        for (let i = 0; i < length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[channel][offset + i]));
          pcm[channel][i] = sample * (sample < 0 ? 0x8000 : 0x7fff);
        }
      }
      const encoded = encoder.encodeBuffer(pcm[0].subarray(0, length), pcm[1]?.subarray(0, length));
      if (encoded.length) chunks.push(new Uint8Array(encoded));
      const progress = Math.floor(offset / samples[0].length * 20) / 20;
      if (progress > lastProgress) { self.postMessage({ progress }); lastProgress = progress; }
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    self.postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
  } catch {
    self.postMessage({ bytes: null });
  }
};
