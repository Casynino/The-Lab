import { Component, Suspense, lazy, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PageSpinner, LoadError } from '@/components/ui';
import { CrashCard, reloadWhenOnline } from '@/components/AppErrorBoundary';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { pages, pageFor, warmList } from '@/lib/pages';
import { warmInTurn, shouldWarm, isPageLoadError } from '@/lib/chunkLoader';

// A page's file that could not be fetched even after the one reload main.jsx
// allows (no signal, say) shows the app's own "couldn't load" card with a
// retry, instead of a blank screen. Any other error stopping a page shows
// "Something went wrong" in the page's place, with the menu still there: it
// used to go on up and unmount the whole app to a black screen that not even
// Back could leave (audit pwa-brand-load-1). Opening another address starts
// afresh (`resetKey`). Also put around a tab's own file inside a page
// (`what="this tab"`), so a tab that cannot arrive takes only its own space.
export class PageLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, at: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.at) return { error: null, at: props.resetKey };
    return null;
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const what = this.props.what || 'this page';
    if (isPageLoadError(error)) return <LoadError what={what} onRetry={reloadWhenOnline} />;
    return <CrashCard what={what[0].toUpperCase() + what.slice(1)} />;
  }
}

/** A route's page, fetched as its own file. If the file is already here (it
 *  was fetched ahead of the click) the page draws at once; if not, the same
 *  spinner the pages show while their figures load. */
export function lazyPage(name) {
  const Lazy = lazy(() => pages.load(name));
  function Page(props) {
    // Chosen once per mount, so the component under it never changes type.
    const Body = useRef(pages.loaded(name) || Lazy).current;
    const { pathname } = useLocation();
    return (
      <PageLoadBoundary resetKey={pathname}>
        <Suspense fallback={<PageSpinner />}>
          <Body {...props} />
        </Suspense>
      </PageLoadBoundary>
    );
  }
  Page.displayName = `Page(${name})`;
  return Page;
}

/** A tab's own file inside a page (Inventory's Transfers, Sales' invoice, the
 *  Products label), fetched through the same loader as the pages — so a fetch
 *  of it AHEAD of the click that fails on a weak line is dropped quietly
 *  instead of reloading the app under what someone is typing (audit
 *  pwa-brand-load-3). `exportName` picks a named export. */
export function lazyPart(name, exportName = 'default') {
  // One lazy per tab for the visit. (A fresh one per open was tried: React
  // retries a suspended tab from scratch, so it asked again for ever and the
  // spinner never gave way to the card.) A tab whose file failed shows its
  // card, and Try again reloads once the line is back.
  return lazy(() => pages.load(name).then((mod) => ({ default: mod[exportName] })));
}

/** Fetch a tab's file ahead of the click, quietly. */
export function warmPart(name) {
  pages.load(name, { ahead: true }).catch(() => {});
}

/** Fetches page files ahead of the click: the moment a finger or the mouse
 *  reaches a link, and — once the first screen has its figures — every page in
 *  this person's menu, three at a time (measured on the Tanzania profile: the
 *  whole menu is here ~2.5 s after the first screen instead of ~5.5 s one at a
 *  time, so a click 1.5 s after opening no longer waits for code, and the
 *  first screen is not slower). Draws nothing. */
export function WarmPages() {
  const { role } = useAuth();
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    const onIntent = (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a || a.origin !== window.location.origin || a.target === '_blank') return;
      const name = pageFor(a.pathname, roleRef.current);
      if (name && name !== 'NotFound') pages.load(name, { ahead: true }).catch(() => {});
    };
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerover', onIntent, opts);
    document.addEventListener('touchstart', onIntent, opts);
    document.addEventListener('focusin', onIntent, true);
    return () => {
      document.removeEventListener('pointerover', onIntent, opts);
      document.removeEventListener('touchstart', onIntent, opts);
      document.removeEventListener('focusin', onIntent, true);
    };
  }, []);

  useEffect(() => {
    if (!shouldWarm(typeof navigator !== 'undefined' ? navigator.connection : null)) return undefined;
    let stopped = false;
    const timer = setTimeout(() => {
      warmInTurn(warmList(role), (name) => pages.load(name, { ahead: true }), {
        isBusy: () => queryClient.isFetching() > 0,
        stopped: () => stopped,
        concurrency: 3,
      });
    }, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [role]);

  return null;
}
