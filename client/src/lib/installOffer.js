// When the "Use it like an app" sheet may open by itself.
//
// Nino, 11 Nov 2026: "the pop-up must not come all the time — only when someone logs in, and when they
// cancel it they must not see it again, unless they want to. Keep Get the app in the sidebar, visible."
// This replaces the 10 Nov rule (ask again on every visit): now it is asked
//   - only right after a real sign-in — not on a reload, not when the app is opened again with the
//     session still alive, not when moving between pages; and
//   - never again once the person closed it (X, Not now, a tap outside, Escape) on this phone.
// "Get the app" in the sidebar and on the sign-in page always opens the sheet — that is the person
// asking, so it ignores all of this.
//
// Two small marks, both in the browser and both optional — a blocked storage never throws, it only
// means the sheet is not offered by itself:
//   - OFFER, in sessionStorage: put there at sign-in, spent when the sheet opens (or is not needed).
//     Session storage dies with the tab, so an old mark cannot come back days later.
//   - DISMISSED, in localStorage (and sessionStorage as a fallback): the person said no.

const OFFER = 'lab.install.offer';
const DISMISSED = 'lab.install.dismissed';

const safe = (fn, fallback) => {
  try { return fn(); } catch { return fallback; }
};

export function createInstallOffer({
  session = () => window.sessionStorage,
  local = () => window.localStorage,
} = {}) {
  return {
    /** Called by the sign-in itself, and only by it. */
    offerAfterSignIn() { safe(() => session().setItem(OFFER, '1')); },
    /** Is there a sign-in that has not been offered the sheet yet? */
    pending() { return safe(() => session().getItem(OFFER) === '1', false); },
    /** The offer is used up: the sheet opened, or this phone does not need it. */
    spend() { safe(() => session().removeItem(OFFER)); },
    /** The person closed the sheet — do not open it by itself again. */
    dismiss() {
      safe(() => local().setItem(DISMISSED, '1'));
      safe(() => session().setItem(DISMISSED, '1'));
    },
    dismissed() {
      return safe(() => local().getItem(DISMISSED) === '1', false)
        || safe(() => session().getItem(DISMISSED) === '1', false);
    },
  };
}

export const installOffer = createInstallOffer();
