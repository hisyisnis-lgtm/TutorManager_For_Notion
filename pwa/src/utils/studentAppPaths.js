import { isStudentAppScope } from '../api/studentAppState.js';
const fixedRoute = /^\/(?:homework\/[a-zA-Z0-9_-]+|notice\/[a-zA-Z0-9_-]+|consent|panda)\/?$/;

export function canonicalStudentPath(path) {
  const clean = String(path).split(/[?#]/)[0];
  const match = clean.match(/^\/(?:personal|student)(\/.*)?$/);
  if (!match) return null;
  const suffix = match[1] || '/';
  if (suffix === '/') return '/personal/';
  if (fixedRoute.test(suffix)) return `/personal${suffix.replace(/\/$/, '')}`;
  const legacySuffix = suffix.replace(/^\/[^/]+/, '');
  return fixedRoute.test(legacySuffix) ? `/personal${legacySuffix.replace(/\/$/, '')}` : '/personal/';
}

export function normalizeStudentAppEntry() {
  if (typeof window === 'undefined') return false;
  const hashPath = window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '';
  const target = canonicalStudentPath(hashPath) || canonicalStudentPath(window.location.pathname);
  if (!target) return false;
  try { localStorage.removeItem('personal_student_token'); } catch { /* 저장소 차단 */ }
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
    window.history.replaceState(null, '', target);
  }
  return true;
}

// Keep the existing OTP/JWT app paths while never placing a member scope in a URL.
export function studentPagePath(scope, suffix = '') {
  const tail = suffix ? '/' + suffix.replace(/^\/+/, '') : '';
  return isStudentAppScope(scope) ? '/personal' + (tail || '/') : '/personal/' + encodeURIComponent(scope || '') + tail;
}
