import { useState, useRef } from 'react';
import { submitConsultation } from '../api/consultApi';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const TIME_OPTIONS = ['오전 (9-12시)', '오후 (12-18시)', '저녁 (18-21시)'];
const LEVEL_OPTIONS = ['입문', '초급', '중급', '고급'];

export default function ConsultPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState('');
  const [preferredDays, setPreferredDays] = useState([]);
  const [preferredTime, setPreferredTime] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const formRef = useRef(null);

  function toggleDay(day) {
    setPreferredDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  }

  function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!phone.trim()) { setError('전화번호를 입력해주세요.'); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setError('전화번호를 올바르게 입력해주세요.'); return; }

    setLoading(true);
    try {
      await submitConsultation({
        name: name.trim(),
        phone: digits,
        level: level || null,
        preferredDays,
        preferredTime: preferredTime || null,
        message: message.trim() || null,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || '신청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-b from-brand-700 to-brand-500 text-white px-6 pt-16 pb-12 text-center">
        <p className="text-brand-100 text-sm font-medium tracking-widest uppercase mb-3">Free Consultation</p>
        <h1 className="text-3xl font-bold leading-tight mb-3">
          중국어로 말하고 싶은 분,<br />여기서 시작하세요
        </h1>
        <p className="text-brand-100 text-base leading-relaxed mb-2">
          회화·발음 교정 전문 | 입문~초중급 특화
        </p>
        <p className="text-brand-200 text-sm leading-relaxed mb-8">
          Zoom 30분, 완전 무료
        </p>
        <button
          onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-white text-brand-600 font-semibold px-8 py-3 rounded-full shadow-md active:scale-95 transition-transform"
        >
          무료 신청하기
        </button>
      </div>

      <div className="max-w-lg mx-auto px-6 py-10 space-y-8">

        {/* 이런 분께 딱 맞아요 */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">이런 분께 딱 맞아요</h2>
          <div className="space-y-3">
            {[
              { icon: '🌱', title: '중국어를 처음 시작하고 싶은 분', desc: '어디서부터 시작해야 할지 같이 잡아드려요.' },
              { icon: '😶', title: '배우긴 했는데 막상 말이 안 나오는 분', desc: '왜 입이 안 열리는지, 어떻게 바꿀 수 있는지 이야기해요.' },
              { icon: '🔤', title: '발음이 자꾸 신경 쓰여 자신감이 없는 분', desc: '발음 교정 중심 수업으로 자연스럽게 말할 수 있게 도와드려요.' },
              { icon: '📈', title: '초·중급인데 어떻게 올려야 할지 막막한 분', desc: '현재 수준을 진단하고 다음 단계 방향을 제안해드려요.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <span className="text-2xl mt-0.5">{icon}</span>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{title}</p>
                  <p className="text-gray-500 text-sm mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 상담에서 이런 걸 해드려요 */}
        <div className="bg-brand-50 rounded-2xl p-5 border border-brand-100">
          <p className="text-brand-700 font-semibold text-sm mb-3">상담에서 이런 걸 해드려요</p>
          <ul className="space-y-2 text-sm text-brand-700">
            <li className="flex gap-2"><span>📍</span><span>현재 수준 진단 (입문~초중급 기준)</span></li>
            <li className="flex gap-2"><span>📍</span><span>회화 실력이 안 느는 이유 찾기</span></li>
            <li className="flex gap-2"><span>📍</span><span>발음 교정 포인트 체크</span></li>
            <li className="flex gap-2"><span>📍</span><span>나에게 맞는 학습 방향 제안</span></li>
          </ul>
          <div className="mt-4 pt-4 border-t border-brand-100 space-y-1.5 text-sm text-brand-600">
            <p>• Zoom 화상통화 30분 진행</p>
            <p>• 신청 후 문자로 일정을 안내해드려요</p>
            <p>• 완전 무료, 부담 없이 신청하세요</p>
          </div>
        </div>

        {/* 이런 상담은 어려워요 */}
        <div className="bg-gray-100 rounded-2xl p-5 border border-gray-200">
          <p className="text-gray-600 font-semibold text-sm mb-2">신청 전에 확인해주세요</p>
          <p className="text-gray-500 text-sm mb-3">저는 회화·발음 교정을 전문으로 합니다.<br />아래 분들은 제가 충분히 도움드리기 어려울 수 있어요.</p>
          <ul className="space-y-1 text-sm text-gray-400">
            <li>· HSK 시험 준비</li>
            <li>· 작문·쓰기 집중 학습</li>
            <li>· 대학원 진학, 유학, 어학연수 준비</li>
          </ul>
        </div>

      </div>

      {/* 신청 폼 */}
      <div ref={formRef} className="max-w-lg mx-auto px-6 pb-16">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-6">무료 상담 신청</h2>

          {done ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">✅</div>
              <p className="text-xl font-bold text-gray-900 mb-2">신청 완료!</p>
              <p className="text-gray-500 text-sm leading-relaxed">
                신청해주셔서 감사합니다.<br />
                확인 후 문자로 연락드릴게요.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {/* 이름 */}
              <div>
                <label className="label">이름 <span className="text-brand-500">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="홍길동"
                  className="input-field w-full"
                  autoComplete="name"
                />
              </div>

              {/* 전화번호 */}
              <div>
                <label className="label">전화번호 <span className="text-brand-500">*</span></label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(formatPhone(e.target.value))}
                  placeholder="010-0000-0000"
                  className="input-field w-full"
                  inputMode="numeric"
                  autoComplete="tel"
                />
              </div>

              {/* 현재 수준 */}
              <div>
                <label className="label">현재 중국어 수준</label>
                <div className="grid grid-cols-4 gap-2">
                  {LEVEL_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setLevel(prev => prev === opt ? '' : opt)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        level === opt
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* 희망 요일 */}
              <div>
                <label className="label">희망 요일 <span className="text-gray-400 font-normal">(복수 선택 가능)</span></label>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                        preferredDays.includes(day)
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              {/* 희망 시간대 */}
              <div>
                <label className="label">희망 시간대</label>
                <div className="space-y-2">
                  {TIME_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPreferredTime(prev => prev === opt ? '' : opt)}
                      className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium border text-left transition-colors ${
                        preferredTime === opt
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* 상담 내용 */}
              <div>
                <label className="label">상담 희망 내용 <span className="text-gray-400 font-normal">(선택)</span></label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="궁금한 점이나 학습 목표를 자유롭게 적어주세요."
                  rows={3}
                  className="textarea-field w-full"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full text-center"
              >
                {loading ? '신청 중...' : '무료 상담 신청하기'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
