// Page code arrives in pieces (one file per page), fetched once and shared.
//
// Two kinds of fetch go through here:
//  - a screen WAITING for its page (the page is being opened), and
//  - a fetch AHEAD of a click (sign-in, a finger on a link, the quiet minute
//    after the home page has drawn), so the click later finds the code here.
//
// The difference matters when a fetch fails. main.jsx reloads the app when a
// page's file cannot be fetched — after a deploy the old file names are gone,
// and a fresh index.html names the new ones. That is right when someone is
// opening the page, and wrong when the fetch was only ahead of time: a rep on a
// patchy line would see the app reload under the form he is typing in. So
// main.jsx asks `aheadOnly()` first, and a failed fetch-ahead is simply
// forgotten; the real open later tries again (and reloads if it has to).
//
// Pure: the loaders are passed in, so node --test can drive it with fakes.
export function createChunkLoader(loaders) {
  const entries = new Map(); // name -> { promise, mod, waited, done }
  let waiting = 0; // fetches in flight that a screen is waiting on
  let ahead = 0; // fetches in flight that are only ahead of a click

  function load(name, { ahead: isAhead = false } = {}) {
    const loader = loaders[name];
    if (!loader) return Promise.reject(new Error(`Unknown page: ${name}`));
    const known = entries.get(name);
    if (known) {
      // A screen now waits on a fetch that started ahead of time: from here on
      // its failure is a real one.
      if (!isAhead && !known.waited && !known.done) {
        known.waited = true;
        ahead -= 1;
        waiting += 1;
      }
      return known.promise;
    }

    const entry = { promise: null, mod: null, waited: !isAhead, done: false };
    entries.set(name, entry);
    if (entry.waited) waiting += 1;
    else ahead += 1;
    const settle = () => {
      entry.done = true;
      if (entry.waited) waiting -= 1;
      else ahead -= 1;
    };

    let started;
    try {
      started = Promise.resolve(loader());
    } catch (err) {
      started = Promise.reject(err);
    }
    entry.promise = started.then(
      (mod) => {
        settle();
        if (!mod) {
          // No module and no error: main.jsx caught the failure and the app is
          // reloading. Keep the spinner up until it does.
          entries.delete(name);
          return new Promise(() => {});
        }
        entry.mod = mod;
        return mod;
      },
      (err) => {
        settle();
        entries.delete(name); // the next open asks again
        const e = err instanceof Error ? err : new Error(String(err));
        e.pageLoadFailed = true;
        throw e;
      },
    );
    return entry.promise;
  }

  return {
    load,
    /** The export if that page's code is already here, else null — so an open
     *  page can draw at once instead of passing through a loading frame. */
    loaded(name, exportName = 'default') {
      const mod = entries.get(name)?.mod;
      return mod ? mod[exportName] ?? null : null;
    },
    /** True while the only fetches in flight are ahead-of-time ones. */
    aheadOnly: () => ahead > 0 && waiting === 0,
    /** For tests. */
    inFlight: () => ({ waiting, ahead }),
  };
}

/** A page file that could not be fetched — ours (tagged above) or any other
 *  import() inside a page (a tab's own file), in each browser's wording. */
export function isPageLoadError(error) {
  if (!error) return false;
  if (error.pageLoadFailed) return true;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(String(error.message || ''));
}

// Fetch ahead one at a time, and never while the screen is still asking the
// server for its own figures: on a 1.5 Mbit/s line a page file in the way of
// an answer is time the person waits for. A file that fails is skipped.
export async function warmInTurn(names, load, {
  isBusy = () => false,
  stopped = () => false,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  step = 250,
  maxWait = 4000,
} = {}) {
  for (const name of names) {
    for (let waited = 0; isBusy() && waited < maxWait && !stopped(); waited += step) await pause(step);
    if (stopped()) return;
    try {
      await load(name);
    } catch {
      /* only a missed head start; opening the page fetches it again */
    }
  }
}

// Data saver on, or a 2G line: fetch nothing the person did not ask for.
export function shouldWarm(connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !['slow-2g', '2g'].includes(connection.effectiveType);
}
