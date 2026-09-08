import { isPrivateNtfyTopic } from './ntfyPrivacy.js';

// The topic and ntfy credential remain on the server. The caller must authorize
// the teacher before entering this handler. No caller-selected topic or host.
export function notificationMessage(raw) {
  if (!raw || typeof raw !== 'object' || !['message', 'open', 'keepalive'].includes(raw.event)) return null;
  return {
    event: raw.event,
    id: String(raw.id || '').slice(0, 128),
    time: Number.isFinite(raw.time) ? raw.time : 0,
    title: String(raw.title || '').slice(0, 512),
    message: String(raw.message || '').slice(0, 16384),
    priority: [1, 2, 3, 4, 5].includes(raw.priority) ? raw.priority : 3,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string').slice(0, 10).map(tag => tag.slice(0, 64)) : [],
  };
}

export async function teacherNotifications(request, env, corsHeaders) {
  if (!env.NTFY_TOPIC || !env.NTFY_TOKEN) return Response.json({ error: '알림 연결이 설정되지 않았습니다.' }, { status: 503, headers: corsHeaders });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(env.NTFY_TOPIC)) return Response.json({ error: '알림 연결 설정을 확인해주세요.' }, { status: 503, headers: corsHeaders });
  if (!(await isPrivateNtfyTopic(env, env.NTFY_TOPIC))) return Response.json({ error: '비공개 알림 채널을 확인할 수 없습니다. 설정을 확인해주세요.' }, { status: 503, headers: corsHeaders });
  const stream = new URL(request.url).searchParams.get('stream') === '1';
  const url = `https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}/${stream ? 'sse' : 'json?poll=1&since=24h'}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener('abort', abort, { once: true });
  // Reconnect periodically so an open stream cannot outlive the auth boundary.
  const timer = setTimeout(abort, stream ? 60000 : 15000);
  let upstream;
  try {
    upstream = await fetch(url, { headers: { Authorization: `Bearer ${env.NTFY_TOKEN}` }, redirect: 'error', signal: controller.signal });
    if (!upstream.ok || !upstream.body) throw new Error('notification upstream unavailable');
    const reader = upstream.body.getReader();
    let bytes = 0;
    let pending = '';
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const emitLine = (line, output) => {
      if (stream && !line.startsWith('data:')) return;
      try {
        const data = notificationMessage(JSON.parse(stream ? line.slice(5).trim() : line));
        if (data) output.enqueue(encoder.encode(`${stream ? 'data: ' : ''}${JSON.stringify(data)}${stream ? '\n\n' : '\n'}`));
      } catch { /* Malformed upstream messages are never forwarded. */ }
    };
    const cleanup = () => { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); };
    const body = new ReadableStream({
      async pull(output) {
        try {
          const item = await reader.read();
          if (item.done) {
            pending += decoder.decode();
            if (pending.trim()) emitLine(pending, output);
            cleanup(); output.close(); return;
          }
          bytes += item.value.byteLength;
          if (bytes > 2 * 1024 * 1024) { cleanup(); controller.abort(); output.error(new Error('알림 응답이 너무 큽니다.')); return; }
          pending += decoder.decode(item.value, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop();
          if (pending.length > 64 * 1024) throw new Error('알림 응답이 너무 큽니다.');
          for (const line of lines) emitLine(line, output);
        } catch (error) { cleanup(); controller.abort(); output.error(error); }
      },
      async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { headers: { ...corsHeaders, 'Content-Type': stream ? 'text/event-stream' : 'application/x-ndjson', 'Cache-Control': 'private, no-store' } });
  } catch {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
    return Response.json({ error: '알림을 불러올 수 없습니다.' }, { status: 502, headers: corsHeaders });
  }
}
