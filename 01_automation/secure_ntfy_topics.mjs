// Run from the repository root. Credentials stay in the runner environment.
// ntfy /v1/account contains tokens and personal data: never log its raw response.
import { pathToFileURL } from 'node:url';

export const TOPIC_KEYS = [
  'NTFY_TOPIC', 'NTFY_TOPIC_CRITICAL', 'NTFY_TOPIC_WARN',
  'NTFY_TOPIC_DIGEST', 'NTFY_TOPIC_OPS',
];
const BASE = 'https://ntfy.sh';

class SafeError extends Error {}

export async function secureTopics({ env = process.env, fetchImpl = fetch, mode = 'check' } = {}) {
  if (!['check', 'apply'].includes(mode)) throw new SafeError('Invalid mode');
  const token = env.NTFY_TOKEN?.trim();
  if (!token) throw new SafeError('NTFY_TOKEN is missing');
  const topics = TOPIC_KEYS.map(alias => ({ alias, topic: env[alias]?.trim() }));
  if (topics.some(({ topic }) => !topic || !/^[-_A-Za-z0-9]{1,64}$/.test(topic))) {
    throw new SafeError('A configured topic is missing or invalid');
  }

  async function request(path, { authenticated = true, method = 'GET', body } = {}) {
    try {
      return await fetchImpl(`${BASE}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // Native fetch errors can include credential-bearing paths; never forward them.
      throw new SafeError('ntfy request failed or timed out');
    }
  }
  async function account() {
    const response = await request('/v1/account');
    if (!response.ok) {
      await response.body?.cancel();
      throw new SafeError(`ntfy account access failed (HTTP ${response.status})`);
    }
    try { return await response.json(); }
    catch { throw new SafeError('ntfy account returned invalid JSON'); }
  }

  let data = await account();
  const reservations = Array.isArray(data.reservations) ? data.reservations : [];
  const uniqueTopics = [...new Set(topics.map(item => item.topic))];
  const additional = uniqueTopics.filter(topic => !reservations.some(item => item.topic === topic));
  const remaining = Number.isInteger(data.stats?.reservations_remaining)
    ? Math.max(0, data.stats.reservations_remaining) : 0;
  const result = {
    mode,
    reservationLimit: Number.isInteger(data.limits?.reservations) ? data.limits.reservations : null,
    additionalReservationsNeeded: additional.length,
    remainingReservations: remaining,
    capacitySufficient: additional.length <= remaining,
    topics: [],
  };

  if (mode === 'apply') {
    if (!result.capacitySufficient) throw new SafeError('Insufficient existing topic reservation capacity; no billing changes made');
    for (const topic of uniqueTopics) {
      if (reservations.some(item => item.topic === topic && item.everyone === 'deny-all')) continue;
      const response = await request('/v1/account/reservation', {
        method: 'POST', body: { topic, everyone: 'deny-all' },
      });
      await response.body?.cancel();
      if (!response.ok) throw new SafeError(`Topic protection failed (HTTP ${response.status}); rerun check for partial progress`);
    }
    data = await account();
  }

  for (const { alias, topic } of topics) {
    const reservation = data.reservations?.find(item => item.topic === topic);
    // /auth only checks read access: no messages are fetched or published.
    const anonymous = await request(`/${topic}/auth`, { authenticated: false });
    await anonymous.body?.cancel();
    const authenticated = await request(`/${topic}/auth`);
    await authenticated.body?.cancel();
    result.topics.push({
      alias,
      owned: Boolean(reservation),
      everyoneDenied: reservation?.everyone === 'deny-all',
      anonymousReadStatus: anonymous.status,
      authenticatedReadStatus: authenticated.status,
      protected: reservation?.everyone === 'deny-all'
        && [401, 403].includes(anonymous.status) && authenticated.ok,
    });
  }
  result.allProtected = result.topics.every(item => item.protected);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await secureTopics({ mode: process.env.NTFY_SECURITY_MODE || 'check' });
    console.log(JSON.stringify(result, null, 2));
    if (result.mode === 'apply' && !result.allProtected) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof SafeError ? error.message : 'ntfy security check failed; response details withheld');
    process.exitCode = 1;
  }
}
