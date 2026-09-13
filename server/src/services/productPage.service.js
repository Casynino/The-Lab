'use strict';

// The public product page — what a customer sees when they scan the QR code
// printed on a Pepa carton.
//
// Three rules hold this file together, and each of them is load-bearing:
//
// 1. IT READS ONE SETTINGS ROW AND NOTHING ELSE. Not Product, not inventory,
//    not a single join. Product carries purchasePrice, sellingPrice,
//    minStockLevel and reorderQuantity, and a handler that never queries it
//    cannot leak a cost price through a careless `include` a year from now.
//    Publishing is an explicit act: the words on the page are the words
//    somebody typed into the label editor.
//
// 2. IT NEVER THROWS. A carton sitting in a shop in Mwanza must not scan to an
//    error screen — that is worse for the brand than any amount of staleness.
//    If the database is unreachable, the defaults below are served instead.
//
// 3. IT SHIPS NO JAVASCRIPT. Nothing to execute means nothing to exploit, and
//    it paints on a 3G phone before the handshake finishes. Never add a script
//    tag, an analytics snippet or a chat widget to this page.

const prisma = require('../config/prisma');
const env = require('../config/env');

const SETTING_KEY = 'public.productPage';

// The frozen fallback. These are also the starting values in the editor.
// Facts left empty are simply not shown — the page would rather say less than
// say something that turns out to be wrong once it is printed on a carton.
const DEFAULTS = {
  name: 'Pepa',
  tagline: 'Natural unrefined rolling papers',
  maker: 'Hǎo-Labs',
  city: 'Mbezi Goigi, Dar es Salaam',
  email: 'haodealtz@gmail.com',
  heroImage: '/pepa-box.jpg',
  products: [
    {
      name: 'Pepa Ndogo',
      note: 'Brown · Unfiltered',
      intro: 'Made from quality raw materials and designed for a slow, smooth and even burn, '
        + 'Pepa Ndogo delivers a consistent rolling experience every time.',
      facts: [
        { label: 'Colour', value: 'Brown' },
        { label: 'Size', value: '70 × 36 mm' },
        { label: 'Type', value: 'Unfiltered' },
        { label: 'Papers per booklet', value: '50' },
        { label: 'Booklets per box', value: '50' },
        { label: 'Papers per box', value: '2,500' },
      ],
    },
  ],
  phones: ['0752828082', '0788734003'],
  waText: 'Hello, I want wholesale prices for Pepa.',
};

// Merge stored content over the defaults, dropping anything of the wrong
// shape. A half-written settings row can never take the page down.
function shape(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const products = Array.isArray(c.products) ? c.products : DEFAULTS.products;
  return {
    name: str(c.name, DEFAULTS.name),
    tagline: str(c.tagline, DEFAULTS.tagline),
    maker: str(c.maker, DEFAULTS.maker),
    city: str(c.city, DEFAULTS.city),
    // An address, not a link target — rendered as text, escaped like the rest.
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email || '').trim())
      ? String(c.email).trim() : (c.email === '' ? '' : DEFAULTS.email),
    // Only a same-origin path is allowed. An absolute URL here would be a way
    // to point the page's one image at somebody else's server.
    heroImage: (() => {
      const v = str(c.heroImage, DEFAULTS.heroImage);
      return /^\/[A-Za-z0-9._\-/]*$/.test(v) ? v : DEFAULTS.heroImage;
    })(),
    products: products
      .filter((p) => p && typeof p === 'object' && String(p.name || '').trim())
      .map((p) => ({
        name: String(p.name).trim(),
        note: str(p.note, ''),
        intro: str(p.intro, ''),
        // A row with a label but no value yet is KEPT here, so the editor can
        // show it as still to be filled in. renderHtml is what leaves it off
        // the page — the page would rather say less than show a blank line.
        facts: (Array.isArray(p.facts) ? p.facts : [])
          .filter((f) => f && String(f.label || '').trim())
          .map((f) => ({ label: String(f.label).trim(), value: String(f.value || '').trim() })),
      })),
    phones: (Array.isArray(c.phones) ? c.phones : DEFAULTS.phones)
      .map((p) => String(p || '').replace(/[^\d+]/g, ''))
      .filter(Boolean)
      .slice(0, 4),
    waText: str(c.waText, DEFAULTS.waText),
  };
}

