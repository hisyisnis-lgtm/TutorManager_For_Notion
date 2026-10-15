import { ShieldCheckIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import { Card, CardContent } from '../components/shadcn/card';
import { KAKAO_CHANNEL_CHAT_URL } from '../constants.js';
import { BG_APP, PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY } from '../constants/theme.js';

const states = {
  login_required: ['홈페이지 계정으로 시작해요', '학생앱도 홈페이지와 같은 계정을 사용해요. 로그인 후 이용 승인을 확인해 주세요.'],
  not_linked: ['강사 승인을 기다리고 있어요', '회원가입은 완료되었어요. 강사가 학생앱 사용을 허용하면 같은 계정으로 숙제와 수업을 확인할 수 있어요.'],
  student_not_linked: ['강사 승인을 기다리고 있어요', '회원가입은 완료되었어요. 강사가 학생앱 사용을 허용하면 같은 계정으로 내 수업과 숙제를 확인할 수 있어요.'],
  not_allowed: ['학생앱 사용 승인이 필요해요', '강사가 학생앱 사용을 허용하면 이용할 수 있어요. 선생님께 이용 상태를 문의해 주세요.'],
  not_provided: ['학생앱 사용 승인이 필요해요', '강사가 학생앱 사용을 허용하면 이용할 수 있어요. 선생님께 이용 상태를 문의해 주세요.'],
  profile_incomplete: ['회원 정보를 먼저 완성해 주세요', '마이페이지에서 필수 회원 정보를 입력한 뒤 학생 앱을 이용해 주세요.'],
  connection_error: ['연결을 확인하지 못했어요', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'],
};

export default function SitePersonalEntryPage({ reason = 'login_required', onRetry }) {
  const [title, description] = states[reason] || states.not_allowed;
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-5 py-8" style={{ background: BG_APP }}>
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: PRIMARY_BG }}>
            <ShieldCheckIcon size={24} weight="fill" color={PRIMARY} />
          </div>
          <p className="mb-2 text-sm font-semibold" style={{ color: TEXT_SECONDARY }}>하늘하늘중국어 학생 앱</p>
          <h1 className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>{title}</h1>
          <p className="mb-6 mt-3 text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>{description}</p>
          <div className="flex flex-col gap-2">
            {reason === 'login_required' && <Button size="lg" block asChild>
              <a href="/login/?next=%2Fpersonal%2F">회원 로그인</a>
            </Button>}
            {onRetry && <Button variant={reason === 'connection_error' ? 'default' : 'outline'} size="lg" block onClick={onRetry}>다시 확인</Button>}
            {reason !== 'login_required' && <Button variant="outline" block asChild><a href="/account/">마이페이지</a></Button>}
            <Button variant="ghost" block asChild><a href={KAKAO_CHANNEL_CHAT_URL} target="_blank" rel="noopener noreferrer">선생님께 문의</a></Button>
            <Button variant="ghost" block asChild><a href="/">홈페이지로</a></Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
