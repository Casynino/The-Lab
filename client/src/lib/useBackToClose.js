import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openLayer, closeLayer, isTopLayer } from './backToClose';

/**
 * While `open`, this window owns a history entry, so phone/browser Back closes it (lib/backToClose.js).
 *
 * It also says whether this window is saving: a save (any react-query mutation) started while this window
 * was the one on top keeps it open until the server has answered. Its X, Escape, Back and the buttons in
 * its footer do nothing meanwhile (audit rep-app-10: a Withdraw closed mid-send still landed, with nothing
 * on screen to say so). `guard: false` for a menu or a panel that never saves.
 */
export function useBackToClose(open, onClose, { guard = true } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return undefined;
    const layer = openLayer({ close: () => closeRef.current?.(), busy: () => busyRef.current });
    let stop = () => {};
    if (guard) {
      const mine = new Set();
      stop = qc.getMutationCache().subscribe((event) => {
        const m = event?.mutation;
        if (!m) return;
        if (event.type === 'added' && isTopLayer(layer)) mine.add(m);
        if (!mine.has(m)) return;
        if (event.type === 'removed') mine.delete(m);
        const now = [...mine].some((x) => x.state.status === 'pending');
        if (now !== busyRef.current) {
          busyRef.current = now;
          setBusy(now);
        }
      });
    }
    return () => {
      stop();
      busyRef.current = false;
      setBusy(false);
      closeLayer(layer);
    };
  }, [open, guard, qc]);

  return busy;
}
