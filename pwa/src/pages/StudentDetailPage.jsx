import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import { getPage, updatePage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseStudent, statusColor, STATUS_OPTIONS, updateStudentStatus } from '../api/students.js';
import { fetchClassesPage, parseClass, classStatusColor } from '../api/classes.js';
import { fetchPaymentsPage, parsePayment, paymentStatusColor } from '../api/payments.js';
import { formatDateTime, formatTime, formatKRW } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

export default function StudentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshAll } = useData();

  const [student, setStudent] = useState(null);
  const [classes, setClasses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [page, classData, paymentData] = await Promise.all([
          getPage(id),
          fetchClassesPage({ studentId: id }),
          fetchPaymentsPage({ studentId: id }),
        ]);
        setStudent(parseStudent(page));
        setClasses(classData.results.slice(0, 5).map(parseClass));
        setPayments(paymentData.results.slice(0, 5).map(parsePayment));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleStatusChange = async (newStatus) => {
    setShowStatusMenu(false);
    setUpdating(true);
    try {
      await updateStudentStatus(id, newStatus);
      setStudent((s) => ({ ...s, status: newStatus }));
      refreshAll();
    } catch (e) {
      alert(`상태 변경 실패: ${e.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      refreshAll();
      navigate(-1);
    } catch (e) {
      alert(`삭제 실패: ${e.message}`);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="학생 상세" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="학생 상세" back /><ErrorMessage message={error} /></>;
  if (!student) return null;

  const { bg, text } = statusColor(student.status);

  return (
    <>
      <PageHeader
        title={student.name}
        back
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/students/${id}/edit`)}
              className="text-sm font-medium text-gray-600 px-3 py-1.5 bg-gray-100 rounded-lg active:bg-gray-200"
            >
              수정
            </button>
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              disabled={updating}
              className="text-sm font-medium text-brand-600 px-3 py-1.5 bg-brand-50 rounded-lg active:bg-brand-100"
            >
              상태 변경
            </button>
            {showStatusMenu && (
              <div className="absolute right-0 top-9 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50 min-w-32">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 active:bg-gray-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        }
      />

      <div className="px-4 pt-4 space-y-4 pb-6">
        {/* 기본 정보 */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-gray-900">{student.name}</span>
            <Badge label={student.status} bg={bg} text={text} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {student.level && <InfoRow label="레벨" value={student.level} />}
            {student.goal && <InfoRow label="목표" value={student.goal} />}
            {student.phone && (
              <div className="col-span-2">
                <span className="text-gray-400 text-xs">전화번호</span>
                <a href={`tel:${student.phone}`} className="block text-brand-600 font-medium">
                  {student.phone}
                </a>
              </div>
            )}
            {student.email && (
              <div className="col-span-2">
                <span className="text-gray-400 text-xs">이메일</span>
                <a href={`mailto:${student.email}`} className="block text-brand-600 font-medium">
                  {student.email}
                </a>
              </div>
            )}
          </div>
          {student.memo && (
            <div className="pt-2 border-t border-gray-50">
              <p className="text-xs text-gray-400 mb-1">메모</p>
              <p className="text-sm text-gray-700">{student.memo}</p>
            </div>
          )}
          {student.bookingCode && (
            <div className="pt-2 border-t border-gray-50">
              <p className="text-xs text-gray-400 mb-1">예약 링크</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-mono truncate flex-1">
                  /book/{student.bookingCode}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}${window.location.pathname}#/book/${encodeURIComponent(student.bookingCode)}`;
                    navigator.clipboard.writeText(url).then(() => alert('링크가 복사되었습니다.'));
                  }}
                  className="shrink-0 text-xs text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1 active:bg-blue-50"
                >
                  복사
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 잔여 회차 / 미수금 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">잔여 시간 회차</p>
            <p
              className={`text-2xl font-bold ${
                student.remainingSessions <= 1 ? 'text-red-500' : 'text-gray-900'
              }`}
            >
              {student.remainingSessions}
              <span className="text-sm font-normal text-gray-400 ml-1">회</span>
            </p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">미수금</p>
            <p
              className={`text-xl font-bold ${
                student.unpaidAmount > 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {student.unpaidAmount > 0 ? formatKRW(student.unpaidAmount) : '없음'}
            </p>
          </div>
        </div>

        {/* 최근 수업 */}
        {classes.length > 0 && (
          <Section title="최근 수업">
            {classes.map((cls) => {
              const { bg: sbg, text: st } = classStatusColor(cls.status);
              return (
                <div key={cls.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {cls.datetime ? formatDateTime(cls.datetime) : '일시 미정'}
                      {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
                    </p>
                    {cls.notes && (
                      <p className="text-xs text-gray-400 mt-0.5">{cls.notes}</p>
                    )}
                    {cls.location && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        📍 {cls.location}{cls.locationMemo && ` — ${cls.locationMemo}`}
                      </p>
                    )}
                  </div>
                  <Badge label={cls.status} bg={sbg} text={st} />
                </div>
              );
            })}
          </Section>
        )}

        {/* 최근 결제 */}
        {payments.length > 0 && (
          <Section title="최근 결제">
            {payments.map((p) => {
              const { bg: pbg, text: pt } = paymentStatusColor(p.paymentStatus);
              return (
                <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {p.sessionCount}회 · {formatKRW(p.paymentAmount)}
                    </p>
                    {p.unpaid > 0 && (
                      <p className="text-xs text-red-500 mt-0.5">미수금 {formatKRW(p.unpaid)}</p>
                    )}
                  </div>
                  <Badge label={p.paymentStatus} bg={pbg} text={pt} />
                </div>
              );
            })}
          </Section>
        )}

        {/* 학생 삭제 */}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="btn-danger"
        >
          학생 삭제
        </button>
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
      <span className="text-gray-400 text-xs">{label}</span>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-gray-50">
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}
