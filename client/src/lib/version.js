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
    toast(
      (t) => React.createElement('span', { className: 'flex items-center gap-3' },
        'A newer version is live.',
        React.createElement('button', {
          className: 'rounded-md bg-brand-500 px-2 py-1 text-xs font-semibold text-slate-950',
          onClick: () => { toast.dismiss(t.id); window.location.reload(); },
        }, 'Reload')),
      { duration: Infinity, id: 'new-version' },
    );
  };

  window.addEventListener('focus', () => check(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true); });
  setInterval(() => check(), intervalMs);
  check(true);
}
