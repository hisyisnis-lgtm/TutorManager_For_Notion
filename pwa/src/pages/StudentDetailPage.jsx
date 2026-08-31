import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate } from 'react-router-dom';
import { stripEmoji } from '../utils/stringUtils.js';
import { Button } from '../components/shadcn/button';
import { Card, CardContent } from '../components/shadcn/card';
import { FileTextIcon, CalendarBlankIcon, CaretRightIcon, CaretDownIcon, PhoneIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import { swrLoad } from '../hooks/useCachedResource.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseStudent, statusColor, STATUS_ACTIVE } from '../api/students.js';
import { PRIMARY, STATUS_ERROR_TEXT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, GRAY_300, GRAY_100, BG_CARD } from '../constants/theme.js';
import { fetchUpcomingClasses, parseClass, bookedHoursOf } from '../api/classes.js';
import { fetchAllPayments, parsePayment, paymentStatusColor, refundSessions, formatSessions, remainingSessionsOf } from '../api/payments.js';
import { formatKRW } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

export default function StudentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshAll } = useData();

  const [student, setStudent] = useState(null);
  const [payments, setPayments] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [bookedHours, setBookedHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // 레벨·목표·메모와 설정은 "수업 준비할 때만" 읽는 참고 정보라 기본은 접어 둔다(§18-4).
  const [infoOpen, setInfoOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // 학생 1명당 Notion 3회 왕복. 상태·VIP 토글은 아래에서 낙관적으로 반영하므로
        // 캐시로 먼저 띄워도 어긋나지 않는다. 화면에 쓰는 만큼만(각 5건) 담는다.
        // 캐시 키에 v3 — 최근 수업 대신 예정 수업(예약된 시간)을 담게 되어 저장 형태가 달라졌다.
        await swrLoad(`student:detail:v3:${id}`, async () => {
          const [page, upcoming, allPayments] = await Promise.all([
            getPage(id),
            // 예약된 시간 합산에 쓰므로 목록 표시용이 아니라 예정 수업 전체를 받는다.
            fetchUpcomingClasses(id),
            // 잔여 시간 합산에 쓰므로 표시용 5건이 아니라 전체를 받는다.
            fetchAllPayments(id),
          ]);
          const st = parseStudent(page);
          const parsedPayments = allPayments.map(parsePayment);
          return {
            student: st,
            payments: parsedPayments.slice(0, 5),
            remaining: remainingSessionsOf(st, parsedPayments),
            bookedHours: bookedHoursOf(upcoming.map(parseClass)),
          };
        }, ({ student: st, payments: pay, remaining: rem, bookedHours: booked }) => {
          setStudent(st);
          setPayments(pay);
          setRemaining(rem);
          setBookedHours(booked);
          setLoading(false);
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      refreshAll();
      navigate(-1);
    } catch (e) {
      toast.error(`삭제 실패: ${e.message}`);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="학생 상세" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="학생 상세" back /><ErrorMessage message={error} /></>;
  if (!student) return null;

  const { bg, text } = statusColor(student.status);
  // 남은 수업 시간(결제분 중 아직 안 한 시간) = 예약 가능 + 예약된.
  // 막대는 그중 '이미 잡힌 비율'. 초과 예약이면 100%로 잘라 막대가 넘치지 않게 한다.
  const totalHours = remaining + bookedHours;
  // ⛔ 잔여가 적다고 색을 바꾸지 않는다. 브랜드색 → 빨강 → 경고색(주황) 순서로 다 거절됐다(2026-08-26~27).
  // 숫자 하나 튀우자고 색을 쓰면 라벨이 안 읽힌다 — 부족한 건 아래 시간 지표와 결제 안내가 이미 말한다.

  return (
    <>
      <PageHeader
        title={student.name}
        back
        action={
          /* 수정은 "필요할 때 찾는" 보조 액션 — 색으로 강조하지 않는다.
             (학생별 수업 관리의 '선택' 버튼과 같은 판단, 2026-08-26) */
          <Button
            variant="outline"
            onClick={() => navigate(`/students/${id}/edit`)}
          >
            수정
          </Button>
        }
      />

      <div className="px-4 pt-4 space-y-4 pb-24">
        {/* 상태는 **예외일 때만** 알린다. '수강중'은 기본값이라 늘 띄우면 노이즈가 되고,
            정작 행동이 달라지는 일시중단·수강종료가 같은 크기로 묻힌다(2026-08-26 지적).
            시간이 남아 있어도 이 상태면 수업을 잡으면 안 되므로 시간 카드보다 위에 둔다. */}
        {student.status !== STATUS_ACTIVE && (
          <div
            className="flex items-center gap-2"
            style={{ padding: '10px 14px', borderRadius: 12, background: GRAY_100 }}
          >
            <Badge label={stripEmoji(student.status)} bg={bg} text={text} />
            <span style={{ fontSize: 13, color: TEXT_SECONDARY, wordBreak: 'keep-all' }}>
              {student.status.includes('일시중단')
                ? '지금은 수업을 잡지 않는 학생이에요.'
                : '수강이 끝난 학생이에요.'}
            </span>
          </div>
        )}
        {/* ① 시간 현황 — 이 페이지에서 가장 중요한 정보라 최상단.
            "수업을 더 잡을 수 있나 / 결제 안내를 해야 하나"를 이 숫자가 결정한다.
            ⛔ 게이지·막대를 넣지 말 것 — 2026-08-26에 두 가지 방식으로 시도했다 모두 폐기했다.
               이유는 메모리 [[project_booking_patterns]] "시간 카드" 항목 참고. */}
        <Card>
          <CardContent className="p-4">
          <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 4px' }}>예약 가능 시간</p>
          <p
            className="tabular-nums"
            style={{ fontSize: 26, fontWeight: 700, margin: 0, lineHeight: 1.15, color: TEXT_PRIMARY }}
          >
            {formatSessions(remaining)}
            <span style={{ fontSize: 14, fontWeight: 400, color: TEXT_TERTIARY, marginLeft: 3 }}>시간</span>
          </p>
          <div style={{ display: 'flex', gap: 6, fontSize: 12, color: TEXT_SECONDARY, flexWrap: 'wrap', marginTop: 10 }}>
            <span className="tabular-nums">예약된 수업 {formatSessions(bookedHours)}시간</span>
            <span style={{ color: GRAY_300 }}>·</span>
            <span className="tabular-nums">남은 수업 {formatSessions(totalHours)}시간</span>
          </div>
          </CardContent>
        </Card>

        {/* ② 수업·숙제 — 학생 관리의 메인 기능이라 가로 2열 타일로 볼륨을 준다.
            숙제는 VIP(숙제 관리 대상)만 진입 가능하므로 비VIP면 수업 타일이 전체 폭을 쓴다. */}
        <div style={{ display: 'grid', gridTemplateColumns: student.vip ? '1fr 1fr' : '1fr', gap: 12 }}>
          <ActionTile
            icon={<CalendarBlankIcon weight="fill" size={24} />}
            label="수업 관리"
            onClick={() => navigate(`/students/${id}/classes`)}
          />
          {student.vip && (
            <ActionTile
              icon={<FileTextIcon weight="fill" size={24} />}
              label="숙제 관리"
              onClick={() => navigate(`/students/${id}/homework`)}
            />
          )}
        </div>

        {/* ③ 학생 정보 — 이름·연락처·레벨·목표·메모. 전부 "필요할 때 찾아보는" 참고 정보라 접어 둔다 */}
        <Card>
          <CardContent>
          <Disclosure open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} label="학생 정보" />
          <div className="reveal" data-open={infoOpen}>
            <div>
              <div className="space-y-3 text-sm" style={{ marginTop: 12 }}>
                <InfoRow label="이름" value={student.name} />
                {student.phone && (
                  <div>
                    <span className="text-gray-500 text-xs">전화번호</span>
                    <a
                      href={`tel:${student.phone}`}
                      className="flex items-center gap-1.5"
                      style={{ fontSize: 14, fontWeight: 600, color: PRIMARY, textDecoration: 'none', minHeight: 24 }}
                    >
                      <PhoneIcon size={16} weight="fill" />
                      {student.phone}
                    </a>
                  </div>
                )}
                {student.email && (
                  <div>
                    <span className="text-gray-500 text-xs">이메일</span>
                    <a href={`mailto:${student.email}`} className="block" style={{ fontSize: 14, fontWeight: 600, color: PRIMARY, textDecoration: 'none' }}>
                      {student.email}
                    </a>
                  </div>
                )}
                {student.level && <InfoRow label="레벨" value={student.level} />}
                {student.goal && <InfoRow label="목표" value={student.goal} />}
                {student.memo && <InfoRow label="메모" value={student.memo} />}
              </div>
            </div>
          </div>
          </CardContent>
        </Card>

        {/* ④ 결제 정보 — 최근 5건. 지금 당장의 판단(수업 잡기)에는 안 쓰이는 이력이라 접어 둔다 */}
        {payments.length > 0 && (
          <Card>
            <CardContent>
            <Disclosure open={paymentsOpen} onToggle={() => setPaymentsOpen((v) => !v)} label="결제 정보" />
            <div className="reveal" data-open={paymentsOpen}>
              <div>
                <div style={{ marginTop: 4 }}>
            {payments.map((p) => {
              const { bg: pbg, text: pt } = paymentStatusColor(p.paymentStatus);
              return (
                <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {formatSessions(p.sessionCount)}시간 · {formatKRW(p.paymentAmount)}
                    </p>
                    {p.unpaid > 0 && (
                      <p className="text-xs mt-0.5" style={{ color: STATUS_ERROR_TEXT }}>미수금 {formatKRW(p.unpaid)}</p>
                    )}
                    {p.refundAmount > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        환불 −{formatKRW(p.refundAmount)}
                        {refundSessions(p) > 0 && ` · ${formatSessions(refundSessions(p))}시간`}
                      </p>
                    )}
                  </div>
                  <Badge label={stripEmoji(p.paymentStatus)} bg={pbg} text={pt} />
                </div>
              );
            })}
                  {/* 상세에는 최근 5건만 담는다 — 전체 이력·합계는 학생별 결제 페이지에서.
                      배경 있는 중립 버튼(GRAY_100)으로 둔다 — 텍스트만 있으면 결제 행들과
                      섞여 어정쩡하고, 브랜드 채움은 이 화면의 액센트 예산을 넘는다. */}
                  <Button
                    type="button"
                    variant="secondary"
                    block
                    onClick={() => navigate(`/students/${id}/payments`)}
                    className="mt-2.5 gap-1 text-muted-foreground"
                    style={{ fontSize: 13 }}
                  >
                    학생 결제 페이지
                    <CaretRightIcon size={16} weight="bold" color={TEXT_TERTIARY} />
                  </Button>
                </div>
              </div>
            </div>
            </CardContent>
          </Card>
        )}

        {/* 학생 삭제 */}
        <Button
          variant="destructiveOutline"
          block
          onClick={() => setShowDeleteConfirm(true)}
        >
          학생 삭제
        </Button>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="학생을 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}</span>
      <p className="text-sm font-semibold text-gray-800" style={{ wordBreak: 'keep-all', lineHeight: 1.55 }}>{value}</p>
    </div>
  );
}

/**
 * 메인 기능 진입 타일 — 수업·숙제. 가로 2열로 볼륨을 준다.
 * 면을 브랜드로 채우지 않는 이유: 두 개가 나란히 있으면 서로 강조가 경합하고
 * 이 화면의 브랜드 채움 예산(§16)을 다 써버린다. 아이콘만 브랜드색.
 */
function ActionTile({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-tap"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        minHeight: 88, padding: '16px 12px', borderRadius: 16,
        background: BG_CARD, border: 'none', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ color: PRIMARY, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY }}>{label}</span>
    </button>
  );
}

/** 접이식 섹션 헤더 — 홈의 '결제 안내 필요'와 같은 어법(.reveal + 캐럿 회전) */
function Disclosure({ open, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center justify-between"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', minHeight: 24, WebkitTapHighlightColor: 'transparent' }}
    >
      <span className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>{label}</span>
      {/* 접힘 ⌄ / 펼침 ⌃ — 아코디언 관용 방향. 오른쪽 화살표(›)는 '이동'을 뜻하므로
          같은 화면에서 펼치는 데 쓰지 않는다(2026-08-26). */}
      <CaretDownIcon
        size={16}
        weight="bold"
        color={TEXT_TERTIARY}
        style={{
          transform: open ? 'rotate(180deg)' : 'none',
          transitionProperty: 'transform',
          transitionDuration: '0.2s',
          transitionTimingFunction: 'var(--ease-out)',
        }}
      />
    </button>
  );
}

