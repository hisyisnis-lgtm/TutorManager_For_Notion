// 팬더 위젯 인터랙션 테스트 페이지 — /panda-test
import { useState } from 'react';
import PandaWidget from '../components/ui/PandaWidget.jsx';

const FEED_KEY = 'panda_fed_total';

export default function PandaTestPage() {
  const [totalSessions, setTotalSessions] = useState(5);
  const [fedDisplay, setFedDisplay] = useState(
    () => parseInt(localStorage.getItem(FEED_KEY) || '0', 10)
  );

  const resetFed = () => {
    localStorage.removeItem(FEED_KEY);
    window.location.reload();
  };

  // 슬라이더로 totalSessions 조절 시 fedDisplay도 동기화
  const handleSessionChange = (v) => {
    setTotalSessions(v);
    setFedDisplay(parseInt(localStorage.getItem(FEED_KEY) || '0', 10));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: '24px 20px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: 0 }}>
          🐼 팬더 위젯 테스트
        </h2>
        <p style={{ fontSize: 12, color: '#8c8c8c', margin: '4px 0 0' }}>
          슬라이더로 총 수업 횟수를 조절하세요
        </p>
      </div>

      {/* 컨트롤 패널 */}
      <div style={{
        background: 'white', borderRadius: 16, padding: '16px',
        marginBottom: 16, boxShadow: 'var(--shadow-card)',
      }}>
        <label style={{ fontSize: 13, color: '#595959', display: 'block', marginBottom: 10 }}>
          총 수업 횟수:{' '}
          <strong style={{ color: '#7f0005', fontVariantNumeric: 'tabular-nums' }}>
            {totalSessions}회
          </strong>
          {' '}/ 먹이 준 횟수:{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {parseInt(localStorage.getItem(FEED_KEY) || '0', 10)}회
          </strong>
        </label>
        <input
          type="range"
          min={0}
          max={150}
          value={totalSessions}
          onChange={e => handleSessionChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#7f0005' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa', marginTop: 2 }}>
          <span>0회</span>
          <span>50회</span>
          <span>100회</span>
          <span>150회</span>
        </div>

        {/* 빠른 설정 버튼 */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {[0, 1, 9, 10, 24, 25, 49, 50, 99, 100].map(v => (
            <button
              key={v}
              onClick={() => handleSessionChange(v)}
              style={{
                padding: '3px 10px', borderRadius: 8, border: '1.5px solid',
                borderColor: totalSessions === v ? '#7f0005' : '#e5e5e5',
                background: totalSessions === v ? '#fff0f1' : 'white',
                color: totalSessions === v ? '#7f0005' : '#595959',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {v}회
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
      <PandaWidget totalSessions={totalSessions} key={totalSessions + '-' + fedDisplay} />

      <p style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 16 }}>
        먹이 기록은 localStorage에 저장됩니다
      </p>
    </div>
  );
}
