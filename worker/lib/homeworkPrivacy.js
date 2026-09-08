// Preserve the existing student's Notion-shaped UI contract while exposing only
// its fields. Signed file URLs, workspace/user metadata and unrelated relations
// never need to reach the browser: downloads already use the authorized proxy.
export function studentHomeworkPage(page) {
  const source = page?.properties || {};
  const properties = {};
  for (const [name, type] of [['제목', 'title'], ['과제 내용', 'rich_text'], ['피드백 텍스트', 'rich_text']]) {
    properties[name] = { [type]: (source[name]?.[type] || []).map(part => ({ plain_text: String(part.plain_text ?? part.text?.content ?? '') })) };
  }
  for (const name of ['학생 제출 파일', '피드백 파일', '과제 파일']) {
    properties[name] = { files: (source[name]?.files || []).map(file => ({ name: String(file.name || 'file') })) };
  }
  for (const name of ['제출일', '피드백일', '제출 먹이 마크', '피드백 확인일']) {
    properties[name] = { date: source[name]?.date ? { start: source[name].date.start } : null };
  }
  properties['제출 상태'] = { select: source['제출 상태']?.select ? { name: source['제출 상태'].select.name } : null };
  return { id: page?.id, created_time: page?.created_time, properties };
}
