import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, message } from 'antd';
import { MapPinIcon, WarningCircleIcon, InfoIcon } from '@phosphor-icons/react';
import Badge from '../ui/Badge.jsx';
import SelectCheck from '../ui/SelectCheck.jsx';
import { classStatusColor, notesColor } from '../../api/classes.js';
import { createLessonLog } from '../../api/lessonLogs.js';
import { invalidateCache } from '../../hooks/useCachedResource.js';
import { formatDateTime, formatDateNoYear, formatTime, formatDuration } from '../../utils/dateUtils.js';
import { stripEmoji } from '../../utils/stringUtils.js';
import {
  PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY,
  STATUS_ERROR_TEXT, STATUS_ERROR_BG, STATUS_WARNING_TEXT, STATUS_WARNING_BG,
  GRAY_100, BORDER_SUBTLE,
} from '../../constants/theme.js';

/**
 * 수업 카드 — ClassesPage(전체 수업)·StudentClassesPage(학생별 수업) 공용.
 * 탭하면 수업 상세(/classes/:id)로, 완료된 수업은 카드 하단에서 일지 작성/보기로 간다.
 * selectable이면 탭이 이동 대신 선택 토글이 되고, 일지 버튼은 숨긴다(선택 중 오탭 방지).
 */
export default function ClassCard({
  cls, studentNameMap, hideStudentName = false,
  selectable = false, selected = false, onSelect,
}) {
  const navigate = useNavigate();
  const now = new Date();
  const isOngoing = !cls.notes?.includes('취소')
    && cls.datetime && cls.endTime
    && now >= new Date(cls.datetime)
    && now < new Date(cls.endTime);
  const { bg, text } = isOngoing ? { bg: 'bg-brand-50', text: 'text-brand-700' } : classStatusColor(cls.status);
  const statusLabel = isOngoing ? '수업중' : stripEmoji(cls.status);
  const studentNames = cls.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  const isCompleted = cls.datetime && new Date(cls.datetime) <= new Date();
  const logId = cls.lessonLogIds?.[0];
  const [creatingLog, setCreatingLog] = useState(false);

  const handleLogClick = async (e) => {
    e.stopPropagation();
    if (logId) {
      // 이미 있는 일지는 **읽기 전용 상세**로. 편집은 거기서 '편집' 버튼으로.
      navigate(`/logs/${logId}`);
      return;
    }
    setCreatingLog(true);
    try {
      const names = cls.studentIds.map((id) => studentNameMap[id]).filter(Boolean).join(', ');
      const dateStr = cls.datetime
        ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
        : '';
      const created = await createLessonLog({
        title: `${names} ${dateStr}`.trim(),
        classId: cls.id,
        studentIds: cls.studentIds,
      });
      invalidateCache('lessonLogs');
      navigate(`/logs/${created.id}/edit`);
    } catch (e) {
      message.error(`일지 생성 실패: ${e.message}`);
      setCreatingLog(false);
    }
  };

  return (
    <li>
      <Card
        variant="borderless"
        className="card-tap"
        style={{
          borderRadius: 16, cursor: 'pointer',
          // 선택 상태는 면을 파스텔로 칠하지 않는다(§18-1 — 그 플러드가 "AI가 만든 것" 느낌의 정체).
          // 대신 브랜드 링 + 살짝의 리프트로 낸다. 채워진 체크 컨트롤이 상태를 확정해준다.
          ...(selected ? { boxShadow: 'var(--shadow-border-selected)' } : null),
        }}
        styles={{ body: { padding: 16 } }}
        onClick={() => (selectable ? onSelect?.(cls.id) : navigate(`/classes/${cls.id}`))}
        aria-pressed={selectable ? selected : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          {/* 카드 전체가 토글이라 체크 컨트롤은 표시 전용(포커스·중복 토글에서 제외).
              첫 줄 텍스트(15px)와 시각 중심을 맞추려 1px 내린다 — Better #2 광학 정렬 */}
          {selectable && (
            <div style={{ marginTop: 1 }}>
              <SelectCheck selected={selected} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {/* 학생별 수업 페이지에선 같은 이름이 카드마다 반복되므로 일시를 제목 자리로 올린다.
                이때 "날짜+시각범위+소요시간"을 한 줄에 다 넣으면 229px이라 360px 화면부터
                의도치 않게 줄바꿈된다(2026-08-26 실측) → 날짜(제목)/시간(메타)으로 나눈다. */}
            {hideStudentName ? (
              <>
                <p className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 2px' }}>
                  {cls.datetime ? formatDateNoYear(cls.datetime) : '일시 미정'}
                </p>
                {cls.datetime && (
                  <p className="tabular-nums" style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 2px' }}>
                    {formatTime(cls.datetime)}
                    {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
                    {cls.duration && ` · ${formatDuration(parseInt(cls.duration))}`}
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {studentNames || cls.title || '학생 미정'}
                </p>
                <p className="tabular-nums" style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 2px' }}>
                  {cls.datetime ? formatDateTime(cls.datetime) : '일시 미정'}
                  {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
                  {cls.duration && ` · ${formatDuration(parseInt(cls.duration))}`}
                </p>
              </>
            )}
            {cls.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <MapPinIcon size={12} weight="fill" color={TEXT_TERTIARY} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                  {cls.location}{cls.locationMemo && ` — ${cls.locationMemo}`}
                </span>
              </div>
            )}
            {cls.noteMemo && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 2 }}>
                <InfoIcon size={12} weight="fill" color={TEXT_TERTIARY} style={{ flexShrink: 0, marginTop: 3 }} />
                <span style={{ fontSize: 12, color: TEXT_TERTIARY, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', lineHeight: 1.5 }}>
                  {cls.noteMemo}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
            <Badge label={statusLabel} bg={bg} text={text} />
            {cls.notes && (() => {
              const nc = notesColor(cls.notes);
              return nc ? <Badge label={stripEmoji(cls.notes)} bg={nc.bg} text={nc.text} /> : null;
            })()}
          </div>
        </div>
        {(cls.sessionShortage || cls.conflictDetected) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {cls.sessionShortage && (
              // 노션 formula 이름('시간 회차 부족')을 그대로 찍지 않는다 — 강사가 할 일은
              // "결제를 받아야 한다"다(2026-08-27). formula 값은 참/거짓 신호로만 쓴다.
              <span style={{ fontSize: 12, color: STATUS_WARNING_TEXT, background: STATUS_WARNING_BG, padding: '2px 8px', borderRadius: 20 }}>
                결제 필요
              </span>
            )}
            {cls.conflictDetected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: STATUS_ERROR_TEXT, background: STATUS_ERROR_BG, padding: '2px 8px', borderRadius: 20 }}>
                <WarningCircleIcon size={12} weight="fill" />
                시간 충돌
              </span>
            )}
          </div>
        )}
        {isCompleted && !selectable && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER_SUBTLE}`, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleLogClick}
              disabled={creatingLog}
              style={{
                fontSize: 12, fontWeight: 600,
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                // 면은 둘 다 중립(GRAY_100). 강조는 **글자색**으로만 준다 —
                // '일지 작성'은 아직 안 한 일이라 눈에 띄어야 하고, '일지 보기'는 그냥 열어보는 것.
                // ⛔ 연한 브랜드 면(PRIMARY_BG)으로 채우지 말 것(design_system §18-1).
                background: GRAY_100,
                color: logId ? TEXT_SECONDARY : PRIMARY,
                transition: 'background-color 150ms ease-out',
                opacity: creatingLog ? 0.5 : 1,
              }}
              className="hit-40 transition-[background-color] duration-150 ease-out"
            >
              {creatingLog ? '생성 중...' : logId ? '일지 보기' : '일지 작성'}
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}
