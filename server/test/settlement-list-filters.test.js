'use strict';

// ── The Overdue tab and the open list see every overdue order (audit #59, 11 Nov 2026) ───────────────
// An order can be stored as OVERDUE (the sweep writes it) or still say OPEN/PARTIAL with its deadline
// gone by. The Overdue filter only looked for the second kind and the open list dropped the first.
// Pinned against a tiny in-memory table, using the same rule as the tab counts.

const test = require('node:test');
const assert = require('node:assert/strict');

const NOW = Date.now();
const H = 3_600_000;
const ORDERS = [
  { id: 'stored-overdue', status: 'OVERDUE', deadlineAt: new Date(NOW - 30 * H) },
  { id: 'open-late', status: 'OPEN', deadlineAt: new Date(NOW - 2 * H) },
  { id: 'partial-late', status: 'PARTIAL', deadlineAt: new Date(NOW - 5 * H) },
  { id: 'open-fine', status: 'OPEN', deadlineAt: new Date(NOW + 20 * H) },
  { id: 'partial-fine', status: 'PARTIAL', deadlineAt: new Date(NOW + 40 * H) },
  { id: 'done', status: 'SETTLED', deadlineAt: new Date(NOW - 99 * H) },
];

// Just enough of Prisma's where-language for these filters.
function matches(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (k === 'OR') { if (!v.some((w) => matches(row, w))) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if (v.in && !v.in.includes(row[k])) return false;
      if (v.lt && !(row[k] < v.lt)) return false;
      if (v.gte && !(row[k] >= v.gte)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function load() {
  const prisma = new Proxy({
    settlement: {
      findMany: async ({ where }) => ORDERS.filter((o) => matches(o, where)),
      count: async ({ where }) => ORDERS.filter((o) => matches(o, where)).length,
    },
  }, { get: (t, k) => t[k] || { findMany: async () => [], groupBy: async () => [], aggregate: async () => ({ _sum: {} }), count: async () => 0 } });
  const f = require.resolve('../src/config/prisma');
  require.cache[f] = { id: f, filename: f, loaded: true, exports: prisma };
  delete require.cache[require.resolve('../src/services/settlement.service')];
  return require('../src/services/settlement.service');
}

const page = { skip: 0, take: 50, orderBy: { deadlineAt: 'asc' } };
const ids = (r) => r.items.map((i) => i.id).sort();

test('Overdue shows stored-OVERDUE orders and open/partial ones past their deadline', async () => {
  const svc = load();
  assert.deepEqual(ids(await svc.list({ status: 'OVERDUE' }, page)), ['open-late', 'partial-late', 'stored-overdue']);
});

test('Open and Partial leave out the overdue ones (they are counted as Overdue)', async () => {
  const svc = load();
  assert.deepEqual(ids(await svc.list({ status: 'OPEN' }, page)), ['open-fine']);
  assert.deepEqual(ids(await svc.list({ status: 'PARTIAL' }, page)), ['partial-fine']);
});

test('the open list keeps every unsettled order, overdue included', async () => {
  const svc = load();
  assert.deepEqual(ids(await svc.list({ open: true }, page)), ['open-fine', 'open-late', 'partial-fine', 'partial-late', 'stored-overdue']);
});

test('Settled is unchanged', async () => {
  const svc = load();
  assert.deepEqual(ids(await svc.list({ status: 'SETTLED' }, page)), ['done']);
});
