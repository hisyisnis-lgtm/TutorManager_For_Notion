import { useEffect, useId, useRef, useState } from 'react';
import { Content as DialogSurface } from '@radix-ui/react-dialog';
import { XIcon } from '@phosphor-icons/react';
import { Button } from '../shadcn/button.jsx';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '../shadcn/dialog.jsx';
import PandaFigure from './PandaFigure.jsx';
import PandaUiPresence from './PandaUiPresence.jsx';
import { PANDA_ART_VIEWBOX, PANDA_PART_LAYERS, PANDA_PART_BOUNDS, PANDA_STICKER_SPEC, PANDA_WARDROBE_ITEMS, getPandaItem, pandaEquippedToWardrobe } from '../../constants/pandaWardrobe.js';
import { getPandaSalePrice } from '../../constants/pandaGameState.js';
import { PANDA_GAME_VARS } from '../../constants/pandaGameTheme.js';
import usePandaDialogFocus from '../../hooks/usePandaDialogFocus.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';
import './PandaWardrobe.css';
import './PandaUiMotion.css';

// Figma B 14:378: retain five UI categories; four authored equipment slots transact.
const CATEGORIES = [
  { id: 'hat', name: '머리' }, { id: 'neck', name: '스카프' }, { id: 'face', name: '표정' },
  { id: 'costume', name: '코스튬' }, { id: 'hand', name: '손 소품' },
];
// Follow the two visible columns in keyboard order: left top-to-bottom, then right.
const SLOT_COLUMNS = [['hat', 'face', 'neck'], ['costume', 'hand']];
function PartThumbnail({ item, className = '' }) {
  const filterId = useId();
  if (!item) return null;
  const [x, y, width, height] = PANDA_PART_BOUNDS[item.id];
  // Scale the single composite silhouette from the 70×56 card, including its shadow margin.
  const spec = PANDA_STICKER_SPEC;
  const unit = Math.max(width / spec.width, height / spec.height), padding = spec.padding * unit;
  return <svg className={'panda-wardrobe-part ' + className} viewBox={PANDA_PART_BOUNDS[item.id].join(' ')} aria-hidden="true" focusable="false">
    <defs>
      <filter id={filterId} filterUnits="userSpaceOnUse" x={x - padding} y={y - padding} width={width + padding * 2} height={height + padding * 2} colorInterpolationFilters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius={spec.rimRadius * unit} result="rim" />
        <feGaussianBlur in="rim" stdDeviation={spec.rimBlur * unit} result="softRim" />
        <feFlood floodColor={spec.color} />
        <feComposite in2="softRim" operator="in" result="ivory" />
        <feGaussianBlur in="softRim" stdDeviation={spec.shadowBlur * unit} />
        <feOffset dy={spec.shadowOffsetY * unit} />
        <feComponentTransfer><feFuncA type="linear" slope={spec.shadowOpacity} /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="ivory" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <g filter={'url(#' + filterId + ')'}>
      {PANDA_PART_LAYERS[item.slot].map(layer => <image key={layer} href={'/panda/wardrobe/' + item.setId + '-' + layer + '.svg'} x={PANDA_ART_VIEWBOX[0]} y={PANDA_ART_VIEWBOX[1]} width={PANDA_ART_VIEWBOX[2]} height={PANDA_ART_VIEWBOX[3]} />)}
    </g>
  </svg>;
}
function thumbnailStyle(item) {
  return item ? { '--pw-thumbnail': item.thumbnailBackground, '--pw-thumbnail-center': item.thumbnailBackgroundCenter } : undefined;
}
function CardThumbnail({ item }) {
  return <span className="panda-wardrobe-card-thumbnail"><PartThumbnail item={item} className="panda-wardrobe-card-part" /></span>;
}
function ActionButton({ children, secondary = false, className = '', ...props }) {
  return <Button variant="ghost" className={'panda-wardrobe-action ' + (secondary ? 'is-secondary ' : '') + className} {...props}>{children}</Button>;
}

