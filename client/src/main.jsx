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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3500,
              style: { fontSize: '14px' },
              success: { iconTheme: { primary: '#84cc16', secondary: '#fff' } },
              error: { iconTheme: { primary: '#e11d48', secondary: '#fff' } },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
