import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CaretLeftIcon } from '@phosphor-icons/react';
import PandaWidget, { PANDA_FEED_KEY, getPandaStorageKey, getStageInfo } from '../components/ui/PandaWidget.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { GRADIENTS, PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, STATUS_ERROR_TEXT } from '../constants/theme.js';

const COACH_KEY = 'panda_coach_seen';

export default function PandaPage() {
  const { studentToken } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState(false);
  const [showCoach, setShowCoach] = useState(false);
  const coachTimerRef = useRef(null);

  useEffect(() => {
    if (!studentToken) { navigate(-1); return; }
    // 옛 공통 키(`panda_fed_total`)에 다른 학생/세션의 누적값이 남아있으면 정리.
    // 학생별 키 도입 전 잔존물이라 어느 학생 것인지 알 수 없어 단순 삭제가 맞음.
    try { localStorage.removeItem(PANDA_FEED_KEY); } catch {}
    fetchStudentByToken(studentToken)
      .then((data) => {
        setStudent(data);
        if (!localStorage.getItem(COACH_KEY)) {
          coachTimerRef.current = setTimeout(() => setShowCoach(true), 600);
        }
      })
      .catch(() => setError(true));
    return () => clearTimeout(coachTimerRef.current);
  }, [studentToken, navigate]);

  const dismissCoach = () => {
    localStorage.setItem(COACH_KEY, '1');
    setShowCoach(false);
  };

  const foodSources = student ? [
    { key: 'sessions', label: '완료 수업', count: student.totalSessions ?? 0 },
    { key: 'referral', label: '친구 추천', count: student.referralBonus ?? 0 },
  ] : [];

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#f9fafb' }}>
      {/* 헤더 */}
      <div style={{
        flexShrink: 0,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          height: 56, display: 'flex', alignItems: 'center', padding: '0 16px',
        }}>
          <button
            onClick={() => navigate(-1)}
            aria-label="뒤로"
            className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, marginLeft: -8, padding: 0,
              border: 'none', background: 'none', cursor: 'pointer',
              color: TEXT_SECONDARY, WebkitTapHighlightColor: 'transparent', flexShrink: 0,
            }}
          >
            <CaretLeftIcon weight="bold" size={20} />
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, flex: 1 }}>
            내 팬더
          </h1>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxWidth: 480, width: '100%', margin: '0 auto', padding: '16px 20px 20px' }}>
          {error ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: STATUS_ERROR_TEXT, fontSize: 14 }}>
              정보를 불러오지 못했어요
            </div>
          ) : !student ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LoadingSpinner />
            </div>
          ) : (
            <PandaWidget
              foodSources={foodSources}
              storageKey={getPandaStorageKey(studentToken)}
              fullscreen
            />
          )}
        </div>
      </div>

      {/* 코치마크 오버레이 */}
      {showCoach && (
        <div
          onClick={dismissCoach}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '0 32px',
            animation: 'fade-in 200ms ease-out both',
          }}
        >
          <div style={{
            background: '#fff', borderRadius: 20,
            padding: '28px 24px', maxWidth: 320, width: '100%',
            textAlign: 'center',
            animation: 'fade-in-up 250ms cubic-bezier(0.2,0,0,1) both',
          }}>
            <p style={{ fontSize: 36, margin: '0 0 12px', lineHeight: 1 }}>🐼</p>
            <p style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 10px', wordBreak: 'keep-all' }}>
              내 팬더를 키워보세요!
            </p>
            <div style={{ fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.65, margin: '0 0 20px', wordBreak: 'keep-all' }}>
              <p style={{ margin: '0 0 8px' }}>수업을 완료하면 <strong style={{ color: PRIMARY }}>먹이</strong>가 생겨요.</p>
              <p style={{ margin: '0 0 8px' }}><strong style={{ color: PRIMARY }}>먹이주기</strong>를 누르면 팬더가 성장해요.</p>
              <p style={{ margin: 0 }}><strong style={{ color: PRIMARY }}>쓰다듬기</strong>로 팬더를 응원해 주세요 ❤️</p>
            </div>
            <button
              onClick={dismissCoach}
              style={{
                width: '100%', height: 48, borderRadius: 12,
                background: GRADIENTS.panda,
                color: '#fff', fontSize: 15, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              시작하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
