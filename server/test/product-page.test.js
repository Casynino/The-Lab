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
  assert.deepEqual(keys(c), NDOGO);
  assert.equal(c.v, page.CONTENT_VERSION);
});

test('a v1 row gains its key, keeps its own wording, and gets Slow burn Unfiltered', async () => {
  seed(V1_ROW);
  const c = await page.readContent();
  assert.deepEqual(keys(c), NDOGO);
  assert.equal(c.products[0].facts[2].label, 'Papers per booklet');
  assert.equal(c.products[0].facts[1].value, 'Slow burn Unfiltered');
  assert.equal('heroImage' in c, false);
});

test('a v2 row loses the King Size Slim box and keeps its Ndogo edits', async () => {
  seed(V2_ROW);
  const c = await page.readContent();
  assert.deepEqual(keys(c), NDOGO);
  assert.equal(c.products[0].intro, 'Edited in v2');
});

test('the page shows no King Size Slim, only the small box pictures', async () => {
  seed(V2_ROW);
  const html = page.renderHtml(await page.readContent(), { host: 'x' });
  assert.deepEqual(pictures(html), ALL_PICTURES);
  assert.doesNotMatch(html, /King Size|108 × 44|kss-/);
});

test('an editor tab loaded under v1 cannot save a keyless row', async () => {
  seed(V1_ROW);
  await page.saveContent({ ...clone(V1_ROW), products: [{ ...V1_ROW.products[0], intro: 'Edited' }] }, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), NDOGO);
  assert.equal(c.products[0].intro, 'Edited');
  assert.deepEqual(pictures(page.renderHtml(c, { host: 'x' })), ALL_PICTURES);
});

test('an editor tab loaded under v2 cannot put King Size Slim back', async () => {
  seed(V1_ROW);
  const staleV2Form = clone(V2_ROW);
  staleV2Form.products[0].intro = 'Saved from an old tab';
  await page.saveContent(staleV2Form, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), NDOGO);
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
  assert.deepEqual(keys(page.shape(page.upgrade({ products: [{ name: 'Pepa Brown' }, { name: '', facts: [] }] }))), ['ndogo:Pepa Brown']);
});

test('no key is ever given to two products', () => {
  const c = page.shape({ v: 3, products: [{ key: 'ndogo', name: 'A' }, { key: 'ndogo', name: 'B' }, { key: '"><x', name: 'C' }] });
  assert.deepEqual(keys(c), ['ndogo:A', ':B', ':C']);
});

test('the editor read fails loudly; the public page still serves', async () => {
  store.fail = true;
  await assert.rejects(() => page.readContent(), /db down/);
  assert.deepEqual(keys(await page.getContent()), NDOGO);
  seed(V1_ROW); store.row.value = '{not json';
  await assert.rejects(() => page.readContent());
  assert.equal((await page.getContent()).products.length, 1);
});

test('all three pictures sit together under Pepa Ndogo, none above it', async () => {
  seed(V1_ROW);
  const html = page.renderHtml(await page.readContent(), { host: 'x' });
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
