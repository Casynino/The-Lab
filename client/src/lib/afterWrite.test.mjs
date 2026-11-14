import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AFTER, keysAfter, refreshAfter } from './afterWrite.js';

// Every first key part some query in the app actually uses (pageQueries builders and the pages' own).
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function usedKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(e.name) && !e.name.includes('.test.')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/queryKey: \['([a-z-]+)'/g)) keys.add(m[1]);
      }
    }
  };
  walk(SRC);
  return keys;
}

test('every key a write refreshes is one the app really asks under (a typo would refresh nothing)', () => {
  const used = usedKeys();
  for (const [kind, list] of Object.entries(AFTER)) {
    for (const k of list) assert.ok(used.has(k), `${kind}: no query uses the key '${k}'`);
    assert.equal(new Set(list).size, list.length, `${kind} names a key twice`);
  }
});

test('approving a settlement refreshes the money, the reps, the stock and the commission (freshness-1/2/3)', () => {
  for (const k of ['finance', 'reports', 'sales', 'settlements', 'settlement', 'commissions', 'bonus-summary', 'bonus',
    'sales-reps', 'sales-rep-profile', 'inventory', 'dashboard']) {
    assert.ok(AFTER.settlement.includes(k), `settlement misses ${k}`);
  }
});

test('paying or rejecting a payout refreshes Finance, the reps and the wallet (freshness-2/3)', () => {
  // A bonus withdrawal paid or rejected moves the bonus wallet and the admin's bonus tables too.
  for (const k of ['commissions', 'finance', 'dashboard', 'sales-reps', 'sales-rep-profile', 'bonus', 'bonus-summary', 'bonus-awards']) {
    assert.ok(AFTER.payout.includes(k), `payout misses ${k}`);
  }
});

test('a counter sale refreshes the stock and the money, receiving stock refreshes the Dashboard alerts (freshness-2/4)', () => {
  for (const k of ['sales', 'inventory', 'finance', 'dashboard', 'products']) assert.ok(AFTER.sale.includes(k), `sale misses ${k}`);
  for (const k of ['inventory', 'dashboard', 'products', 'reorder']) assert.ok(AFTER.stock.includes(k), `stock misses ${k}`);
});

test('stock requests and returns refresh the Sales reps page too (freshness-3)', () => {
  for (const kind of ['stockRequest', 'repReturn']) {
    for (const k of ['sales-reps', 'sales-rep-profile', 'inventory', 'dashboard', 'settlements']) {
      assert.ok(AFTER[kind].includes(k), `${kind} misses ${k}`);
    }
  }
});

test('several kinds refresh each key once, and a misspelt kind is an error, not a silent no-op', () => {
  const keys = keysAfter('sale', 'stock');
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('finance') && keys.includes('reorder'));
  assert.throws(() => keysAfter('setlement'), /no such write/);
});

test('refreshAfter invalidates each key by its first part', () => {
  const calls = [];
  refreshAfter({ invalidateQueries: (o) => calls.push(o.queryKey) }, 'payout');
  assert.deepEqual(calls, AFTER.payout.map((k) => [k]));
});

test('a transfer made or cancelled refreshes the stock, the Dashboard alerts and a rep\'s order, not only its list', () => {
  for (const k of ['transfers', 'inventory', 'dashboard', 'products', 'reorder', 'sales-reps', 'sales-rep-profile', 'settlements', 'settlement']) {
    assert.ok(AFTER.transfer.includes(k), `transfer misses ${k}`);
  }
});
