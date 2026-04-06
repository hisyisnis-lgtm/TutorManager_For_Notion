// 학생 상태에 따라 이름 앞 이모지를 자동 동기화하는 스크립트
// GitHub Actions에서 매시간 자동 실행됨

import { createNotionClient, stripEmoji } from './notion_utils.mjs';

const TOKEN = process.env.NOTION_TOKEN;
const STUDENT_DB_ID = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const STATUS_EMOJI = {
  '🟢 수강중': '🟢',
  '🟡 일시중단': '🟡',
  '⚫ 수강종료': '⚫',
};

if (!TOKEN) {
  console.error('NOTION_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const { notion, queryAll } = createNotionClient(TOKEN);

async function syncEmojis() {
  console.log('학생 목록 조회 중...');
  const students = await queryAll(STUDENT_DB_ID);
  console.log(`총 ${students.length}명 조회 완료`);

  let updatedCount = 0;

  for (const student of students) {
    const titleArr = student.properties['이름']?.title ?? [];
    const currentName = titleArr.map(t => t.plain_text).join('');
    const status = student.properties['상태']?.select?.name ?? null;
    const targetEmoji = status ? STATUS_EMOJI[status] : null;

    const baseName = stripEmoji(currentName);
    const expectedName = targetEmoji ? `${targetEmoji} ${baseName}` : baseName;

    if (currentName === expectedName) continue;

    console.log(`업데이트: "${currentName}" → "${expectedName}"`);
    await notion('PATCH', `/pages/${student.id}`, {
      properties: {
        이름: {
          title: [{ text: { content: expectedName } }],
        },
      },
    });
    updatedCount++;
  }

  if (updatedCount === 0) {
    console.log('변경 사항 없음 - 모든 이모지가 최신 상태입니다.');
  } else {
    console.log(`완료: ${updatedCount}명 이름 업데이트됨`);
  }
}

syncEmojis().catch(err => {
  console.error('오류 발생:', err.message);
  process.exit(1);
});
