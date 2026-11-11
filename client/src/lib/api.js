import axios from 'axios';
import { queryClient } from '@/lib/queryClient';

const TOKEN_KEY = 'haostock.accessToken';
// When this tab last reloaded itself to answer the host's security challenge.
const CHALLENGE_KEY = 'haostock.challengeReload';
const REFRESH_KEY = 'haostock.refreshToken';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access, refresh) => {
    if (access) localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// The app's own look at the screen, sent with every request: a touch screen whose shorter side is under
// 600px is a phone. The server combines it with what the browser says about itself (server/src/utils/
// device.js) to keep sales-rep accounts on phones only. It can only ever narrow, never widen, access.
function clientForm() {
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return 'desktop';
    const short = Math.min(window.screen.width, window.screen.height);
    // A foldable phone opened wide (Galaxy Z Fold, Pixel Fold ~690-700px) still says it is a phone in its
    // User-Agent ("iPhone" / "Android ... Mobile"); tablets do not. Trust that up to 900px (audit 11 Nov).
    const phoneUA = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent || '');
    return short < 600 || (phoneUA && short < 900) ? 'phone' : 'tablet';
  } catch {
    return '';
  }
}
export const RESTRICTED_KEY = 'zl.restricted';

// Attach the bearer token to every request.
api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Worked out per request: a phone folded or unfolded mid-session sends what it is now.
  const form = clientForm();
  if (form) config.headers['X-Client-Form'] = form;
  return config;
});

// Transparently refresh the access token once on a 401, then retry.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // A sales-rep account used on a computer or tablet: the server refuses every request. Sign out here and
    // show the reason on the sign-in page (the sign-in form shows it itself, so no redirect from there).
    const details = error.response?.data?.error?.details;
    if (status === 403 && details?.reason === 'DEVICE_RESTRICTED' && !original?.url?.includes('/auth/login')) {
      tokenStore.clear();
      try { sessionStorage.setItem(RESTRICTED_KEY, JSON.stringify({ message: error.response.data.error.message, hint: details.hint })); } catch { /* private window */ }
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
      return Promise.reject(error);
    }

    if (status === 401 && !original._retry && tokenStore.getRefresh() && !original.url?.includes('/auth/')) {
      original._retry = true;
      try {
        refreshing =
          refreshing ||
          api.post('/auth/refresh', { refreshToken: tokenStore.getRefresh() }).then((r) => {
            const { accessToken, refreshToken } = r.data.data.tokens;
            tokenStore.set(accessToken, refreshToken);
            return accessToken;
          });
        const newToken = await refreshing;
        refreshing = null;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (e) {
        refreshing = null;
        tokenStore.clear();
        if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
        return Promise.reject(e);
      }
    }
    // The host's firewall challenges a whole address when it sees too many
    // requests from it — and everyone here is behind one address. A browser
    // answers that challenge by loading a page; a request made in the
    // background cannot, so it comes back 403 with nothing in it and the app
    // simply stops working until the challenge lifts, ten minutes later.
    //
    // One reload answers it and everything works again. Only for a plain read,
    // never while something is being saved, never more than once every five
    // minutes, and never in a tab nobody is looking at — a reload in the
    // middle of typing costs more than the wait.
    if (status === 403 && error.response?.headers?.['x-vercel-mitigated'] === 'challenge') {
      const isRead = (original?.method || 'get').toLowerCase() === 'get';
      try {
        const last = Number(sessionStorage.getItem(CHALLENGE_KEY) || 0);
        if (isRead && queryClient.isMutating() === 0 && document.visibilityState === 'visible'
            && Date.now() - last > 5 * 60_000) {
          sessionStorage.setItem(CHALLENGE_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch { /* private window: no memory of the last one, so leave it alone */ }
    }

    // One line in the console for anything that fails, so a screenshot of the
    // toast is never the only evidence there is.
    if (error?.response) {
      // eslint-disable-next-line no-console
      console.warn('[api]', original?.method?.toUpperCase(), original?.url, '->', status, error.response.data);
    }
    return Promise.reject(error);
  },
);

// Normalize an axios error into a readable message.
export function apiError(error, fallback = 'Something went wrong') {
  const said = error?.response?.data?.error?.message || error?.response?.data?.message;
  // A 422 says which field and why in `details`; "Validation failed" alone left nobody able to fix it.
  const details = error?.response?.data?.error?.details;
  if (said && Array.isArray(details) && details.length) {
    const why = details.slice(0, 2).map((d) => (d?.path ? `${d.path}: ${d.message}` : d?.message)).filter(Boolean);
    if (why.length) return `${said} — ${why.join('; ')}`;
  }
  if (said) return said;

  const status = error?.response?.status;
  // Every refusal the app itself makes carries a sentence saying why. A 401 or
  // 403 WITHOUT one never came from the app: something in front of it — the
  // network, or the host — turned the request away before it arrived. The
  // difference matters to whoever is looking at the screen: nothing they typed
  // is wrong, nothing was saved, and trying again is the right next move.
  if (status === 401 || status === 403) {
    return `Blocked before it reached the app (${status}). Nothing was saved. Try again — if it keeps happening it is the network or the host turning it away, not your figures.`;
  }
  if (!error?.response && (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK')) {
    return 'No connection to the app. Check the internet and try again.';
  }
  return status ? `${fallback} (${status})` : (error?.message || fallback);
}

// Unwrap the standard { success, data, meta } envelope.
export const unwrap = (res) => res.data;

export default api;
