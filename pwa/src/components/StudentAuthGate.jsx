import { useState, useEffect, useRef } from 'react';
import { Button, Input, Typography, Flex } from 'antd';
import { ShieldCheckIcon, ArrowLeftIcon, DeviceMobileIcon } from '@phosphor-icons/react';
import {
  PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY,
  BG_APP, STATUS_ERROR_TEXT, STATUS_SUCCESS_DARK, BORDER_DEFAULT,
} from '../constants/theme.js';
import {
  hasStudentAccess, requestStudentOtp, verifyStudentOtp,
} from '../api/studentAuth.js';

const RESEND_SECONDS = 30;

// 학생 페이지 진입 게이트 — 새 기기는 휴대폰 인증을 거쳐야 통과.
// disabled(게스트 게임 등)이거나 이미 권한이 있으면 즉시 children 렌더.
export default function StudentAuthGate({ token, disabled = false, children }) {
  const [granted, setGranted] = useState(() => disabled || hasStudentAccess(token));
  const [phase, setPhase] = useState('idle');   // idle | sent | no_phone
  const [code, setCode] = useState('');
  const [phoneTail, setPhoneTail] = useState('');
  const [error, setError] = useState('');
  const [errNonce, setErrNonce] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    timerRef.current = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timerRef.current);
  }, [resendIn]);

  if (granted) return children;

  function fail(msg) { setError(msg); setErrNonce((n) => n + 1); }

  async function sendOtp(resend = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await requestStudentOtp(token);
      if (res.ok === false && res.reason === 'no_phone') { setPhase('no_phone'); return; }
      setPhoneTail(res.phoneTail || '');
      setCode('');
      setPhase('sent');
      setResendIn(RESEND_SECONDS);
      if (resend) setNotice('인증번호를 다시 보냈어요.');
    } catch (e) {
      fail(e.status === 429 ? '요청이 많아요. 잠시 후 다시 시도해 주세요.'
        : e.status === 404 ? '학생 코드를 확인해 주세요.'
        : '인증번호 발송에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally { setBusy(false); }
  }

  async function submitCode(codeArg) {
    const c = codeArg ?? code;
    if (c.length !== 6 || busy) return;
    setBusy(true); setError('');
    try {
      await verifyStudentOtp(token, c);
      setGranted(true);
    } catch (e) {
      setCode('');
      fail(e.status === 401 ? '인증번호가 일치하지 않아요. 다시 확인해 주세요.'
        : e.status === 429 ? '시도가 많아요. 잠시 후 다시 시도해 주세요.'
        : '인증에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally { setBusy(false); }
  }

  return (
    <Flex
      align="center" justify="center"
      style={{ minHeight: '100dvh', background: BG_APP, padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))' }}
    >
      <div
        className="sa-gate-card"
        style={{
          width: '100%', maxWidth: 360, background: '#fff', borderRadius: 20,
          border: `1px solid ${BORDER_DEFAULT}`, padding: '36px 26px 30px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
        }}
      >
        <Flex vertical align="center" gap={14}>
          <div
            className="sa-gate-icon"
            style={{
              width: 60, height: 60, borderRadius: 20, background: PRIMARY_BG,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 0 6px ${PRIMARY_BG}66`,
            }}
          >
            {phase === 'no_phone'
              ? <DeviceMobileIcon size={24} weight="fill" color={PRIMARY} />
              : <ShieldCheckIcon size={24} weight="fill" color={PRIMARY} />}
          </div>
          <Typography.Title level={4} style={{ margin: 0, color: TEXT_PRIMARY, textAlign: 'center', letterSpacing: '-0.01em' }}>
            {phase === 'no_phone' ? '인증을 받을 수 없어요' : '본인 확인'}
          </Typography.Title>
          <Typography.Text style={{ color: TEXT_SECONDARY, textAlign: 'center', fontSize: 14, lineHeight: 1.65 }}>
            {phase === 'sent'
              ? <>휴대폰으로 보낸 인증번호 6자리를<br />입력해 주세요.</>
              : phase === 'no_phone'
                ? <>등록된 휴대폰 번호가 없어요.</>
                : <>소중한 정보를 지키기 위해<br />새 기기에서는 한 번만 확인할게요.</>}
          </Typography.Text>
        </Flex>

        {/* 전화 미등록 — 막다른 길 방지 */}
        {phase === 'no_phone' && (
          <div style={{
            marginTop: 22, padding: '16px 18px', borderRadius: 14, background: PRIMARY_BG,
            color: TEXT_SECONDARY, fontSize: 14, lineHeight: 1.65, textAlign: 'center',
          }}>
            <span style={{ fontWeight: 700, color: TEXT_PRIMARY }}>선생님께 문의</span>해<br />인증을 받아 주세요.
          </div>
        )}

        {phase === 'sent' && (
          <Flex vertical align="center" gap={6} style={{ marginTop: 22, marginBottom: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 999, background: PRIMARY_BG,
              color: PRIMARY, fontWeight: 700, fontSize: 13,
            }}>
              <DeviceMobileIcon size={16} weight="fill" />
              {phoneTail ? `010 ···· ${phoneTail}` : '등록된 번호'}
            </span>
            <Typography.Text style={{ color: TEXT_TERTIARY, fontSize: 12, textAlign: 'center' }}>
              문자가 도착하기까지 1~2분 걸릴 수 있어요.
            </Typography.Text>
          </Flex>
        )}

        {/* 액션 영역 */}
        {phase !== 'no_phone' && (
          <Flex vertical gap={14} style={{ marginTop: phase === 'sent' ? 14 : 24 }}>
            {phase === 'sent' && (
              <Input.OTP
                className="sa-otp"
                length={6}
                size="large"
                value={code}
                formatter={(s) => s.replace(/\D/g, '')}
                onChange={(val) => { setError(''); setCode(val); if (val.length === 6) submitCode(val); }}
                autoFocus
              />
            )}

            {notice && !error && (
              <Typography.Text style={{ color: STATUS_SUCCESS_DARK, fontSize: 13, textAlign: 'center', fontWeight: 600 }}>
                ✓ {notice}
              </Typography.Text>
            )}

            {error && (
              <Typography.Text
                key={errNonce}
                className="sa-gate-shake"
                style={{ color: STATUS_ERROR_TEXT, fontSize: 13, textAlign: 'center', fontWeight: 600 }}
              >
                {error}
              </Typography.Text>
            )}

            {phase === 'idle' && (
              <Button
                type="primary" size="large" block loading={busy} onClick={() => sendOtp(false)}
                style={{ borderRadius: 14, height: 50, fontWeight: 600, fontSize: 16 }}
              >
                인증번호 받기
              </Button>
            )}

            {phase === 'sent' && (
              <>
                <Button
                  type="primary" size="large" block loading={busy}
                  disabled={code.length !== 6} onClick={() => submitCode()}
                  style={{ borderRadius: 14, height: 50, fontWeight: 600, fontSize: 16 }}
                >
                  확인
                </Button>
                <Flex align="center" justify="center" gap={4} style={{ marginTop: 2 }}>
                  <Button
                    type="text" size="small"
                    onClick={() => { setPhase('idle'); setCode(''); setError(''); }}
                    style={{ color: TEXT_TERTIARY, padding: '0 8px' }}
                    icon={<ArrowLeftIcon size={16} />}
                  >
                    처음으로
                  </Button>
                  <span style={{ color: BORDER_DEFAULT }}>·</span>
                  <Button
                    type="text" size="small" disabled={resendIn > 0 || busy} onClick={() => sendOtp(true)}
                    style={{ color: resendIn > 0 ? TEXT_TERTIARY : PRIMARY, fontWeight: 600, padding: '0 8px' }}
                  >
                    {resendIn > 0 ? `다시 보내기 (${resendIn})` : '다시 보내기'}
                  </Button>
                </Flex>
              </>
            )}
          </Flex>
        )}

        {phase === 'no_phone' && (
          <Button
            type="default" size="large" block onClick={() => { setPhase('idle'); setError(''); }}
            style={{ borderRadius: 14, height: 48, fontWeight: 600, marginTop: 18 }}
          >
            처음으로
          </Button>
        )}
      </div>
    </Flex>
  );
}
