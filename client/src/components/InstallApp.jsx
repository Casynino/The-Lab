import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, Download, EllipsisVertical, Menu, Share, SquarePlus, X } from 'lucide-react';

/**
 * Use it like an app.
 *
 * Nino, 9 Nov 2026: the screen must be full on ANY phone — "iPhone and Android
 * and Huawei and Google Pixel and any kind of phone". A site open in a browser
 * tab always keeps the address bar, on every phone and in every browser, and
 * no page can hide it. The only full screen is the one the person installs.
 *
 * So the sheet says how — and the way there is different on each browser, which
 * is the whole point of this file. Chrome puts its menu at the TOP right;
 * Samsung Internet and Huawei's browser put theirs at the BOTTOM; Safari hides
 * it in the Share sheet; and WhatsApp's or Instagram's own browser cannot add
 * anything to a home screen at all. Telling a Huawei user to look top right is
 * the same as telling them it does not work.
 *
 * Ported from Target Express's components/install-app.tsx; keep them in step.
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

/* "Not now" is remembered for this visit only. Nino, 10 Nov 2026, holding up
   Super Drive on a rep's Android: the app must keep asking, one tap, until it
   is installed — a rep who waves it away once on a Monday is not meant to be
   left on the browser's address bar for good. */
const ASKED = 'lab.install.asked';

const read = (key) => {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
};

/** Which phone browser this is — see the note at the top of the file. */
function browserOf(ua, ios) {
  // None of these can put anything on a home screen. WhatsApp matters here:
  // it is how a rep is sent the link in the first place.
  if (/MicroMessenger|WhatsApp|FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|GSA\/|; wv\)/i.test(ua)) return 'in-app';
  // On iOS every browser is Safari underneath, but only Safari itself installs.
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/i.test(ua) ? 'ios-other' : 'safari';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/HuaweiBrowser|HBPC|HarmonyOS|OpenHarmony|ArkWeb/i.test(ua)) return 'huawei';
  if (/Chrome\//i.test(ua) && !/EdgA|OPR|Firefox|YaBrowser|UCBrowser|MiuiBrowser|HeyTapBrowser/i.test(ua)) return 'chrome';
  return 'android-other';
}

/** What this phone is, and what it can actually do about installing. */
function look() {
  const ua = navigator.userAgent || '';
  const mm = (q) => window.matchMedia(q).matches;
  const installed = mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)')
    || mm('(display-mode: minimal-ui)') || navigator.standalone === true;
  // A phone or a small tablet held in the hand — not a laptop with a touchscreen.
  const phone = mm('(max-width: 1023px)') && mm('(pointer: coarse)');
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return { ready: true, installed, phone, ios, browser: browserOf(ua, ios), canPrompt: !!deferred };
}

