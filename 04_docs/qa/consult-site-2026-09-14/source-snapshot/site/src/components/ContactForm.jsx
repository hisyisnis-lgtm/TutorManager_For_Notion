import { useEffect, useId, useRef, useState } from 'react';
import { BUSINESS, PRIVACY_URL } from '../config.js';
import Icon from './Icon.jsx';

const ENDPOINT = 'https://tutor-manager-proxy.hisyisnis.workers.dev/contact';
const UNCONFIRMED = '접수 결과를 확인하지 못했어요. 이메일로 접수 여부를 확인해 주세요.';
const EMPTY_FIELDS = { type: '', company: '', name: '', email: '', message: '', website: '' };
const INQUIRY_TYPES = [
  { value: 'lecture', label: '기업·기관 출강' },
  { value: 'collaboration', label: '콘텐츠·브랜드 협업' },
];

export async function submitContactInquiry(payload, { signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal,
    });
  } catch { throw new Error(UNCONFIRMED); }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const rejected = response.status >= 400 && response.status < 500;
    const message = rejected && typeof data?.error === 'string' && data.error.length <= 300
      ? data.error : rejected ? '입력 내용을 확인한 뒤 다시 보내 주세요.' : UNCONFIRMED;
    throw new Error(message);
  }
  return data;
}