async function getContent() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row || !row.value) return shape(DEFAULTS);
    return shape(JSON.parse(row.value));
  } catch {
    // Unreachable database, or a row that is not valid JSON. Serve the page.
    return shape(DEFAULTS);
  }
}

async function saveContent(content, userId) {
  const clean = shape(content);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify(clean),
      type: 'JSON',
      group: 'public',
      description: 'What the QR code on the carton shows when it is scanned.',
      updatedById: userId || null,
    },
    update: { value: JSON.stringify(clean), type: 'JSON', group: 'public', updatedById: userId || null },
  });
  return clean;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Every value below comes from a settings row an admin typed. Escaped without
// exception, including inside attributes — the page has no script, and this is
// what keeps it that way.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// 0752828082 → { display: '0752 828 082', tel: '+255752828082', wa: '255752828082' }
function phoneParts(raw) {
  const digits = String(raw).replace(/\D/g, '');
  const local = digits.startsWith('255') ? `0${digits.slice(3)}` : digits;
  const intl = `255${local.replace(/^0/, '')}`;
  const display = local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
  return { display, tel: `+${intl}`, wa: intl };
}

function renderHtml(c, { host } = {}) {
  const phones = c.phones.map(phoneParts);
  const waMsg = encodeURIComponent(c.waText);

  // Only facts that actually have a value reach the page.
  const withValues = c.products.map((p) => ({ ...p, facts: p.facts.filter((f) => f.value) }));

  const facts = withValues.map((p) => `
      <section class="item">
        <h3>${esc(p.name)}</h3>
        ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
        ${p.intro ? `<p class="intro">${esc(p.intro)}</p>` : ''}
        ${p.facts.length ? `<dl>${p.facts.map((f) => `
          <div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}
        </dl>` : ''}
      </section>`).join('');

  // One number, two ways to reach it. The WhatsApp link arrives with the
  // wholesale question already typed — in this market that prefilled message
  // is worth more than everything else on the page.
  const call = phones.map((p) => `
      <div class="num">
        <div class="num-n">${esc(p.display)}</div>
        <div class="num-a">
          <a class="btn" href="tel:${esc(p.tel)}">Call</a>
          <a class="btn wa" href="https://wa.me/${esc(p.wa)}?text=${waMsg}">WhatsApp</a>
        </div>
      </div>`).join('');

  const title = `${c.name} — ${c.tagline}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${c.name} — ${c.tagline}. ${c.maker}, ${c.city}. Wholesale: ${phones.map((p) => p.display).join(', ')}`)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(`${c.maker} is the only distributor. Wholesale: ${phones.map((p) => p.display).join(' · ')}`)}">
${host ? `<meta property="og:url" content="${esc(`https://${host}/p`)}">` : ''}
<meta name="robots" content="index, follow">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--paper:#f6f1e7;--ink:#14120e;--soft:#6b6355;--line:#ddd3c0;--brick:#a33a1f}
  html{-webkit-text-size-adjust:100%}
  body{background:var(--paper);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    padding:28px 20px 44px;max-width:520px;margin:0 auto}
  h1{font-size:clamp(44px,17vw,76px);line-height:.92;letter-spacing:-.03em;font-weight:800}
  h1 sup{font-size:.24em;font-weight:600;letter-spacing:0;vertical-align:super;margin-left:.12em}
  .say{margin-top:12px;font-size:17px;font-weight:600}
  .sub{color:var(--soft);font-size:15px}
  hr{border:0;border-top:1px solid var(--line);margin:26px 0}
  /* The beadwork band off the carton border. Used exactly twice — under the
     wordmark and above the footer — so it stays a signature, not a pattern. */
  .bead{height:7px;margin:20px 0;border-radius:1px;
    background:repeating-linear-gradient(90deg,
      var(--brick) 0 7px,#e0a03c 7px 14px,var(--ink) 14px 21px,#e8dcc2 21px 28px)}
  h2{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--soft);
    font-weight:700;margin-bottom:12px}
  .addr{border:1px solid var(--line);border-left:3px solid var(--brick);
    background:rgba(255,255,255,.5);padding:14px 16px;border-radius:2px}
  .addr .url{font:700 19px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    color:var(--brick);word-break:break-all}
  .addr p{margin-top:8px;font-size:14px}
  .addr .sub{margin-top:4px;font-size:14px}
  .addr .lead{font-size:16px;font-weight:700}
  .addr .same{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);
    font-size:15px;font-weight:600}
  .addr-url{margin-top:12px;font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    color:var(--soft);word-break:break-all}
  /* The box, shot from its own die-line. Bleeds to the full width of the
     page because it is the first thing worth looking at. */
  .shot{display:block;width:66%;max-width:300px;margin:24px auto 4px;height:auto}
  .item{margin-bottom:22px}
  .item h3{font-size:21px;font-weight:700;letter-spacing:-.01em}
  .item .note{margin-top:3px;font-size:13px;font-weight:600;letter-spacing:.06em;
    text-transform:uppercase;color:var(--brick)}
  .item .intro{margin-top:10px;font-size:15px;line-height:1.6;color:var(--soft)}
  dl{margin-top:16px}
  dl div{display:flex;justify-content:space-between;gap:18px;padding:7px 0;
    border-bottom:1px solid var(--line)}
  dt{color:var(--soft);font-size:14px;flex:none}
  dd{text-align:right;font-size:14px;font-weight:600}
  .made p{font-size:15px}
  .made .lead{font-weight:700;font-size:17px}
  .made .lead + .lead{margin-top:8px}
  .tm{margin-top:12px;font-size:13px;color:var(--soft)}
  .mail{margin-top:4px;font-size:16px}
  .mail a{color:var(--brick);text-decoration:none;border-bottom:1px solid currentColor}
  .nums{margin-top:20px}
  .num{margin-bottom:18px}
  .num-n{font:700 26px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    letter-spacing:.02em;margin-bottom:8px}
  .num-a{display:flex;gap:8px}
  .btn{flex:1;display:flex;align-items:center;justify-content:center;
    min-height:56px;padding:0 10px;border:1px solid var(--ink);border-radius:2px;
    background:var(--ink);color:var(--paper);text-decoration:none;
    font-size:15px;font-weight:700;-webkit-tap-highlight-color:transparent}
  .btn.wa{background:#128c4a;border-color:#128c4a;color:#fff}
  footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);
    font-size:12px;color:var(--soft)}
  /* Deliberately light in every case, including on a phone set to dark mode.
     This page is read outdoors in a market in direct sun, where a near-black
     screen is a mirror — and the page is the packaging, which is paper. */
</style>
</head>
<body>
  <h1>${esc(c.name)}<sup>™</sup></h1>
  <p class="say">${esc(c.tagline)}</p>

  ${c.heroImage ? `<img class="shot" src="${esc(c.heroImage)}" width="760" height="1266"
    alt="A box of ${esc(c.name)} rolling papers">` : ''}

  <div class="bead"></div>

  ${facts}

  <hr>

  <div class="addr">
    <p class="lead">The same code is on every box.</p>
    <p class="sub">It shows the product and who makes it. It does not prove this box.</p>
    <p class="same">Not sure about a seller or a price? Call us.</p>
    <p class="addr-url">${esc(host || '')}</p>
  </div>

  <hr>

  <h2>Made by</h2>
  <div class="made">
    <p class="lead">${esc(c.name)} is distributed by ${esc(c.maker)}.</p>
    <p class="lead">${esc(c.maker)} is the only distributor.</p>
    <p class="tm">${esc(c.name)}™ is a trademark of ${esc(c.maker)}.</p>
  </div>

  <hr>

  <h2>Get in touch</h2>
  <p class="say">${esc(c.city)}</p>
  ${c.email ? `<p class="mail"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
  <div class="nums">${call}</div>

  <hr>

  <h2>Seen a fake?</h2>
  <p class="say">Call us and say where you bought it.</p>

  <div class="bead"></div>
  <footer>${esc(c.maker)} · ${esc(c.city)}</footer>
</body>
</html>`;
}

module.exports = { SETTING_KEY, DEFAULTS, getContent, saveContent, renderHtml, shape, appUrl: env.appUrl };
