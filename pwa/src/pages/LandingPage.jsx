import { useState } from 'react';
import {
  MessageCircle, BookOpen, Clock, MapPin, Users,
  CheckCircle2, Volume2, TrendingUp, Sparkles,
  ChevronRight, User, Gift, Calendar, CreditCard,
} from 'lucide-react';
import { submitConsultation } from '../api/consultApi';

const TABS = ['소개', '무료상담', '수강료'];
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const TIME_OPTIONS = ['오전 (9-12시)', '오후 (12-18시)', '저녁 (18-21시)'];
const LEVEL_OPTIONS = ['입문', '초급', '중급', '고급'];
const PRIMARY = '#7f0005';

// ─── 탭 1: 서비스 소개 ────────────────────────────────────────
function LandingContent({ onConsult, onPricing }) {
  return (
    <div className="pb-20">
      {/* Hero */}
      <section style={{ backgroundColor: PRIMARY }} className="text-white px-6 pt-14 pb-12">
        <span className="inline-block text-xs font-medium bg-white/20 px-3 py-1 rounded-full mb-5 tracking-wide">
          회화 · 발음 교정 전문
        </span>
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight mb-3">
          중국어로<br />말하고 싶다면
        </h1>
        <p className="text-white/70 text-sm leading-relaxed mb-9">
          10년 경력의 중국어 전문 강사와 함께<br />
          입문부터 초중급까지 체계적으로.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConsult}
            className="flex-1 bg-white font-bold py-3.5 rounded-xl text-sm active:opacity-80 transition-opacity"
            style={{ color: PRIMARY }}
          >
            무료 상담 신청
          </button>
          <button
            onClick={onPricing}
            className="flex-1 bg-white/15 text-white font-semibold py-3.5 rounded-xl text-sm active:bg-white/25 transition-colors border border-white/25"
          >
            수강료 안내
          </button>
        </div>
      </section>

      {/* Instructor */}
      <section className="px-5 py-8">
        <div className="bg-white rounded-xl p-5 flex items-center gap-5">
          <img
            src="/img/profile.jpg"
            alt="하늘쌤"
            className="w-[72px] h-[72px] rounded-xl object-cover object-top shrink-0"
          />
          <div>
            <p className="text-xs font-semibold mb-1 tracking-wide" style={{ color: PRIMARY }}>
              중국어 강사
            </p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">하늘쌤</h2>
            <div className="flex flex-wrap gap-1.5">
              {['10년 경력', '회화 전문', '발음 교정'].map(tag => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* For whom */}
      <section className="px-5 pb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">이런 분께 맞아요</h2>
        <div className="space-y-2.5">
          {[
            { Icon: Sparkles, title: '중국어를 처음 시작하고 싶은 분', desc: '어디서부터 시작할지 같이 잡아드려요.' },
            { Icon: Volume2, title: '발음 교정으로 자신감을 키우고 싶은 분', desc: '자연스럽게 말할 수 있도록 체계적으로 교정해드려요.' },
            { Icon: MessageCircle, title: '배웠지만 막상 말이 안 나오는 분', desc: '왜 입이 안 열리는지, 어떻게 해결할지 이야기해요.' },
            { Icon: TrendingUp, title: '초·중급인데 방향을 못 잡겠는 분', desc: '수준 진단 후 맞춤 방향을 제안해드려요.' },
          ].map(({ Icon, title, desc }) => (
            <div key={title} className="flex gap-4 bg-white rounded-xl p-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#fff0f1' }}>
                <Icon className="w-4 h-4" style={{ color: PRIMARY }} />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">{title}</p>
                <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Lesson info */}
      <section className="px-5 pb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">수업 안내</h2>
        <div className="bg-white rounded-xl p-5 space-y-4">
          {[
            { Icon: Clock, label: '수업 시간', value: '50분 기준 (조정 가능)' },
            { Icon: MapPin, label: '수업 장소', value: '강남 사무실 · Zoom 화상' },
            { Icon: BookOpen, label: '수업 방식', value: '회화·발음 교정, 1:1 맞춤형' },
            { Icon: Users, label: '수업 형태', value: '1:1 개인 과외' },
          ].map(({ Icon, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-sm text-gray-700 font-medium">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <section className="px-5 pb-8">
        <div className="bg-gray-50 rounded-xl p-5">
          <p className="text-sm font-semibold text-gray-600 mb-3">이런 상담은 어려워요</p>
          <p className="text-sm text-gray-400 leading-relaxed mb-3">
            하늘쌤은 입문~초중급 회화·발음 교정 전문입니다.<br />
            아래 항목은 충분히 도움드리기 어려울 수 있어요.
          </p>
          <ul className="space-y-1 text-sm text-gray-400">
            <li className="flex items-center gap-2">· HSK 시험 준비</li>
            <li className="flex items-center gap-2">· 작문·쓰기 집중 학습</li>
            <li className="flex items-center gap-2">· 대학원 진학, 유학, 어학연수 준비</li>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5">
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: '#fff0f1' }}>
          <p className="font-bold text-base mb-1.5" style={{ color: PRIMARY }}>
            Zoom 30분 무료 상담
          </p>
          <p className="text-gray-500 text-sm mb-5 leading-relaxed">
            부담 없이 신청하세요.<br />완전 무료, 신청 후 문자로 연락드립니다.
          </p>
          <button
            onClick={onConsult}
            className="text-white font-bold px-8 py-3.5 rounded-xl text-sm active:opacity-80 transition-opacity inline-flex items-center gap-2"
            style={{ backgroundColor: PRIMARY }}
          >
            무료 상담 신청하기
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── 탭 2: 무료 상담 신청 ─────────────────────────────────────
function ConsultContent() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState('');
  const [preferredDays, setPreferredDays] = useState([]);
  const [preferredTime, setPreferredTime] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

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
        name: name.trim(), phone: digits,
        level: level || null, preferredDays,
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

  const selectedStyle = { backgroundColor: PRIMARY, color: '#fff', borderColor: PRIMARY };
  const unselectedStyle = {};

  return (
    <div className="max-w-lg mx-auto px-5 py-8 pb-20">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1.5">무료 상담 신청</h2>
        <p className="text-gray-400 text-sm">Zoom 화상통화 30분 · 완전 무료</p>
      </div>

      {/* What you get */}
      <div className="bg-white rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">상담에서 해드리는 것</p>
        <div className="space-y-2">
          {[
            '현재 수준 진단 (입문~초중급)',
            '회화 실력이 안 느는 이유 찾기',
            '발음 교정 포인트 체크',
            '나에게 맞는 학습 방향 제안',
          ].map(item => (
            <div key={item} className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: PRIMARY }} />
              <span className="text-sm text-gray-600">{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-1 text-xs text-gray-400">
          <p>· 신청 후 문자로 일정을 안내해드려요</p>
          <p>· 완전 무료, 부담 없이 신청하세요</p>
        </div>
      </div>

      {done ? (
        <div className="bg-white rounded-xl p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-green-500" />
          </div>
          <p className="text-lg font-bold text-gray-900 mb-2">신청 완료!</p>
          <p className="text-gray-400 text-sm leading-relaxed">
            신청해주셔서 감사합니다.<br />확인 후 문자로 연락드릴게요.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label className="label">이름 <span style={{ color: PRIMARY }}>*</span></label>
            <input
              type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동" className="input-field w-full" autoComplete="name"
            />
          </div>

          <div>
            <label className="label">전화번호 <span style={{ color: PRIMARY }}>*</span></label>
            <input
              type="tel" value={phone}
              onChange={e => setPhone(formatPhone(e.target.value))}
              placeholder="010-0000-0000" className="input-field w-full"
              inputMode="numeric" autoComplete="tel"
            />
          </div>

          <div>
            <label className="label">현재 중국어 수준</label>
            <div className="grid grid-cols-4 gap-2">
              {LEVEL_OPTIONS.map(opt => (
                <button
                  key={opt} type="button"
                  onClick={() => setLevel(prev => prev === opt ? '' : opt)}
                  style={level === opt ? selectedStyle : unselectedStyle}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    level === opt ? '' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">
              희망 요일 <span className="text-gray-400 font-normal">(복수 선택)</span>
            </label>
            <div className="grid grid-cols-7 gap-1.5">
              {DAYS.map(day => (
                <button
                  key={day} type="button"
                  onClick={() => toggleDay(day)}
                  style={preferredDays.includes(day) ? selectedStyle : unselectedStyle}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    preferredDays.includes(day) ? '' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">희망 시간대</label>
            <div className="space-y-2">
              {TIME_OPTIONS.map(opt => (
                <button
                  key={opt} type="button"
                  onClick={() => setPreferredTime(prev => prev === opt ? '' : opt)}
                  style={preferredTime === opt ? selectedStyle : unselectedStyle}
                  className={`w-full py-3 px-4 rounded-xl text-sm font-medium border text-left transition-colors ${
                    preferredTime === opt ? '' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">
              상담 희망 내용 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <textarea
              value={message} onChange={e => setMessage(e.target.value)}
              placeholder="궁금한 점이나 학습 목표를 자유롭게 적어주세요."
              rows={3} className="textarea-field w-full"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full text-white font-bold py-3.5 rounded-xl text-sm transition-opacity disabled:opacity-50"
            style={{ backgroundColor: PRIMARY }}
          >
            {loading ? '신청 중...' : '무료 상담 신청하기'}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── 탭 3: 수강료 안내 ───────────────────────────────────────
function PricingContent({ onConsult }) {
  return (
    <div className="max-w-lg mx-auto px-5 py-8 pb-20 space-y-8">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1.5">수강료 안내</h2>
        <p className="text-gray-400 text-sm">하늘하늘 중국어 · 회화·발음 교정 전문</p>
      </div>

      {/* Value prop */}
      <div className="bg-white rounded-xl p-5">
        <p className="text-sm text-gray-500 leading-relaxed">
          필기 시험이 아닌{' '}
          <span className="font-semibold text-gray-700">'중국인처럼 자연스럽게 말하는 회화'</span>
          를 목표로 합니다. 발음, 억양, 리듬, 실전 표현을 중심으로
          개인의 말하기 습관에 맞춰 진행합니다.
        </p>
      </div>

      {/* 수강 대상 */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">수강 대상</p>
        <div className="bg-white rounded-xl p-5 space-y-2.5">
          {[
            '성인 학습자',
            '왕초보 ~ 중급 회화 수준 (TSC 3–5급)',
            '회화 및 발음 교정에 집중하고 싶은 분',
          ].map(item => (
            <div key={item} className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: PRIMARY }} />
              <span className="text-sm text-gray-600">{item}</span>
            </div>
          ))}
          <p className="text-xs text-gray-300 pt-1">
            ※ 고급 회화, 전문 번역, 비즈니스 중국어는 현재 운영하지 않습니다.
          </p>
        </div>
      </div>

      {/* 1:1 프라이빗 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <User className="w-4 h-4" style={{ color: PRIMARY }} />
          <h3 className="text-base font-bold text-gray-900">1:1 프라이빗 수업</h3>
        </div>
        <div className="space-y-2.5">
          <div className="rounded-xl p-5" style={{ backgroundColor: PRIMARY }}>
            <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full tracking-wider">추천</span>
            <div className="flex items-start justify-between mt-2.5">
              <div>
                <p className="font-bold text-white text-base">120분 집중 수업</p>
                <p className="text-white/60 text-xs mt-0.5">개념 → 발음 → 문장 → 실전 말하기</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-bold text-white text-2xl leading-none">100,000원</p>
                <p className="text-white/50 text-xs mt-1">1회 기준</p>
              </div>
            </div>
            <p className="text-white/50 text-xs mt-3">빠르게 말하기 변화를 체감하고 싶은 분께 추천</p>
          </div>

          <div className="bg-white rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-gray-900 text-base">90분 실속 수업</p>
                <p className="text-gray-400 text-xs mt-0.5">회화 연습 + 발음 교정 균형</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-bold text-gray-900 text-2xl leading-none">75,000원</p>
                <p className="text-gray-400 text-xs mt-1">1회 기준</p>
              </div>
            </div>
            <p className="text-gray-400 text-xs mt-3">직장인·입문자께 추천</p>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">60분 기본 수업</span>
            <span className="text-sm font-semibold text-gray-700">50,000원</span>
          </div>
        </div>
      </div>

      {/* 2:1 소그룹 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4" style={{ color: PRIMARY }} />
          <h3 className="text-base font-bold text-gray-900">2:1 소규모 그룹 수업</h3>
          <span className="text-xs text-gray-400">1인 기준</span>
        </div>
        <div className="space-y-2.5">
          <div className="bg-white rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-gray-900 text-base">120분 그룹 수업</p>
                <p className="text-gray-400 text-xs mt-0.5">친구 · 동료 · 커플 수강 추천</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-bold text-gray-900 text-2xl leading-none">80,000원</p>
                <p className="text-gray-400 text-xs mt-1">1인 기준</p>
              </div>
            </div>
            <p className="text-gray-400 text-xs mt-3">서로의 피드백으로 학습 효과를 높이는 구조</p>
          </div>

          <div className="bg-white rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-gray-900 text-base">90분 그룹 수업</p>
                <p className="text-gray-400 text-xs mt-0.5">반복 말하기로 회화 자신감 형성</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-bold text-gray-900 text-2xl leading-none">60,000원</p>
                <p className="text-gray-400 text-xs mt-1">1인 기준</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">60분 기본 수업</span>
            <span className="text-sm font-semibold text-gray-700">40,000원 (1인)</span>
          </div>
          <p className="text-xs text-gray-400 px-1">※ 3인 이상 그룹은 별도 상담 진행</p>
        </div>
      </div>

      {/* 혜택 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Gift className="w-4 h-4" style={{ color: PRIMARY }} />
          <h3 className="text-base font-bold text-gray-900">수강 혜택</h3>
        </div>
        <div className="bg-white rounded-xl p-5 space-y-2.5">
          {[
            '주 N회 자유롭게 일정 조정 가능',
            '하늘하늘 중국어 학습 굿즈 증정',
            '패키지 등록 시 첫 교재 제공',
            '대면 불가 시 Zoom 비대면 수업 (동일 가격)',
          ].map(item => (
            <div key={item} className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: PRIMARY }} />
              <span className="text-sm text-gray-600">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 수업 일정 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4" style={{ color: PRIMARY }} />
          <h3 className="text-base font-bold text-gray-900">수업 일정 안내</h3>
        </div>
        <div className="bg-white rounded-xl p-5 space-y-2 text-sm text-gray-500">
          <p>월~금 수업 가능 · 토요일 제외</p>
          <p>학습자와 협의 후 유연하게 일정 조율</p>
          <p>사전 예약제 운영</p>
          <p>주 고정 시간 확보 시 계획적인 학습에 유리</p>
        </div>
      </div>

      {/* 결제·환불 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4" style={{ color: PRIMARY }} />
          <h3 className="text-base font-bold text-gray-900">결제 및 환불 안내</h3>
        </div>
        <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-500">
          <p>선결제 기준으로 진행</p>
          <p>환불은 잔여 수업 횟수 기준으로 계산</p>
          <p>당일 취소 및 무단결석 시 환불 어려움</p>
          <p>일정 변경은 수업 시작 24시간 전까지 요청</p>
        </div>
      </div>

      {/* CTA */}
      <div className="space-y-3 pb-4">
        <div className="rounded-xl p-6 text-center" style={{ backgroundColor: '#fff0f1' }}>
          <p className="font-bold text-sm leading-relaxed" style={{ color: PRIMARY }}>
            빠르게 배우는 중국어보다,<br />오래 남는 중국어를 함께 만들어 갑니다.
          </p>
          <p className="text-gray-400 text-xs mt-2 mb-5">
            정확한 일정·수업 방식은 무료 상담에서 안내드려요
          </p>
          <button
            onClick={onConsult}
            className="w-full text-white font-bold py-3.5 rounded-xl text-sm active:opacity-80 transition-opacity"
            style={{ backgroundColor: PRIMARY }}
          >
            무료 상담 신청하기
          </button>
        </div>
        <p className="text-center text-xs text-gray-400">
          문의는 채널톡으로 편하게 연락주세요
        </p>
      </div>

    </div>
  );
}

// ─── 메인 랜딩 페이지 ─────────────────────────────────────────
export default function LandingPage() {
  const [tab, setTab] = useState('소개');

  function switchTab(t) {
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: '#f9fafb' }}>
      {/* Sticky header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-lg mx-auto px-5">
          <div className="flex items-center h-12">
            <img src="/logo/logo-red.png" alt="하늘하늘 중국어" className="h-6 object-contain" />
          </div>
          <div className="flex -mb-px">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className="mr-6 pb-2.5 text-sm font-medium border-b-2 transition-colors"
                style={
                  tab === t
                    ? { borderColor: PRIMARY, color: PRIMARY }
                    : { borderColor: 'transparent', color: '#9ca3af' }
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto">
        <div style={{ display: tab === '소개' ? 'block' : 'none' }}>
          <LandingContent onConsult={() => switchTab('무료상담')} onPricing={() => switchTab('수강료')} />
        </div>
        <div style={{ display: tab === '무료상담' ? 'block' : 'none' }}>
          <ConsultContent />
        </div>
        <div style={{ display: tab === '수강료' ? 'block' : 'none' }}>
          <PricingContent onConsult={() => switchTab('무료상담')} />
        </div>
      </main>
    </div>
  );
}
