# 랴오랴오 서버 저장 전환·백업 운영

작성일: 2026-09-30. 2026-10-05 운영 D1·Worker와 정상 TEST 학생의 전환/동기화 및 실제 원격 백업·격리 복구 검증을 완료했다. `panda-readiness.json`은 근거 문서를 연결한 `verified`이며 PWA 공개 및 지속 활성화는 별도 진행 기록을 따른다.

## 저장과 전환 기준

- Notion 학생 페이지 ID가 학생별 D1 기록의 키다. 예약코드나 기기별 로컬 키를 기준으로 저장하지 않는다.
- Notion의 수업·숙제·피드백 실적으로 누적 먹이를 계산하고, Worker가 검증된 총량을 D1에 반영한다.
- 전환 정책은 **학생별 한 번만 알로 초기화하고 누적 획득 먹이 전액을 사용할 수 있게 하는 것**이다. 예전 로컬 성장·소비량을 새 서버 기록에 합치지 않는다.
- 예: 누적 169개 → 알과 먹이 169개 → 112개 먹이면 6단계와 먹이 57개. 예전 기기의 먹인 양을 다시 더하지 않는다.
- `0006_panda_transition.sql`의 전환 버전·완료 시각·시작 먹이·안내 확인 여부가 재접속/다른 기기의 반복 초기화를 막는다.
- 이후 D1이 정본이며, 기기 데이터는 화면 표시를 위한 캐시다. 저장 실패를 성공으로 표시하거나, 실패 시 알/먹이 0개로 덮어쓰지 않는다.

## 백업 범위와 산출물

공유 D1 `tone-game-users`에서 `student_panda_profiles`, `student_panda_actions`만 **한 번의 export 요청으로 함께** 내보낸다. 성조게임 회원·인증·알림 테이블은 포함하지 않는다.

Cloudflare는 [테이블별 D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)와 [복수 테이블 필터](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)를 제공한다. 설치된 Wrangler의 `--table` 배열을 사용하며, 전체 DB dump나 Time Travel 복구를 판다 복구 수단으로 쓰지 않는다.

`01_automation/backup_panda_to_r2.mjs`는 export 후 다음을 확인한다.

1. 허용 테이블 두 개만 있는 SQL을 메모리 SQLite에 복원한다. 외부 DB 연결, 트리거·뷰·가상 테이블·확장 기능 SQL을 거부한다.
2. SQLite 무결성, 필수 컬럼, 참조 관계, 먹이 잔액, 거래 revision, 전환 기록을 검사한다. 프로필과 과거 거래의 프로필 모두 서버의 동일 검증 함수를 사용하므로 아이템·착용 슬롯·소유권·레벨·구매가격·이름도 확인한다. 업데이트 전 0005 형식도 보관할 수 있다.
3. 압축 SQL과 행 수·원본/압축 SHA-256·시각이 든 완료 표식을 만든다. 원본 학생 ID·이름·프로필은 로그에 남기지 않는다.
4. workflow가 기존 R2 버킷에 압축 파일을 올리고 다시 내려받아 검사한다. 성공한 후에만 완료 표식을 업로드한다.

R2 키는 `panda-backup/YYYY-MM-DD-RUN_ID-RUN_ATTEMPT.sql.gz`와 같은 키의 `.complete.json`이다. 완료 표식이 없는 객체는 완료된 백업으로 취급하지 않는다. 버킷은 기존 `tutormanager-backup`을 사용하고 공개하지 않는다. 백업 파일도 학생 기록이므로 Git·공개 문서·Actions artifacts에 올리지 않는다.

## 활성화에 필요한 설정

Node.js 24.14.0 이상의 Node 24 런타임과 `npm ci --prefix worker`로 설치한 프로젝트 Wrangler를 사용한다. 별도 DB 라이브러리를 추가하지 않았으며, 검사에는 Node 내장 `node:sqlite`를 사용한다.

| GitHub 설정 | 역할 |
| --- | --- |
| `CLOUDFLARE_D1_BACKUP_API_TOKEN` secret | 해당 운영 계정으로 제한한 별도 D1 백업 토큰. 실제 확인에서 D1 Read는 메타데이터 조회200/export10000이었고, 사용자가 Edit로 변경한 뒤 export 성공했다. 자동화는 두 판다 테이블 export만 호출하며 기존 배포 토큰을 확대 재사용하지 않는다. |
| `CLOUDFLARE_R2_API_TOKEN` secret | 기존 R2 백업용 토큰. 대상 버킷 객체 업로드·다운로드 권한 필요. |
| `CLOUDFLARE_ACCOUNT_ID` secret | 기존 Cloudflare 계정 ID 재사용. |
| `R2_BACKUP_BUCKET` secret | 기존 `tutormanager-backup` 값 재사용. |
| `PANDA_BACKUP_ENABLED` variable | 수동 리허설 성공 후 `true`로 설정하면 일일 스케줄 실행. 기본은 미활성. |

`.github/workflows/panda-backup.yml`은 매일 KST 04:00에 실행하도록 준비되어 있다. GitHub 실행 지연은 가능하다. `workflow_dispatch`는 변수와 관계없이 명시적 수동 백업을 실행하므로 배포 직전 추가 백업에도 사용한다. 이 문서 작성 작업에서는 시크릿·변수·R2 수명주기를 변경하지 않았고 workflow를 실행하지 않았다.

