const WORKER_URL = import.meta.env.VITE_WORKER_URL;

export async function submitConsultation({ name, phone, level, preferredDays, preferredTime, message }) {
  const res = await fetch(`${WORKER_URL}/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, level, preferredDays, preferredTime, message }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
