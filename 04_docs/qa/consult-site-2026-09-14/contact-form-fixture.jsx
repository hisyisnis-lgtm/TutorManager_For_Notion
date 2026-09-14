import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ContactForm from '../../site/src/components/ContactForm.jsx';

const fixture = { calls: [], aborts: 0, blockedRequests: 0 };
window.__CONTACT_FIXTURE__ = fixture;
window.fetch = async () => { fixture.blockedRequests++; throw new Error('모의 검증에서는 외부 요청을 보낼 수 없습니다.'); };
document.addEventListener('click', event => {
  if (event.target.closest('a')) event.preventDefault();
});

function Fixture() {
  const [mode, setMode] = useState('success');
  const [run, setRun] = useState(0);
  const [count, setCount] = useState(0);
  const submit = (payload, { signal }) => {
    const call = { payload, mode, aborted: false };
    fixture.calls.push(call);
    setCount(fixture.calls.length);
    return new Promise((resolve, reject) => {
      let timer;
      signal.addEventListener('abort', () => {
        call.aborted = true;
        fixture.aborts++;
        clearTimeout(timer);
      }, { once: true });
      if (mode === 'timeout') return;
      timer = setTimeout(() => {
        if (mode === 'failure') reject(new Error('모의 메일 제공자 오류입니다. 입력한 내용은 유지됩니다.'));
        else resolve(mode === 'unconfirmed' ? {} : { ok: true });
      }, 350);
    });
  };
  return <main className="fixture-main">
    <aside className="fixture-controls" aria-label="모의 검증 제어">
      <h1 className="t-h3">출강·협업 폼 · 모의 검증</h1>
      <p>실제 메일이나 API 요청은 전송되지 않습니다. 가상 정보만 입력해 주세요.</p>
      <label htmlFor="fixture-mode">모의 응답</label>
      <select id="fixture-mode" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="success">접수 성공</option>
        <option value="failure">제공자 오류</option>
        <option value="timeout">시간 초과 (1.5초)</option>
        <option value="unconfirmed">접수 확인 누락</option>
      </select>
      <button className="btn btn--md btn--outline-ink" onClick={() => { fixture.calls.length = 0; fixture.aborts = 0; setCount(0); setRun(value => value + 1); }}>모의 폼 초기화</button>
      <p role="status">모의 제출: {count}회</p>
    </aside>
    <ContactForm key={run} submit={submit} timeoutMs={1500} />
  </main>;
}

createRoot(document.getElementById('fixture-root')).render(<Fixture />);
