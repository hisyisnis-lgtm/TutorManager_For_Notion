import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatTextIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '../components/shadcn/button';
import { Textarea } from '../components/shadcn/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/shadcn/dialog';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import useUnsavedChanges from '../hooks/useUnsavedChanges.js';
import { editReviewPhotos, fetchReviewPhoto, fetchReviewQueue, moderateReview } from '../api/reviews.js';
import { getToken } from '../api/authUtils.js';
import { formatDateDot } from '../utils/dateUtils.js';
import { MAX_REVIEW_PHOTOS, prepareReviewPhoto } from '../utils/reviewPhoto.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { BG_CARD, BORDER_NEUTRAL, GRAY_50, PRIMARY, PRIMARY_BG, STATUS_ERROR_TEXT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from '../constants/theme.js';

const STATES = { pending: '검수 대기', published: '공개', rejected: '반려', hidden: '숨김' };
const TYPES = { class: '정규 수업', special: '특강', external: '외부활동', other: '기타' };
const ACTIONS = { approve: '공개', reject: '반려', hide: '숨김', restore: '복원' };
const EMPTY = {
  pending: '검수 대기 후기가 없어요', published: '공개된 후기가 없어요',
  rejected: '반려한 후기가 없어요', hidden: '숨긴 후기가 없어요',
};
const noPhotos = [];

function samePhotos(first, second) {
  return first.length === second.length && first.every((photo, index) => photo === second[index]);
}

function ReviewFacts({ content }) {
  return <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
    {content.purchaseConfirmed ? '구매 확인 후기' : '일반 후기'}
    {content.targetName ? ` · ${content.targetName}` : ''}
    {Number.isInteger(content.rating) ? ` · 별점 ${content.rating}/5` : ' · 별점 없음'}
  </p>;
}

function ReviewPhotos({ reviewId, photoIds, label = '첨부 사진' }) {
  const [open, setOpen] = useState(false);
  if (!photoIds?.length) return null;
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 flex items-center cursor-pointer text-sm font-semibold" style={{ color: TEXT_SECONDARY }}>
        {label} {photoIds.length}장 보기
      </summary>
      {open && photoIds.map((photoId, index) => (
        <FilePreview key={photoId} file={{ name: `후기 사진 ${index + 1}.jpg` }} plain neutral
          fetchInlineBlobUrl={async () => URL.createObjectURL(await fetchReviewPhoto(reviewId, photoId))} />
      ))}
    </details>
  );
}

function EditPhotoPreview({ reviewId, photo, number }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let url;
    async function load() {
      try {
        const blob = typeof photo === 'string' ? await fetchReviewPhoto(reviewId, photo, controller.signal) : photo;
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      } catch {
        if (!controller.signal.aborted) setPreview('');
      }
    }
    load();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [reviewId, photo]);
  return (
    <div className="aspect-[4/3] overflow-hidden rounded-xl" style={{ background: GRAY_50 }}>
      {preview
        ? <img src={preview} alt={`후기 사진 ${number}`} className="h-full w-full object-contain" onError={() => setPreview('')} />
        : <p className="flex h-full items-center justify-center p-2 text-center text-xs break-keep" style={{ color: TEXT_SECONDARY }}>
          {preview === null ? '사진 불러오는 중' : '사진을 불러오지 못했어요.'}
        </p>}
    </div>
  );
}

