// 회원·학생·권한 revision이 포함된 개인 상태는 현재 탭 메모리에만 보관한다.
const entries = new Map();
export const studentAppMemoryStorage = {
  get length() { return entries.size; },
  key(index) { return Array.from(entries.keys())[index] ?? null; },
  getItem(key) { return entries.get(String(key)) ?? null; },
  setItem(key, value) { entries.set(String(key), String(value)); },
  removeItem(key) { entries.delete(String(key)); },
  clear() { entries.clear(); },
};
export const getStudentAppStorage = key => String(key).includes('app-') ? studentAppMemoryStorage : localStorage;
export function clearStudentAppMemory(scope) {
  for (const key of entries.keys()) if (!scope || key.includes(scope)) entries.delete(key);
}
