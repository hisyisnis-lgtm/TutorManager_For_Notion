import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon } from '@phosphor-icons/react';
import { createLessonLog } from '../../api/lessonLogs.js';
import { formatTime } from '../../utils/dateUtils.js';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_TERTIARY } from '../../constants/theme.js';

const KST = 'Asia/Seoul';

export default function PendingClassCard({ cls, studentName, hwDone, onHwClick, onDismiss }) {
  const navigate = useNavigate();
  const [creatingLog, setCreatingLog] = useState(false);

  const logId = cls.lessonLogIds?.[0];
  const logDone = !!logId;

  const timeStr = cls.datetime
    ? new Date(cls.datetime).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';

  const handleHwClick = () => {
    if (hwDone) return;
    onHwClick(cls.id);
    const hwLink = cls.studentIds.length === 1
      ? `/homework/new?studentId=${cls.studentIds[0]}`
      : '/homework/new';
    navigate(hwLink);
  };

  const handleLogClick = async () => {
    if (logId) {
      navigate(`/logs/${logId}/edit`);
      return;
    }
    setCreatingLog(true);
    try {
      const dateStr = cls.datetime
        ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric' })
        : '';
      const created = await createLessonLog({
        title: `${studentName || ''} ${dateStr}`.trim(),
        classId: cls.id,
        studentIds: cls.studentIds,
      });
      navigate(`/logs/${created.id}/edit`);
    } catch {
      setCreatingLog(false);
    }
  };

  const activeBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: PRIMARY_BG, color: PRIMARY,
    fontSize: 13, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer',
    transition: 'background-color 150ms ease-out',
  };
  const doneBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: '#f5f5f5', color: '#8a8a8e',
    fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    border: 'none', cursor: 'default',
  };
  const editBtn = {
    flex: 1, height: 40, borderRadius: 10,
    background: '#fff', color: TEXT_PRIMARY,
    fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid #e5e5e7', cursor: 'pointer',
  };

  return (
    <div
      style={{
        borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-border)',
        padding: '12px 14px',
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
        <button
          onClick={() => onDismiss(cls.id)}
          className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
          style={{
            flexShrink: 0, background: '#fff', border: '1px solid #e5e5e7',
            color: TEXT_TERTIARY, fontSize: 12, fontWeight: 600,
            padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
          }}
        >
          완료
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleHwClick}
          disabled={hwDone}
          className={hwDone ? '' : 'active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out'}
          style={hwDone ? doneBtn : activeBtn}
        >
          {hwDone && <CheckIcon size={14} weight="bold" />}
          {hwDone ? '숙제 부여 완료' : '숙제 부여'}
        </button>
        <button
          onClick={handleLogClick}
          disabled={creatingLog}
          className={creatingLog ? '' : 'active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out'}
          style={logDone ? editBtn : { ...activeBtn, opacity: creatingLog ? 0.5 : 1 }}
        >
          {creatingLog ? '생성 중...' : logDone ? '일지 수정' : '일지 작성'}
        </button>
      </div>
    </div>
  );
}
