'use strict';

// The public product page (/p) behind the QR on the 70 x 36 Pepa box, and its
// label editor. Run with: npm test
//
// What these guard is content, not layout: production holds a settings row
// saved under an older content version, the editor sends back whatever it
// loaded, and pictures are keyed to products. A regression here silently
// removes the product or its pictures from what customers see when they scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = { row: null, fail: false };
const prismaStub = {
  setting: {
    findUnique: async () => { if (store.fail) throw new Error('db down'); return store.row; },
    upsert: async ({ create, update }) => {
      store.row = { ...(store.row || create), ...update, value: update.value ?? create.value };
      return store.row;
    },
  },
};
require.cache[require.resolve('../src/config/prisma')] = { id: 'prisma', filename: 'prisma', loaded: true, exports: prismaStub };
const page = require('../src/services/productPage.service');

const clone = (o) => JSON.parse(JSON.stringify(o));
const keys = (c) => c.products.map((p) => `${p.key}:${p.name}`);
const pictures = (html) => [...html.matchAll(/<img class="shot" src="\/pepa\/([a-z-]+)-/g)].map((m) => m[1]);
const NDOGO = ['ndogo:Pepa Ndogo'];
// The settings row carries every product; which of them a page shows is
// forPath's job, tested separately below.
const BOTH = ['ndogo:Pepa Ndogo', 'ndogo77:Pepa Ndogo Kubwa'];
// What the 70 x 36 carton's code reaches — the assertion most of these tests
// are really making.
const onP = (c) => page.forPath(c, 'p');
const ALL_PICTURES = ['hero', 'open', 'pair'];

// A row as the v1 editor saved it: no version, no keys, a hero image field,
// and the owner's own wording on a fact.
const V1_ROW = {
  name: 'Pepa', tagline: 'Natural unrefined rolling papers', maker: 'Hǎo-Labs',
  city: 'Mbezi Goigi, Dar es Salaam', email: 'haodealtz@gmail.com', heroImage: '/pepa-box.jpg',
  products: [{
    name: 'Pepa Ndogo', note: 'Brown · Unfiltered', intro: 'Made from quality raw materials.',
    facts: [{ label: 'Size', value: '70 × 36 mm' }, { label: 'Type', value: 'Unfiltered' }, { label: 'Papers per booklet', value: '50' }],
  }],
  phones: ['0788734003'], waText: 'Hello, I want wholesale prices for Pepa.',
};
// A row as the v2 editor saved it: keyed, and carrying the King Size Slim box.
const V2_ROW = {
  ...clone(V1_ROW), v: 2, heroImage: undefined,
  products: [
    { key: 'ndogo', name: 'Pepa Ndogo', note: 'Brown · Unfiltered', intro: 'Edited in v2', facts: [{ label: 'Type', value: 'Slow burn Unfiltered' }] },
    { key: 'kss', name: 'Pepa King Size Slim', note: 'Display box of 50', intro: '', facts: [{ label: 'Size', value: '108 × 44 mm' }] },
  ],
};
const seed = (content) => { store.fail = false; store.row = { key: page.SETTING_KEY, value: JSON.stringify(content) }; };

test('with no saved row the page carries Pepa Ndogo only', async () => {
  store.row = null;
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.deepEqual(keys(onP(c)), NDOGO);   // the 70 x 36 page is unchanged
  assert.equal(c.v, page.CONTENT_VERSION);
});

test('a v1 row gains its key, keeps its own wording, and gets Slow burn Unfiltered', async () => {
  seed(V1_ROW);
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.equal(c.products[0].facts[2].label, 'Papers per booklet');
  assert.equal(c.products[0].facts[1].value, 'Slow burn Unfiltered');
  assert.equal('heroImage' in c, false);
});

test('a v2 row loses the King Size Slim box and keeps its Ndogo edits', async () => {
  seed(V2_ROW);
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.deepEqual(keys(onP(c)), NDOGO);
  assert.equal(c.products[0].intro, 'Edited in v2');
});

test('the page shows no King Size Slim, only the small box pictures', async () => {
  seed(V2_ROW);
  const html = page.renderHtml(onP(await page.readContent()), { host: 'x' });
  assert.deepEqual(pictures(html), ALL_PICTURES);
  assert.doesNotMatch(html, /King Size|108 × 44|kss-/);
});

test('an editor tab loaded under v1 cannot save a keyless row', async () => {
  seed(V1_ROW);
  await page.saveContent({ ...clone(V1_ROW), products: [{ ...V1_ROW.products[0], intro: 'Edited' }] }, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.equal(c.products[0].intro, 'Edited');
  assert.deepEqual(pictures(page.renderHtml(onP(c), { host: 'x' })), ALL_PICTURES);
});

test('an editor tab loaded under v2 cannot put King Size Slim back', async () => {
  seed(V1_ROW);
  const staleV2Form = clone(V2_ROW);
  staleV2Form.products[0].intro = 'Saved from an old tab';
  await page.saveContent(staleV2Form, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);          // the 76 x 44 box is appended, King Size is not
  assert.deepEqual(keys(onP(c)), NDOGO);
  assert.equal(c.products[0].intro, 'Saved from an old tab');
  assert.equal(JSON.parse(store.row.value).v, page.CONTENT_VERSION);
});

test('once saved as current, a deleted product stays deleted — even from an old tab', async () => {
  seed({ ...clone(V1_ROW), v: page.CONTENT_VERSION, products: [] });
  assert.deepEqual(keys(await page.readContent()), []);
  await page.saveContent(clone(V1_ROW), 'admin');        // an old tab saves its one product
  assert.deepEqual(keys(await page.readContent()), NDOGO); // what it held is kept, nothing is appended
  seed({ ...clone(V1_ROW), v: page.CONTENT_VERSION, products: [] });
  await page.saveContent({ ...clone(V1_ROW), products: [] }, 'admin');
  assert.deepEqual(keys(await page.readContent()), []);
});

test('a product deleted and added back by name gets its pictures back', async () => {
  seed({ ...clone(V1_ROW), v: page.CONTENT_VERSION, products: [] });
  const form = clone(await page.readContent());
  form.products.push({ name: 'pepa ndogo', note: '', intro: '', facts: [] });
  await page.saveContent(form, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), ['ndogo:pepa ndogo']);
  assert.deepEqual(pictures(page.renderHtml(c, { host: 'x' })), ALL_PICTURES);
});

test('the note becomes "Brown • Slow burn Unfiltered" only where it still said "Brown · Unfiltered"', () => {
  const up = (v, note) => page.shape(page.upgrade({ v, products: [{ key: 'ndogo', name: 'Pepa Ndogo', note }] })).products[0].note;
  assert.equal(up(undefined, 'Brown · Unfiltered'), 'Brown • Slow burn Unfiltered');
  assert.equal(up(3, 'Brown · Unfiltered'), 'Brown • Slow burn Unfiltered');
  assert.equal(up(3, 'Brown · Rolling papers'), 'Brown · Rolling papers');
  assert.equal(up(4, 'Brown · Unfiltered'), 'Brown · Unfiltered');   // a current row is the owner's own
});

test('a small rename keeps the pictures', () => {
  assert.deepEqual(keys(page.shape({ v: 3, products: [{ key: 'ndogo', name: 'Pepa Ndogo Brown' }] })), ['ndogo:Pepa Ndogo Brown']);
});

test('Type becomes "Slow burn Unfiltered" only where a v1 row said exactly "Unfiltered"', () => {
  const up = (value) => page.shape(page.upgrade({ products: [{ name: 'Pepa Ndogo', facts: [{ label: 'Type', value }] }] }))
    .products[0].facts[0].value;
  assert.equal(up('Unfiltered'), 'Slow burn Unfiltered');
  assert.equal(up('Unfiltered, gummed'), 'Unfiltered, gummed');
  const v2 = page.shape(page.upgrade({ v: 2, products: [{ key: 'ndogo', name: 'Pepa Ndogo', facts: [{ label: 'Type', value: 'Unfiltered' }] }] }));
  assert.equal(v2.products[0].facts[0].value, 'Unfiltered');   // a v2 value is the owner's own
});

test('an empty "Add a paper" card does not confuse the upgrade', () => {
  assert.deepEqual(keys(page.shape(page.upgrade({ products: [{ name: 'Pepa Brown' }, { name: '', facts: [] }] }))),
    ['ndogo:Pepa Brown', 'ndogo77:Pepa Ndogo Kubwa']);
});

test('no key is ever given to two products', () => {
  const c = page.shape({ v: 3, products: [{ key: 'ndogo', name: 'A' }, { key: 'ndogo', name: 'B' }, { key: '"><x', name: 'C' }] });
  assert.deepEqual(keys(c), ['ndogo:A', ':B', ':C']);
});

test('the editor read fails loudly; the public page still serves', async () => {
  store.fail = true;
  await assert.rejects(() => page.readContent(), /db down/);
  assert.deepEqual(keys(await page.getContent()), BOTH);
  assert.deepEqual(keys(onP(await page.getContent())), NDOGO);
  seed(V1_ROW); store.row.value = '{not json';
  await assert.rejects(() => page.readContent());
  assert.equal((await page.getContent()).products.length, 2);
});

test('all three pictures sit together under Pepa Ndogo, none above it', async () => {
  seed(V1_ROW);
  const html = page.renderHtml(onP(await page.readContent()), { host: 'x', path: 'p' });
  assert.equal(html.indexOf('<picture>') > html.indexOf('<h3>Pepa Ndogo</h3>'), true);
  assert.deepEqual(pictures(html), ALL_PICTURES);
  const first = html.split('<picture>')[1];
  assert.match(first, /fetchpriority="high"/);
  assert.equal((html.match(/loading="lazy"/g) || []).length, 2);
});

test('the page references only pictures that ship, and carries no script', async () => {
  seed(V1_ROW);
  const html = page.renderHtml(await page.readContent(), { host: 'the-haolab.vercel.app' });
  const refs = [...html.matchAll(/\/pepa\/[a-z0-9.-]+\.(?:webp|jpg)/g)].map((m) => m[0]);
  assert.ok(refs.length >= 12);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(__dirname, '../../client/public', ref)), `missing ${ref}`);
  assert.match(html, /og:image" content="https:\/\/the-haolab\.vercel\.app\/pepa\/hero-1000\.[0-9a-f]{10}\.jpg"/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(html.includes('pepa-box.jpg'), false);
});

// ── One carton, one box ──────────────────────────────────────────────────────
// Each size carries its own QR code: /p on the 70 x 36 carton, /p2 on the
// 76 x 44. A scan must show the box it was printed on and not the other one —
// and a code can never be recalled once it is on a hundred thousand cartons,
// so the fallbacks matter as much as the happy path.

test('each page shows its own box, and only its own', async () => {
  store.row = null;
  const c = await page.getContent();
  assert.deepEqual(keys(page.forPath(c, 'p')), ['ndogo:Pepa Ndogo']);
  assert.deepEqual(keys(page.forPath(c, 'p2')), ['ndogo77:Pepa Ndogo Kubwa']);
});

test('the 70 x 36 page is untouched by the second box', async () => {
  store.row = null;
  const html = page.renderHtml(page.forPath(await page.getContent(), 'p'), { host: 'x', path: 'p' });
  assert.match(html, /70 × 36 mm/);
  assert.doesNotMatch(html, /76 × 44/);
  assert.deepEqual(pictures(html), ALL_PICTURES);      // its own three, as before
});

test('the second box\'s page shows its own box, and says only what the box says', async () => {
  store.row = null;
  const html = page.renderHtml(page.forPath(await page.getContent(), 'p2'), { host: 'x', path: 'p2' });
  assert.match(html, /Pepa Ndogo Kubwa/);
  assert.match(html, /77 × 44 mm/);
  assert.match(html, /Slow burn Unfiltered/);
  assert.doesNotMatch(html, /70 × 36/);
  // Its own pictures, and none of the other box\'s — including the one a
  // shared link previews.
  assert.deepEqual(pictures(html), ['kubwa-hero', 'kubwa-back']);
  assert.match(html, /og:image" content="[^"]*kubwa-hero/)
  // Counts are left blank until the die shows them: blank facts never print.
  assert.doesNotMatch(html, /Papers per box<\/dt><dd><\/dd>/);
  assert.match(html, /haodealtz@gmail\.com|0788/);      // it is still a Pepa page
});

test('a scan never lands on an empty page', async () => {
  // A code printed for a product that was later deleted, or a path nobody has
  // set up yet: show everything rather than a shell with no product in it.
  store.row = null;
  const c = await page.getContent();
  assert.deepEqual(keys(page.forPath(c, 'p9')), BOTH);
  assert.deepEqual(keys(page.forPath(c, '')), ['ndogo:Pepa Ndogo']);   // empty means the original page
  const stripped = { ...c, products: c.products.filter((p) => p.key !== 'ndogo77') };
  assert.deepEqual(keys(page.forPath(stripped, 'p2')), ['ndogo:Pepa Ndogo']);
});

test('each page names itself in the link preview', async () => {
  store.row = null;
  const c = await page.getContent();
  for (const [path, want] of [['p', 'https://h/p'], ['p2', 'https://h/p2']]) {
    const html = page.renderHtml(page.forPath(c, path), { host: 'h', path });
    assert.match(html, new RegExp(`og:url" content="${want.replace(/\//g, '\\/')}"`));
  }
});

test('a saved row that predates the second box gains it', async () => {
  seed(V2_ROW);                                   // a production row from before this change
  const c = await page.readContent();
  assert.deepEqual(keys(page.forPath(c, 'p2')), ['ndogo77:Pepa Ndogo Kubwa']);
  assert.equal(c.products[0].intro, 'Edited in v2');   // and keeps what the owner typed
});

test('a second-box card the owner deleted does not come back', async () => {
  seed({ ...clone(V2_ROW), v: page.CONTENT_VERSION, products: [{ key: 'ndogo', name: 'Pepa Ndogo' }] });
  await page.saveContent({ v: page.CONTENT_VERSION, products: [{ key: 'ndogo', name: 'Pepa Ndogo' }] }, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), ['ndogo:Pepa Ndogo']);
  // ...and its page then falls back rather than going blank.
  assert.deepEqual(keys(page.forPath(c, 'p2')), ['ndogo:Pepa Ndogo']);
});

test('the second box carries the counts its own artwork prints', async () => {
  // "50 LEAVES" on the lid, "50 PER BOX" on the side wall, 50 BOOKLETS on the
  // pattern — the same reading the 70 x 36 box's figures came from.
  store.row = null;
  const two = page.forPath(await page.getContent(), 'p2').products[0];
  const fact = (l) => two.facts.find((f) => f.label === l).value;
  assert.equal(fact('Papers per booklet'), '50');
  assert.equal(fact('Booklets per box'), '50');
  assert.equal(fact('Papers per box'), '2,500');
  const html = page.renderHtml(page.forPath(await page.getContent(), 'p2'), { host: 'x', path: 'p2' });
  assert.match(html, /2,500/);
});

test('a count the owner typed himself is never overwritten', async () => {
  seed({ v: 6, products: [
    { key: 'ndogo', name: 'Pepa Ndogo' },
    { key: 'ndogo77', name: 'Pepa Ndogo Kubwa', facts: [{ label: 'Papers per booklet', value: '32' }] },
  ] });
  const two = (await page.readContent()).products.find((p) => p.key === 'ndogo77');
  assert.equal(two.facts.find((f) => f.label === 'Papers per booklet').value, '32');
});

// ── The codes are printed in CAPITALS ────────────────────────────────────────
// A QR has a cheaper mode for capitals and digits, so the address on every
// carton reads HTTPS://…/P and HTTPS://…/P2. Matching those case-sensitively
// made both codes fall through to "show everything", and a scan of either box
// listed both of them. This is the case the real world actually sends.
test('a scan in capitals shows one box, the way a scan in lower case does', async () => {
  store.row = null;
  const c = await page.getContent();
  for (const [path, want] of [['P', NDOGO], ['P2', ['ndogo77:Pepa Ndogo Kubwa']],
                              ['/P/', NDOGO], ['/P2/', ['ndogo77:Pepa Ndogo Kubwa']]]) {
    assert.deepEqual(keys(page.forPath(c, path)), want, `path ${path}`);
  }
});

test('the capital path never prints the other box', async () => {
  store.row = null;
  const c = await page.getContent();
  const big = page.renderHtml(page.forPath(c, 'P2'), { host: 'x', path: 'P2' });
  assert.match(big, /77 × 44 mm/);
  assert.doesNotMatch(big, /70 × 36/);
  const small = page.renderHtml(page.forPath(c, 'P'), { host: 'x', path: 'P' });
  assert.match(small, /70 × 36 mm/);
  assert.doesNotMatch(small, /77 × 44/);
});
