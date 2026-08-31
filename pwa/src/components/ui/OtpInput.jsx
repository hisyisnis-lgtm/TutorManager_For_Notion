import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * OtpInput — antd `<Input.OTP>` 대체. 학생 SMS 인증 게이트에서 쓴다.
 *
 * shadcn 쪽 대응은 별도 패키지(`input-otp`)가 필요한데, 쓰는 곳이 한 곳뿐이라
 * 의존성을 늘리지 않고 직접 만들었다(코드 절약 사다리 5·7).
 *
 * 바깥 컨테이너에 `sa-otp` 클래스를 유지한다 — index.css가 이미
 * 칸 크기(52px·radius 12·20px bold)와 균등 배분을 잡고 있어 그대로 재사용한다.
 *
 * antd와 맞춘 동작:
 *  · 숫자만 입력(formatter 대응)
 *  · 입력하면 다음 칸으로, Backspace로 빈 칸이면 이전 칸으로
 *  · 붙여넣기하면 현재 칸부터 채운다(문자 메시지에서 복사하는 흐름)
 *  · onChange는 **합쳐진 문자열**을 넘긴다 — 호출부가 길이로 자동 제출을 판단한다
 */
export default function OtpInput({ length = 6, value = '', onChange, autoFocus = false, className, ...props }) {
  const refs = useRef([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  const emit = (next) => onChange?.(next.join('').slice(0, length));

  const setAt = (i, digit) => {
    const next = [...chars];
    next[i] = digit;
    emit(next);
  };

  const handleChange = (i) => (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (!digits) { setAt(i, ''); return; }
    if (digits.length === 1) {
      setAt(i, digits);
      refs.current[i + 1]?.focus();
      return;
    }
    // 여러 자가 한 번에 들어온 경우(붙여넣기·자동완성) — 현재 칸부터 채운다
    const next = [...chars];
    for (let k = 0; k < digits.length && i + k < length; k++) next[i + k] = digits[k];
    emit(next);
    refs.current[Math.min(i + digits.length, length - 1)]?.focus();
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      e.preventDefault();
      setAt(i - 1, '');
      refs.current[i - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); refs.current[i - 1]?.focus(); }
    if (e.key === 'ArrowRight' && i < length - 1) { e.preventDefault(); refs.current[i + 1]?.focus(); }
  };

  return (
    <div className={cn('sa-otp flex gap-2', className)} {...props}>
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={c}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onFocus={(e) => e.target.select()}
          autoFocus={autoFocus && i === 0}
          aria-label={`인증번호 ${i + 1}번째 자리`}
          className="min-w-0 flex-1 rounded-lg border border-input bg-background text-center focus-visible:border-primary focus-visible:outline-none"
        />
      ))}
    </div>
  );
}
