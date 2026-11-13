import { WORKER_URL } from '../config.js';
import { fetchWithTimeout, UPLOAD_TIMEOUT_MS } from './fetchTimeout.js';
import { getToken, handleTeacherAuthExpiry } from './authUtils.js';

async function request(path, { signal, method = 'GET', body, photo = false } = {}) {
  const bearer = getToken();
  const multipart = body instanceof FormData;
  const response = await fetchWithTimeout(`${WORKER_URL}/reviews/admin${path}`, {
    method,
    signal,
    cache: 'no-store',
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
  }, multipart ? UPLOAD_TIMEOUT_MS : undefined);
  if (response.status === 401) handleTeacherAuthExpiry(bearer);
  if (photo && response.ok) {
    if (bearer !== getToken() || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
      throw new Error('후기 사진을 불러오지 못했어요.');
    }
    return response.blob();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '후기를 처리하지 못했어요. 다시 시도해 주세요.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function fetchReviewQueue(status = 'pending', cursor, signal) {
  const query = new URLSearchParams({ status });
  if (cursor) query.set('cursor', cursor);
  return request(`?${query}`, { signal });
}

export function fetchReviewPhoto(reviewId, photoId, signal) {
  return request(`/${encodeURIComponent(reviewId)}/photos/${encodeURIComponent(photoId)}`, { photo: true, signal });
}

export function editReviewPhotos(id, version, photos) {
  const body = { version, photoIds: photos.map(photo => typeof photo === 'string' ? photo : null) };
  const path = `/${encodeURIComponent(id)}/photos`;
  const files = photos.filter(photo => typeof photo !== 'string');
  if (!files.length) return request(path, { method: 'PUT', body });
  const form = new FormData();
  form.append('review', JSON.stringify(body));
  for (const file of files) form.append('photos', file, 'review-photo.jpg');
  return request(path, { method: 'PUT', body: form });
}

export function moderateReview(id, { action, version, reason, allowRestore }) {
  return request(`/${encodeURIComponent(id)}/moderate`, {
    method: 'POST',
    body: { action, version, reason, ...(action === 'hide' ? { allowRestore: Boolean(allowRestore) } : {}) },
  });
}
