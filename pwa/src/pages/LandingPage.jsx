import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../components/shadcn/button';
import OfficialLessonsPage from '../components/public/OfficialLessonsPage';
import { TEXT_TERTIARY } from '../constants/theme';

const OFFICIAL_CONSULT_URL = 'https://tiantianchinese.com/consult/';

export default function LandingPage() {
  const { state } = useLocation();
  const isConsult = state?.tab === '상담';

  useEffect(() => {
    if (isConsult) window.location.replace(OFFICIAL_CONSULT_URL);
  }, [isConsult]);

  if (!isConsult) return <OfficialLessonsPage />;

  return <main className="mx-auto max-w-[480px] px-4 py-12 space-y-6">
    <img src="/logo/logo-red.png" alt="하늘하늘 중국어" className="h-6 w-auto" />
    <h1 className="text-xl font-semibold">상담 신청으로 이동합니다</h1>
    <p className="text-sm leading-7" style={{ color: TEXT_TERTIARY }}>공식 홈페이지에서 상담을 신청해 주세요.</p>
    <Button asChild block><a href={OFFICIAL_CONSULT_URL}>상담 신청 페이지 열기</a></Button>
  </main>;
}
