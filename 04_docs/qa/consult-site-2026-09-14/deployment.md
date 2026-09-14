# 2026-09-14 공식 웹·상담·Contact 배포

사용자의 명시적인 배포 요청에 따라 검증 커밋 `78d5c5264cf8e7f9db03c50884b142353807d9d6`을 main에 반영하고 Worker → 공식 웹 → PWA 순서로 배포했다. 원본 작업 폴더의 다른 WIP는 포함하지 않았다.

| 대상 | 운영 배포 |
| --- | --- |
| 공식 웹 | `54bed96a-b902-4823-a661-ee26dea217f0` · https://tiantianchinese.com |
| Worker | `32113c40-6cef-4bf6-93e5-b79d978ab835` · 트래픽 100% |
| PWA | `v2.48.5` · `dba17c14-e2b6-4262-9bcb-859cfa47fd53` |

## 반영 내용

- 공식 `/consult/` 상담 신청과 기존 앱의 소개·상담 진입 이동.
- `/contact/` 기업·기관 출강 및 콘텐츠·브랜드 협업 문의 폼, 고정 업무메일 수신. 문의 유형 화살표 오른쪽 여백 16px.
- 메인 ‘왜 하늘하늘 중국어인가’에 이력 7개 통합. 제목 아래 좌측 64px 사진과 이름 배치.
- 후기 카드 5:4 비율, 좌우 버튼, 양끝 그라데이션. 수업 안내의 중복 후기 섹션 제거.
- 게임 소개의 흰색 상담 버튼 글자·화살표 색상 수정.
- 공식 홈페이지에서 가격 링크를 숨기고 공유용 가격 페이지와 기존 게임 파일은 보존.

## 검증

- Worker 38파일/673테스트, PWA 65파일/560테스트, 배포 보호 23테스트, Contact 폼 11개 격리 검증 통과. PWA 디자인 감사 ERROR 0/WARN 0.
- [Worker CI](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34796080779), [PWA CI](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34796080759), [PWA 배포](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/34796312379) 성공.
- 사이트 staging 968파일과 소스 13개 해시 일치. 인라인 스크립트 50개·스타일 15개 CSP 검증 및 공개 가격 검사 통과. 가격 12파일·게임 24파일·video 폴더 19파일 보존.
- 운영 주요 8개 페이지 HTTP 200. 공식 웹 HTML은 Cloudflare의 확인된 업무메일 난독화와 복호화 스크립트만 정규화한 뒤 배포 파일과 일치했다. 가격·게임 HTML은 원본 바이트도 그대로 일치했다.
- 실제 브라우저에서 Contact 폼 활성화, 화살표 여백 16px, 상담 버튼의 `/consult/` 이동과 폼 활성화, 메인 사진 64px·좌측 정렬·이력 7개를 확인했다. 폼 콘솔 오류 없음.
- 운영 `https://tiantian-chinese.pages.dev/#/intro`를 열어 공식 `/lessons/`로 이동하는 것을 실제 브라우저에서 확인했다.
- Worker 공식 출처 `/contact`·`/consult` OPTIONS 204 및 비허용 출처 차단, PWA 운영 HTML·서비스워커·자산 색인·버전 2.48.5를 확인했다.

배포 중 실제 고객 문의나 추가 이메일은 전송하지 않았다. 배포 전 별도 연결 확인 메일 1건의 제공자 전송 성공은 확인했으나, 받은편지함 도착은 사용자 확인과 구분한다.

## 이전 운영 버전

롤백이 필요하면 Cloudflare에서 해당 대상의 이전 배포를 운영으로 복원하고 같은 공개 URL·자산·출처 검사를 수행한다. 이번 배포에는 데이터베이스 마이그레이션이 없다.

- 공식 웹: `014aca80-27f4-494e-9352-d523ced901f2`
- Worker: `2018e22c-8392-49cf-bdb3-255d65ff4b68`
- PWA: `v2.48.4`, `49cf77aa-619c-49bb-ad35-55de28b6813d`

기존 Dependabot #107은 9월 9일부터 열린 Wrangler→Miniflare→sharp 개발용 간접 의존성 알림이다. 이전 운영 기준과 같고 운영 Worker의 직접 사용 경로는 확인되지 않았다. 별도 개발 도구 업데이트 대상이며 이번 릴리스로 생긴 변경은 아니다.
