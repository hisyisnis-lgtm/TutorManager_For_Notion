import { useRef } from 'react';

// Controlled panda dialogs have no Radix Trigger. Keep their keyboard return target explicitly.
export default function usePandaDialogFocus(fallbackRef) {
  const titleRef = useRef(null);
  const openerRef = useRef(null);
  const onOpenAutoFocus = event => {
    event.preventDefault();
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus({ preventScroll: true });
  };
  const onCloseAutoFocus = event => {
    event.preventDefault();
    const canFocus = node => node?.isConnected && node !== document.body && !node.disabled
      && !node.closest('[data-state="closed"], [inert]');
    const target = canFocus(openerRef.current) ? openerRef.current : fallbackRef?.current;
    if (!canFocus(target)) return;
    // A queued dialog may already have opened while the old one is animating out.
    const dialogs = [...document.querySelectorAll('[role="dialog"][data-state="open"]')];
    const activeDialog = dialogs.at(-1);
    if (activeDialog && !activeDialog.contains(target)) return;
    target.focus({ preventScroll: true });
  };
  return { titleRef, onOpenAutoFocus, onCloseAutoFocus };
}
