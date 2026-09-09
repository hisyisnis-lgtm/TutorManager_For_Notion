const TOPIC_KEY = 'ntfy_topic';
const CHANGE_EVENT = 'ntfy-topic-changed';
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function getNtfyTopic() {
  try {
    const value = localStorage.getItem(TOPIC_KEY) || '';
    return TOPIC_PATTERN.test(value) ? value : '';
  } catch { return ''; }
}

export function clearNtfyHistory() {
  sessionStorage.removeItem('ntfy_notifications');
  sessionStorage.removeItem('ntfy_last_read');
  sessionStorage.removeItem('ntfy_history_topic');
}

export function saveNtfyTopic(value) {
  const topic = value.trim();
  if (topic && !TOPIC_PATTERN.test(topic)) {
    throw new Error('알림 코드는 영문·숫자·밑줄(_)·하이픈(-)만 128자까지 입력해 주세요.');
  }
  const previous = getNtfyTopic();
  if (topic) localStorage.setItem(TOPIC_KEY, topic);
  else localStorage.removeItem(TOPIC_KEY);
  if (previous !== topic) {
    clearNtfyHistory();
    window.dispatchEvent(new window.Event(CHANGE_EVENT));
  }
  return topic;
}

export function subscribeNtfyTopic(listener) {
  const onStorage = (event) => {
    if (event.key === TOPIC_KEY || event.key === null) {
      clearNtfyHistory();
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
