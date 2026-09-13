# 공식웹 후기 썸네일 배포

2026-09-14, https://tiantianchinese.com/reviews/ 에 실제 블로그 썸네일 3개를 반영했다.

- main 소스: `114263d559a050013e3243577052568ae16d38a1`.
- Pages: `014aca80-27f4-494e-9352-d523ced901f2` — https://014aca80.tiantianchinese.pages.dev
- 직전 운영: `84da1323-bcb4-432f-92ed-55e93baf4951`. 다른 태스크의 최신 게임 배포를 기준으로 보존했다.
- 938파일 / 110,623,197바이트. 후기 HTML 1개 교체, CSS 1개 추가. 나머지 936파일·footer·가격12파일·게임24파일은 동일하다. 실제 업로드2개, Cloudflare자산934개 재사용.
- Astro 빌드·390/1280px 실제 브라우저·CSP·공개가격 검사가 통과했다. 운영에서도 사진3개 로드, fallback 비활성, 가로넘침0·가격링크0·콘솔오류0을 확인했다.
- 원격936개 자산 manifest 전부 일치. 고유주소·구매도메인의14개 응답 확인, 가격 noindex/nofollow와 옛 checkout302 유지. 구매도메인 HTML은 기존 Cloudflare 이메일 보호 변환만 복원한 후 전체 해시를 대조했다.
- PWA는 `49cf77aa-619c-49bb-ad35-55de28b6813d` 그대로다. 이번 PWA·Worker·DNS 배포는 없다.
- 공용 architecture.md에 새 배포 상태를 기록했다. 비교 근거는 stage-manifest.json, preflight.json, live-verification.json과 source-snapshot에 보관했다.
