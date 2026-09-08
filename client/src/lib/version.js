import toast from 'react-hot-toast';
import React from 'react';

// A tab left open never learns that a deploy happened. index.html is served
// must-revalidate, so a refresh always gets the new build — but nobody
// refreshes a page that looks fine, which is how "I don't see the changes"
// happens while the fix is already live. So the tab asks, quietly.
//
// The check is a conditional GET of index.html; when nothing has shipped the
// server answers 304 and it costs nothing. The reply names the entry bundle,
// and that filename carries a content hash, so a different name means
// different code — not a rebuild of the same source.
const ENTRY = /assets\/index-[A-Za-z0-9_-]+\.js/;

// Read it off the tag that loaded us. `import.meta.url` looks like the obvious
// source, but Vite compiles it to document.currentScript?.src — which is null
// inside a module — so it falls back to the page URL and matches nothing.
function currentEntry() {
  const tag = document.querySelector('script[type=module][src*="/assets/index-"]');
  const m = (tag?.src || '').match(ENTRY);
  return m ? m[0] : null;
}

async function deployedEntry() {
  const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  const m = (await res.text()).match(ENTRY);
  return m ? m[0] : null;
}

// ── The update pill ─────────────────────────────────────────────────────────
// One object in two states. The mark is the browser's own reload arrow: an arc
// centred exactly on the rotation origin with a gap and an arrowhead. Turning
// it leaves a stationary ring with a travelling gap — it already IS a spinner,
// standing still. So a tap does not swap a glyph for a spinner, it sets the
// same glyph turning. It only ever turns clockwise: once on arrival, meaning
// there is something to do; endlessly after the tap, meaning it is being done.
const PILL = {
  // The button below is the whole pill, so it owns the padding and the tap
  // target; the container carries only the skin.
  padding: 0,
  borderRadius: '999px',
  // Lit from the glyph outward. 22px is the glyph's centre in BOTH states
  // (14px of padding + half a 16px icon), so when the words close the light is
  // already dead centre of the circle that is left. Move the padding and this
  // number has to move with it.
  background: 'radial-gradient(90px circle at 22px 50%, rgba(132,204,22,0.16), rgba(132,204,22,0) 72%), #151517',
  color: '#f4f4f5',
  border: '1px solid rgba(132,204,22,0.30)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.45), 0 10px 30px -14px rgba(132,204,22,0.45)',
  // The global toast style caps every card at 350px. Not this one.
  maxWidth: 'none',
};

const PILL_BUTTON = 'group flex cursor-pointer items-center rounded-full px-[14px] py-3 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500/60';

// Two whole strings picked by a ternary, never one assembled from a variable —
// an assembled class name compiles to nothing. overflow-visible is
// load-bearing: the arrowhead's tip sits 12.73 units from the centre of a
// 24-unit box, so the SVG's default overflow:hidden would clip it the instant
// it turns.
const GLYPH_RESTING = 'h-4 w-4 shrink-0 animate-reload-settle overflow-visible text-brand-500 transition-colors duration-200 group-hover:text-brand-600';
const GLYPH_TURNING = 'h-4 w-4 shrink-0 animate-spin overflow-visible text-brand-500';

// A ceiling over the line, not a target — a longer label degrades by not
// animating rather than by being clipped.
const WORDS_OPEN = { maxWidth: '12rem', opacity: 1 };
const WORDS_SHUT = { maxWidth: '0px', opacity: 0 };

function updatePill(turning, onTap) {
  return React.createElement(
    'button',
    {
      type: 'button',
      className: PILL_BUTTON,
      onClick: onTap,
      // Once tapped it is no longer a target: it stops taking focus and stops
      // announcing itself as pressable while it finishes.
      'aria-disabled': turning ? 'true' : undefined,
      tabIndex: turning ? -1 : undefined,
    },
    React.createElement(
      'svg',
      {
        className: turning ? GLYPH_TURNING : GLYPH_RESTING,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '2.25',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      React.createElement('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
      React.createElement('polyline', { points: '21 3 21 9 15 9' }),
    ),
    // The words sit in a box that closes. The gap is padding on the INNER
    // span, inside the clip, so it closes with them and leaves a true circle
    // rather than 10px of dead air. No role here — the library's own message
    // wrapper already carries role="status" aria-live="polite".
    React.createElement(
      'span',
      // whitespace-nowrap here as well as on the line inside it: the library's
      // message wrapper sets white-space: pre-line, which this box inherits,
      // and under pre-line any newline that ever reached it would become a real
      // line break and make the pill three lines tall.
      { className: 'toast-collapse block overflow-hidden whitespace-nowrap', style: turning ? WORDS_SHUT : WORDS_OPEN },
      React.createElement(
        'span',
        { className: 'block whitespace-nowrap pl-2.5 text-sm font-medium leading-5' },
        turning ? 'Updating…' : 'Update ready',
      ),
    ),
  );
}

export function watchForNewVersion({ intervalMs = 3 * 60 * 1000 } = {}) {
  const mine = currentEntry();
  // In dev there is no hashed bundle to compare against.
  if (!mine) return;
  let asked = false;

  // A background tab is left alone; coming back to it, or asking directly, is
  // always worth a check.
  const check = async (force = false) => {
    if (asked) return;
    if (!force && document.hidden) return;
    let live;
    try {
      live = await deployedEntry();
    } catch {
      return; // offline or a blip — ask again next time
    }
    if (!live || live === mine) return;
    asked = true;
    let tapped = false;

    // Same id, same style, same element in the same position on both calls, so
    // React keeps the DOM node and the words genuinely animate closed rather
    // than mounting already shut.
    const show = (turning) => toast(() => updatePill(turning, tap), {
      id: 'new-version',
      duration: Infinity,
      className: 'toast-update-pill',
      style: PILL,
    });

    function tap() {
      if (tapped) return;
      tapped = true;
      show(true);
      // Long enough for the words to have closed and the turn to be underway
      // before navigation starts. The browser keeps the old page painted while
      // the new build downloads, so the circle turns through the whole wait,
      // and the reload is what clears it — it can never be left spinning.
      setTimeout(() => window.location.reload(), 140);
    }

    show(false);
  };

  window.addEventListener('focus', () => check(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true); });
  setInterval(() => check(), intervalMs);
  check(true);
}
