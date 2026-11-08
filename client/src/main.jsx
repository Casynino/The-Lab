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
            position="top-right"
            toastOptions={{
              duration: 3500,
              style: {
                fontSize: '14px',
                background: '#151517',
                color: '#f4f4f5',
                border: '1px solid #2a2a30',
                boxShadow: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
              },
              // The tick and the cross sit on the dark card now, so their
              // secondary colour is the card, not white.
              success: { iconTheme: { primary: '#10b981', secondary: '#151517' } },
              error: { iconTheme: { primary: '#fb7185', secondary: '#151517' } },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
