// 학생 호환 경로 /student와 강사 경로 /students는 경계까지 비교한다.
export function isPublicHashRoute(hash, dev = false) {
  return /^#\/(?:book|intro|pricing|consent|privacy|group-class|bootcamp|personal|student)(?:[/?#]|$)/.test(hash)
    || (dev && /^#\/panda-test(?:[/?#]|$)/.test(hash));
}
