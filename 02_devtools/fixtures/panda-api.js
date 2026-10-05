// Browser-only simulated server for the isolated preview, never imported by the app build.
import { getPandaFoodBalance, normalizePandaGameProfile } from '../../pwa/src/constants/pandaGameState.js';
import { applyPandaAction, PandaActionSchema } from '../../worker/lib/pandaRules.js';

export function createPandaFixtureApi({ storageKey, query = new URLSearchParams(window.location.search) }) {
  const integer = (key, fallback) => Math.max(0, Math.min(999, Math.floor(Number(query.get(key) ?? fallback) || 0)));
  const earnedTotal = integer('fed', 3) + integer('available', 5);
  const serverKey = `${storageKey}_fixture_server`;
  const receiptKey = `${serverKey}_receipts`;
  const transitionKey = `${serverKey}_transition`;
  const failure = query.get('failure');
  const failureAction = query.get('failureAction') || 'nickname';
  const failureAt = Math.max(1, integer('failureAt', 1));
  let failed = false;
  let matchingActions = 0;
  const responseDelay = Math.max(0, Math.min(15000, Math.floor(Number(query.get('delay')) || 0)));
  const delay = () => new Promise(resolve => setTimeout(resolve, responseDelay));
  const profile = () => normalizePandaGameProfile(JSON.parse(localStorage.getItem(serverKey)));
  const transition = () => {
    const saved = JSON.parse(localStorage.getItem(transitionKey));
    if (saved) return saved;
    const value = { version: 1, initializedAt: new Date().toISOString(), startingFood: earnedTotal, noticeSeen: query.get('transition') !== '1' };
    localStorage.setItem(transitionKey, JSON.stringify(value));
    return value;
  };
  const snapshot = () => { const current = profile(); return { profile: current, earnedTotal, availableFood: getPandaFoodBalance(current, earnedTotal), transition: transition() }; };
  return {
    fetchPandaProfile: async () => {
      await delay();
      if (failure === 'load-once' && !failed) { failed = true; throw new Error('예시 서버 연결을 다시 확인해 주세요.'); }
      return snapshot();
    },
    performPandaAction: async (_student, action) => {
      await delay();
      const parsed = PandaActionSchema.safeParse(action);
      if (!parsed.success) throw Object.assign(new Error('잘못된 판다 요청이에요.'), { status: 400, code: 'invalid_action' });
      action = parsed.data;
      const receipts = JSON.parse(localStorage.getItem(receiptKey) || '{}');
      const signature = JSON.stringify(action);
      const receipt = receipts[action.requestId];
      if (receipt) {
        if (receipt.signature !== signature) throw Object.assign(new Error('같은 요청 번호로 다른 작업을 보낼 수 없습니다.'),
          { status: 409, code: 'request_id_reused', snapshot: snapshot() });
        return { ...snapshot(), ok: true, action: receipt.action, replayed: true };
      }
      if (action.type === failureAction) matchingActions += 1;
      const injectFailure = action.type === failureAction && matchingActions === failureAt && !failed;
      if (failure === 'reject-once' && injectFailure) {
        failed = true;
        throw Object.assign(new Error('예시 착용 요청이 거절됐어요. 다시 시도해 주세요.'), { status: 409, code: 'fixture_rejected', snapshot: snapshot() });
      }
      const current = profile();
      if (current.revision !== action.expectedRevision) throw Object.assign(new Error('다른 화면에서 기록이 바뀌었어요.'), { status: 409, code: 'revision_conflict', snapshot: snapshot() });
      const serverProfile = { ...current };
      delete serverProfile.version;
      delete serverProfile.revision;
      const next = normalizePandaGameProfile({ ...applyPandaAction(serverProfile, action, earnedTotal), revision: current.revision + 1 });
      localStorage.setItem(serverKey, JSON.stringify(next));
      if (action.type === 'dismiss-transition') localStorage.setItem(transitionKey, JSON.stringify({ ...transition(), noticeSeen: true }));
      receipts[action.requestId] = { signature, action: { type: action.type, requestId: action.requestId } };
      localStorage.setItem(receiptKey, JSON.stringify(receipts));
      if (failure === 'lost-once' && injectFailure) {
        failed = true; throw new Error('예시 응답이 유실됐어요. 결과를 다시 확인해 주세요.');
      }
      return { ...snapshot(), ok: true, action: receipts[action.requestId].action };
    },
  };
}
