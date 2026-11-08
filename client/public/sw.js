/* The service worker that makes The Lab installable.
 *
 * It caches nothing and answers nothing. It exists because Chrome — and so
 * every Chromium browser on Android, Samsung Internet, Opera, Edge and
 * Huawei's Petal — will only offer "Install app" for a site that has a
 * service worker with a fetch handler. Without one, the browser's menu offers
 * a plain shortcut instead, which reopens the site in a tab WITH the address
 * bar: not an app, and not full screen. (An iPhone needs none of this; Safari
 * installs from the manifest and the apple-* tags in index.html.)
 *
 * The fetch handler is deliberately empty. The Lab is a live system — stock,
 * settlements, money — and a cached answer is a wrong answer. Not calling
 * respondWith lets every request go to the network exactly as it would with
 * no service worker at all.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', () => {
  /* On purpose: see above. Nothing is cached and nothing is intercepted. */
});
