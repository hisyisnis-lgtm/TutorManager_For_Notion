// 팬더 위젯 인터랙션 테스트 페이지 — /panda-test
import { useState } from 'react';
import PandaWidget from '../components/ui/PandaWidget.jsx';

// 테스트 전용 키 — PersonalPage의 실제 데이터와 분리
const FEED_KEY = 'panda_test_fed_total';

export default function PandaTestPage() {
  // 완료된 수업 시간(분) — 30분당 먹이 1개로 환산
  const [completedMinutes, setCompletedMinutes] = useState(150);
  const [fedDisplay, setFedDisplay] = useState(
    () => parseInt(localStorage.getItem(FEED_KEY) || '0', 10)
  );

  const foodCount = Math.floor(completedMinutes / 30);

  const resetFed = () => {
    localStorage.removeItem(FEED_KEY);
    window.location.reload();
  };

  const handleMinutesChange = (v) => {
    setCompletedMinutes(v);
    setFedDisplay(parseInt(localStorage.getItem(FEED_KEY) || '0', 10));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: '24px 20px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: 0 }}>
          🐼 팬더 위젯 테스트
        </h2>
        <p style={{ fontSize: 12, color: '#8c8c8c', margin: '4px 0 0' }}>
          슬라이더로 완료된 수업 시간(분)을 조절하세요 — 30분당 먹이 1개
        </p>
      </div>

      {/* 컨트롤 패널 */}
      <div style={{
        background: 'white', borderRadius: 16, padding: '16px',
        marginBottom: 16, boxShadow: 'var(--shadow-card)',
      }}>
        <label style={{ fontSize: 13, color: '#595959', display: 'block', marginBottom: 10 }}>
          완료 수업 시간:{' '}
          <strong style={{ color: '#7f0005', fontVariantNumeric: 'tabular-nums' }}>
            {completedMinutes}분
          </strong>
          {' '}→ 먹이{' '}
          <strong style={{ color: '#7f0005', fontVariantNumeric: 'tabular-nums' }}>
            {foodCount}개
          </strong>
          {' '}/ 먹인 횟수:{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {parseInt(localStorage.getItem(FEED_KEY) || '0', 10)}회
          </strong>
        </label>
        <input
          type="range"
          min={0}
          max={3000}
          step={10}
          value={completedMinutes}
          onChange={e => handleMinutesChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#7f0005' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa', marginTop: 2 }}>
          <span>0분</span>
          <span>1000분</span>
          <span>2000분</span>
          <span>3000분</span>
        </div>

        {/* 빠른 설정 버튼 — 레벨 경계에 맞춘 분 값 */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {[0, 30, 270, 300, 720, 750, 1470, 1500, 2970, 3000].map(v => (
            <button
              key={v}
              onClick={() => handleMinutesChange(v)}
              style={{
                padding: '3px 10px', borderRadius: 8, border: '1.5px solid',
                borderColor: completedMinutes === v ? '#7f0005' : '#e5e5e5',
                background: completedMinutes === v ? '#fff0f1' : 'white',
                color: completedMinutes === v ? '#7f0005' : '#595959',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {v}분
            </button>
          ))}
        </div>

        <button
          onClick={resetFed}
          style={{
            marginTop: 12, width: '100%', height: 36, borderRadius: 10,
            border: '1.5px solid #f0f0f0', background: 'white',
            color: '#7f0005', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          🔄 먹이 기록 초기화 (새로고침)
        </button>
      </div>

      {/* 팬더 위젯 */}
      <PandaWidget
        foodSources={[
          { key: 'sessions', label: '완료 수업', count: foodCount },
          { key: 'referral', label: '친구 추천', count: 0 },
        ]}
        storageKey={FEED_KEY}
        key={completedMinutes + '-' + fedDisplay}
      />

      <p style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 16 }}>
        먹이 기록은 localStorage에 저장됩니다
      </p>
    </div>
  );
}
