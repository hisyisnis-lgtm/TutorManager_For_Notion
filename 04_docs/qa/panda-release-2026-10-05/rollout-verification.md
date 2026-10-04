# 랴오랴오 운영 저장 전환 검증

검증 완료: 2026-10-04T18:18:42.928Z. PWA 공개 태그 배포 전 서버·백업 준비 근거다.

- Worker version: `a7f48e4a-5924-476f-9be1-bef31e1833a5` (100%).
- Worker origin: https://tutor-manager-proxy.hisyisnis.workers.dev
- 서버 main source: `9ff670a8166dea3735e86d1d2b923ca63863d2ee`.
- 계약 SHA-256: `9c9c1c8a5fcd0f5b38fdb56c234f55f107dc5c4de7e5bad81f66e75cdc752726`. Git 체크아웃의 CRLF/LF 차이는 정규화하며 실제 텍스트 변경은 여전히 차단한다.
- D1: 최초 판다 테이블 부재 확인 후 0005/0006 적용 성공. 기존 공유 DB 테이블 보존.

## 인증·거래·전환

[정상 TEST 학생 세션 검증](live-validation.md)에서 최초 알/누적23 지급, 먹이1 차감, 동일 요청 중복 차감 방지, 다른 payload 재사용409, 새 브라우저 두 컨텍스트의 캐시 없는 복원, 전환시각 유지 및 안내 확인 재접속 유지를 확인했다. 인증값과 개인 식별자, 실제 학생 화면 캡처는 Git에 포함하지 않았다.

## 백업·복구

사용자가 `student_panda_profiles`와 `student_panda_actions` 두 테이블만 기존 비공개 `tutormanager-backup/panda-backup/`에 저장하고 다운로드·새 로컬 DB 복구를 검사하는 범위를 명시적으로 승인했다.

[백업 실행 37223657743](https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/37223657743)이 성공했다. 전용 백업 토큰은 active, 지정 DB 메타데이터 조회 HTTP200. 실제 프로필1개/거래2개를 export한 후 압축·무결성 검사, R2 업로드·재다운로드, 완료 표식 대조 및 새 로컬 SQLite 복구를 통과했다. 복구본도 프로필1개/거래2개이며 운영 DB로 복원하지 않았다. 성공 후에만 완료 표식을 업로드했다.

객체 prefix: `panda-backup/2026-10-04-37223657743-1`. SQL·학생 기록·복구 DB·시크릿은 공개 Git 또는 Actions artifacts에 올리지 않았다.

앞선 D1 Read 토큰은 메타데이터 조회200이나 export10000이었다. 사용자 권한 변경 후 동일 전용 토큰으로 export 성공을 확인했다. 기존 배포 토큰을 백업용으로 복제하지 않았다.

## 출시 전 검사

Worker 전체841 tests 및 dry-run419.25KiB/gzip93.90KiB, 기존 인증/CORS6경계PASS. PWA전체877 tests, 서버 모드v2.49.0 build, 디자인ERROR/WARN0. 사용자가 두 지속 설정 활성화를 명시적으로 승인한 뒤 GitHub 변수 VITE_PANDA_SERVER_PERSISTENCE=true 및 PANDA_BACKUP_ENABLED=true를 확인했다. 일일 백업은 KST04:00, 같은 두 테이블/동일 비공개 R2 prefix에 한정한다. PWA 태그배포 완료 여부는 배포 진행 기록에서 확인한다.
