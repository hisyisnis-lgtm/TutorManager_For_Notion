import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Input, Typography } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { createStudent, updateStudent, parseStudent, STATUS_OPTIONS } from '../api/students.js';
import { getPage } from '../api/notionClient.js';
import { useData } from '../context/DataContext.jsx';

// 0/O, 1/I/l 제외 — 혼동 없는 대문자+숫자 32자
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default function StudentFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { refresh: refreshAll } = useData();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    level: '',
    goal: '',
    status: '🟢 수강중',
    memo: '',
    bookingCode: isEdit ? '' : generateCode(),
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      try {
        const page = await getPage(id);
        const s = parseStudent(page);
        setForm({
          name: s.name,
          phone: s.phone || '',
          email: s.email || '',
          level: s.level || '',
          goal: s.goal || '',
          status: s.status || '🟢 수강중',
          memo: s.memo || '',
          bookingCode: s.bookingCode || '',
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('이름을 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateStudent(id, { ...form, name: form.name.trim() });
        refreshAll();
        navigate(-1);
      } else {
        await createStudent({ ...form, name: form.name.trim() });
        refreshAll();
        navigate('/students');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <><PageHeader title="학생 수정" back /><LoadingSpinner /></>;

  return (
    <>
      <PageHeader title={isEdit ? '학생 수정' : '학생 추가'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {error && (
          <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} />
        )}

        {/* 이름 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            이름 *
          </Typography.Text>
          <Input
            size="large"
            value={form.name}
            onChange={set('name')}
            placeholder="홍길동"
            style={{ borderRadius: 12 }}
            required
          />
        </div>

        {/* 상태 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            상태
          </Typography.Text>
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className={`px-3 py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,border-color] duration-150 ease-out ${
                  form.status === s
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 전화번호 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            전화번호 (선택)
          </Typography.Text>
          <Input
            size="large"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="010-0000-0000"
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 이메일 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            이메일 (선택)
          </Typography.Text>
          <Input
            size="large"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="example@email.com"
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 레벨 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            레벨 (선택)
          </Typography.Text>
          <Input.TextArea
            value={form.level}
            onChange={set('level')}
            placeholder="예: 초급, 중급, 고급"
            rows={3}
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 목표 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            목표 (선택)
          </Typography.Text>
          <Input.TextArea
            value={form.goal}
            onChange={set('goal')}
            placeholder="예: 수능 1등급, 회화 향상"
            rows={3}
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 메모 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            메모 (선택)
          </Typography.Text>
          <Input.TextArea
            value={form.memo}
            onChange={set('memo')}
            placeholder="특이사항, 참고 정보 등"
            rows={3}
            style={{ borderRadius: 12 }}
          />
        </div>

        {/* 예약 코드 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            예약 코드
          </Typography.Text>
          <div className="flex gap-2">
            <Input
              size="large"
              value={form.bookingCode}
              onChange={set('bookingCode')}
              placeholder="자동 생성됩니다"
              style={{ borderRadius: 12, flex: 1 }}
            />
            <Button
              type="default"
              onClick={() => setForm((f) => ({ ...f, bookingCode: generateCode() }))}
              style={{ borderRadius: 12, height: 40, fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              재생성
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">학생이 /book/[코드] 로 예약 가능 · 직접 입력도 가능</p>
        </div>

        <Button
          type="primary"
          htmlType="submit"
          block
          disabled={saving}
          style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8 }}
        >
          {saving ? '저장 중...' : isEdit ? '수정 완료' : '학생 추가'}
        </Button>
      </form>
    </>
  );
}
