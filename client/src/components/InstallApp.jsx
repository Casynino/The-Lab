import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, Download, EllipsisVertical, Menu, Share, SquarePlus, X } from 'lucide-react';
import { installOffer } from '@/lib/installOffer';
import { useBackToClose } from '@/lib/useBackToClose';

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

/** One step: a plain line — a small red number, the words, the button it names
    drawn faint at the end. No box round it, no red disc: Nino, 10 Nov 2026,
    holding up the card for the second time — "it looks like too much". */
function Step({ n, icon: Icon, children }) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-[13px] leading-snug text-white/65">
      <span className="w-2.5 shrink-0 text-center font-mono text-[11px] text-brand-500">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-white/30" /> : null}
    </li>
  );
}

const b = (text) => <b className="font-medium text-white">{text}</b>;

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
      <Step key={3} n={3}>Tap {b('Add')}, then open {b('ZELab')}.</Step>,
    ];
  }
  if (browser === 'samsung') {
    return [
      <Step key={1} n={1} icon={Menu}>Tap the menu at the {b('bottom right')}.</Step>,
      <Step key={2} n={2}>Tap {b('Add page to')}, then {b('Home screen')}.</Step>,
      <Step key={3} n={3}>Open {b('ZELab')} from your home screen.</Step>,
    ];
  }
  if (browser === 'huawei') {
    return [
      <Step key={1} n={1} icon={Menu}>Tap the menu at the {b('bottom')} of the browser.</Step>,
      <Step key={2} n={2}>Tap {b('Add to home screen')} (it may sit under {b('Add to')}).</Step>,
      <Step key={3} n={3}>Open {b('ZELab')} from your home screen.</Step>,
    ];
  }
  return [
    <Step key={1} n={1} icon={browser === 'chrome' ? EllipsisVertical : Menu}>
      {browser === 'chrome' ? <>Open the menu at the {b('top right')}.</> : <>Open the browser menu.</>}
    </Step>,
    <Step key={2} n={2}>Tap {b('Install app')} or {b('Add to Home screen')}.</Step>,
    <Step key={3} n={3}>Open {b('ZELab')} from your home screen.</Step>,
  ];
}

export function InstallSheet({ open, onClose }) {
  const { ios, browser, canPrompt, install } = useInstall();
  // The phone's Back closes the sheet, not the page under it (lib/backToClose.js).
  useBackToClose(open, onClose, { guard: false });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // On an iPhone in Safari a small arrow points at the Share button.
  const hint = ios && browser === 'safari' && !canPrompt;

  /* Frosted glass that belongs to the page (Nino, 10 Nov 2026: "it should feel
     like the background, it should not disturb the design"). So it sits low,
     in the empty dark ground above the toolbar — the sea and the plain — and
     leaves the logo, Log in and the scene alone; the dim behind it is barely
     there; and the card is see-through, warm like the sky, blurring the scene
     under it instead of covering it with a slab. Only a title and the steps.
     Closing is the X, a tap outside, or Escape. */
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/15 p-5 ${hint
        ? 'pb-[calc(max(0.5rem,env(safe-area-inset-bottom))+5.75rem)]'
        : 'pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))]'}`}
    >
      <div role="dialog" aria-modal="true" aria-label="Use it like an app"
        className="w-full max-w-[17.5rem] rounded-2xl border border-white/[0.09] bg-[#140b0b]/55 px-4 pb-1.5 pt-3.5 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.75)] backdrop-blur-2xl backdrop-saturate-150">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium tracking-tight text-white">Use it like an app</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-1.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {canPrompt ? (
          <div className="mb-1.5 mt-3 flex flex-col items-stretch">
            <button type="button"
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 text-[13px] font-medium text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
              onClick={async () => { if (await install()) onClose(); }}>
              <Download className="h-3.5 w-3.5" /> Install the app
            </button>
            <button type="button" className="h-8 cursor-pointer text-[12px] text-white/45 transition hover:text-white/75" onClick={onClose}>Not now</button>
          </div>
        ) : (
          <ol className="mt-1.5 divide-y divide-white/[0.06]">{steps(browser, ios)}</ol>
        )}
      </div>

      {/* An iPhone has no one-tap install, so the next best thing: while the
          sheet is open in Safari, a small arrow bounces over the toolbar
          where Share actually is, so nobody hunts for it. */}
      {hint && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+2.4rem)] z-[60] flex justify-center">
          <span className="flex animate-bounce flex-col items-center gap-0.5 text-[10px] font-medium text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            Share
            <ArrowDown className="h-3.5 w-3.5 text-brand-500" />
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Opens by itself a moment after someone signs in on a phone — and only then
 * (Nino, 11 Nov 2026: "only when someone logs in, not all the time; if they
 * cancel, they must not see it again unless they want to"). A reload, a new
 * page or opening the app again with the session alive does not open it, and
 * neither does any later sign-in once it has been closed. The rules live in
 * lib/installOffer.js; "Get the app" in the sidebar always opens it.
 *
 * On Android (Chrome, Samsung, Huawei's browser) the sheet is one tap on
 * "Install the app" — the browser's own install dialog, caught above. Apple
 * allows no such tap, so an iPhone gets the three steps instead; that is the
 * shortest road Safari has.
 */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || !installOffer.pending()) return undefined;
    // Nothing to offer: not a phone, already installed, or the person said no before.
    if (!phone || installed || installOffer.dismissed()) {
      installOffer.spend();
      return undefined;
    }
    const t = window.setTimeout(() => {
      installOffer.spend();
      setOpen(true);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [ready, phone, installed]);

  const close = () => {
    setOpen(false);
    installOffer.dismiss();
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
