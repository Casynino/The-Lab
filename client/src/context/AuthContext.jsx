import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import api, { tokenStore, unwrap, apiError } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { idle } from '@/lib/idle';
import { installOffer } from '@/lib/installOffer';
import { sessionRefused, retryDelay } from '@/lib/sessionCheck';

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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Opening with no signal: the session is kept and asked about again (see sessionCheck.js).
  const [reconnecting, setReconnecting] = useState(false);

  // Restore the session on first load if a token is present.
  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }
      // Opened again after being away longer than the limit — a phone that
      // slept in a pocket, a screen left on overnight: no timer ran, so this is
      // where it is caught.
      if (idle.expired()) {
        endSession('idle');
        setLoading(false);
        return;
      }
      idle.touch(true);
      // Only the server refusing the sign-in forgets it (audit #116: opening the app with no signal
      // signed the rep out). No signal, a server error or the host in the way: keep it and ask again.
      for (let attempt = 0; active; attempt += 1) {
        try {
          const res = await api.get('/auth/me');
          if (active) setUser(unwrap(res).data);
          break;
        } catch (err) {
          if (!active) break;
          // Refused, or signed out meanwhile (another tab, or a refused device that cleared it).
          if (sessionRefused(err) || !tokenStore.get()) {
            tokenStore.clear();
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
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user: u, tokens } = unwrap(res).data;
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      idle.touch(true);
      // A real sign-in is the one moment the "Use it like an app" sheet may open by itself.
      installOffer.offerAfterSignIn();
      setUser(u);
      return { ok: true, user: u };
    } catch (err) {
      const details = err?.response?.data?.error?.details;
      return { ok: false, message: apiError(err, 'Login failed'), reason: details?.reason, hint: details?.hint };
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
