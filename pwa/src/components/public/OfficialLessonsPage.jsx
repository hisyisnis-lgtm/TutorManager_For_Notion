import { useEffect } from 'react';
import { Button } from '../shadcn/button';
import { TEXT_TERTIARY } from '../../constants/theme.js';

export const OFFICIAL_LESSONS_URL = 'https://tiantianchinese.com/lessons/';

export default function OfficialLessonsPage() {
  useEffect(() => { window.location.replace(OFFICIAL_LESSONS_URL); }, []);
  return <main className="mx-auto max-w-[480px] px-4 py-12 space-y-6">
    <img src="/logo/logo-red.png" alt="하늘하늘 중국어" className="h-6 w-auto" />
    <h1 className="text-xl font-semibold">수업 안내로 이동합니다</h1>
    <p className="text-sm leading-7" style={{ color: TEXT_TERTIARY }}>수업 방식과 상담 순서는 공식 홈페이지에서 확인해 주세요.</p>
    <Button asChild block><a href={OFFICIAL_LESSONS_URL}>공식 수업 안내 열기</a></Button>
  </main>;
}
