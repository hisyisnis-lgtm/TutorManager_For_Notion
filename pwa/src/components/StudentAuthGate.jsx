import { useState, useEffect, useRef } from 'react';
import { Button, Input, Typography, Flex } from 'antd';
import { ShieldCheckIcon } from '@phosphor-icons/react';
import {
  PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY,
  BG_APP, STATUS_ERROR_TEXT, BORDER_DEFAULT,
} from '../constants/theme.js';
import {
  hasStudentAccess, requestStudentOtp, verifyStudentOtp,
} from '../api/studentAuth.js';

const RESEND_SECONDS = 60;

// 학생 페이지 진입 게이트 — 새 기기는 휴대폰 인증을 거쳐야 통과.
// disabled(게스트 게임 등)이거나 이미 권한이 있으면 즉시 children 렌더.
export default function StudentAuthGate({ token, disabled = false, children }) {
  const [granted, setGranted] = useState(() => disabled || hasStudentAccess(token));
  const [phase, setPhase] = useState('idle');   // idle | sent | no_phone
  const [code, setCode] = useState('');
  const [phoneTail, setPhoneTail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    timerRef.current = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timerRef.current);
  }, [resendIn]);

  if (granted) return children;

  async function sendOtp() {
    setBusy(true); setError('');
    try {
      const res = await requestStudentOtp(token);
      if (res.ok === false && res.reason === 'no_phone') {
        setPhase('no_phone');
        return;
      }
      setPhoneTail(res.phoneTail || '');
      setPhase('sent');
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      setError(e.status === 429 ? '요청이 많아요. 잠시 후 다시 시도해주세요.'
        : e.status === 404 ? '학생 코드를 확인해주세요.'
        : '인증번호 발송에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally { setBusy(false); }
  }

  async function submitCode() {
    if (code.length !== 6) { setError('인증번호 6자리를 입력해주세요.'); return; }
    setBusy(true); setError('');
    try {
      await verifyStudentOtp(token, code);
      setGranted(true);
    } catch (e) {
      setError(e.status === 401 ? '인증번호가 일치하지 않아요. 다시 확인해주세요.'
        : e.status === 429 ? '시도가 많아요. 잠시 후 다시 시도해주세요.'
        : '인증에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally { setBusy(false); }
  }

  const cardStyle = {
    width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16,
    border: `1px solid ${BORDER_DEFAULT}`, padding: '32px 24px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
  };

  return (
    <Flex
      align="center" justify="center"
      style={{ minHeight: '100dvh', background: BG_APP, padding: 20 }}
    >
      <div style={cardStyle}>
        <Flex vertical align="center" gap={16}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: PRIMARY_BG,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldCheckIcon size={30} weight="fill" color={PRIMARY} />
          </div>
          <Typography.Title level={4} style={{ margin: 0, color: TEXT_PRIMARY, textAlign: 'center' }}>
            본인 확인
          </Typography.Title>
          <Typography.Text style={{ color: TEXT_SECONDARY, textAlign: 'center', fontSize: 14, lineHeight: 1.6 }}>
            소중한 정보 보호를 위해 새 기기에서는<br />휴대폰 인증을 한 번만 진행해요.
          </Typography.Text>
        </Flex>

        {phase === 'no_phone' && (
          <div style={{
            marginTop: 20, padding: '14px 16px', borderRadius: 12, background: PRIMARY_BG,
            color: TEXT_SECONDARY, fontSize: 14, lineHeight: 1.6, textAlign: 'center',
          }}>
            등록된 휴대폰 번호가 없어요.<br />
            <span style={{ fontWeight: 600, color: TEXT_PRIMARY }}>선생님께 문의</span>해 인증을 받아주세요.
          </div>
        )}

        {phase !== 'no_phone' && (
          <Flex vertical gap={12} style={{ marginTop: 24 }}>
            {phase === 'sent' && (
              <>
                <Typography.Text style={{ color: TEXT_SECONDARY, fontSize: 13, textAlign: 'center' }}>
                  {phoneTail ? `···${phoneTail} 번호로 인증번호를 보냈어요.` : '인증번호를 보냈어요.'}
                </Typography.Text>
                <Input
                  size="large"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onPressEnter={submitCode}
                  placeholder="인증번호 6자리"
                  inputMode="numeric"
                  maxLength={6}
                  style={{ borderRadius: 12, textAlign: 'center', letterSpacing: 6, fontSize: 18 }}
                  autoFocus
                />
              </>
            )}

            {error && (
              <Typography.Text style={{ color: STATUS_ERROR_TEXT, fontSize: 13, textAlign: 'center' }}>
                {error}
              </Typography.Text>
            )}

            {phase === 'idle' && (
              <Button
                type="primary" size="large" block loading={busy} onClick={sendOtp}
                style={{ borderRadius: 12, height: 48, fontWeight: 600 }}
              >
                인증번호 받기
              </Button>
            )}

            {phase === 'sent' && (
              <>
                <Button
                  type="primary" size="large" block loading={busy}
                  disabled={code.length !== 6} onClick={submitCode}
                  style={{ borderRadius: 12, height: 48, fontWeight: 600 }}
                >
                  확인
                </Button>
                <Button
                  type="link" block disabled={resendIn > 0 || busy} onClick={sendOtp}
                  style={{ color: resendIn > 0 ? TEXT_TERTIARY : PRIMARY }}
                >
                  {resendIn > 0 ? `다시 보내기 (${resendIn}초)` : '인증번호 다시 보내기'}
                </Button>
              </>
            )}
          </Flex>
        )}
      </div>
    </Flex>
  );
}
