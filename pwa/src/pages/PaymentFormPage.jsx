import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import {
  parsePayment,
  createPayment,
  updatePayment,
  PAYMENT_METHODS,
  calcPaymentAmount,
} from '../api/payments.js';
import { toNotionDateOnly } from '../utils/dateUtils.js';
import { formatKRW } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

export default function PaymentFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { students, classTypes, discounts } = useData();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({
    note: '',
    studentId: '',
    classTypeId: '',
    discountEventId: '',
    sessionCount: '',
    actualAmount: '',
    paymentMethod: '',
    paymentDate: new Date().toISOString().split('T')[0],
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      try {
        const page = await getPage(id);
        const p = parsePayment(page);
        setForm({
          note: p.note,
          studentId: p.studentIds[0] || '',
          classTypeId: p.classTypeId || '',
          discountEventId: p.discountEventId || '',
          sessionCount: String(p.sessionCount),
          actualAmount: String(p.actualAmount),
          paymentMethod: p.paymentMethod || '',
          paymentDate: p.paymentDate || new Date().toISOString().split('T')[0],
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // 선택된 수업 유형 정보
  const selectedClassType = classTypes.find((ct) => ct.id === form.classTypeId);
  const unitPrice = selectedClassType?.unitPrice ?? 0;

  // 선택된 할인 이벤트
  const selectedDiscount = discounts.find((d) => d.id === form.discountEventId);
  const discountRate = selectedDiscount?.rate ?? 0;

  // 실시간 금액 계산
  const sessionCount = parseFloat(form.sessionCount) || 0;
  const expectedAmount = calcPaymentAmount(sessionCount, unitPrice, discountRate);
  const actualAmount = parseFloat(form.actualAmount) || 0;
  const unpaid = expectedAmount - actualAmount;

  const paymentStatus = () => {
    if (!expectedAmount || !sessionCount) return null;
    if (actualAmount === 0) return { label: '⬛ 미결제', color: 'text-gray-500' };
    if (actualAmount > expectedAmount) return { label: '⚠️ 초과금', color: 'text-amber-600' };
    if (unpaid === 0) return { label: '🟢 완료', color: 'text-green-600' };
    return { label: '🔴 미완료', color: 'text-red-500' };
  };

  const status = paymentStatus();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.studentId) { setError('학생을 선택하세요.'); return; }
    if (!form.classTypeId) { setError('수업 종류를 선택하세요.'); return; }
    if (!form.sessionCount || isNaN(parseFloat(form.sessionCount))) {
      setError('시간 회차를 입력하세요.'); return;
    }
    if (form.actualAmount === '' || isNaN(parseFloat(form.actualAmount))) {
      setError('실제 결제 금액을 입력하세요.'); return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        note: form.note,
        studentId: form.studentId,
        classTypeId: form.classTypeId,
        discountEventId: form.discountEventId || null,
        sessionCount: parseFloat(form.sessionCount),
        actualAmount: parseFloat(form.actualAmount),
        paymentMethod: form.paymentMethod || null,
        paymentDate: form.paymentDate || null,
      };

      if (isEdit) {
        await updatePayment(id, payload);
      } else {
        await createPayment(payload);
      }
      navigate(-1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="결제 입력" back /><LoadingSpinner /></>;

  return (
    <>
      <PageHeader title={isEdit ? '결제 편집' : '결제 입력'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 1. 학생 선택 */}
        <div>
          <label className="label">① 학생</label>
          <input
            type="text"
            placeholder="학생 이름 검색..."
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            className="input-field mb-2"
          />
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {students
              .filter((s) => s.name.includes(studentSearch))
              .map((s) => (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    form.studentId === s.id
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="studentId"
                    value={s.id}
                    checked={form.studentId === s.id}
                    onChange={() => setForm((f) => ({ ...f, studentId: s.id }))}
                    className="w-4 h-4 accent-brand-600"
                  />
                  <span className="text-sm font-medium text-gray-800">{s.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{s.status}</span>
                </label>
              ))}
            {students.filter((s) => s.name.includes(studentSearch)).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-3">검색 결과 없음</p>
            )}
          </div>
        </div>

        {/* 2. 수업 종류 선택 */}
        <div>
          <label className="label">② 수업 종류</label>
          <select
            value={form.classTypeId}
            onChange={set('classTypeId')}
            className="select-field"
            required
          >
            <option value="">선택하세요</option>
            {classTypes.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.title} ({ct.unitPrice.toLocaleString()}원)
              </option>
            ))}
          </select>
          {selectedClassType && (
            <p className="text-xs text-gray-400 mt-1.5">
              시간당 단가: <strong className="text-gray-700">{formatKRW(unitPrice)}</strong>
            </p>
          )}
        </div>

        {/* 3. 할인 이벤트 */}
        <div>
          <label className="label">③ 할인 이벤트 (선택)</label>
          <select
            value={form.discountEventId}
            onChange={set('discountEventId')}
            className="select-field"
          >
            <option value="">없음</option>
            {discounts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.rate}% 할인)
              </option>
            ))}
          </select>
          {discountRate > 0 && (
            <p className="text-xs text-green-600 mt-1.5">
              {discountRate}% 할인 적용 → {formatKRW(Math.round(unitPrice * (1 - discountRate / 100)))}원/회
            </p>
          )}
        </div>

        {/* 4. 시간 회차 */}
        <div>
          <label className="label">④ 시간 회차</label>
          <input
            type="number"
            value={form.sessionCount}
            onChange={set('sessionCount')}
            step="0.5"
            min="0"
            placeholder="예: 8 (8회 60분 수업)"
            className="input-field"
            required
          />
          {sessionCount > 0 && unitPrice > 0 && (
            <p className="text-sm font-semibold text-brand-700 mt-2 p-3 bg-brand-50 rounded-xl">
              결제 예정 금액: {formatKRW(expectedAmount)}
            </p>
          )}
        </div>

        {/* 5. 실제 결제 금액 */}
        <div>
          <label className="label">⑤ 실제 결제 금액</label>
          <input
            type="number"
            value={form.actualAmount}
            onChange={set('actualAmount')}
            step="1000"
            min="0"
            placeholder="실제로 받은 금액"
            className="input-field"
            required
          />
          {/* 실시간 미수금 / 상태 표시 */}
          {status && (
            <div className={`mt-2 p-3 rounded-xl bg-gray-50 text-sm`}>
              <span className="text-gray-500">결제 상태: </span>
              <strong className={status.color}>{status.label}</strong>
              {unpaid !== 0 && (
                <span className="text-gray-400 ml-2">
                  ({unpaid > 0 ? `미수금 ${formatKRW(unpaid)}` : `초과 ${formatKRW(-unpaid)}`})
                </span>
              )}
            </div>
          )}
        </div>

        {/* 6. 결제 수단 */}
        <div>
          <label className="label">⑥ 결제 수단</label>
          <select value={form.paymentMethod} onChange={set('paymentMethod')} className="select-field">
            <option value="">선택하세요</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* 7. 결제일 */}
        <div>
          <label className="label">⑦ 결제일</label>
          <input
            type="date"
            value={form.paymentDate}
            onChange={set('paymentDate')}
            className="input-field"
          />
        </div>

        {/* 8. 비고 */}
        <div>
          <label className="label">⑧ 비고 (선택)</label>
          <input
            type="text"
            value={form.note}
            onChange={set('note')}
            placeholder="메모"
            className="input-field"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving ? '저장 중...' : isEdit ? '수정하기' : '결제 저장'}
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-3 rounded-xl text-sm font-medium text-red-500 border border-red-200 bg-white active:bg-red-50 mt-1"
          >
            결제 내역 삭제
          </button>
        )}
      </form>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="결제 내역을 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}
