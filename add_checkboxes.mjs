const TOKEN = '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';
const DISCOUNT_DB_ID = '314838fa-f2a6-81d3-9ce4-c628edab065b';

async function api(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('할인 이벤트 DB에 활성/비활성 체크박스 추가 중...');

  await api('PATCH', `/databases/${DISCOUNT_DB_ID}`, {
    properties: {
      '활성': { checkbox: {} },
      '비활성': { checkbox: {} },
    },
  });

  console.log('완료! 할인 이벤트 DB에 활성/비활성 체크박스가 추가되었습니다.');
}

main().catch(console.error);
