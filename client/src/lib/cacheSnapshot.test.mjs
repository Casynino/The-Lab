import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenClaims, serializeSnapshot, readSnapshot, keptEntry, MAX_AGE_MS, ONE_MAX_CHARS } from './cacheSnapshot.js';

test('the last good answer is kept even when the latest ask failed (offline); nothing else is', () => {
  const k = ['settlements', { page: 1 }];
  assert.deepEqual(keptEntry(k, { status: 'success', data: { a: 1 }, dataUpdatedAt: 50 }), { k, d: { a: 1 }, t: 50 });
  // Asked again with no signal: still holds the answer from before — that is the one to keep.
  assert.deepEqual(keptEntry(k, { status: 'error', data: { a: 1 }, dataUpdatedAt: 50 }), { k, d: { a: 1 }, t: 50 });
  // Never had an answer: nothing to keep.
  assert.equal(keptEntry(k, { status: 'error', data: undefined, dataUpdatedAt: 0 }), null);
  assert.equal(keptEntry(k, { status: 'pending', data: undefined, dataUpdatedAt: 0 }), null);
  assert.equal(keptEntry(k, undefined), null);
});

test('a failed refresh keeps the old answer only when the line or the server fell over', () => {
  const k = ['sales', 'abc'];
  const failed = (error) => ({ status: 'error', data: { a: 1 }, dataUpdatedAt: 50, error });
  // No answer at all (no signal): kept.
  assert.deepEqual(keptEntry(k, failed({ message: 'Network Error' })), { k, d: { a: 1 }, t: 50 });
  // The server fell over: kept.
  assert.deepEqual(keptEntry(k, failed({ response: { status: 503 } })), { k, d: { a: 1 }, t: 50 });
  // The record is gone, or the server now refuses it: its real answer, so nothing is kept.
  assert.equal(keptEntry(k, failed({ response: { status: 404 } })), null);
  assert.equal(keptEntry(k, failed({ response: { status: 403 } })), null);
});

