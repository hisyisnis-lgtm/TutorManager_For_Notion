import {
  useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import { CheckIcon } from '@phosphor-icons/react';
import { createLessonLog, fetchLogsByClassIds } from '../../api/lessonLogs.js';
import { invalidateCache } from '../../hooks/useCachedResource.js';
import { formatTime,
  KST } from '../../utils/dateUtils.js';
import { PRIMARY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  GRAY_100,
  TEXT_INACTIVE } from '../../constants/theme.js';

// hwRequired=false(비VIP·학생 없는 수업)면 숙제 버튼을 아예 내지 않는다 — 눌러봐야 출제 폼에서 막히는 막다른 길이었다.
export default function PendingClassCard({ cls, studentName, hwDone, hwRequired = true }) {
  const navigate = useNavigate();
  const [creatingLog, setCreatingLog] = useState(false);

  // writtenLogId = 내용이 있는 일지, anyLogId = 자동 생성된 빈 일지 포함 아무 일지.
  // 쓴 일지가 있으면 그걸 열고(수정), 빈 일지만 있으면 그 빈 일지를 **편집 화면으로** 연다(새로 만들지 않음).
  const writtenLogId = cls.writtenLogId ?? null;
  const anyLogId = cls.anyLogId ?? cls.lessonLogIds?.[0] ?? null;
  const logDone = !!writtenLogId;

  const timeStr = cls.datetime
    ? new Date(cls.datetime).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';

  const handleHwClick = () => {
    if (hwDone) return;
    // 완료 표시는 여기서 하지 않는다 — 클릭만 하고 저장 없이 나와도 '완료'로 남던 버그(2026-08-30).
    // fromClassId를 넘기면 HomeworkFormPage가 **저장 성공 시** markPendingHwDone으로 기록한다.
    const hwLink = cls.studentIds.length === 1
      ? `/homework/new?studentId=${cls.studentIds[0]}&fromClassId=${cls.id}`
      : `/homework/new?fromClassId=${cls.id}`;
    navigate(hwLink);
  };

  const handleLogClick = async () => {
    if (writtenLogId) {
      // 이미 쓴 일지는 **읽기 전용 상세**로. 편집은 거기서 '편집' 버튼으로.
      navigate(`/logs/${writtenLogId}`);
      return;
    }
    if (anyLogId) {
      // 자동 생성된 빈 일지 — 바로 편집 화면으로.
      navigate(`/logs/${anyLogId}/edit`);
      return;
    }
    setCreatingLog(true);
    try {
      // 캐시가 오래됐을 수 있다 — 자동화가 그새 빈 일지를 만들었으면 그걸 쓴다(같은 수업에 일지 2개 생기던 사고, 2026-09-04).
      const fresh = (await fetchLogsByClassIds([cls.id]))[cls.id];
      const existing = fresh?.writtenLogId ?? fresh?.anyLogId;
      if (existing) {
        navigate(fresh.writtenLogId ? `/logs/${existing}` : `/logs/${existing}/edit`);
        return;
      }
      const dateStr = cls.datetime
        ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric' })
        : '';
      const created = await createLessonLog({
        title: `${studentName || ''} ${dateStr}`.trim(),
        classId: cls.id,
        studentIds: cls.studentIds,
      });
      invalidateCache('lessonLogs');
      navigate(`/logs/${created.id}/edit`);
    } catch (e) {
      toast.error(`일지 생성 실패: ${e.message}`);
      setCreatingLog(false);
    }
  };

  // 아직 안 한 일(숙제 부여·일지 작성) — **흰 면 + 테두리**로 카드 위에 얹힌 버튼처럼 세운다.
  // 회색 면은 카드 배경에 가라앉아 '이미 끝난 것'으로 읽힌다(2026-08-27 지적).
  // ⛔ 연한 브랜드 면(PRIMARY_BG)으로 채우지 말 것(design_system §18-1) — 강조는 글자색으로.
  const activeBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: '#fff', color: PRIMARY,
    fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', boxShadow: 'var(--shadow-border)', cursor: 'pointer',
    transition: 'background-color 150ms ease-out',
  };
  const doneBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: GRAY_100, color: TEXT_INACTIVE,
    fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    border: 'none', cursor: 'default',
  };
  // 이미 일지가 있어 '고치러 가는' 버튼 — 할 일이 아니라 회색 면에 가라앉힌다.
  // 위 doneBtn('숙제 부여 완료')과 같은 층이다.
  const editBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: GRAY_100, color: TEXT_SECONDARY,
    fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer',
  };

  return (
    <div
      style={{
        borderRadius: 16, background: '#fff', boxShadow: 'var(--shadow-border)',
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {studentName || cls.title || '학생 미정'}
          </p>
          <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0' }} className="tabular-nums">
            {timeStr}{endTimeStr && `–${endTimeStr}`} 수업 완료
          </p>
        </div>
        {/* ⛔ '완료'(직접 치우기) 버튼은 없앴다(2026-08-27).
            이 목록은 **오늘 수업만** 조회해서 자정이 지나면 저절로 사라지고,
            숙제 부여·일지 작성이 둘 다 끝나도 즉시 사라진다. 치울 길은 전체 목록 화면의 '모두 완료'에 남아 있다. */}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {hwRequired && (
        <button
          onClick={handleHwClick}
          disabled={hwDone}
          className={hwDone ? '' : 'transition-[background-color] duration-150 ease-out'}
          style={hwDone ? doneBtn : activeBtn}
        >
          {hwDone && (
            <span style={{ display: 'inline-flex', animation: 'badge-in 300ms var(--ease-out) both' }}>
              <CheckIcon size={16} weight="bold" />
            </span>
          )}
          {hwDone ? '숙제 부여 완료' : '숙제 부여'}
        </button>
        )}
        <button
          onClick={handleLogClick}
          disabled={creatingLog}
          className={creatingLog ? '' : 'transition-[background-color] duration-150 ease-out'}
          style={logDone ? editBtn : { ...activeBtn, opacity: creatingLog ? 0.5 : 1 }}
        >
          {creatingLog ? '생성 중...' : logDone ? '일지 수정' : '일지 작성'}
        </button>
      </div>
    </div>
  );
}