export default function ContactForm({ submit = submitContactInquiry, timeoutMs = 25000 }) {
  const id = useId();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const activeRequest = useRef(null);
  const validationFocus = useRef(null);
  const typeInput = useRef(null), companyInput = useRef(null), nameInput = useRef(null);
  const emailInput = useRef(null), messageInput = useRef(null);
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
    const payload = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]));
    const errors = {};
    if (!INQUIRY_TYPES.some(option => option.value === payload.type)) errors.type = '문의 유형을 선택해 주세요.';
    if (!payload.company) errors.company = '기업·기관명을 입력해 주세요.';
    else if (payload.company.length > 100) errors.company = '기업·기관명은 100자 이내로 입력해 주세요.';
    if (!payload.name) errors.name = '담당자 이름을 입력해 주세요.';
    else if (payload.name.length > 50) errors.name = '담당자 이름은 50자 이내로 입력해 주세요.';
    if (!payload.email) errors.email = '이메일을 입력해 주세요.';
    else if (payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errors.email = '이메일 주소를 확인해 주세요.';
    if (!payload.message) errors.message = '문의 내용을 입력해 주세요.';
    else if (payload.message.length > 2000) errors.message = '문의 내용은 2,000자 이내로 입력해 주세요.';
    const fieldRefs = { type: typeInput, company: companyInput, name: nameInput, email: emailInput, message: messageInput };
    validationFocus.current = fieldRefs[Object.keys(errors)[0]] || null;
    setFieldErrors(errors);
    setError('');
    if (Object.keys(errors).length) return;

    const request = { controller: new AbortController(), timer: null };
    activeRequest.current = request;
    setSubmitting(true);
    try {
      // Do not retry automatically: a lost response may still follow a delivered email.
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
    <section className="contact-form contact-form--done" aria-labelledby={`${id}-done`}>
      <h2 className="t-h3" id={`${id}-done`} tabIndex={-1} ref={doneTitle}>문의를 접수했어요.</h2>
      <p className="t-body muted">내용을 확인한 뒤 남겨 주신 이메일로 연락드릴게요.</p>
    </section>
  );

  return (
    <form className="contact-form" method="post" onSubmit={handleSubmit} noValidate aria-labelledby={`${id}-title`} aria-busy={submitting}>
      <div className="contact-form__heading">
        <h2 className="t-h3" id={`${id}-title`}>문의 남기기</h2>
        <p className="t-caption muted">모든 항목을 입력해 주세요.</p>
      </div>
      <noscript>
        <div className="contact-form__privacy">
          <p>문의 접수에는 자바스크립트가 필요해요. 이메일로 문의해 주세요.</p>
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
        </div>
      </noscript>
      <fieldset className="contact-form__fields" disabled={!ready || submitting}>
        <legend className="sr-only">출강·협업 문의 정보</legend>
        <div className="contact-form__field">
          <label htmlFor={`${id}-type`}>문의 유형</label>
          <div className="contact-form__select">
            <select ref={typeInput} id={`${id}-type`} name="type" value={fields.type} onChange={event => update('type', event.target.value)} required
              aria-invalid={fieldErrors.type ? true : undefined} aria-describedby={fieldErrors.type ? `${id}-type-error` : undefined}>
              <option value="">선택해 주세요</option>
              {INQUIRY_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Icon name="caretRight" size={16} className="contact-form__select-icon" />
          </div>
          {fieldErrors.type && <p className="contact-form__field-error" id={`${id}-type-error`}>{fieldErrors.type}</p>}
        </div>
        <div className="contact-form__field">
          <label htmlFor={`${id}-company`}>기업·기관명</label>
          <input ref={companyInput} id={`${id}-company`} name="company" value={fields.company} onChange={event => update('company', event.target.value)}
            required maxLength={100} autoComplete="organization"
            aria-invalid={fieldErrors.company ? true : undefined} aria-describedby={fieldErrors.company ? `${id}-company-error` : undefined} />
          {fieldErrors.company && <p className="contact-form__field-error" id={`${id}-company-error`}>{fieldErrors.company}</p>}
        </div>
        <div className="contact-form__field">
          <label htmlFor={`${id}-name`}>담당자 이름</label>
          <input ref={nameInput} id={`${id}-name`} name="name" value={fields.name} onChange={event => update('name', event.target.value)}
            required maxLength={50} autoComplete="name"
            aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined} />
          {fieldErrors.name && <p className="contact-form__field-error" id={`${id}-name-error`}>{fieldErrors.name}</p>}
        </div>
        <div className="contact-form__field">
          <label htmlFor={`${id}-email`}>이메일</label>
          <input ref={emailInput} id={`${id}-email`} name="email" type="email" inputMode="email" value={fields.email} onChange={event => update('email', event.target.value)}
            required maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false}
            aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? `${id}-email-error` : undefined} />
          {fieldErrors.email && <p className="contact-form__field-error" id={`${id}-email-error`}>{fieldErrors.email}</p>}
        </div>
        <div className="contact-form__field">
          <label htmlFor={`${id}-message`}>문의 내용</label>
          <textarea ref={messageInput} id={`${id}-message`} name="message" rows={5} value={fields.message} onChange={event => update('message', event.target.value)}
            required maxLength={2000} placeholder="제안 내용과 희망 일정을 알려 주세요."
            aria-invalid={fieldErrors.message ? true : undefined} aria-describedby={fieldErrors.message ? `${id}-message-error` : undefined} />
          {fieldErrors.message && <p className="contact-form__field-error" id={`${id}-message-error`}>{fieldErrors.message}</p>}
        </div>
        <div className="contact-form__website" aria-hidden="true">
          <label htmlFor={`${id}-website`}>Website</label>
          <input id={`${id}-website`} name="website" value={fields.website} onChange={event => update('website', event.target.value)} tabIndex={-1} autoComplete="off" />
        </div>
      </fieldset>
      <div className="contact-form__privacy">
        <p>입력한 정보는 문의 확인과 답변에 사용합니다.</p>
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">개인정보처리방침<span className="sr-only"> (새 창)</span></a>
      </div>
      {error && <div className="contact-form__error" role="alert" tabIndex={-1} ref={errorSummary}>
        <p>{error}</p>
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
      </div>}
      <button className="btn btn--lg btn--filled-ink contact-form__submit" type="submit" disabled={!ready || submitting}>
        {submitting ? '접수 중…' : '문의 보내기'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{submitting ? '문의 내용을 보내고 있어요.' : ''}</span>
    </form>
  );
}
