import { useState, useEffect, useCallback } from 'react';

const TIPS_KEY = 'tab_tips_v1';

function getSeenMap() {
  try { return JSON.parse(localStorage.getItem(TIPS_KEY) || '{}'); }
  catch { return {}; }
}

/**
 * 탭별 튜토리얼 팁 표시 상태를 관리하는 훅.
 *
 * @param {string}  tabKey        - 탭 식별 키
 * @param {boolean} onboardingDone - 온보딩 완료 여부
 * @param {number}  resetKey      - 이 값이 바뀌면 seen 상태를 재확인해 visible 재계산
 */
export function useTabTip(tabKey, onboardingDone, resetKey = 0) {
  const [visible, setVisible] = useState(() => {
    if (!onboardingDone) return false;
    const seen = getSeenMap();
    return !seen[tabKey];
  });

  useEffect(() => {
    if (!onboardingDone) return;
    const seen = getSeenMap();
    if (!seen[tabKey]) setVisible(true);
  }, [onboardingDone, tabKey, resetKey]);

  const dismiss = useCallback(() => {
    setVisible(false);
    const seen = getSeenMap();
    seen[tabKey] = true;
    localStorage.setItem(TIPS_KEY, JSON.stringify(seen));
  }, [tabKey]);

  return { visible, dismiss };
}

/** 설정 등에서 모든 탭 팁을 초기화할 때 사용 */
export function resetAllTabTips() {
  localStorage.removeItem(TIPS_KEY);
}
