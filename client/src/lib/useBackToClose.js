import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { openLayer, closeLayer, isTopLayer } from './backToClose';
import { watchSaves } from './busyLock';

/**
 * While `open`, this window owns a history entry, so phone/browser Back closes it (lib/backToClose.js).
 *
 * It also says whether this window is saving: a save (any react-query mutation) started while this window
 * was the one on top keeps it open until the server has answered. Its X, Escape, Back and the buttons in
 * its footer do nothing meanwhile (audit rep-app-10: a Withdraw closed mid-send still landed, with nothing
 * on screen to say so) - for 25 seconds at most, so a request stuck on a bad connection cannot trap the
 * person (lib/busyLock.js). `guard: false` for a menu or a panel that never saves.
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
      stop = watchSaves(qc.getMutationCache(), {
        isOnTop: () => isTopLayer(layer),
        onChange: (now) => {
          busyRef.current = now;
          setBusy(now);
        },
        onExpire: () => toast('Still sending — check before you try again', { duration: 6000 }),
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
