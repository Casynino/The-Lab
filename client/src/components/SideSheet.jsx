import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'motion/react';
import { useBackToClose } from '@/lib/useBackToClose';

// A panel that slides in from the right over the page (Nino, 11 Nov 2026: "we should be able to open these
// cards inside and see the good views"). Full screen on a phone, a wide side sheet from 640 px up. It keeps
// the keyboard inside while it is the top window (Tab cycles, Escape closes, focus goes back to whatever
// opened it), scrolls inside itself, and holds the page still behind it.
//
// A window opened from inside the sheet (a payout, a fine) is rendered AFTER the sheet, so it sits on top,
// takes Escape and Tab first, and the sheet waits until it is gone: the sheet only acts while it is the last
// open dialog on the page.
//
// Phone/browser Back closes it (lib/backToClose.js), unless the page keeps the sheet in its own address
// (`ownEntry={false}`, e.g. Commissions' ?rep=): then Back is already the router's. While a save started
// from it is on its way, Escape and a tap outside wait for the answer.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SideSheet({ onClose, labelledBy, children, className, ownEntry = true }) {
  const panel = useRef(null);
  const busy = useBackToClose(ownEntry, onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(null);
  closeRef.current = () => { if (!busyRef.current) onClose?.(); };
  const still = useReducedMotion();

  useEffect(() => {
    const opener = document.activeElement;
    const isTop = () => {
      const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      return open[open.length - 1] === panel.current;
    };
    const focusables = () => [...(panel.current?.querySelectorAll(FOCUSABLE) || [])]
      .filter((e) => e.offsetParent !== null || e === document.activeElement);
    // The panel itself takes focus first, so a screen reader starts at its title and Tab starts at the top.
    panel.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); panel.current?.focus(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current || !inside)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    // The page behind stays where it was while the sheet scrolls.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={still ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={() => closeRef.current?.()}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        initial={still ? false : { x: 28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
        className={clsx(
          'relative flex h-full w-full flex-col overflow-hidden outline-none sm:w-[min(46rem,calc(100vw-3rem))] sm:rounded-l-[1.25rem]',
          className,
        )}
        style={{
          // The pop-up window's glass (.modal-glass), set here so the phone can drop its corners.
          background: 'radial-gradient(120% 40% at 100% 0%, rgba(238,49,36,0.08), transparent 62%), linear-gradient(155deg, rgba(31,25,26,0.98), rgba(17,16,19,0.98))',
          boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.1), 0 32px 64px -28px rgba(0,0,0,0.95)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
