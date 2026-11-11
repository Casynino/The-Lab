'use strict';

// ── Which kind of device a request comes from ───────────────────────────────
// Nino, 11 Nov 2026: a SALES REP may use ZELab ONLY on a mobile phone — not a desktop, a laptop, an iPad or
// an Android tablet. The owner and staff may use any device. This classifies a request from what the
// browser itself says, so the rule is enforced on the server (login, token refresh and every API call):
//
//   1. Chromium browsers (Chrome, Edge, Samsung Internet, Opera...) send the `Sec-CH-UA-Mobile` client hint
//      on every request: "?1" on a phone, "?0" on a computer or a tablet (Android tablets ask for desktop
//      pages). When it is present it decides; nothing in the page can change it.
//   2. The User-Agent: iPhone / iPod, Android with "Mobile", and the other phone systems are phones. An iPad
//      is never a phone (iPadOS also sends a Mac User-Agent, which is a computer — blocked either way).
//   3. The app's own screen check (`X-Client-Form`, sent by the client on every request): a touch screen
//      whose shorter side is under 600 px is a phone. When it says "tablet" or "desktop" the request is not
//      from a phone, whatever the User-Agent claims.
//
// LIMITS (documented on purpose): every one of these comes from the browser, so someone who deliberately
// fakes all three (a desktop browser's developer tools set to "phone" mode) can pass. The rule stops normal
// use of a computer or tablet, which is what the business asked for; it is not proof against a determined
// technician. A phone browser switched to "Desktop site" is treated as a computer — the message says how
// to fix it.

const RESTRICTED_MESSAGE = 'Access restricted. Sales Representative accounts can only be accessed using a mobile phone.';
const RESTRICTED_HINT = 'If you are on your phone, turn off "Desktop site" in the browser and try again.';

function classifyDevice(headers = {}) {
  const ua = String(headers['user-agent'] || '');
  const hint = String(headers['sec-ch-ua-mobile'] || '').trim();      // "?1" | "?0" | ""
  const form = String(headers['x-client-form'] || '').trim().toLowerCase(); // "phone" | "tablet" | "desktop" | ""

  const ipad = /\biPad\b/i.test(ua) || /\(Tablet;/i.test(ua);
  const iphone = /\biPhone\b|\biPod\b/i.test(ua);
  const android = /\bAndroid\b/i.test(ua);
  const androidPhone = android && /\bMobile\b/i.test(ua);
  const otherPhone = /\(Phone;|Windows Phone|BlackBerry|BB10|IEMobile|Opera Mini|KaiOS/i.test(ua);

  let kind = ipad ? 'tablet' : (iphone || androidPhone || otherPhone) ? 'phone' : android ? 'tablet' : ua ? 'desktop' : 'unknown';

  // The client hint is set by the browser itself and outranks the User-Agent text.
  if (hint === '?0' && kind === 'phone') kind = /Android/i.test(ua) ? 'tablet' : 'desktop';
  if (hint === '?1' && kind !== 'phone' && !ipad) kind = 'phone';

  // The app's own screen check can only take "phone" away, never grant it.
  if (kind === 'phone' && (form === 'tablet' || form === 'desktop')) kind = form;

  return { kind, isPhone: kind === 'phone' };
}

// Throws for a sales rep who is not on a phone; does nothing for anyone else.
function assertDeviceAllowed(role, headers, ApiError) {
  if (role !== 'SALES_REP') return;
  const { isPhone } = classifyDevice(headers);
  if (!isPhone) {
    throw new ApiError(403, RESTRICTED_MESSAGE, { reason: 'DEVICE_RESTRICTED', hint: RESTRICTED_HINT });
  }
}

module.exports = { classifyDevice, assertDeviceAllowed, RESTRICTED_MESSAGE };
