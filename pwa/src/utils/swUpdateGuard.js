/** 작성 화면은 이탈할 때까지 SW 교체·리로드를 유예한다. */
export function isOnFormPage(location = window.location) {
  const { pathname = '', hash = '' } = location;
  const teacherForm = /\/(logs|classes|students|payments|homework)\/(new|[^/]+\/edit)/;
  // 숙제 상세 안의 첨부·녹음은 메모리에 있으므로 읽기 상태를 포함해 경로 전체를 보호한다.
  const studentHomework = /^\/(personal|student)\/[^/?#]+\/homework\/[^/?#]+(?:[/?#]|$)/;
  return teacherForm.test(hash)
    || studentHomework.test(pathname)
    || studentHomework.test(hash.replace(/^#/, ''));
}