export default function PandaWardrobe({ open, onOpenChange, profile, available, busy, blocked, onAction, notice, onRetry, onHelp, returnFocusRef }) {
  const reducedMotion = usePrefersReducedMotion();
  const [tab, setTab] = useState('shop'), [slot, setSlot] = useState('hat');
  const [selectedId, setSelectedId] = useState(null), [transaction, setTransaction] = useState(null);
  const [toast, setToast] = useState(null), [requesting, setRequesting] = useState(false);
  const [actionError, setActionError] = useState('');
  const { titleRef, ...dialogFocus } = usePandaDialogFocus(returnFocusRef);
  const { titleRef: transactionTitleRef, ...transactionFocus } = usePandaDialogFocus(titleRef);
  const transactionRef = useRef(false), listRef = useRef(null), wasOpen = useRef(false);
  const lastTransaction = useRef(null);
  // Radix retains the closing surface; preserve its content during that same exit.
  useEffect(() => { if (transaction) lastTransaction.current = transaction; }, [transaction]);
  const displayedTransaction = transaction || lastTransaction.current;
  const displayedItem = getPandaItem(displayedTransaction?.itemId);
  const equipped = pandaEquippedToWardrobe(profile.equipped), selected = getPandaItem(selectedId);
  const preview = tab === 'shop' && selected ? { ...equipped, [selected.slot]: selected.setId } : equipped;
  const items = PANDA_WARDROBE_ITEMS.filter(item => item.slot === slot && (tab === 'mine' ? profile.owned.includes(item.id) : !profile.owned.includes(item.id)));
  const category = CATEGORIES.find(item => item.id === slot), transactionItem = getPandaItem(transaction?.itemId);
  const processing = busy || requesting, cannotAct = processing || blocked;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (open && !wasOpen.current) { setTab(profile.owned.length ? 'mine' : 'shop'); setSlot('hat'); }
    if (!open) { setTransaction(null); setToast(null); setSelectedId(null); setActionError(''); }
    wasOpen.current = open;
  }, [open, profile.owned]);
  // A retry outside this dialog can resolve an ambiguous network result.
  useEffect(() => {
    if (!transaction || processing || transaction.phase === 'bought') return;
    if (transaction.type === 'buy' && profile.owned.includes(transaction.itemId)) {
      setTransaction(current => current && { ...current, phase: 'bought' }); setSelectedId(null);
    } else if (transaction.type === 'sell' && !profile.owned.includes(transaction.itemId)) {
      setToast({ complete: true, text: transactionItem.name + ' 판매 완료!\n먹이 ' + transaction.refund + '개를 받았어요.' });
      setTransaction(null); setSelectedId(null); setTab('mine');
    }
  }, [profile.owned, transaction, transactionItem, processing]);

  function selectList(nextTab, nextSlot) {
    setTab(nextTab); setSlot(nextSlot); setSelectedId(null); setToast(null); setActionError('');
    listRef.current?.scrollTo?.({ top: 0 });
  }
  function requestPurchase(item) {
    setSelectedId(item.id); setToast(null); setActionError('');
    if (profile.fedTotal < item.minFed) setToast({ text: 'Lv.' + item.level + '부터 구매할 수 있어요.\n먹이를 주며 레벨을 올려보세요.' });
    else if (available < item.price) setToast({ text: '먹이가 ' + (item.price - available) + '개 부족해요.\n먹이를 더 모은 뒤 구매해 주세요.' });
    else setTransaction({ type: 'buy', itemId: item.id, phase: 'confirm' });
  }
  async function executeTransaction() {
    if (!transactionItem || cannotAct || transactionRef.current) return;
    transactionRef.current = true; setRequesting(true);
    const current = transaction;
    setTransaction({ ...current, phase: 'processing' });
    try {
      const success = await onAction({ type: current.type, itemId: current.itemId });
      if (!success) setTransaction({ ...current, phase: 'failed' });
      else if (current.type === 'buy') { setTransaction({ ...current, phase: 'bought' }); setSelectedId(null); }
      else {
        setTransaction(null); setSelectedId(null); setTab('mine');
        setToast({ complete: true, text: transactionItem.name + ' 판매 완료!\n먹이 ' + current.refund + '개를 받았어요.' });
      }
    } catch { setTransaction({ ...current, phase: 'failed' }); }
    finally { transactionRef.current = false; setRequesting(false); }
  }
  async function retryTransaction() {
    if (processing || transactionRef.current) return;
    if (!onRetry) { setTransaction(current => ({ ...current, phase: 'confirm' })); return; }
    transactionRef.current = true; setRequesting(true);
    try {
      const next = await onRetry();
      if (next) {
        const owned = next.owned.includes(transaction.itemId);
        if (transaction.type === 'buy' && owned) { setTransaction(current => ({ ...current, phase: 'bought' })); setSelectedId(null); }
        else if (transaction.type === 'sell' && !owned) {
          setToast({ complete: true, text: transactionItem.name + ' 판매 완료!\n먹이 ' + transaction.refund + '개를 받았어요.' });
          setTransaction(null); setTab('mine'); setSelectedId(null);
        } else setTransaction(current => ({ ...current, phase: 'confirm' }));
      }
    } catch { /* The model keeps the pending request; there is no local success fallback. */ }
    finally { transactionRef.current = false; setRequesting(false); }
  }
  async function equipItem(item, remove = false) {
    if (cannotAct || transactionRef.current) return;
    setActionError(''); setToast(null);
    transactionRef.current = true; setRequesting(true);
    try {
      if (await onAction({ type: 'equip', slot: item.slot, itemId: remove ? null : item.id })) {
        setTransaction(null); setSelectedId(null);
        setToast({ complete: true, text: item.name + (remove ? ' 착용 해제 완료!' : ' 착용 완료!') });
      } else setActionError('착용을 변경하지 못했어요. 다시 시도해 주세요.');
    } catch {
      setActionError('착용을 변경하지 못했어요. 다시 시도해 주세요.');
    } finally { transactionRef.current = false; setRequesting(false); }
  }
  function closeTransaction() {
    if (processing) return;
    if (transaction?.phase === 'bought') setSelectedId(null);
    setTransaction(null);
  }
  const failed = displayedTransaction?.phase === 'failed', bought = displayedTransaction?.phase === 'bought', selling = displayedTransaction?.type === 'sell';
  const displayedProcessing = processing || (!transaction && displayedTransaction?.phase === 'processing');
  const transactionTitle = bought ? '구매 완료!\n바로 착용할까요?' : failed ? (selling ? '판매를 완료하지 못했어요' : '구매를 완료하지 못했어요')
    : displayedProcessing ? (selling ? '판매를 확인하고 있어요' : '구매를 확인하고 있어요') : selling ? '판매 할까요?' : '구매 할까요?';

  return <Dialog open={open} onOpenChange={next => { if (!processing) onOpenChange(next); }}>
    {(open || !reducedMotion) && <DialogPortal>
      <DialogSurface className="panda-wardrobe-screen panda-ui-wardrobe" style={PANDA_GAME_VARS} aria-busy={processing || undefined} aria-describedby={undefined} {...dialogFocus}
        inert={!open ? '' : undefined} aria-hidden={!open || undefined}
        onEscapeKeyDown={event => { if (processing || transaction) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        <header className="panda-wardrobe-header">
          <Button variant="ghost" className="panda-wardrobe-icon" aria-label="꾸미기 나가기" disabled={processing} onClick={() => onOpenChange(false)}><img src="/panda/ui/back.svg" alt="" /></Button>
          <DialogTitle ref={titleRef} tabIndex={-1} className="panda-wardrobe-title">랴오랴오 꾸미기</DialogTitle>
          <Button variant="ghost" className="panda-wardrobe-icon" aria-label="꾸미기 도움말" onClick={onHelp}><img src="/panda/ui/help.svg" alt="" /></Button>
        </header>
        <div className="panda-wardrobe-stage">
          <div className="panda-wardrobe-floor" />
          <div className="panda-wardrobe-balance"><img src="/panda/ui/leaf.svg" alt="먹이" /><span>{available}</span></div>
          <PandaFigure stage={5} width={106.6667} wardrobe={preview} className="panda-wardrobe-figure" style={{ position: 'absolute', transformOrigin: 'top center' }} label={selected && tab === 'shop' ? selected.name + ' 미리보기' : '현재 착장'} />
          <div className="panda-wardrobe-slots" aria-label="현재 착용한 파츠">
            {SLOT_COLUMNS.map(column => <div className="panda-wardrobe-slot-column" key={column[0]}>{column.map(categoryId => {
              const categoryItem = CATEGORIES.find(item => item.id === categoryId);
              const item = getPandaItem(profile.equipped[categoryItem.id]);
              const baseSlot = !item && (categoryItem.id === 'face' ? 'base-face' : categoryItem.id === 'neck' && !profile.equipped.costume ? 'base-scarf' : null);
              return <Button key={categoryItem.id} variant="ghost" className={'panda-wardrobe-slot' + (item ? ' is-equipped' : baseSlot ? ' is-base' : '')} disabled={processing}
                style={thumbnailStyle(item)} aria-label={categoryItem.name + ': ' + (item?.name || (baseSlot ? '기본' : '착용 없음'))} onClick={() => selectList('mine', categoryItem.id)}>
                {item ? <PartThumbnail item={item} /> : <img src={'/panda/ui/' + (baseSlot || 'slot-' + categoryItem.id) + '.svg'} alt="" />}
              </Button>;
            })}</div>)}
          </div>
        </div>
        <div className="panda-wardrobe-tabs" aria-label="상점과 보관함">
          <Button variant="ghost" aria-pressed={tab === 'mine'} disabled={processing} onClick={() => selectList('mine', slot)}>내 아이템</Button>
          <Button variant="ghost" aria-pressed={tab === 'shop'} disabled={processing} onClick={() => selectList('shop', slot)}>상점</Button>
        </div>
        <div className="panda-wardrobe-categories" aria-label="파츠 종류">
          {CATEGORIES.map(item => <Button variant="ghost" key={item.id} aria-pressed={slot === item.id} disabled={processing} onClick={() => selectList(tab, item.id)}>{item.name}</Button>)}
        </div>
        <div className="panda-wardrobe-scroll" ref={listRef}>
          {items.length ? <div className="panda-wardrobe-cards" aria-label="파츠 목록">
            {items.map(item => {
              const mine = tab === 'mine', wearing = profile.equipped[item.slot] === item.id;
              const unavailable = profile.fedTotal < item.minFed || available < item.price;
              return <article key={item.id} style={thumbnailStyle(item)} className={'panda-wardrobe-card' + (mine ? ' is-mine' : '') + ((mine ? wearing : selectedId === item.id) ? ' is-selected' : '')}>
                <button type="button" className="panda-wardrobe-preview" aria-label={item.name + (mine ? wearing ? ' 카드 해제' : ' 카드 착용' : ' 미리보기')}
                  aria-pressed={mine ? wearing : selectedId === item.id} disabled={mine ? cannotAct : processing} onClick={() => mine ? equipItem(item, wearing) : setSelectedId(item.id)}><CardThumbnail item={item} /></button>
                <p className="panda-wardrobe-item-name" title={item.name}>{item.name}</p>
                {!mine && <><span className="panda-wardrobe-item-level">Lv.{item.level}</span><div className="panda-wardrobe-price"><img src="/panda/ui/leaf.svg" alt="먹이" />{item.price}</div></>}
                <div className="panda-wardrobe-card-actions">
                  {mine && <Button variant="ghost" className="panda-wardrobe-small is-sell" disabled={cannotAct} aria-label={item.name + ' 판매'} onClick={() => { setToast(null); setActionError(''); setTransaction({ type: 'sell', itemId: item.id, phase: 'confirm', refund: getPandaSalePrice(profile, item.id) }); }}><span>판매</span></Button>}
                  <Button variant="ghost" className={'panda-wardrobe-small' + (mine ? ' is-equip' : ' is-buy') + (wearing ? ' is-remove' : '') + (!mine && unavailable ? ' is-unavailable' : '')} disabled={cannotAct}
                    aria-label={item.name + (mine ? wearing ? ' 해제' : ' 착용' : ' 구매')} onClick={() => mine ? equipItem(item, wearing) : requestPurchase(item)}><span>{mine ? wearing ? '해제' : '착용' : '구매'}</span></Button>
                </div>
              </article>;
            })}
          </div> : <div className="panda-wardrobe-empty">
            <img src={'/panda/ui/slot-' + slot + '.svg'} alt="" />
            <p>{tab === 'mine' ? '아직 ' + category.name + ' 아이템이 없어요' : '구매할 아이템이 없어요'}</p>
            <ActionButton onClick={() => selectList(tab === 'mine' ? 'shop' : 'mine', slot)}>{tab === 'mine' ? '상점 둘러보기' : '내 아이템 보기'}</ActionButton>
          </div>}
          {(actionError || blocked && notice) && !transaction && <div className="panda-wardrobe-recovery" role="alert"><p>{notice || actionError}</p>{onRetry && <ActionButton secondary disabled={processing} onClick={async () => { if (await onRetry()) setActionError(''); }}>다시 시도</ActionButton>}</div>}
        </div>
        <PandaUiPresence>{toast && <div className="panda-wardrobe-toast panda-ui-toast" role="status">
          <img src={'/panda/ui/' + (toast.complete ? 'toast-complete' : 'toast-info') + '.svg'} alt="" /><span>{toast.text}</span>
          <Button type="button" variant="ghost" size="icon" className="panda-toast-close" aria-label="알림 닫기" onClick={() => setToast(null)}><XIcon size={20} aria-hidden="true" /></Button>
        </div>}</PandaUiPresence>
        <Dialog open={Boolean(transaction)} onOpenChange={next => { if (!next) closeTransaction(); }}>
          {(transaction || !reducedMotion) && <DialogPortal>
            <DialogOverlay className="panda-wardrobe-overlay panda-ui-overlay" style={PANDA_GAME_VARS} />
            <DialogSurface className={'panda-wardrobe-transaction panda-ui-dialog' + (selling ? ' is-sale' : '')} style={PANDA_GAME_VARS} aria-describedby={failed ? 'panda-transaction-description' : undefined} {...transactionFocus}
              inert={!transaction ? '' : undefined} aria-hidden={!transaction || undefined}
              onEscapeKeyDown={event => { if (processing) event.preventDefault(); }} onPointerDownOutside={event => { if (processing) event.preventDefault(); }}>
              {displayedItem && <>
                <div className="panda-wardrobe-transaction-item" style={thumbnailStyle(displayedItem)}><PartThumbnail item={displayedItem} /><p>{displayedItem.name} Lv.{String(displayedItem.level).padStart(2, '0')}</p></div>
                <div className="panda-wardrobe-transaction-copy">
                  {!bought && !failed && <div className="panda-wardrobe-transaction-price"><img src="/panda/ui/slot-leaf-transaction.svg" alt="먹이" /><span>{selling ? '+' + displayedTransaction.refund : displayedItem.price}</span></div>}
                  <DialogTitle ref={transactionTitleRef} tabIndex={-1} className="panda-wardrobe-transaction-title">{transactionTitle}</DialogTitle>
                </div>
                {failed && <DialogDescription id="panda-transaction-description" className="panda-wardrobe-transaction-description">연결 상태를 확인하고 다시 시도해 주세요.<br />{selling ? '판매' : '구매'} 내역을 먼저 확인할게요.</DialogDescription>}
                {actionError && <p className="panda-wardrobe-transaction-description" role="alert">{notice || actionError}</p>}
                {selling && displayedTransaction.refund === 0 && <p className="panda-wardrobe-legacy-note">이전에 무료로 적용한 아이템은 먹이를 돌려받지 않아요.</p>}
                <div className="panda-wardrobe-transaction-actions">
                  {displayedProcessing ? <ActionButton disabled className="is-processing">{selling ? '판매 중...' : '구매 중...'}</ActionButton> : <>
                    <ActionButton secondary onClick={closeTransaction}>{bought ? '나중에' : failed ? '닫기' : '취소'}</ActionButton>
                    <ActionButton disabled={failed ? false : cannotAct} onClick={failed ? retryTransaction : bought ? () => equipItem(transactionItem) : executeTransaction}>{bought ? '바로 착용' : failed ? '다시 시도' : selling ? '판매하기' : '구매하기'}</ActionButton>
                  </>}
                </div>
              </>}
            </DialogSurface>
          </DialogPortal>}
        </Dialog>
      </DialogSurface>
    </DialogPortal>}
  </Dialog>;
}