function ReviewPhotoEditor({ edit, photos, preparing, saving, dirty, stale, error, onSelect, onRemove, onClose, onSave }) {
  const input = useRef(null);
  const addButton = useRef(null);
  const removeButtons = useRef([]);
  const blocked = preparing || saving;
  function removePhoto(index) {
    onRemove(index);
    requestAnimationFrame(() => {
      (removeButtons.current[index] || removeButtons.current[index - 1] || addButton.current)?.focus();
    });
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !blocked) onClose(); }}>
      <DialogContent showClose={false} className="max-h-[85dvh] overflow-y-auto"
        onEscapeKeyDown={event => { if (blocked) event.preventDefault(); }}
        onPointerDownOutside={event => { if (blocked) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>후기 사진 수정</DialogTitle>
          <DialogDescription>사진을 추가하거나 삭제할 수 있어요. 승인하면 사진을 포함한 수정본 전체가 공개돼요.</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-semibold break-words">{edit.title}</p>
        <form onSubmit={onSave} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button ref={addButton} type="button" variant="outline" onClick={() => input.current?.click()} loading={preparing}
              disabled={saving || stale || photos.length >= MAX_REVIEW_PHOTOS} aria-describedby="review-photo-help">
              {!preparing && <PlusIcon size={20} aria-hidden="true" />}
              {preparing ? '사진 준비 중' : '사진 추가'}
            </Button>
            <span className="text-sm" style={{ color: TEXT_SECONDARY }} aria-live="polite">{photos.length} / {MAX_REVIEW_PHOTOS}장</span>
          </div>
          <input ref={input} type="file" hidden aria-label="후기 사진 파일 선택" multiple
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={blocked || stale || photos.length >= MAX_REVIEW_PHOTOS} onChange={onSelect} />
          <p id="review-photo-help" className="text-xs" style={{ color: TEXT_SECONDARY }}>JPG, PNG, WebP · 한 장당 20MB까지 선택할 수 있어요.</p>
          {!!photos.length && <ul aria-label="수정할 사진" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={typeof photo === 'string' ? photo : photo.name} className="min-w-0">
                <EditPhotoPreview reviewId={edit.id} photo={photo} number={index + 1} />
                <Button ref={node => { removeButtons.current[index] = node; }} type="button" variant="ghost" block
                  disabled={blocked || stale} aria-label={`사진 ${index + 1} 삭제`} onClick={() => removePhoto(index)}>
                  <TrashIcon size={20} aria-hidden="true" /> 삭제
                </Button>
              </li>
            ))}
          </ul>}
          {error && <p role="alert" className="text-sm" style={{ color: STATUS_ERROR_TEXT }}>{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={blocked} onClick={onClose}>취소</Button>
            <Button type="submit" loading={saving} disabled={preparing || stale || !dirty}>사진 저장</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewsManagePage() {
  const [filter, setFilter] = useState('pending');
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [allowRestore, setAllowRestore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoEdit, setPhotoEdit] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const [photoStale, setPhotoStale] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const requestSequence = useRef(0);
  const mounted = useRef(false);
  const photosDirty = Boolean(photoEdit && !samePhotos(photos, photoEdit.photoIds || noPhotos));
  const leaveGuard = useUnsavedChanges(saving || preparing || photosDirty || Boolean(decision && (reason.trim() || allowRestore)));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (cursor, signal) => {
    const sequence = ++requestSequence.current;
    setError('');
    if (cursor) setLoadingMore(true);
    try {
      const data = await fetchReviewQueue(filter, cursor, signal);
      if (sequence !== requestSequence.current || signal?.aborted) return;
      setQueue(previous => ({
        ...data,
        reviews: cursor
          ? [...(previous?.reviews || []), ...data.reviews].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
          : data.reviews,
      }));
    } catch (cause) {
      if (sequence === requestSequence.current && !signal?.aborted) {
        setError(cause.message || '후기를 불러오지 못했어요.');
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    setQueue(null);
    load(undefined, controller.signal);
    return () => { controller.abort(); requestSequence.current += 1; };
  }, [load]);

  function openDecision(review, action) {
    setDecision({ review, action });
    setReason('');
    setDecisionError('');
    setAllowRestore(false);
  }

  function closeDecision() {
    if (!saving) leaveGuard.requestLeave(() => { setDecision(null); setReason(''); setDecisionError(''); });
  }

  function openPhotoEdit(review) {
    setPhotoEdit(review);
    setPhotos(review.photoIds || noPhotos);
    setPhotoError('');
    setPhotoStale(false);
  }

  function closePhotoEdit() {
    if (!saving && !preparingRef.current) leaveGuard.requestLeave(() => {
      setPhotoEdit(null);
      setPhotos(noPhotos);
      if (photoStale) void load();
    });
  }

  async function selectPhotos(event) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (!files.length || saving || photoStale || preparingRef.current) return;
    if (files.length + photos.length > MAX_REVIEW_PHOTOS) {
      setPhotoError(`사진은 최대 ${MAX_REVIEW_PHOTOS}장까지 첨부할 수 있어요.`);
      return;
    }
    preparingRef.current = true;
    setPreparing(true);
    setPhotoError('');
    try {
      const prepared = [];
      for (const file of files) {
        prepared.push(await prepareReviewPhoto(file));
        if (!mounted.current) return;
      }
      setPhotos(current => [...current, ...prepared]);
    } catch (cause) {
      if (mounted.current) setPhotoError(cause.message || '사진을 준비하지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    } finally {
      preparingRef.current = false;
      if (mounted.current) setPreparing(false);
    }
  }

  async function savePhotos(event) {
    event.preventDefault();
    if (!photoEdit || saving || preparingRef.current || photoStale || !photosDirty) return;
    setSaving(true);
    setPhotoError('');
    const submittedBearer = getToken();
    try {
      await editReviewPhotos(photoEdit.id, photoEdit.version, photos);
      if (!mounted.current || submittedBearer !== getToken()) return;
      leaveGuard.markSaved();
      setPhotoEdit(null);
      setPhotos(noPhotos);
      toast.success('후기 사진을 저장했어요. 검수 후 공개돼요.');
      if (filter === 'pending') await load();
      else setFilter('pending');
    } catch (cause) {
      if (!mounted.current || submittedBearer !== getToken()) return;
      if (cause.status === 409) {
        setPhotoStale(true);
        setPhotoError('후기가 변경됐어요. 수정을 취소한 뒤 최신 후기를 다시 열어 주세요.');
      } else {
        setPhotoError(cause.message || '사진을 저장하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function submitDecision(event) {
    event.preventDefault();
    if (saving) return;
    if (decision.action !== 'approve' && !reason.trim()) {
      setDecisionError(decision.action === 'restore' ? '숨김 사유가 해소된 근거를 적어주세요.' : '작성자에게 안내할 사유를 적어주세요.');
      return;
    }
    setSaving(true);
    setDecisionError('');
    const submittedBearer = getToken();
    try {
      await moderateReview(decision.review.id, {
        action: decision.action,
        version: decision.review.version,
        reason: reason.trim(),
        ...(decision.action === 'hide' ? { allowRestore } : {}),
      });
      if (!mounted.current || submittedBearer !== getToken()) return;
      toast.success(`후기를 ${ACTIONS[decision.action]}했어요.`);
      leaveGuard.markSaved();
      setDecision(null);
      setReason('');
      await load();
    } catch (cause) {
      if (!mounted.current || submittedBearer !== getToken()) return;
      if (cause.status === 409) {
        toast.error('후기가 변경됐어요. 최신 내용을 확인하고 다시 처리해 주세요.');
        leaveGuard.markSaved();
        setDecision(null);
        setReason('');
        await load();
      } else {
        setDecisionError(cause.message || '처리하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="수업·활동 후기 관리" back />
      <div className="px-4 py-4 space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>
          수강 기록이 없는 참여자도 작성할 수 있어요. 긍정·부정 평가에 같은 기준을 적용하고 개인정보·광고·사칭 여부를 확인해 주세요.
        </p>
        <div className="grid grid-cols-4 gap-1.5" aria-label="후기 상태">
          {Object.entries(STATES).map(([value, label]) => (
            <Button key={value} variant={filter === value ? 'default' : 'outline'}
              className="px-1 text-xs" aria-pressed={filter === value} disabled={saving}
              onClick={() => setFilter(value)}>
              {label}{queue?.counts?.[value] !== undefined ? ` ${queue.counts[value]}` : ''}
            </Button>
          ))}
        </div>
        {error && <ErrorMessage message={error} onRetry={() => load(queue?.nextCursor && queue.reviews.length ? queue.nextCursor : undefined)} />}
        {!error && queue === null && <LoadingSpinner />}
        {queue && queue.reviews.length === 0 && !error && (
          <EmptyState icon={<ChatTextIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
            title={EMPTY[filter]} description="새 후기를 제출하면 검수 대기 목록에 표시돼요." />
        )}
        {queue && queue.reviews.map(review => (
          <article key={review.id} className="rounded-xl p-4 space-y-3"
            style={{ background: BG_CARD, boxShadow: 'var(--shadow-border)' }}>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY }}>{STATES[review.status] || review.status}</span>
              {review.pendingVersion != null && review.status !== 'pending' && <span className="text-xs" style={{ color: TEXT_SECONDARY }}>수정 검수 대기</span>}
              <span className="text-xs" style={{ color: TEXT_TERTIARY }}>{TYPES[review.experienceType] || '기타'}</span>
            </div>
            <ReviewFacts content={review} />
            <h2 className="text-base font-semibold break-words" style={{ color: TEXT_PRIMARY }}>{review.title}</h2>
            <p className="text-xs break-words" style={{ color: TEXT_TERTIARY }}>
              {review.nickname}{review.activityName ? ` · ${review.activityName}` : ''}
              {review.updatedAt ? ` · ${formatDateDot(review.updatedAt)}` : ''}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: TEXT_PRIMARY }}>{review.body}</p>
            <ReviewPhotos reviewId={review.id} photoIds={review.photoIds} />
            {review.publishedContent && (
              <details className="text-sm" style={{ color: TEXT_SECONDARY }}>
                <summary className="min-h-11 flex items-center cursor-pointer">{review.status === 'hidden' ? '이전 공개 내용 보기' : '현재 공개된 내용 보기'}</summary>
                <ReviewFacts content={review.publishedContent} />
                <p className="font-semibold break-words">{review.publishedContent.title}</p>
                <p className="whitespace-pre-wrap break-words leading-relaxed">{review.publishedContent.body}</p>
                <ReviewPhotos reviewId={review.id} photoIds={review.publishedContent.photoIds} label="공개본 사진" />
              </details>
            )}
            {review.moderationReason && <p className="text-xs leading-relaxed break-words" style={{ color: TEXT_SECONDARY }}>최근 처리 사유: {review.moderationReason}</p>}
            <div className="flex flex-wrap gap-2">
              {review.pendingVersion != null && <>
                <Button disabled={saving} onClick={() => openDecision(review, 'approve')}>공개</Button>
                <Button variant="outline" disabled={saving} onClick={() => openDecision(review, 'reject')}>반려</Button>
              </>}
              {review.status === 'published' && <Button variant="destructiveOutline" disabled={saving} onClick={() => openDecision(review, 'hide')}>숨김</Button>}
              {review.status === 'hidden' && review.restoreAllowed && review.publishedVersion != null && review.pendingVersion == null && (
                <Button variant="outline" disabled={saving} onClick={() => openDecision(review, 'restore')}>복원</Button>
              )}
              <Button variant="outline" disabled={saving} onClick={() => openPhotoEdit(review)}>사진 수정</Button>
            </div>
          </article>
        ))}
        {queue?.nextCursor && <Button block variant="outline" loading={loadingMore} disabled={saving} onClick={() => load(queue.nextCursor)}>더 보기</Button>}
      </div>
      {photoEdit && (
        <ReviewPhotoEditor edit={photoEdit} photos={photos} preparing={preparing} saving={saving} dirty={photosDirty} stale={photoStale} error={photoError}
          onSelect={selectPhotos} onRemove={index => { setPhotos(current => current.filter((_, position) => position !== index)); setPhotoError(''); }}
          onClose={closePhotoEdit} onSave={savePhotos} />
      )}
      {decision && (
        <Dialog open onOpenChange={open => { if (!open) closeDecision(); }}>
          <DialogContent showClose={false} className="max-h-[85dvh] overflow-y-auto"
            onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}
            onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
            <DialogHeader>
              <DialogTitle>후기 {ACTIONS[decision.action]}</DialogTitle>
              <DialogDescription>
                {decision.action === 'approve' ? '확인한 내용이 공개돼요. 수정본이면 기존 공개본을 교체해요.' :
                  decision.action === 'restore' ? '숨김 사유가 해소됐는지 확인해 주세요. 개인정보가 남은 원문을 복원하면 안 돼요.' : '작성자가 확인할 수 있도록 객관적인 사유를 남겨주세요.'}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm font-semibold break-words">{decision.review.title}</p>
            <form onSubmit={submitDecision} className="space-y-4">
              {decision.action !== 'approve' && <div>
                <label htmlFor="review-moderation-reason" className="block text-sm font-semibold mb-2">{decision.action === 'restore' ? '해소 확인 근거' : '처리 사유'}</label>
                <Textarea id="review-moderation-reason" value={reason} disabled={saving} maxLength={500}
                  aria-invalid={Boolean(decisionError)} aria-describedby={decisionError ? 'review-decision-error' : undefined}
                  onChange={event => { setReason(event.target.value); setDecisionError(''); }} rows={4} />
              </div>}
              {decision.action === 'hide' && (
                <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>
                  <input type="checkbox" className="mt-1" disabled={saving} checked={allowRestore} onChange={event => setAllowRestore(event.target.checked)} />
                  원문에 개인정보 등 문제가 없는 일시 숨김이에요. 사유 해소 후 같은 공개본을 복원할 수 있어요.
                </label>
              )}
              {decisionError && <p id="review-decision-error" role="alert" className="text-sm" style={{ color: TEXT_SECONDARY }}>{decisionError}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" block disabled={saving} onClick={closeDecision}>취소</Button>
                <Button type="submit" block loading={saving}>{ACTIONS[decision.action]}하기</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {leaveGuard.showLeaveConfirm && (
        <Dialog open onOpenChange={open => { if (!open && !saving) leaveGuard.cancelLeave(); }}>
          <DialogContent showClose={false}>
            <DialogHeader>
              <DialogTitle>{photoEdit ? '사진 수정을 취소할까요?' : '작성 중인 사유를 두고 나갈까요?'}</DialogTitle>
              <DialogDescription>{photoEdit ? '저장하지 않은 사진 변경이 사라져요.' : '아직 처리하지 않은 사유가 사라져요.'}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button block variant="outline" disabled={saving} onClick={leaveGuard.cancelLeave}>{photoEdit ? '계속 수정' : '계속 작성'}</Button>
              <Button block disabled={saving || preparing} onClick={leaveGuard.confirmLeave}>나가기</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
