import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The colour a phone paints its own bars with — the browser's bar at the top,
 * Android's status bar, the installed app's strip — kept equal to the page
 * behind them, so the app reads as one full screen instead of a page boxed
 * inside a browser.
 *
 * The sign-in scene is darker than the app, so it gets its own. Keep these two
 * in step with .status-strip in index.css. (Ported from Target Express's
 * components/theme-color.tsx.)
 */
export const BAR = { app: '#0a0a0b', scene: '#070907' };

export default function ThemeColor() {
  const { pathname } = useLocation();

  useEffect(() => {
    const colour = pathname.startsWith('/login') ? BAR.scene : BAR.app;
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length) {
      metas.forEach((m) => {
        m.setAttribute('content', colour);
        // A media-scoped theme-color would hand the choice back to the phone's
        // own light/dark setting; this app is dark whatever the phone is.
        m.removeAttribute('media');
      });
      return;
    }
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = colour;
    document.head.appendChild(m);
  }, [pathname]);

  return null;
}
