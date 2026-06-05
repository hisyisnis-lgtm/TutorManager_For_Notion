성조게임 효과음(SFX)

음원: Dustyroom "Casual Game Sounds" (CC0 / 퍼블릭 도메인 / 출처표기 불필요)
  https://dustyroom.com/free-casual-game-sounds/
원본 50개 WAV(24bit)를 16bit 모노로 변환해 lib/ 에 넣어둠 (DM-CGS-01.wav ~ DM-CGS-50.wav).

매핑: 코드의 키 → 파일은 src/game/tgSfx.js 의 SFX_FILES 에서 관리.
  파형 분석(길이·피치 상승하강·음 개수·밝기)으로 자동 배정함. 들어보고 번호만 바꾸면 됨.

오디션: 브라우저에서 /game/sfx/picker.html 열기 → 14키 현재 배정 + 50개 전체 듣기.
  (로컬 dev면 http://localhost:5175/game/sfx/picker.html)

현재 배정(사용자 청취 반영):
  tap=21 button=21 count=03 correct=26 combo=28 score=31 go=07
  wrong=16 timeout=04 win=18 gameover=12 unlock=23 whoosh=20 locked=14
  규칙: 결과 시 신기록=win(#18) / 신기록 아님=gameover(#12) (전 모드). 단 그 점수로
        다음 난이도가 막 열리면 unlock(#23) 우선. 무한 시간초과 사망은 위 규칙대로.

볼륨은 tgSfx.js 의 VOL 에서 키별 조정. 음소거는 타이틀 우상단 스피커 토글.
※ score·whoosh 키는 파일은 배정돼 있으나 아직 게임에 미배선(원하면 연결).
