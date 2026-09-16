'use strict';

// The public product page (/p) and its label editor.
// Run with: npm test
//
// What these guard is content, not layout: production holds a settings row
// saved before content v2, the editor sends back whatever it loaded, and the
// pictures are keyed to products. A regression here silently removes a
// product or its pictures from what customers see when they scan a box.

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
const BOTH = ['ndogo:Pepa Ndogo', 'kss:Pepa King Size Slim'];

// A row as the pre-v2 editor saved it: no version, no keys, a hero image
// field, and the owner's own wording on a fact.
const V1_ROW = {
  name: 'Pepa', tagline: 'Natural unrefined rolling papers', maker: 'Hǎo-Labs',
  city: 'Mbezi Goigi, Dar es Salaam', email: 'haodealtz@gmail.com', heroImage: '/pepa-box.jpg',
  products: [{
    name: 'Pepa Ndogo', note: 'Brown · Unfiltered', intro: 'Made from quality raw materials.',
    facts: [{ label: 'Size', value: '70 × 36 mm' }, { label: 'Type', value: 'Unfiltered' }, { label: 'Papers per booklet', value: '50' }],
  }],
  phones: ['0788734003'], waText: 'Hello, I want wholesale prices for Pepa.',
};
const seed = (content) => { store.fail = false; store.row = { key: page.SETTING_KEY, value: JSON.stringify(content) }; };

test('with no saved row the page carries both products', async () => {
  store.row = null;
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.equal(c.v, page.CONTENT_VERSION);
});

test('a pre-v2 row gains keys and King Size Slim, keeping its own wording', async () => {
  seed(V1_ROW);
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.equal(c.products[0].facts[2].label, 'Papers per booklet');
  assert.equal(c.products[0].facts[1].value, 'Slow burn Unfiltered');
  assert.equal('heroImage' in c, false);
});

test('an editor tab loaded before the deploy cannot save a keyless row', async () => {
  seed(V1_ROW);
  const staleForm = { ...clone(V1_ROW), products: [{ ...V1_ROW.products[0], intro: 'Edited' }] };
  await page.saveContent(staleForm, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), BOTH);
  assert.equal(c.products[0].intro, 'Edited');
  assert.deepEqual(pictures(page.renderHtml(c, { host: 'x' })), ['range', 'small', 'kss-open', 'kss-closed']);
});

test('once saved as v2, a deleted product stays deleted', async () => {
  seed(V1_ROW);
  const form = clone(await page.readContent());
  form.products = form.products.filter((p) => p.key !== 'kss');
  await page.saveContent(form, 'admin');
  assert.deepEqual(keys(await page.readContent()), ['ndogo:Pepa Ndogo']);
});

test('a product deleted and added back by name gets its pictures back', async () => {
  seed({ ...clone(V1_ROW), v: 2, products: [{ key: 'kss', name: 'Pepa King Size Slim' }] });
  const form = clone(await page.readContent());
  form.products.push({ name: 'pepa ndogo', note: '', intro: '', facts: [] });
  await page.saveContent(form, 'admin');
  const c = await page.readContent();
  assert.deepEqual(keys(c), ['kss:Pepa King Size Slim', 'ndogo:pepa ndogo']);
  assert.ok(pictures(page.renderHtml(c, { host: 'x' })).includes('small'));
});

test('retyping the two cards over each other moves the pictures with the names', async () => {
  seed({ ...clone(V1_ROW), v: 2, products: [
    { key: 'ndogo', name: 'Pepa Ndogo', facts: [] }, { key: 'kss', name: 'Pepa King Size Slim', facts: [] }] });
  const form = clone(await page.readContent());
  const [a, b] = form.products;
  form.products = [{ ...a, name: b.name }, { ...b, name: a.name }];   // setProduct spread keeps each card's key
  await page.saveContent(form, 'admin');
  assert.deepEqual(keys(await page.readContent()), ['kss:Pepa King Size Slim', 'ndogo:Pepa Ndogo']);
});

