'use strict';

// The code printed on each carton, written as a file so the workspace can be
// rebuilt from nothing. These used to be exported by hand from Admin → Product
// Label; when the scratch workspace was cleared the file for the 77 x 44 box
// went with it, and the next render of that box simply had no code on its
// panel. A mockup that quietly loses the code is worse than no mockup.
//
//   node qr.js <workspace>        ->  <workspace>/out/Pepa-QR-*.png
//
// CAPITALS are deliberate and must not be "tidied": a QR has a cheaper mode
// for capitals and digits, which holds this address at 25 modules instead of
// 29. Addresses are not case-sensitive, so it opens the very same page. The
// quiet zone (4 modules) is inside the file, so whoever places it needs no
// margin of their own.

const path = require('path');
const fs = require('fs');
const QRCode = require(path.join(__dirname, '..', '..', 'client', 'node_modules', 'qrcode'));

const W = process.argv[2];
if (!W) { console.error('usage: node qr.js <workspace>'); process.exit(1); }
const OUT = path.join(W, 'out');
fs.mkdirSync(OUT, { recursive: true });

// One entry per box. A box with no entry has no code, which is the one thing
// a carton may not have.
//
// 10 Nov 2026: the business is ZELab and the site is www.zelab.site, so a carton
// now sends people there (it was THE-HAOLAB.VERCEL.APP). Cartons already printed
// keep working: the old address serves the same site, so keep it attached. At
// 25 modules this is the same size of code as before. (The bare ZELAB.SITE/P
// would fit 21 modules — bigger squares on the box — but it redirects to www.)
const CODES = {
  'Pepa-QR-70x36': 'HTTPS://WWW.ZELAB.SITE/P',
  'Pepa-QR-77x44': 'HTTPS://WWW.ZELAB.SITE/P2',
};

(async () => {
  for (const [name, text] of Object.entries(CODES)) {
    const file = path.join(OUT, name + '.png');
    await QRCode.toFile(file, text, {
      errorCorrectionLevel: 'M',
      margin: 4,
      scale: 12,
      color: { dark: '#000000', light: '#ffffff' },
    });
    console.log(name, '->', text);
  }
})();
