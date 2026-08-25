// ESLint(flat config) — 목적은 스타일 통제가 아니라 **죽은 코드 조기 발견** 하나다.
//  2026-08-10 게임 코드 검수에서 나온 것들(미사용 import 2개, 렌더 불가 분기, 쓰기만 하는 state,
//  삭제된 서브시스템의 유령 export 17개)은 전부 이 규칙 하나로 잡혔을 것들이다.
//  규칙을 늘리면 기존 25k줄에서 노이즈가 폭발해 아무도 안 보게 되므로 의도적으로 좁게 유지한다.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['dist/**', 'dist-game/**', 'dev-dist/**', 'node_modules/**', 'public/**', 'android/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        fetch: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', performance: 'readonly', crypto: 'readonly',
        Audio: 'readonly', Image: 'readonly', FormData: 'readonly', File: 'readonly', Blob: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', XMLHttpRequest: 'readonly', AbortController: 'readonly',
        SpeechSynthesisUtterance: 'readonly', HTMLElement: 'readonly', CustomEvent: 'readonly',
        sessionStorage: 'readonly', caches: 'readonly', atob: 'readonly', btoa: 'readonly',
        IntersectionObserver: 'readonly', MediaRecorder: 'readonly', EventSource: 'readonly',
        ErrorEvent: 'readonly', createImageBitmap: 'readonly', OffscreenCanvas: 'readonly',
        __APP_VERSION__: 'readonly', __GAME_APP__: 'readonly', process: 'readonly', global: 'readonly',
      },
    },
    // 게임 코드 곳곳에 `// eslint-disable-line react-hooks/exhaustive-deps`(의도된 예외)가 이미 깔려 있다.
    //  플러그인이 없으면 그 주석들이 전부 "규칙 정의 없음" 에러가 되므로 함께 등록한다.
    //  react 플러그인은 규칙 세트 때문이 아니라 **jsx-uses-vars 하나** 때문에 넣는다 —
    //  이게 없으면 no-unused-vars가 JSX(`<Icon/>`)를 사용으로 못 봐서, 오탐을 피하려 대문자 식별자를
    //  통째로 무시해야 하고 그러면 정작 잡아야 할 미사용 import(BG_MESH·DIFF_COLORS 같은)를 놓친다.
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-vars': 'error',
      // JSX 태그 이름은 no-undef가 못 본다 — `<SectionHeading>` import 누락이 빌드까지 통과해
      //  런타임 ReferenceError로만 드러났다(2026-08-25 PersonalPage 분할). 이 규칙이 그 사각지대를 덮는다.
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-react': 'error',
      // deps 누락은 게임에서 실제로 stale 클로저 버그를 냈던 부류 — 다만 기존 코드가 많아 warn으로 시작.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 죽은 코드 탐지 — 이 설정의 존재 이유.
      //  args: 'after-used' = 시그니처 호환용 뒤쪽 인자는 봐주되, 진짜 안 쓰는 앞 인자는 잡는다.
      //  `_` 접두사는 의도적 미사용(구조분해로 필드 빼내기 등)의 명시적 표식.
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        caughtErrors: 'none',
      }],
      // 아래 셋은 게임 코드에서 실제로 사고를 냈던 부류라 error로.
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      // 스타일·취향 영역은 전부 끈다(노이즈 방지).
      'no-empty': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      // 한글·이모지 정규식(닉네임 sanitize, 한자 범위)에서 오탐 — 의도된 코드다.
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
    },
  },
  {
    // 테스트 — vitest 전역
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', vi: 'readonly',
        Element: 'readonly', // jsdom shim(Element.prototype.animate)용
      },
    },
  },
];