보관은 새 `panda-backup/` prefix에 대해서만 별도로 정한다. 권장 시작값은 90일이며, 기존 Notion 백업 보관 규칙을 함께 바꾸지 않는다. 일일 백업만으로는 마지막 성공 이후 발생한 변경을 모두 복구할 수 없으므로 배포 직전 백업의 완료 표식과 최근 성공 시각을 확인한다. 성공이 없는 workflow 실행을 백업 완료로 간주하지 않는다.

## 백업 검사와 로컬 격리 복구

R2에서 같은 키의 두 파일을 비공개 작업 폴더에 내려받고 레포 루트에서 실행한다. 경로는 실제 다운로드 경로로 바꾼다.

```powershell
# 기본: 해시와 데이터 정합성 검사만 수행
node 02_devtools/restore-panda-backup.mjs --input C:/private/panda.sql.gz --receipt C:/private/panda.complete.json

# 선택: 새 로컬 SQLite 파일로 복원. 기존 파일은 덮어쓰지 않는다.
node 02_devtools/restore-panda-backup.mjs --input C:/private/panda.sql.gz --receipt C:/private/panda.complete.json --local-output C:/private/panda-rehearsal.sqlite
```

복구 도구에는 원격 DB 연결 기능이 없고 `--remote`도 거부한다. 출력 파일에는 판다 테이블만 존재한다. 격리 복원된 기록의 잔액·전환 상태·행 수를 확인한 후 필요한 복구 범위를 정한다.

운영 복구는 별도 운영 변경이다. 새 백업을 먼저 확보하고 판다 쓰기를 멈춘 뒤, 격리 복원 결과와 현재 기록을 비교해 **학생/판다 테이블 범위의 복구 SQL**을 별도로 검토한다. 백업보다 최근의 수업 실적·거래를 누락하거나 재시도 영수증만 삭제하지 않는다. 이 도구는 자동 원격 복원 SQL을 만들지 않는다. 공유 DB 전체를 덮어쓰거나 `game_users`를 되돌리지 않는다.

## 출시 순서와 완료 기준

1. 기존 판다 테이블이 있으면 수동 백업을 완료한다. 최초 설치로 두 테이블 자체가 없으면 백업할 서버 기록이 없다는 사실을 근거에 기록하고 DB 준비 후 빈 테이블부터 백업을 시작한다. 오래된 로컬 기록이 서버 백업에 있다는 뜻은 아니다.
2. DB `0005`·`0006` 준비 → Worker 배포 → 인증된 테스트 학생으로 전환과 두 기기 동기화를 검증한다.
3. 기존 기기/새 기기 접속 순서, 동시 최초 접속, 조회 실패, 먹이주기 응답 유실·동일 요청 재시도, 브라우저 데이터 삭제 복원을 확인한다. 같은 학생의 전환 완료와 안내 확인이 두 번 초기화되지 않아야 한다.
4. 실제 원격 백업을 내려받아 기본 검사와 새 로컬 SQLite 복구를 수행한다. `backupRestore`는 합성 데이터 테스트만으로 `true`로 바꾸지 않는다.
5. 정확한 Worker 버전·검증 시각·근거 문서를 `panda-readiness.json`에 기록한다. `transitionOnce`, `backupRestore`를 포함한 모든 확인을 마친 경우에만 `verified`로 바꾼다. 계약 해시는 `node 02_devtools/panda-release-check.mjs --hash`로 얻으며 0006 마이그레이션도 포함한다.
6. `VITE_PANDA_SERVER_PERSISTENCE=true`인 PWA를 배포하고 인증된 두 기기로 재확인한다.

전환 후 장애가 발생해도 로컬 기록 이관이나 전환 버전 변경으로 재초기화하지 않는다. D1 기록을 보존하며 판다 쓰기 경로를 중단하고 복구한다. 기존 로컬 전용 PWA로 되돌리면 서버와 성장 기록이 갈라질 수 있으므로 이를 정상 롤백으로 취급하지 않는다.

## 이번 작업의 검증 근거

```powershell
node --test 01_automation/panda_backup.test.mjs 02_devtools/panda-release-check.test.mjs
```

2026-09-30: 12개 테스트 통과. 정상/구형 백업, 위변조·손상·잘못된 잔액·누락된 부모·미래 revision 차단, 검사 전용 기본값, 새 로컬 DB 복구, 기존 파일·원격 옵션 거부를 확인했다. 슬롯 누락·잘못된 아이템·미보유 착용·레벨 미달·누락/잘못된 구매가격·잘못된 이름이 현재 프로필 또는 과거 거래에 있으면 모두 거부한다. 설치된 Wrangler로 임시 로컬 D1에 판다 2개 테이블과 `game_users` 합성 테이블을 만든 뒤 실제 export를 수행하여 판다 데이터만 포함되는 것도 확인했다. 공유 검증 함수의 Node JSON import 속성 적용 후 Worker 판다 관련 41개 테스트와 Vite fixture 로딩도 통과했다.

운영 D1, R2 업로드/재다운로드, GitHub 시크릿 및 스케줄, 실사용 학생 기기 간 복원은 이번 로컬 테스트의 확인 범위가 아니다. 출시 상태는 계속 `pending`이다.