test('a card retyped as the other product takes that product\'s pictures', async () => {
  seed({ ...clone(V1_ROW), v: 2, products: [{ key: 'ndogo', name: 'Pepa King Size Slim', facts: [] }] });
  assert.deepEqual(keys(await page.readContent()), ['kss:Pepa King Size Slim']);
});

test('Type becomes "Slow burn Unfiltered" only where it still said exactly "Unfiltered"', () => {
  const up = (value) => page.shape(page.upgrade({ products: [{ name: 'Pepa Ndogo', facts: [{ label: 'Type', value }] }] }))
    .products[0].facts[0].value;
  assert.equal(up('Unfiltered'), 'Slow burn Unfiltered');
  assert.equal(up('Unfiltered, gummed'), 'Unfiltered, gummed');
  const v2 = page.shape({ v: 2, products: [{ key: 'ndogo', name: 'Pepa Ndogo', facts: [{ label: 'Type', value: 'Unfiltered' }] }] });
  assert.equal(v2.products[0].facts[0].value, 'Unfiltered');   // a v2 row is the owner's own, untouched
});

test('a small rename keeps the pictures', () => {
  assert.deepEqual(keys(page.shape({ v: 2, products: [{ key: 'ndogo', name: 'Pepa Ndogo Brown' }] })), ['ndogo:Pepa Ndogo Brown']);
});

test('an empty "Add a paper" card does not confuse the upgrade', () => {
  const c = page.shape(page.upgrade({ products: [{ name: 'Pepa Brown' }, { name: '', facts: [] }] }));
  assert.deepEqual(keys(c), ['ndogo:Pepa Brown', 'kss:Pepa King Size Slim']);
});

test('a pre-v2 tab cannot bring back a product deleted after the row became v2', async () => {
  seed({ ...clone(V1_ROW), v: 2, products: [{ key: 'ndogo', name: 'Pepa Ndogo', facts: [] }] });  // King Size deleted
  await page.saveContent(clone(V1_ROW), 'admin');                                                 // the old tab saves
  assert.deepEqual(keys(await page.readContent()), ['ndogo:Pepa Ndogo']);
});

test('no key is ever given to two products', () => {
  const c = page.shape({ v: 2, products: [{ key: 'kss', name: 'A' }, { key: 'kss', name: 'B' }, { key: '"><x', name: 'C' }] });
  assert.deepEqual(keys(c), ['kss:A', ':B', ':C']);
});

test('a lone pre-v2 product is the 70 x 36 pack whatever it was renamed to', () => {
  assert.deepEqual(keys(page.shape(page.upgrade({ products: [{ name: 'Pepa Small' }] }))), ['ndogo:Pepa Small', 'kss:Pepa King Size Slim']);
});

test('the editor read fails loudly; the public page still serves', async () => {
  store.fail = true;
  await assert.rejects(() => page.readContent(), /db down/);
  assert.deepEqual(keys(await page.getContent()), BOTH);
  seed(V1_ROW); store.row.value = '{not json';
  await assert.rejects(() => page.readContent());
  assert.equal((await page.getContent()).products.length, 2);
});

test('the page references only pictures that ship, and carries no script', async () => {
  seed(V1_ROW);
  const html = page.renderHtml(await page.readContent(), { host: 'the-haolab.vercel.app' });
  const refs = [...html.matchAll(/\/pepa\/[a-z0-9.-]+\.(?:webp|jpg)/g)].map((m) => m[0]);
  assert.ok(refs.length >= 16);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(__dirname, '../../client/public', ref)), `missing ${ref}`);
  assert.match(html, /og:image" content="https:\/\/the-haolab\.vercel\.app\/pepa\/range-1000\.[0-9a-f]{10}\.jpg"/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(html.includes('pepa-box.jpg'), false);
});