export function useInstall() {
  const [state, setState] = useState({
    ready: false, installed: false, phone: false, ios: false, browser: 'chrome', canPrompt: false,
  });

  useEffect(() => {
    const check = () => setState(look());
    check();
    listeners.add(check);
    // Installing from the browser's own menu fires nothing we can hear, so the
    // display mode is watched as well: the sheet stops offering afterwards.
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

/** One step, with the button it names drawn at the end of the row. Kept small:
    Nino, 10 Nov 2026, holding up the iPhone's: "it should be small and nice,
    don't make it big and bad". */
function Step({ n, icon: Icon, children }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-border bg-elevated px-2.5 py-2 text-[12.5px] leading-snug text-muted">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
    </li>
  );
}

const b = (text) => <b className="font-semibold text-foreground">{text}</b>;

function steps(browser, ios) {
  if (browser === 'in-app') {
    return [
      <Step key={1} n={1} icon={EllipsisVertical}>Tap the menu at the top, then {b('Open in browser')}.</Step>,
      <Step key={2} n={2}>
        {ios ? <>In {b('Safari')}, open this page and tap {b('Get the app')}.</>
          : <>Open this page again and tap {b('Get the app')}.</>}
      </Step>,
    ];
  }
  if (ios) {
    return [
      <Step key={1} n={1} icon={Share}>
        {browser === 'safari'
          ? <>Tap {b('Share')} (bottom bar, or {b('···')}).</>
          : <>Tap {b('Share')} in the address bar or menu.</>}
      </Step>,
      <Step key={2} n={2} icon={SquarePlus}>Tap {b('Add to Home Screen')}.</Step>,
      <Step key={3} n={3}>Tap {b('Add')}, then open {b('Hao Labs')}.</Step>,
    ];
  }
  if (browser === 'samsung') {
    return [
      <Step key={1} n={1} icon={Menu}>Tap the menu at the {b('bottom right')}.</Step>,
      <Step key={2} n={2}>Tap {b('Add page to')}, then {b('Home screen')}.</Step>,
      <Step key={3} n={3}>Open {b('Hao Labs')} from your home screen.</Step>,
    ];
  }
  if (browser === 'huawei') {
    return [
      <Step key={1} n={1} icon={Menu}>Tap the menu at the {b('bottom')} of the browser.</Step>,
      <Step key={2} n={2}>Tap {b('Add to home screen')} (it may sit under {b('Add to')}).</Step>,
      <Step key={3} n={3}>Open {b('Hao Labs')} from your home screen.</Step>,
    ];
  }
  return [
    <Step key={1} n={1} icon={browser === 'chrome' ? EllipsisVertical : Menu}>
      {browser === 'chrome' ? <>Open the menu at the {b('top right')}.</> : <>Open the browser menu.</>}
    </Step>,
    <Step key={2} n={2}>Tap {b('Install app')} or {b('Add to Home screen')}.</Step>,
    <Step key={3} n={3}>Open {b('Hao Labs')} from your home screen.</Step>,
  ];
}

export function InstallSheet({ open, onClose }) {
  const { ios, browser, canPrompt, install } = useInstall();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5 backdrop-blur-[2px]"
    >
      <div role="dialog" aria-modal="true" aria-label="Use it like an app"
        className="w-full max-w-[19.5rem] rounded-2xl border border-border bg-surface p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">Use it like an app</h3>
            <p className="mt-0.5 text-[12px] text-faint">Full screen, no browser bar, its own icon.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-faint transition hover:bg-elevated hover:text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {canPrompt ? (
          <div className="mt-3.5 flex flex-col gap-1.5">
            <button type="button" className="btn-primary w-full !py-2 text-[13px]" onClick={async () => { if (await install()) onClose(); }}>
              <Download className="h-3.5 w-3.5" /> Install the app
            </button>
            <button type="button" className="btn-secondary w-full !py-1.5 text-[12.5px]" onClick={onClose}>Not now</button>
          </div>
        ) : (
          <>
            <ol className="mt-3 space-y-1.5">{steps(browser, ios)}</ol>
            {browser !== 'in-app' && (
              <p className="mt-2 text-[11px] leading-snug text-faint">
                Opened in WhatsApp? Open it in {ios ? 'Safari' : 'your browser'} first.
              </p>
            )}
            <button type="button" className="btn-secondary mt-3 w-full !py-1.5 text-[12.5px]" onClick={onClose}>Got it</button>
          </>
        )}
      </div>

      {/* An iPhone has no one-tap install, so the next best thing: while the
          sheet is open in Safari, a small arrow bounces over the toolbar
          where Share actually is, so nobody hunts for it. */}
      {ios && browser === 'safari' && !canPrompt && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-[60] flex justify-center">
          <span className="flex animate-bounce flex-col items-center gap-0.5 text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            Share
            <ArrowDown className="h-3.5 w-3.5 text-brand-500" />
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Opens by itself a moment after a phone's browser reaches the app, on every
 * visit until the app is installed. On Android (Chrome, Samsung, Huawei's
 * browser) that is one tap on "Install the app" — the browser's own install
 * dialog, caught above. Apple allows no such tap, so an iPhone gets the three
 * steps instead; that is the shortest road Safari has.
 */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !phone || installed || read(ASKED)) return undefined;
    const t = window.setTimeout(() => setOpen(true), 1500);
    return () => window.clearTimeout(t);
  }, [ready, phone, installed]);

  const close = () => {
    setOpen(false);
    try { window.sessionStorage.setItem(ASKED, '1'); } catch { /* private window: it asks once more next time */ }
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
