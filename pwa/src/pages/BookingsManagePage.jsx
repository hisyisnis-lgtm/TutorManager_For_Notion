import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/layout/PageHeader.jsx';
import { fetchBlockedDates, createBlockedDate, deleteBlockedDate } from '../api/bookingApi.js';
import { Card, Input, Button } from 'antd';

const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// 30분 단위 시간 슬롯 (08:00 ~ 22:00)
const TIME_SLOTS = [];
for (let m = 8 * 60; m <= 22 * 60; m += 30) {
  const h = String(Math.floor(m / 60)).padStart(2, '0');
  const min = String(m % 60).padStart(2, '0');
  TIME_SLOTS.push(`${h}:${min}`);
}

function formatBlockedLabel(item) {
  const timeStr = item.blockedTimes?.length > 0 ? ` (${item.blockedTimes.join(', ')})` : '';
  if (item.type === '반복') {
    const days = item.days.join('·');
    if (item.start && item.end) return `매주 ${days}${timeStr} (${item.start} ~ ${item.end})`;
    if (item.start) return `매주 ${days}${timeStr} (${item.start}~)`;
    if (item.end) return `매주 ${days}${timeStr} (~${item.end})`;
    return `매주 ${days}${timeStr}`;
  }
  if (item.end && item.end !== item.start) return `${item.start} ~ ${item.end}${timeStr}`;
  return `${item.start || ''}${timeStr}`;
}

export default function BookingsManagePage() {
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [form, setForm] = useState({
    type: '일회성',
    days: [],
    start: '',
    end: '',
    memo: '',
    blockedTimes: [],
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBlockedDates();
      setBlocked(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleDay = (day) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }));
  };

  const resetForm = () => setForm({ type: '일회성', days: [], start: '', end: '', memo: '', blockedTimes: [] });

  const toggleTime = (t) => {
    setForm(f => ({
      ...f,
      blockedTimes: f.blockedTimes.includes(t)
        ? f.blockedTimes.filter(x => x !== t)
        : [...f.blockedTimes, t].sort(),
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await createBlockedDate({
        type: form.type,
        days: form.type === '반복' ? form.days : [],
        start: form.start || undefined,
        end: form.end || undefined,
        memo: form.memo || undefined,
        blockedTimes: form.blockedTimes.length > 0 ? form.blockedTimes : undefined,
      });
      resetForm();
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`"${item.memo || formatBlockedLabel(item)}" 을 삭제하시겠습니까?`)) return;
    setDeletingId(item.id);
    try {
      await deleteBlockedDate(item.id);
      setBlocked(prev => prev.filter(b => b.id !== item.id));
    } catch (e) {
      alert(`삭제 실패: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const isFormValid = form.type === '반복'
    ? form.days.length > 0
    : !!form.start;

  return (
    <div className="page-content">
      <PageHeader title="예약 불가 설정" />

      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-sm text-gray-500">{blocked.length}개 등록됨</span>
        <Button
          type="link"
          onClick={() => { setShowForm(v => !v); setFormError(null); if (showForm) resetForm(); }}
          style={{ padding: 0, fontWeight: 500 }}
        >
          {showForm ? '닫기' : '+ 추가'}
        </Button>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <form onSubmit={handleSave}>
          <Card variant="borderless" style={{ margin: '0 16px 12px', borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
            {/* 유형 선택 */}
            <div className="flex gap-2" style={{ marginBottom: 12 }}>
              {['일회성', '반복'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t, days: [], start: '', end: '' }))}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium border transition-colors ${
                    form.type === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* 반복: 요일 선택 */}
            {form.type === '반복' && (
              <div style={{ marginBottom: 12 }}>
                <p className="text-xs text-gray-500 mb-2">반복 요일</p>
                <div className="flex gap-1.5 flex-wrap">
                  {WEEK_DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`h-11 w-11 rounded-full text-sm font-medium border transition-colors ${
                        form.days.includes(day)
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 반복: 기간 제한 (선택) */}
            {form.type === '반복' && (
              <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 12 }}>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">시작일 (선택)</label>
                  <input
                    type="date"
                    value={form.start}
                    onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">종료일 (선택)</label>
                  <input
                    type="date"
                    value={form.end}
                    min={form.start}
                    onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            )}

            {/* 일회성: 날짜 선택 */}
            {form.type === '일회성' && (
              <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 12 }}>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">날짜</label>
                  <input
                    type="date"
                    required
                    value={form.start}
                    onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">종료일 (범위 시)</label>
                  <input
                    type="date"
                    value={form.end}
                    min={form.start}
                    onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            )}

            {/* 차단 시간 슬롯 선택 (선택) */}
            <div style={{ marginBottom: 12 }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">
                  차단 시간 <span className="text-gray-500">(선택 안 하면 하루 전체 차단)</span>
                </p>
                {form.blockedTimes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, blockedTimes: [] }))}
                    className="text-xs text-gray-400 active:text-red-500"
                  >
                    전체 해제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TIME_SLOTS.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTime(t)}
                    className={`px-2.5 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                      form.blockedTimes.includes(t)
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: 12 }}>
              <label className="block text-xs text-gray-500 mb-1">메모 (선택)</label>
              <Input
                size="large"
                style={{ borderRadius: 12 }}
                value={form.memo}
                onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                placeholder="예: 추석 연휴"
              />
            </div>

            {formError && (
              <div style={{ padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322', marginBottom: 12 }}>
                {formError}
              </div>
            )}

            <Button
              type="primary"
              block
              htmlType="submit"
              disabled={saving || !isFormValid}
              style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </Card>
        </form>
      )}

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}
      {error && (
        <div style={{ margin: '0 16px', padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
          {error}
        </div>
      )}

      {!loading && blocked.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🚫</div>
          <div>등록된 예약 불가 설정이 없습니다</div>
        </div>
      )}

      <div className="px-4 pb-24 space-y-2 mt-1">
        {blocked.map(item => (
          <Card key={item.id} variant="borderless" style={{ borderRadius: 16 }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    item.type === '반복' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {item.type}
                  </span>
                  {item.blockedTimes?.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                      시간 차단
                    </span>
                  )}
                </div>
                <div className="font-medium text-gray-800 text-sm">{formatBlockedLabel(item)}</div>
                {item.memo && item.memo !== formatBlockedLabel(item) && (
                  <div className="text-xs text-gray-500 mt-0.5">{item.memo}</div>
                )}
              </div>
              <Button
                danger
                onClick={() => handleDelete(item)}
                disabled={deletingId === item.id}
                style={{ borderRadius: 8, flexShrink: 0 }}
              >
                {deletingId === item.id ? '삭제 중...' : '삭제'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
