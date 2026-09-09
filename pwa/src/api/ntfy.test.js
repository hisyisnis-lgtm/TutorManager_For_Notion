import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNtfyTopic, saveNtfyTopic, subscribeNtfyTopic } from './ntfy.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('ntfy 연결 설정', () => {
  it('코드를 trim하여 저장하고 인증정보를 바꾸지 않는다', () => {
    localStorage.setItem('auth_token', 'unchanged');
    expect(saveNtfyTopic('  Example_topic-1  ')).toBe('Example_topic-1');
    expect(getNtfyTopic()).toBe('Example_topic-1');
    expect(localStorage.getItem('auth_token')).toBe('unchanged');
  });

  it.each(['https://ntfy.sh/topic', '../private', '공백 코드', 'a'.repeat(129)])('잘못된 코드 %s는 기존 설정을 덮어쓰지 않는다', (value) => {
    saveNtfyTopic('existing');
    expect(() => saveNtfyTopic(value)).toThrow('알림 코드는');
    expect(getNtfyTopic()).toBe('existing');
  });

  it('동일 코드는 캐시를 유지하고 변경·해제는 이력과 읽음 기록을 비운다', () => {
    saveNtfyTopic('existing');
    sessionStorage.setItem('ntfy_notifications', 'cache');
    sessionStorage.setItem('ntfy_last_read', '123');
    const changed = vi.fn(); const unsubscribe = subscribeNtfyTopic(changed);
    saveNtfyTopic('existing');
    expect(sessionStorage.getItem('ntfy_notifications')).toBe('cache');
    expect(changed).not.toHaveBeenCalled();
    saveNtfyTopic('');
    expect(getNtfyTopic()).toBe('');
    expect(sessionStorage.getItem('ntfy_notifications')).toBeNull();
    expect(sessionStorage.getItem('ntfy_last_read')).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
