import { useState, useEffect } from 'react';

/**
 * TabPanel — 탭 패널 페이드인 래퍼
 * tabFadeIn 키프레임은 index.css에 정의되어 있습니다.
 */
export default function TabPanel({ active, id, labelledBy, children }) {
  const [visible, setVisible] = useState(active);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setAnimKey(k => k + 1);
    } else {
      setVisible(false);
    }
  }, [active]);

  return (
    <div
      role="tabpanel" id={id} aria-labelledby={labelledBy}
      style={{ display: visible ? 'block' : 'none' }}
    >
      <div key={animKey} style={{
        animation: active ? 'tabFadeIn 0.35s ease forwards' : 'none',
      }}>
        {children}
      </div>
    </div>
  );
}
