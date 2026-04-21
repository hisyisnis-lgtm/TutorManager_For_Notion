import { SECTION_HEADING } from '../../constants/styles.js';

/**
 * SectionHeading — 카드/페이지 내 섹션 제목 (17px · 600 · #1d1d1f)
 * 홈·예약·학생 상세·상담 관리 등에서 반복되는 제목 블록을 단일 표현으로 통일.
 *
 * @param {ReactNode} children - 제목 텍스트
 * @param {Object}    style    - 개별 override (marginBottom 조정 등)
 * @param {string}    as       - 태그명 (기본 'span', 접근성 상 'h2'~'h4' 전달 가능)
 */
export default function SectionHeading({ children, style, as: Tag = 'span' }) {
  return <Tag style={{ ...SECTION_HEADING, ...style }}>{children}</Tag>;
}
