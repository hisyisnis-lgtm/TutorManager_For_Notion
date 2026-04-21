import { WORKER_URL } from '../config.js';

export async function submitConsultation({ name, phone, kakaoId, level, preferredDays, preferredTime, concerns, reasons, reasonOther, message }) {
  const res = await fetch(`${WORKER_URL}/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, kakaoId, level, preferredDays, preferredTime, concerns, reasons, reasonOther, message }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
