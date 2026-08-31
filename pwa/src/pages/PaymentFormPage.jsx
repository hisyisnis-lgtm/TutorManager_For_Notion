import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stripEmoji } from '../utils/stringUtils.js';
import { WarningCircleIcon, CheckCircleIcon, XIcon } from '@phosphor-icons/react';
import { Alert, AlertDescription } from '../components/shadcn/alert';
import { Button } from '../components/shadcn/button';
import { Input } from '../components/shadcn/input';
import SelectField from '../components/ui/SelectField.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';
import SubmitButton from '../components/ui/SubmitButton.jsx';
import SelectCheck from '../components/ui/SelectCheck.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import {
  parsePayment,
  createPayment,
  updatePayment,
  PAYMENT_METHODS,
  calcPaymentAmount,
  validatePaymentForm,
} from '../api/payments.js';
import { formatKRW, todayKST } from '../utils/dateUtils.js';
import { isOnlineGroupTitle, isFixedPriceTitle } from '../utils/classTypeKind.js';
import { useData } from '../context/DataContext.jsx';
import { TEXT_SECONDARY, TEXT_INACTIVE } from '../constants/theme.js';

export default function PaymentFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { students, classTypes, discounts, refresh: refreshAll } = useData();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({
    note: '',
    studentId: '',
    classTypeId: '',
    discountEventId: '',
    sessionCount: '',
    actualAmount: '',
    paymentMethod: '',
    paymentDate: todayKST(),
    guestName: '', // 온라인그룹수업 수강생 이름 (단건)
  });
  const [studentSearch, setStudentSearch] = useState('');
  const selectedStudentRef = useRef(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // "저장하고 계속" 성공 피드백

  // 편집 모드: 선택된 학생 항목이 스크롤 뷰 안에 오도록 스크롤
  useEffect(() => {
    if (!loading && students.length > 0 && selectedStudentRef.current) {
      selectedStudentRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [loading, students]);

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
          paymentDate: p.paymentDate || todayKST(),
          guestName: '',
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

  // 온라인그룹수업: 학생앱 미등록자. 학생 없이 수강생 이름·금액만 기록(결제 시간·할인·고정가격 미사용).
  const isOnlineGroup = isOnlineGroupTitle(selectedClassType?.title);
  // 신규 등록 + 온라인그룹수업일 때만 "수강생 이름 + 저장하고 계속" 단건 반복 UI
  const isGroupCreate = isOnlineGroup && !isEdit;

  // 고정 가격 상품 (원데이클래스만): 1인 단가가 시간당 기준으로 저장됨 → 총액으로 표시·자동 채움.
  const isFixedPriceClass = isFixedPriceTitle(selectedClassType?.title);
  const fixedSessionCount = selectedClassType ? (selectedClassType.duration || 60) / 60 : 0;
  const fixedTotalPrice = selectedClassType ? Math.round(unitPrice * fixedSessionCount) : 0;

  // 선택된 할인 이벤트
  const selectedDiscount = discounts.find((d) => d.id === form.discountEventId);
  const discountRate = selectedDiscount?.rate ?? 0;

  // 실시간 금액 계산 (일반 결제용)
  const sessionCount = parseFloat(form.sessionCount) || 0;
  const expectedAmount = calcPaymentAmount(sessionCount, unitPrice, discountRate);
  const actualAmount = parseFloat(form.actualAmount) || 0;
  const unpaid = expectedAmount - actualAmount;

  const paymentStatus = () => {
    if (!expectedAmount || !sessionCount) return null;
    if (actualAmount === 0) return { label: '미결제', color: 'text-gray-500' };
    if (actualAmount > expectedAmount) return { label: '초과금', color: 'text-amber-600' };
    if (unpaid === 0) return { label: '완료', color: 'text-green-600' };
    return { label: '미완료', color: 'text-red-500' };
  };
  const status = paymentStatus();

  // 수업 종류 선택 → 원데이클래스(고정가격)만 결제 시간·금액 자동 채움
  const onSelectClassType = (value) => {
    const ct = classTypes.find((c) => c.id === value);
    const isFixed = isFixedPriceTitle(ct?.title);
    if (isFixed) {
      const sc = (ct.duration || 60) / 60;
      const price = Math.round(ct.unitPrice * sc);
      setForm((f) => ({ ...f, classTypeId: value, sessionCount: String(sc), actualAmount: String(price) }));
    } else {
      setForm((f) => ({ ...f, classTypeId: value }));
    }
  };

  // 온라인그룹수업 신규 — 단건 저장 (keepOpen=true면 폼 유지하고 이름·금액만 비움)
  const saveGroup = async (keepOpen) => {
    const name = form.guestName.trim();
    if (!name) { setError('수강생 이름을 입력하세요.'); return; }
    if (form.actualAmount === '' || isNaN(parseFloat(form.actualAmount)) || parseFloat(form.actualAmount) < 0) {
      setError('결제 금액을 입력하세요.'); return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createPayment({
        guestName: name,
        classTypeId: form.classTypeId,
        sessionCount: 0, // 그룹은 결제 시간 개념 없음 (매출은 실제 결제 금액으로 집계)
        actualAmount: parseFloat(form.actualAmount),
        paymentMethod: form.paymentMethod || null,
        paymentDate: form.paymentDate || null,
        note: form.note || undefined,
      });
    } catch (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    refreshAll();
    invalidateCache('payment');
    setSaving(false);
    if (keepOpen) {
      // 수업종류·결제일·결제수단은 유지, 이름·금액·비고만 비워 다음 사람 바로 입력
      setForm((f) => ({ ...f, guestName: '', actualAmount: '', note: '' }));
      setNotice(`${name} 결제 저장됨 · 이어서 입력하세요`);
    } else {
      navigate(-1);
    }
  };

  // 비활성 사유 — handleSubmit·saveGroup의 검사 순서를 그대로 따라간다.
  const groupAmountInvalid =
    form.actualAmount === '' || isNaN(parseFloat(form.actualAmount)) || parseFloat(form.actualAmount) < 0;
  const blockedReason =
    !form.classTypeId ? '수업 종류를 선택하세요.'
    : isGroupCreate
      ? (!form.guestName.trim() ? '수강생 이름을 입력하세요.' : groupAmountInvalid ? '결제 금액을 입력하세요.' : null)
      : validatePaymentForm(form, { isOnlineGroup, isEdit });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.classTypeId) { setError('수업 종류를 선택하세요.'); return; }

    // 온라인그룹수업 신규는 saveGroup으로 처리 (Enter 제출 시 닫기 저장)
    if (isGroupCreate) { saveGroup(false); return; }

    const validationError = validatePaymentForm(form, { isOnlineGroup, isEdit });
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        note: form.note,
        studentId: form.studentId,
        classTypeId: form.classTypeId,
        discountEventId: form.discountEventId || null,
        sessionCount: isOnlineGroup ? 0 : parseFloat(form.sessionCount),
        actualAmount: parseFloat(form.actualAmount),
        paymentMethod: form.paymentMethod || null,
        paymentDate: form.paymentDate || null,
      };
      if (isEdit) {
        await updatePayment(id, payload);
      } else {
        await createPayment(payload);
      }
      refreshAll();
      invalidateCache('payment');
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
      invalidateCache('payment');
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="결제 추가" back /><LoadingSpinner /></>;

  return (
    <>
      <PageHeader title={isEdit ? '결제 편집' : '결제 추가'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {error && (
          <Alert variant="destructive">
            <WarningCircleIcon size={16} weight="fill" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert variant="success" className="pr-12">
            <CheckCircleIcon size={16} weight="fill" aria-hidden />
            <AlertDescription>{notice}</AlertDescription>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => setNotice(null)}
              className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg"
            >
              <XIcon size={16} weight="bold" />
            </button>
          </Alert>
        )}

        {/* ① 수업 종류 선택 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            ① 수업 종류
          </span>
          <SelectField
            value={form.classTypeId || undefined}
            onChange={onSelectClassType}
            placeholder="선택하세요"
            disabled={isEdit && isOnlineGroup}
            options={classTypes.map((ct) => {
              const optGroup = isOnlineGroupTitle(ct.title);
              const optFixed = isFixedPriceTitle(ct.title);
              const totalPrice = Math.round(ct.unitPrice * (ct.duration || 60) / 60);
              return {
                value: ct.id,
                label: optGroup
                  ? ct.title
                  : optFixed
                  ? `${ct.title} (${ct.duration}분 ${totalPrice.toLocaleString()}원)`
                  : `${ct.title} (${ct.unitPrice.toLocaleString()}원)`,
              };
            })}
          />
          {selectedClassType && (
            isOnlineGroup ? (
              <p className="text-xs text-gray-500 mt-1.5">
                수강생 이름과 결제 금액을 직접 입력해 기록합니다.
              </p>
            ) : isFixedPriceClass ? (
              <p className="text-xs text-gray-500 mt-1.5">
                <strong className="text-gray-700">
                  {selectedClassType.duration}분 고정 가격: {formatKRW(fixedTotalPrice)}
                </strong>
                <span className="text-gray-400 ml-1">
                  (결제 시간 {fixedSessionCount}시간 자동 입력)
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1.5">
                시간당 단가: <strong className="text-gray-700">{formatKRW(unitPrice)}</strong>
              </p>
            )
          )}
        </div>

        {form.classTypeId && (<>
        {/* ② 수강생 — 온라인그룹수업(신규)이면 이름 한 명, 그 외엔 학생 선택 */}
        {isGroupCreate ? (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ② 수강생 이름
            </span>
            <Input
              placeholder="결제한 수강생 이름"
              value={form.guestName}
              onChange={(e) => setForm((f) => ({ ...f, guestName: e.target.value }))}
            />
          </div>
        ) : isOnlineGroup ? null : (
          <div>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ② 학생
            </span>
            <Input
              type="text"
              placeholder="학생 이름 검색..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div className="space-y-2 max-h-60 overflow-y-auto px-2 py-2 -mx-2">
              {students
                .filter((s) => s.name.includes(studentSearch))
                .map((s) => {
                  const isSelected = form.studentId === s.id;
                  return (
                  <label
                    key={s.id}
                    ref={isSelected ? selectedStudentRef : null}
                    className="flex items-center gap-3 p-3 rounded-xl cursor-pointer bg-white"
                    style={{
                      boxShadow: isSelected ? 'var(--shadow-border-selected)' : 'var(--shadow-border)',
                      transitionProperty: 'box-shadow',
                      transitionDuration: '150ms',
                      transitionTimingFunction: 'var(--ease-out)',
                    }}
                  >
                    <input
                      type="radio"
                      name="studentId"
                      value={s.id}
                      checked={isSelected}
                      onChange={() => setForm((f) => ({ ...f, studentId: s.id }))}
                      className="sr-only select-check-input"
                    />
                    <SelectCheck selected={isSelected} />
                    <span className="text-sm font-semibold text-gray-800">{s.name}</span>
                    <span className="text-xs text-gray-500 ml-auto">{stripEmoji(s.status)}</span>
                  </label>
                  );
                })}
              {students.filter((s) => s.name.includes(studentSearch)).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-3">검색 결과 없음</p>
              )}
            </div>
          </div>
        )}

        {/* ③ 할인 이벤트 — 일반 결제만 (그룹은 금액 직접 입력) */}
        {!isOnlineGroup && (
          <div>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ③ 할인 이벤트 (선택)
            </span>
            <SelectField
              value={form.discountEventId || undefined}
              onChange={(value) => setForm((f) => ({ ...f, discountEventId: value || '' }))}
              placeholder="없음"
              allowClear
              options={discounts.map((d) => ({ value: d.id, label: `${d.name} (${d.rate}% 할인)` }))}
            />
            {discountRate > 0 && (
              <p className="text-xs text-green-600 mt-1.5">
                {discountRate}% 할인 적용 → {formatKRW(Math.round(unitPrice * (1 - discountRate / 100)))}원/시간
              </p>
            )}
          </div>
        )}

        {/* ④ 결제 시간 — 일반 결제만 */}
        {!isOnlineGroup && (
          <div>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ④ 결제 시간
            </span>
            <Input
              type="number"
              value={form.sessionCount}
              onChange={set('sessionCount')}
              step="0.5"
              min="0"
              placeholder="예: 8 (60분 수업 8회분)"
            />
            <p className="text-xs text-gray-400 mt-1.5">60분 수업 1회 = 1시간, 90분 = 1.5시간</p>
            {sessionCount > 0 && unitPrice > 0 && (
              <p className="text-sm font-semibold text-brand-700 mt-2 p-3 bg-brand-50 rounded-xl">
                결제 예정 금액: {formatKRW(expectedAmount)}
              </p>
            )}
          </div>
        )}

        {/* 결제 금액 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제 금액' : '⑤ 실제 결제 금액'}
          </span>
          <Input
            type="number"
            value={form.actualAmount}
            onChange={set('actualAmount')}
            step="1000"
            min="0"
            placeholder={isOnlineGroup ? '실제로 받은 금액' : '실제로 받은 금액'}
          />
          {/* 일반 결제: 실시간 미수금 / 상태 표시 */}
          {!isOnlineGroup && status && (
            <div className={`mt-2 p-3 rounded-xl bg-gray-50 text-sm`}>
              <span className="text-gray-500">결제 상태: </span>
              <strong className={status.color}>{status.label}</strong>
              {unpaid !== 0 && (
                <span className="text-gray-500 ml-2">
                  ({unpaid > 0 ? `미수금 ${formatKRW(unpaid)}` : `초과 ${formatKRW(-unpaid)}`})
                </span>
              )}
            </div>
          )}
        </div>

        {/* 결제 수단 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제 수단' : '⑥ 결제 수단'}
          </span>
          <SelectField
            value={form.paymentMethod || undefined}
            onChange={(value) => setForm((f) => ({ ...f, paymentMethod: value || '' }))}
            placeholder="선택하세요"
            allowClear
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
          />
        </div>

        {/* 결제일 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제일' : '⑦ 결제일'}
          </span>
          <Input
            type="date"
            value={form.paymentDate}
            onChange={set('paymentDate')}
          />
        </div>

        {/* 비고 (학생 없는 결제 편집 시에는 수강생 이름 = 타이틀 수정란) */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isEdit && isOnlineGroup ? '수강생 이름' : isOnlineGroup ? '비고 (선택)' : '⑧ 비고 (선택)'}
          </span>
          <Input
            type="text"
            value={form.note}
            onChange={set('note')}
            placeholder={isEdit && isOnlineGroup ? '수강생 이름' : '메모'}
          />
        </div>

        {/* 저장 버튼 */}
        {isGroupCreate ? (
          <div className="space-y-2" style={{ marginTop: 8 }}>
            <Button
              block
              onClick={() => saveGroup(true)}
              disabled={saving}
            >
              {saving ? '저장 중...' : '저장하고 계속 입력'}
            </Button>
            <Button
              variant="outline"
              block
              onClick={() => saveGroup(false)}
              disabled={saving}
            >
              저장하고 닫기
            </Button>
            <p className="text-xs text-center" style={{ color: TEXT_INACTIVE, marginTop: 2 }}>
              여러 명이면 "저장하고 계속 입력"으로 이름·금액만 바꿔가며 등록하세요.
            </p>
          </div>
        ) : (
          <SubmitButton
            htmlType="submit"
            loading={saving}
            blockedReason={blockedReason}
            style={{ marginTop: 8 }}
          >
            {isEdit ? '수정하기' : '결제 저장'}
          </SubmitButton>
        )}
        </>)}

        {isEdit && (
          <Button
            variant="destructiveOutline"
            block
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-1"
          >
            결제 내역 삭제
          </Button>
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
