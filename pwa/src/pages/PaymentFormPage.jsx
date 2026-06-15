import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stripEmoji } from '../utils/stringUtils.js';
import { Alert, Button, Input, Select, Typography } from 'antd';
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
import { formatKRW } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import { TEXT_SECONDARY, TEXT_INACTIVE } from '../constants/theme.js';

const todayKST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

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

  // 온라인그룹수업: 학생앱 미등록자. 학생 없이 수강생 이름·금액만 기록(시간회차·할인·고정가격 미사용).
  const isOnlineGroup = selectedClassType?.title?.includes('온라인그룹수업') ?? false;
  // 신규 등록 + 온라인그룹수업일 때만 "수강생 이름 + 저장하고 계속" 단건 반복 UI
  const isGroupCreate = isOnlineGroup && !isEdit;

  // 고정 가격 상품 (원데이클래스만): 1인 단가가 시간당 기준으로 저장됨 → 총액으로 표시·자동 채움.
  const isFixedPriceClass = (selectedClassType?.title?.includes('원데이클래스') || selectedClassType?.title?.includes('체험수업')) ?? false;
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

  // 수업 종류 선택 → 원데이클래스(고정가격)만 시간회차·금액 자동 채움
  const onSelectClassType = (value) => {
    const ct = classTypes.find((c) => c.id === value);
    const isFixed = (ct?.title?.includes('원데이클래스') || ct?.title?.includes('체험수업')) ?? false;
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
        sessionCount: 0, // 그룹은 시간회차 개념 없음 (매출은 실제 결제 금액으로 집계)
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
    setSaving(false);
    if (keepOpen) {
      // 수업종류·결제일·결제수단은 유지, 이름·금액·비고만 비워 다음 사람 바로 입력
      setForm((f) => ({ ...f, guestName: '', actualAmount: '', note: '' }));
      setNotice(`${name} 결제 저장됨 · 이어서 입력하세요`);
    } else {
      navigate(-1);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.classTypeId) { setError('수업 종류를 선택하세요.'); return; }

    // 온라인그룹수업 신규는 saveGroup으로 처리 (Enter 제출 시 닫기 저장)
    if (isGroupCreate) { saveGroup(false); return; }

    // 일반 결제 검증
    if (!form.sessionCount || isNaN(parseFloat(form.sessionCount))) { setError('시간 회차를 입력하세요.'); return; }
    if (parseFloat(form.sessionCount) <= 0) { setError('시간 회차는 0보다 커야 합니다.'); return; }
    if (form.actualAmount === '' || isNaN(parseFloat(form.actualAmount))) { setError('실제 결제 금액을 입력하세요.'); return; }
    if (parseFloat(form.actualAmount) < 0) { setError('결제 금액은 0 이상이어야 합니다.'); return; }
    // 신규일 때만 학생 필수 (편집은 기존 학생 관계 유지)
    if (!isEdit && !form.studentId) { setError('학생을 선택하세요.'); return; }

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
      refreshAll();
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
          <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} />
        )}
        {notice && (
          <Alert type="success" message={notice} showIcon closable onClose={() => setNotice(null)} style={{ borderRadius: 12 }} />
        )}

        {/* ① 수업 종류 선택 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            ① 수업 종류
          </Typography.Text>
          <Select
            value={form.classTypeId || undefined}
            onChange={onSelectClassType}
            style={{ width: '100%' }}
            size="large"
            placeholder="선택하세요"
            disabled={isEdit && isOnlineGroup}
          >
            {classTypes.map((ct) => {
              const optGroup = ct.title?.includes('온라인그룹수업') ?? false;
              const optFixed = (ct.title?.includes('원데이클래스') || ct.title?.includes('체험수업')) ?? false;
              const totalPrice = Math.round(ct.unitPrice * (ct.duration || 60) / 60);
              return (
                <Select.Option key={ct.id} value={ct.id}>
                  {optGroup
                    ? ct.title
                    : optFixed
                    ? `${ct.title} (${ct.duration}분 ${totalPrice.toLocaleString()}원)`
                    : `${ct.title} (${ct.unitPrice.toLocaleString()}원)`}
                </Select.Option>
              );
            })}
          </Select>
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
                  (시간 회차 {fixedSessionCount} 자동 입력)
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
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ② 수강생 이름
            </Typography.Text>
            <Input
              placeholder="결제한 수강생 이름"
              value={form.guestName}
              onChange={(e) => setForm((f) => ({ ...f, guestName: e.target.value }))}
              size="large"
              style={{ borderRadius: 12 }}
            />
          </div>
        ) : isOnlineGroup ? null : (
          <div>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ② 학생
            </Typography.Text>
            <Input
              type="text"
              placeholder="학생 이름 검색..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              size="large"
              style={{ borderRadius: 12, marginBottom: 8 }}
            />
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {students
                .filter((s) => s.name.includes(studentSearch))
                .map((s) => {
                  const isSelected = form.studentId === s.id;
                  return (
                  <label
                    key={s.id}
                    ref={isSelected ? selectedStudentRef : null}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-[background-color,border-color] duration-150 ease-out ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="studentId"
                      value={s.id}
                      checked={isSelected}
                      onChange={() => setForm((f) => ({ ...f, studentId: s.id }))}
                      className="w-4 h-4 accent-brand-600"
                    />
                    <span className="text-sm font-medium text-gray-800">{s.name}</span>
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
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ③ 할인 이벤트 (선택)
            </Typography.Text>
            <Select
              value={form.discountEventId || undefined}
              onChange={(value) => setForm((f) => ({ ...f, discountEventId: value || '' }))}
              style={{ width: '100%' }}
              size="large"
              placeholder="없음"
              allowClear
            >
              {discounts.map((d) => (
                <Select.Option key={d.id} value={d.id}>
                  {d.name} ({d.rate}% 할인)
                </Select.Option>
              ))}
            </Select>
            {discountRate > 0 && (
              <p className="text-xs text-green-600 mt-1.5">
                {discountRate}% 할인 적용 → {formatKRW(Math.round(unitPrice * (1 - discountRate / 100)))}원/회
              </p>
            )}
          </div>
        )}

        {/* ④ 시간 회차 — 일반 결제만 */}
        {!isOnlineGroup && (
          <div>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              ④ 시간 회차
            </Typography.Text>
            <Input
              type="number"
              value={form.sessionCount}
              onChange={set('sessionCount')}
              step="0.5"
              min="0"
              placeholder="예: 8 (8회 60분 수업)"
              size="large"
              style={{ borderRadius: 12 }}
            />
            {sessionCount > 0 && unitPrice > 0 && (
              <p className="text-sm font-semibold text-brand-700 mt-2 p-3 bg-brand-50 rounded-xl">
                결제 예정 금액: {formatKRW(expectedAmount)}
              </p>
            )}
          </div>
        )}

        {/* 결제 금액 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제 금액' : '⑤ 실제 결제 금액'}
          </Typography.Text>
          <Input
            type="number"
            value={form.actualAmount}
            onChange={set('actualAmount')}
            step="1000"
            min="0"
            placeholder={isOnlineGroup ? '실제로 받은 금액' : '실제로 받은 금액'}
            size="large"
            style={{ borderRadius: 12 }}
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
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제 수단' : '⑥ 결제 수단'}
          </Typography.Text>
          <Select
            value={form.paymentMethod || undefined}
            onChange={(value) => setForm((f) => ({ ...f, paymentMethod: value || '' }))}
            style={{ width: '100%' }}
            size="large"
            placeholder="선택하세요"
            allowClear
          >
            {PAYMENT_METHODS.map((m) => (
              <Select.Option key={m} value={m}>{m}</Select.Option>
            ))}
          </Select>
        </div>

        {/* 결제일 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isOnlineGroup ? '결제일' : '⑦ 결제일'}
          </Typography.Text>
          <Input
            type="date"
            value={form.paymentDate}
            onChange={set('paymentDate')}
            size="large"
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 비고 (학생 없는 결제 편집 시에는 수강생 이름 = 타이틀 수정란) */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            {isEdit && isOnlineGroup ? '수강생 이름' : isOnlineGroup ? '비고 (선택)' : '⑧ 비고 (선택)'}
          </Typography.Text>
          <Input
            type="text"
            value={form.note}
            onChange={set('note')}
            placeholder={isEdit && isOnlineGroup ? '수강생 이름' : '메모'}
            size="large"
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 저장 버튼 */}
        {isGroupCreate ? (
          <div className="space-y-2" style={{ marginTop: 8 }}>
            <Button
              type="primary"
              block
              onClick={() => saveGroup(true)}
              disabled={saving}
              style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
            >
              {saving ? '저장 중...' : '저장하고 계속 입력'}
            </Button>
            <Button
              block
              onClick={() => saveGroup(false)}
              disabled={saving}
              style={{ borderRadius: 12, height: 44 }}
            >
              저장하고 닫기
            </Button>
            <p className="text-xs text-center" style={{ color: TEXT_INACTIVE, marginTop: 2 }}>
              여러 명이면 "저장하고 계속 입력"으로 이름·금액만 바꿔가며 등록하세요.
            </p>
          </div>
        ) : (
          <Button
            type="primary"
            block
            htmlType="submit"
            disabled={saving}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8 }}
          >
            {saving ? '저장 중...' : isEdit ? '수정하기' : '결제 저장'}
          </Button>
        )}
        </>)}

        {isEdit && (
          <Button
            danger
            block
            onClick={() => setShowDeleteConfirm(true)}
            style={{ borderRadius: 12, height: 44, marginTop: 4 }}
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
