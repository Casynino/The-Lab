import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { watchForNewVersion } from '@/lib/version';
import './index.css';

// Every deploy renames the hashed chunks. A tab left open across one will ask
// for a chunk that no longer exists the moment it hits a lazy route (the
// invoice page), and the request fails. Reloading pulls a fresh index.html
// naming the new chunks. Guarded by a session flag so a chunk that is genuinely
// unfetchable — offline, or a stale entry cached under its old URL — fails
// visibly instead of reloading forever.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('chunkReloadAttempted')) return;
  sessionStorage.setItem('chunkReloadAttempted', '1');
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('chunkReloadAttempted'));

watchForNewVersion();

/* The service worker that lets a phone install the app and run it full screen,
   with no address bar. It caches nothing — see client/public/sw.js. A browser
   without service workers, or a page opened over plain http on a LAN address,
   simply skips this; the iPhone route does not need it at all. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* nothing to do: the app works exactly as before, it just cannot be
         installed from this browser's menu. */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          {/* Every toast in this app was the library's default white card on a
              near-black page — a bright slab that arrived, took the eye off
              whatever it interrupted, and matched nothing around it. These are
              the app's own surface, border and text tokens, so a toast now
              looks like it belongs to the screen it lands on. */}
          <Toaster
            position="top-center"
            /* 16px from every edge, as the library does — plus whatever the
               phone keeps for its clock, camera and home bar. Without it a toast
               opened UNDER the status bar of the installed app. */
            containerStyle={{
              top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
              right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              left: 'calc(env(safe-area-inset-left, 0px) + 16px)',
            }}
            /* Nino, 11 Nov 2026: "these toasts are not nice — make them premium". A small dark glass
               capsule at the top centre: 13px words, a small icon, a soft deep shadow, the page blurred
               behind it. The words are kept short where they are set. */
            toastOptions={{
              duration: 3000,
              className: 'zl-toast',
              style: {
                fontSize: '13px',
                fontWeight: 500,
                lineHeight: 1.35,
                padding: '7px 14px 7px 10px',
                maxWidth: 'min(92vw, 360px)',
                borderRadius: '18px',
                background: 'rgba(24, 24, 27, 0.86)',
                color: '#f4f4f5',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 14px 34px -14px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.06)',
                backdropFilter: 'blur(16px) saturate(150%)',
                WebkitBackdropFilter: 'blur(16px) saturate(150%)',
              },
              success: { iconTheme: { primary: '#34d399', secondary: '#18181b' } },
              error: { iconTheme: { primary: '#fb7185', secondary: '#18181b' } },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
