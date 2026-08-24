import { PRIMARY } from '../../constants/theme.js';

// 본문 텍스트 안의 URL을 눌러서 열 수 있는 링크로 바꿔 렌더한다.
//
// 강사가 피드백·숙제 내용에 링크를 적어 보내는데(예: 그룹수업 안내 페이지) 순수 텍스트로
// 렌더돼 학생이 주소를 손으로 옮겨 적어야 했다. 2026-08-24 UX 검수에서 실제 데이터로 확인됨.
//
// 보안: http/https만 링크로 만든다. javascript:·data: 같은 실행 가능한 스킴은
// 강사 입력이라도 링크화하지 않는다(신뢰경계 검증은 생략 대상이 아니다).

const URL_RE = /https?:\/\/[^\s<>"'()[\]]+/g;

// 문장 끝에 붙어온 부호는 주소가 아니다 — "...group-class." 의 마침표까지 링크에 넣지 않는다.
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

function isSafeHttpUrl(raw) {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const LINK_STYLE = {
  color: PRIMARY,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  // 긴 주소가 카드 밖으로 삐져나가지 않게. 한국어 본문 사이에 섞여도 줄바꿈된다.
  wordBreak: 'break-all',
};

/** 텍스트를 그대로 렌더하되 URL만 링크로 감싼다. 줄바꿈은 부모의 white-space가 처리. */
export default function AutoLink({ text }) {
  const source = String(text ?? '');
  const nodes = [];
  let cursor = 0;

  for (const match of source.matchAll(URL_RE)) {
    let url = match[0];
    const trailing = url.match(TRAILING_PUNCT_RE);
    if (trailing) url = url.slice(0, -trailing[0].length);
    if (!url) continue;

    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    nodes.push(
      isSafeHttpUrl(url)
        ? <a key={`${match.index}-${url}`} href={url} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>{url}</a>
        : url,
    );
    cursor = match.index + url.length;
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return <>{nodes}</>;
}
