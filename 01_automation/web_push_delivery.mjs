const DEFAULT_WORKER_URL = 'https://tutor-manager-proxy.hisyisnis.workers.dev';

export async function publishTeacherPush({ title, message, priority = 4, tags, url }, {
  workerUrl = process.env.PUSH_WORKER_URL || DEFAULT_WORKER_URL,
  token = process.env.PUSH_PUBLISH_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!token || !/^https:\/\/[^\s]+$/.test(workerUrl || '')) return { ok: false, reason: 'push_not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(`${workerUrl.replace(/\/$/, '')}/push/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, message, priority, tags, url }),
      redirect: 'error',
      signal: controller.signal,
    });
    return response.ok ? { ok: true } : { ok: false, reason: 'push_publish_failed' };
  } catch {
    return { ok: false, reason: 'push_publish_failed' };
  } finally {
    clearTimeout(timer);
  }
}
