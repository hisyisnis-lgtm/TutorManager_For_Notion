import { useEffect, useId, useRef, useState } from 'react';
import { KAKAO_CHANNEL_CHAT_URL, PRIVACY_URL } from '../config.js';
import '../styles/consult.css';

const ENDPOINT = 'https://tutor-manager-proxy.hisyisnis.workers.dev/consult';
const LEVELS = ['완전 처음이에요', '조금 배운 적 있어요', '어느 정도 배웠는데 막혀있어요'];
const UNCONFIRMED = '접수 결과를 확인하지 못했어요. 다시 신청하기 전에 카카오 채널로 문의해 주세요.';
const EMPTY_FIELDS = { name: '', phone: '', kakaoId: '', level: '', message: '' };

// One request per submission. An uncertain response must not resend a request
// that may already have created a consultation and sent its notification.
export async function submitConsultation(payload, { signal } = {}) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal,
    });
  } catch { throw new Error(UNCONFIRMED); }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const rejected = response.status >= 400 && response.status < 500;
    const message = rejected && typeof data?.error === 'string' && data.error.length <= 300
      ? data.error : rejected ? '입력 내용을 확인한 뒤 다시 신청해 주세요.' : UNCONFIRMED;
    throw new Error(message);
  }
  return data;
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function ConsultForm({ submit = submitConsultation, timeoutMs = 25000 }) {
  const id = useId();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const activeRequest = useRef(null);
  const validationFocus = useRef(null);
  const nameInput = useRef(null), phoneInput = useRef(null);
  const errorSummary = useRef(null), doneTitle = useRef(null);

  useEffect(() => {
    setReady(true);
    return () => {
      const active = activeRequest.current;
      activeRequest.current = null;
      if (active) { clearTimeout(active.timer); active.controller.abort(); }
    };
  }, []);
  useEffect(() => {
    validationFocus.current?.current?.focus();
    validationFocus.current = null;
  }, [fieldErrors]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (done) doneTitle.current?.focus(); }, [done]);

  function update(field, value) {
    setFields(previous => ({ ...previous, [field]: value }));
    setFieldErrors(previous => previous[field] ? { ...previous, [field]: undefined } : previous);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!ready || activeRequest.current || done) return;
    const digits = fields.phone.replace(/\D/g, '');
    const errors = {};
    if (!fields.name.trim()) errors.name = '이름을 입력해 주세요.';
    else if (fields.name.trim().length > 50) errors.name = '이름은 50자 이내로 입력해 주세요.';
    if (!digits) errors.phone = '전화번호를 입력해 주세요.';
    else if (digits.length < 10 || digits.length > 11) errors.phone = '전화번호 10~11자리를 확인해 주세요.';
    validationFocus.current = errors.name ? nameInput : errors.phone ? phoneInput : null;
    setFieldErrors(errors);
    setError('');
    if (Object.keys(errors).length) return;

    const request = { controller: new AbortController(), timer: null };
    activeRequest.current = request;
    setSubmitting(true);
    const payload = {
      name: fields.name.trim(), phone: digits,
      kakaoId: fields.kakaoId.trim() || null,
      level: fields.level || null, message: fields.message.trim() || null,
    };
    try {
      const expired = new Promise((_, reject) => {
        request.timer = setTimeout(() => {
          request.controller.abort();
          reject(new Error(UNCONFIRMED));
        }, timeoutMs);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => submit(payload, { signal: request.controller.signal })), expired,
      ]);
      if (activeRequest.current !== request) return;
      if (result?.ok !== true) throw new Error(UNCONFIRMED);
      setDone(true);
    } catch (failure) {
      if (activeRequest.current === request) setError(failure?.message || UNCONFIRMED);
    } finally {
      clearTimeout(request.timer);
      if (activeRequest.current === request) {
        activeRequest.current = null;
        setSubmitting(false);
      }
    }
  }

  if (done) return (
    <div className="consult-form consult-form--done">
      <h2 className="t-h3" tabIndex={-1} ref={doneTitle}>상담 신청 접수</h2>
      <p className="t-body muted">신청 내용을 접수했어요. 공식 응대 시간은 09:00~23:00이며, 답변 가능한 때 확인 후 연락드릴게요.</p>
      <a className="btn btn--md btn--outline-ink consult-form__contact" href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener noreferrer">
        카카오 채널로 문의하기<span className="sr-only"> (새 창)</span>
      </a>
    </div>
  );

  return (
    <form className="consult-form" method="post" onSubmit={handleSubmit} noValidate aria-label="상담 신청" aria-busy={submitting}>
      <noscript>
        <div className="consult-form__privacy">
          <p>상담 신청에는 자바스크립트가 필요해요. 카카오 채널로 문의해 주세요.</p>
          <a href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener noreferrer">카카오 채널로 문의하기<span className="sr-only"> (새 창)</span></a>
        </div>
      </noscript>
      <fieldset className="consult-form__fields" disabled={!ready || submitting}>
        <legend className="sr-only">상담 신청 정보</legend>
        <div className="consult-form__field">
          <label htmlFor={`${id}-name`}>이름 <span className="consult-form__required">(필수)</span></label>
          <input ref={nameInput} id={`${id}-name`} name="name" value={fields.name} onChange={event => update('name', event.target.value)}
            required maxLength={50} autoComplete="name" placeholder="홍길동"
            aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined} />
          {fieldErrors.name && <p className="consult-form__field-error" id={`${id}-name-error`}>{fieldErrors.name}</p>}
        </div>

        <div className="consult-form__field">
          <label htmlFor={`${id}-phone`}>전화번호 <span className="consult-form__required">(필수)</span></label>
          <input ref={phoneInput} id={`${id}-phone`} name="tel" type="tel" inputMode="tel" autoComplete="tel"
            value={fields.phone} onChange={event => update('phone', formatPhone(event.target.value))}
            required maxLength={13} placeholder="010-0000-0000"
            aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={fieldErrors.phone ? `${id}-phone-error` : undefined} />
          {fieldErrors.phone && <p className="consult-form__field-error" id={`${id}-phone-error`}>{fieldErrors.phone}</p>}
        </div>

        <div className="consult-form__field">
          <label htmlFor={`${id}-kakao`}>카카오톡 ID <span className="consult-form__optional">(선택)</span></label>
          <input id={`${id}-kakao`} name="kakaoId" value={fields.kakaoId} onChange={event => update('kakaoId', event.target.value)}
            maxLength={50} autoComplete="off" autoCorrect="off" autoCapitalize="off" placeholder="kakao_id" />
        </div>

        <div className="consult-form__field">
          <label htmlFor={`${id}-level`}>현재 중국어 수준 <span className="consult-form__optional">(선택)</span></label>
          <select id={`${id}-level`} name="level" value={fields.level} onChange={event => update('level', event.target.value)}>
            <option value="">선택하지 않음</option>
            {LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
        </div>

        <div className="consult-form__field">
          <label htmlFor={`${id}-message`}>상담 희망 내용 <span className="consult-form__optional">(선택)</span></label>
          <textarea id={`${id}-message`} name="message" rows={4} maxLength={500} value={fields.message}
            onChange={event => update('message', event.target.value)} placeholder="궁금한 점이나 학습 목표를 적어 주세요." />
        </div>
      </fieldset>

      <div className="consult-form__privacy">
        <p>입력한 정보는 문의 답변과 상담·일정 조율에 사용합니다.</p>
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">개인정보처리방침<span className="sr-only"> (새 창)</span></a>
      </div>

      {error && <div className="consult-form__error" role="alert" tabIndex={-1} ref={errorSummary}>
        <p>{error}</p>
        <a href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener noreferrer">카카오 채널로 문의하기<span className="sr-only"> (새 창)</span></a>
      </div>}

      <button className="btn consult-form__submit" type="submit" disabled={!ready || submitting}>
        {submitting ? '접수 중…' : '상담 신청하기'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{submitting ? '신청 내용을 보내고 있어요.' : ''}</span>
    </form>
  );
}
