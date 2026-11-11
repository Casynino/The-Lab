import { Component, Suspense, lazy, useEffect, useRef } from 'react';
import { PageSpinner, LoadError } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { pages, pageFor, warmList } from '@/lib/pages';
import { warmInTurn, shouldWarm, isPageLoadError } from '@/lib/chunkLoader';

// A page's file that could not be fetched even after the one reload main.jsx
// allows (no signal, say) shows the app's own "couldn't load" card with a
// retry, instead of a blank screen. Any other error is not ours to dress up:
// it goes on up exactly as it did before pages were split.
class PageLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isPageLoadError(error)) throw error;
    return <LoadError what="this page" onRetry={() => window.location.reload()} />;
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
    return (
      <PageLoadBoundary>
        <Suspense fallback={<PageSpinner />}>
          <Body {...props} />
        </Suspense>
      </PageLoadBoundary>
    );
  }
  Page.displayName = `Page(${name})`;
  return Page;
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