// A sign-in token as the server makes it (only the middle part is read here; the signature is the server's business).
const b64url = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tokenFor = (sub, role, sv = 1) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role, sv, typ: 'access' })}.signature`;

const OWNER = { id: 'u-owner', name: 'Owner', role: 'ADMIN', permissions: [] };
const REP = { id: 'u-rep', name: 'Rep', role: 'SALES_REP', permissions: [] };
const NOW = 1_762_860_000_000;
const BUILD = 'Ab12Cd34';
const entries = [
  { k: ['dashboard', 'command'], d: { totalFunds: 1_250_000 }, t: NOW - 5_000 },
  { k: ['settlements', { page: 1, status: '' }], d: { data: [{ id: 's1' }], meta: { total: 1 } }, t: NOW - 60_000 },
];
const stored = (over = {}) => serializeSnapshot({ build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), user: OWNER, entries, now: NOW, ...over });

test('reads the claims of a stored sign-in, and nothing from garbage', () => {
  assert.deepEqual(tokenClaims(tokenFor('u-1', 'ADMIN')), { sub: 'u-1', role: 'ADMIN' });
  assert.equal(tokenClaims(null), null);
  assert.equal(tokenClaims('not-a-token'), null);
  assert.equal(tokenClaims('a.%%%.c'), null);
  assert.equal(tokenClaims(`${b64url({})}.${b64url({ role: 'ADMIN' })}.x`), null); // no person named
});

test('the same person on the same build gets their last screens back', () => {
  const back = readSnapshot(stored(), { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW + 60_000 });
  assert.equal(back.user.id, OWNER.id);
  assert.deepEqual(back.entries.map((e) => e.k), [['dashboard', 'command'], ['settlements', { page: 1, status: '' }]]);
  assert.deepEqual(back.entries[0].d, { totalFunds: 1_250_000 });
  assert.equal(back.entries[1].t, NOW - 60_000);
});

test('another account on the same device never reads them', () => {
  assert.equal(readSnapshot(stored(), { build: BUILD, token: tokenFor(REP.id, 'SALES_REP'), now: NOW }), null);
  assert.equal(readSnapshot(stored(), { build: BUILD, token: tokenFor('u-someone-else', 'ADMIN'), now: NOW }), null);
});

test('no sign-in, a changed role, another build or an old copy: nothing is read', () => {
  assert.equal(readSnapshot(stored(), { build: BUILD, token: null, now: NOW }), null);
  assert.equal(readSnapshot(stored(), { build: BUILD, token: tokenFor(OWNER.id, 'WAREHOUSE_STAFF'), now: NOW }), null);
  assert.equal(readSnapshot(stored(), { build: 'Zz99Yy88', token: tokenFor(OWNER.id, 'ADMIN'), now: NOW }), null);
  assert.equal(readSnapshot(stored(), { build: null, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW }), null);
  assert.equal(readSnapshot(stored(), { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW + MAX_AGE_MS + 1 }), null);
  assert.equal(readSnapshot('{not json', { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW }), null);
  assert.equal(readSnapshot('', { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW }), null);
});

test('a copy that claims one person but carries another is refused', () => {
  const forged = JSON.parse(stored());
  forged.user = REP;
  assert.equal(readSnapshot(JSON.stringify(forged), { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW }), null);
});

test('nothing is written for a person the stored sign-in does not name', () => {
  // Another tab signed in as the rep: the owner's tab must not write over (or into) the rep's copy.
  assert.equal(stored({ token: tokenFor(REP.id, 'SALES_REP') }), null);
  assert.equal(stored({ token: null }), null);
  assert.equal(stored({ user: null }), null);
  assert.equal(stored({ build: null }), null);
});

test('newest answers first, an oversized one skipped, within the budget', () => {
  const big = { k: ['returns', { type: '', page: 1 }], d: 'x'.repeat(ONE_MAX_CHARS + 10), t: NOW };
  const many = Array.from({ length: 30 }, (_, i) => ({ k: ['row', i], d: 'y'.repeat(1000), t: NOW - i * 1000 }));
  const text = serializeSnapshot({ build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), user: OWNER, entries: [big, ...many], now: NOW, budget: 10_000 });
  assert.ok(text.length <= 10_000);
  const back = readSnapshot(text, { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW });
  assert.ok(back.entries.length > 0 && back.entries.length < 30);
  assert.ok(back.entries.every((e) => e.k[0] === 'row'));
  // the newest ones are the ones kept
  assert.deepEqual(back.entries.map((e) => e.k[1]), [...Array(back.entries.length).keys()]);
});

test('keys and sign-ins are never written to the device', () => {
  const secretEntries = [
    // the owner's settings carry the CallMeBot key as a value: the whole answer stays off the device
    { k: ['settings'], d: [{ key: 'whatsapp.apikey', value: 'OWNER-KEY-123' }], t: NOW },
    // a rep's profile carries the rep's key, and its edit form reads it from there: asked again instead
    { k: ['sales-rep-profile', 'r1', 'all'], d: { rep: { id: 'r1', whatsappApiKey: 'REP-KEY-456' } }, t: NOW },
    // a rep record nested in a list (activity, penalties): the field goes, the row stays
    { k: ['penalties', 'all'], d: { data: [{ id: 'p1', salesRep: { id: 'r1', code: 'REP-001', whatsappApiKey: 'REP-KEY-789' } }] }, t: NOW },
    // the audit log copies a saved setting's value (the owner's key) into newValues: never kept
    { k: ['audit-logs', { page: 1, search: '' }], d: { data: [{ entityId: 'whatsapp.apikey', newValues: { value: 'OWNER-KEY-AUDIT' } }] }, t: NOW },
    // every WhatsApp message row names its rep's key: never kept
    { k: ['whatsapp-history'], d: [{ id: 'w1', toPhone: '255700000000', toApiKey: 'REP-KEY-OUTBOX' }], t: NOW },
    // a key field under any other name ending in ApiKey goes too
    { k: ['activity'], d: [{ id: 'a1', extra: { toApiKey: 'REP-KEY-NESTED', api_key: 'K-SNAKE' } }], t: NOW - 1 },
  ];
  const text = stored({ entries: secretEntries, user: { ...OWNER, accessToken: 'tok' } });
  for (const secret of ['OWNER-KEY-123', 'REP-KEY-456', 'REP-KEY-789', 'OWNER-KEY-AUDIT', 'REP-KEY-OUTBOX', 'REP-KEY-NESTED', 'K-SNAKE', 'whatsappApiKey', 'toApiKey', 'accessToken']) {
    assert.ok(!text.includes(secret), secret);
  }
  const back = readSnapshot(text, { build: BUILD, token: tokenFor(OWNER.id, 'ADMIN'), now: NOW });
  assert.deepEqual(back.entries.map((e) => e.k[0]), ['penalties', 'activity']);
  assert.deepEqual(back.entries[0].d.data[0].salesRep, { id: 'r1', code: 'REP-001' });
  assert.deepEqual(back.entries[1].d, [{ id: 'a1', extra: {} }]);
});
