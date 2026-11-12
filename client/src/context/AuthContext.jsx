import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import api, { tokenStore, unwrap, apiError, clientForm, rememberRefusal } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { idle } from '@/lib/idle';
import { installOffer } from '@/lib/installOffer';
import { sessionRefused, retryDelay, accountRefusal } from '@/lib/sessionCheck';
import { restoreSession, rememberUser, startPersisting, forgetCache } from '@/lib/persist';
import { tokenClaims } from '@/lib/cacheSnapshot';
import { prefetchRoute } from '@/lib/pageQueries';

const AuthContext = createContext(null);

const TOKEN_KEY = 'haostock.accessToken';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

/**
 * Forget the person on this device: the tokens, the idle clock, and every
 * answer the app has cached for them — the next person to sign in here must not
 * see the last one's figures for even a moment. The server is told afterwards,
 * best effort, only so the audit log says who signed out and why; nothing waits
 * on it, because a phone with no signal must still be able to sign out.
 *
 * `reason` is 'idle' or 'manual'. Anything else, including the click event
 * that a bare `onClick={logout}` passes in, counts as manual.
 */
function endSession(reason) {
  const why = reason === 'idle' ? 'idle' : 'manual';
  const token = tokenStore.get();
  tokenStore.clear();
  idle.reset();
  queryClient.clear();
  if (token) {
    // The request interceptor only adds a token when one is stored, and none
    // is now, so this explicit header is the one that goes.
    api.post('/auth/logout', { reason: why }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

/*
  Opened with nothing kept from last time (a first open, or the first after a
  deploy): ask for this screen's answers ALONGSIDE "who is this?" instead of
  after it — one round trip to Frankfurt instead of two. The stored sign-in
  only chooses what to ask for; every answer is still the server's, for
  whoever the server says this is, and nothing shows until /auth/me answers.
*/
function startScreen() {
  const claims = tokenClaims(tokenStore.get());
  if (!claims?.role) return;
  // A rep's account works on a phone only; anywhere else the server signs it out, so ask nothing first.
  if (claims.role === 'SALES_REP' && clientForm() !== 'phone') return;
  prefetchRoute(queryClient, window.location.pathname, window.location.search, claims.role, { shell: true });
}

startPersisting();

// Wait `ms`, or less if the device says it is back online.
function waitToRetry(ms) {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    window.addEventListener('online', done);
  });
}

export function AuthProvider({ children }) {
  // Opened again by the same person on this device: their last screens are shown at once, from what
  // was kept (lib/persist.js), while /auth/me checks the session behind them — a refused session still
  // signs out, and takes the kept screens with it. Nothing kept: wait for /auth/me, as before.
  const [boot] = useState(() => restoreSession());
  const [user, setUser] = useState(boot);
  const [loading, setLoading] = useState(!boot);
  // Opening with no signal: the session is kept and asked about again (see sessionCheck.js).
  const [reconnecting, setReconnecting] = useState(false);
  // Signed in from the sign-in page while that was still waiting: the waiting is over.
  const signedInHere = useRef(false);

  // Restore the session on first load if a token is present.
  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!tokenStore.get()) {
        // Signed out in another tab in the moment since opening: nothing kept is shown either.
        if (boot) {
          queryClient.clear();
          setUser(null);
        }
        setLoading(false);
        return;
      }
      // Opened again after being away longer than the limit — a phone that
      // slept in a pocket, a screen left on overnight: no timer ran, so this is
      // where it is caught.
      if (idle.expired()) {
        endSession('idle');
        setUser(null);
        setLoading(false);
        return;
      }
      idle.touch(true);
      if (!boot) startScreen();
      // Only the server refusing the sign-in forgets it (audit #116: opening the app with no signal
      // signed the rep out). No signal, a server error or the host in the way: keep it and ask again.
      for (let attempt = 0; active && !signedInHere.current; attempt += 1) {
        try {
          const res = await api.get('/auth/me');
          if (!active || signedInHere.current) break;
          // The wait for a signal can outlast the one-hour limit (a phone back in the pocket): still signed out.
          if (idle.expired()) {
            endSession('idle');
            setUser(null);
            break;
          }
          setUser(unwrap(res).data);
          break;
        } catch (err) {
          if (!active || signedInHere.current) break;
          // Refused, or signed out meanwhile (another tab, or a refused device that cleared it).
          if (sessionRefused(err) || !tokenStore.get()) {
            // A reason about the account (a rep suspended, an account switched off) waits on the sign-in
            // page instead of a silent drop to it (auth-device-4).
            rememberRefusal(err);
            // Everything goes: the tokens, the kept screens (tokenStore.clear) and anything shown or
            // read ahead from them.
            tokenStore.clear();
            queryClient.clear();
            setUser(null);
            break;
          }
          setReconnecting(true);
          await waitToRetry(retryDelay(attempt));
        }
      }
      if (active) {
        setReconnecting(false);
        setLoading(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, [boot]);

  // What is written to this device follows who is signed in here (nobody: nothing is written).
  useEffect(() => { rememberUser(user); }, [user]);

  const login = useCallback(async (email, password) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user: u, tokens } = unwrap(res).data;
      // Whoever signed in here before, none of their answers may show for this person.
      queryClient.clear();
      forgetCache();
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      idle.touch(true);
      // A real sign-in is the one moment the "Use it like an app" sheet may open by itself.
      installOffer.offerAfterSignIn();
      signedInHere.current = true;
      setReconnecting(false);
      setLoading(false);
      setUser(u);
      return { ok: true, user: u };
    } catch (err) {
      const details = err?.response?.data?.error?.details;
      // `refusal`: the right password, but the account is suspended or switched off — shown in the card.
      return { ok: false, message: apiError(err, 'Login failed'), reason: details?.reason, hint: details?.hint, refusal: accountRefusal(err) };
    }
  }, []);

  const logout = useCallback(async (reason) => {
    endSession(reason);
    setUser(null);
  }, []);

  // Sign out whoever has stopped using it, and follow another tab that already did.
  useEffect(() => {
    if (!user) return undefined;

    const onActivity = () => idle.touch();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));

    const check = () => {
      if (!idle.expired()) return;
      // Never cut off a save that is on its way: that is a sale half recorded.
      if (queryClient.isMutating() > 0) { idle.touch(true); return; }
      logout('idle');
    };
    const timer = window.setInterval(check, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);

    // The access token vanishing from storage means another tab signed out (or
    // timed out). Without this, this tab would sit on a dead session showing
    // the last screen until its next request failed.
    const onStorage = (e) => {
      if (e.key === TOKEN_KEY && !e.newValue) {
        queryClient.clear();
        setUser(null);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('storage', onStorage);
    };
  }, [user, logout]);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(unwrap(res).data);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      reconnecting,
      isAuthenticated: !!user,
      role: user?.role,
      hasRole: (...roles) => !!user && (user.role === 'ADMIN' || roles.includes(user.role)),
      hasPermission: (key) =>
        !!user && (user.role === 'ADMIN' || (user.permissions || []).includes(key)),
      login,
      logout,
      refreshUser,
      setUser,
    }),
    [user, loading, reconnecting, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
