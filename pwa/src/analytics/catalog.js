// 서비스 추가 시 이 목록과 Worker의 출처 허용목록을 함께 등록한다.
export const SERVICES = { site: '통합웹', tone: '성조 다락방', finder: '성조 찾기' };
export const CHANNELS = { direct: '직접·알 수 없음', instagram: '인스타그램', youtube: '유튜브', naver: '네이버', kakao: '카카오', google: '구글', referral: '기타 외부 유입' };
export const EVENTS = ['visit', 'lesson_view', 'book_view', 'inquiry_click', 'game_view', 'game_click', 'game_enter', 'run_start', 'run_end', 'business_click'];
const step = (event, label, service, connected = true) => ({ event, label, service, connected });
export const FUNNELS = [
  { id: 'lessons', title: '수업 고객 확보', description: '수업에 관심을 보인 방문이 문의로 이어지는지 확인합니다.', steps: [step('visit', '통합웹 방문', 'site'), step('lesson_view', '수업 안내 조회', 'site'), step('inquiry_click', '카카오 문의 클릭', 'site'), step('consult', '실제 상담 접수', 'site', false), step('enrol', '첫 유료 수업 등록', 'site', false)] },
  { id: 'books', title: '교재 판매', description: '교재 관심을 측정합니다. 테스트 주문은 구매에 포함하지 않습니다.', steps: [step('visit', '통합웹 방문', 'site'), step('book_view', '교재 상세 조회', 'site'), step('checkout', '실제 구매 시작', 'site', false), step('purchase', '결제 완료', 'site', false)] },
  ...['tone', 'finder'].map(service => ({ id: service, title: `${SERVICES[service]} 이용`, description: '플레이까지의 흐름입니다. 같은 세션의 반복 플레이는 한 번만 집계합니다.', steps: [step('game_enter', '게임 진입', service), step('run_start', '플레이 시작', service), step('run_end', '플레이 완료', service)] })),
  { id: 'journey', title: '통합웹 → 성조 다락방', description: '게임 이동 링크로 연결된 동일 세션의 전환입니다.', steps: [step('visit', '통합웹 방문', 'site'), step('game_view', '게임 소개 조회', 'site'), step('game_click', '게임 이동 클릭', 'site'), step('game_enter', '게임 진입', 'tone'), step('run_start', '플레이 시작', 'tone'), step('run_end', '플레이 완료', 'tone')] },
  { id: 'contribution', title: '게임의 사업 기여', description: '게임에서 카카오 채널로 이동한 관심을 봅니다. 채널 클릭은 문의 접수가 아닙니다.', steps: [step('game_enter', '게임 진입', 'tone'), step('business_click', '카카오 채널 클릭', 'tone'), step('consult', '상담·구매 완료', 'site', false)] },
];
