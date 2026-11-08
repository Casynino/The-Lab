import { useCallback, useEffect, useState } from 'react';
import { Download, EllipsisVertical, Share, SquarePlus, Smartphone, Compass, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui';

/**
 * Use it like an app.
 *
 * Nino, 9 Nov 2026: the screen must be full on ANY phone — "not only people on
 * iPhone, Google Pixel or Android or Huawei". A site open in a browser tab
 * always keeps the address bar, on every phone and in every browser, and no
 * page can hide it. The only full screen is the one the person installs. So on
 * a phone that has not installed it yet, a small sheet shows how — and the
 * steps differ by browser, which is the whole point of this file:
 *
 *   Android / Huawei / Samsung (Chromium)  one tap: the browser's own prompt
 *   iPhone in Safari                       Share → Add to Home Screen
 *   iPhone in Chrome, Firefox, Edge        only Safari can install on iOS
 *   inside WhatsApp, Instagram, Facebook   open it in the real browser first
 *   anything else on Android               browser menu → Add to Home screen
 *
 * It opens by itself once, a moment after a phone's browser reaches the app,
 * and any time from "Get the app" on the sign-in page or in the account menu.
 * Nothing shows on a computer or once the app is installed.
 */

/* Chromium fires this once, early — long before any component asks. It is
   caught at module load and kept here so whoever opens the sheet later can
   still use it. */
let deferred = null;
const listeners = new Set();
const tell = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    tell();
  });
}

const SEEN = 'lab.install.seen';

const read = (key) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};

/** What this phone is, and what it can actually do about installing. */
function look() {
  const ua = navigator.userAgent || '';
  const mm = (q) => window.matchMedia(q).matches;
  const installed = mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)')
    || mm('(display-mode: minimal-ui)') || navigator.standalone === true;
  // A phone or a small tablet held in the hand — not a laptop with a touchscreen.
  const phone = mm('(max-width: 1023px)') && mm('(pointer: coarse)');
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // WhatsApp, Facebook, Instagram, Telegram, TikTok, WeChat and the generic
  // Android WebView: none of them can add anything to a home screen.
  const inApp = /\bFBAN|\bFBAV|Instagram|Line\/|WhatsApp|Telegram|TikTok|Snapchat|MicroMessenger|GSA\/|; wv\)/i.test(ua);
  // On iOS every browser is Safari underneath, but only Safari itself may install.
  const iosOther = ios && /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);
  return { ready: true, installed, phone, ios, inApp, iosOther, canPrompt: !!deferred };
}

export function useInstall() {
  const [state, setState] = useState({
    ready: false, installed: false, phone: false, ios: false, inApp: false, iosOther: false, canPrompt: false,
  });

  useEffect(() => {
    const check = () => setState(look());
    check();
    listeners.add(check);
    // Installing from the browser's own menu fires nothing we can hear, so the
    // display mode is watched as well: the sheet closes itself afterwards.
    const dm = window.matchMedia('(display-mode: standalone)');
    dm.addEventListener?.('change', check);
    return () => { listeners.delete(check); dm.removeEventListener?.('change', check); };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    tell();
    return outcome === 'accepted';
  }, []);

  return { ...state, install };
}

const STEP = 'flex items-start gap-3 rounded-xl border border-border bg-elevated px-3 py-2.5 text-[13px] leading-snug text-muted';
const NUM = 'grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-slate-950';

function Steps({ items, note }) {
  return (
    <>
      <ol className="space-y-2">
        {items.map((line, i) => (
          <li key={i} className={STEP}>
            <span className={NUM}>{i + 1}</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 text-xs text-faint">{note}</p>}
    </>
  );
}

const b = (text) => <b className="font-semibold text-foreground">{text}</b>;

/** The button's own picture, set into the sentence that names it. */
function Glyph({ icon: Icon }) {
  return <Icon className="mx-0.5 inline h-3.5 w-3.5 -translate-y-px" />;
}

export function InstallSheet({ open, onClose }) {
  const { ios, inApp, iosOther, canPrompt, install } = useInstall();

  let body;
  if (inApp) {
    // Nothing can be installed from inside a chat app's own browser, on any phone.
    body = (
      <Steps
        items={[
          <>Tap the <Glyph icon={EllipsisVertical} /> menu at the corner of this screen.</>,
          <>Choose {b('Open in browser')} <Glyph icon={ExternalLink} /> — Chrome, Safari or whichever browser this phone uses.</>,
          <>Then add it to the home screen from there.</>,
        ]}
        note="This page opened inside another app, and an app's own browser cannot put anything on a home screen."
      />
    );
  } else if (canPrompt) {
    body = (
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-primary w-full py-3" onClick={async () => { if (await install()) onClose(); }}>
          <Download className="h-4 w-4" /> Install The Lab
        </button>
        <button type="button" className="btn-secondary w-full" onClick={onClose}>Not now</button>
      </div>
    );
  } else if (iosOther) {
    body = (
      <Steps
        items={[
          <>Copy this page's address, then open {b('Safari')} <Glyph icon={Compass} />.</>,
          <>Paste it, then tap {b('Share')} <Glyph icon={Share} /> at the bottom.</>,
          <>Tap {b('Add to Home Screen')} <Glyph icon={SquarePlus} />, then {b('Add')}.</>,
        ]}
        note="On an iPhone only Safari can put an app on the home screen — Chrome, Firefox and Edge cannot."
      />
    );
  } else if (ios) {
    body = (
      <Steps
        items={[
          <>Tap {b('Share')} <Glyph icon={Share} /> at the bottom of Safari.</>,
          <>Scroll down and tap {b('Add to Home Screen')} <Glyph icon={SquarePlus} />.</>,
          <>Tap {b('Add')}, then open {b('The Lab')} from your home screen.</>,
        ]}
      />
    );
  } else {
    // Android, Huawei, Samsung and anything else: the menu wording differs by
    // browser, so both names it may carry are given.
    body = (
      <Steps
        items={[
          <>Open the browser menu <Glyph icon={EllipsisVertical} /> — usually top right.</>,
          <>Tap {b('Install app')} or {b('Add to Home screen')}.</>,
          <>Confirm, then open {b('The Lab')} from your home screen.</>,
        ]}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Use it like an app" size="sm">
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-slate-950">
          <Smartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Full screen, no address bar</p>
          <p className="text-xs text-muted">Its own icon, and it opens straight into your work.</p>
        </div>
      </div>
      {body}
      {!canPrompt && (
        <button type="button" className="btn-secondary mt-4 w-full" onClick={onClose}>Got it</button>
      )}
    </Modal>
  );
}

/**
 * Opens by itself, once, a moment after a phone's browser reaches the app.
 * Closing it is remembered, so it never nags.
 */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !phone || installed || read(SEEN)) return undefined;
    const t = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(t);
  }, [ready, phone, installed]);

  const close = () => {
    setOpen(false);
    try { window.localStorage.setItem(SEEN, '1'); } catch { /* private window: it asks once more next time */ }
  };

  return <InstallSheet open={open} onClose={close} />;
}

/**
 * A button that opens the sheet. Draws nothing on a computer, or once the app
 * is installed. `render` lets each caller style its own.
 */
export function InstallButton({ render }) {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  if (!ready || !phone || installed) return null;
  return (
    <>
      {render(() => setOpen(true))}
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
