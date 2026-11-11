'use strict';

// ── Rep daily reports and the account statement (repUI/finance audit, 11 Nov 2026) ─────────────────
// 1. A daily report is filed under the Tanzanian day it was sent, whatever clock the server runs on:
//    the server took its OWN local midnight, so on Tanzania time every report landed on yesterday's
//    DATE, and on UTC (Vercel) the first three hours of each morning did. A second send only writes
//    what was filled in (it used to null every earlier figure), and an empty report is refused.
// 2. The statement's "balance after" column carries on from page to page: every page used to restart
//    at today's balance. listTransactions now sends the in-minus-out of the rows on earlier pages.

process.env.TZ = 'Africa/Dar_es_Salaam'; // the server clock that filed reports under yesterday
// Prisma is stubbed below; nothing here talks to a database. Placeholders only, for config/env.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const test = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory Prisma ────────────────────────────────────────────────────────
const upserts = [];
const txns = [];
const sortRows = (list, orderBy) => {
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...list].sort((a, b) => {
    for (const [k, dir] of keys) {
      const av = a[k] instanceof Date ? a[k].getTime() : a[k];
      const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
    }
    return 0;
  });
};
const onAccount = (where) => txns.filter((t) => !where.accountId || t.accountId === where.accountId);
const prismaStub = {
  dailyReport: {
    upsert: async (args) => { upserts.push(args); return { id: 'dr1', ...args.create }; },
  },
  financeTransaction: {
    findMany: async ({ where, orderBy, skip = 0, take }) => {
      const rows = sortRows(onAccount(where), orderBy);
      return rows.slice(skip, take == null ? undefined : skip + take);
    },
    count: async ({ where }) => onAccount(where).length,
    aggregate: async () => ({ _sum: { amount: 0 } }),
    groupBy: async () => [],
  },
  brand: { findMany: async () => [] },
  commissionWithdrawal: { findMany: async () => [] },
};
const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('../src/config/prisma', prismaStub);
stub('../src/services/reports.service', { financeEpoch: async () => null });

const dailyReport = require('../src/services/dailyReport.service');
const finance = require('../src/services/finance.service');
const { dailyReportSubmit } = require('../src/validators/phase2.validator');

const iso = (d) => d.toISOString();

// ── 1. Daily reports ────────────────────────────────────────────────────────

test('a report sent at 07:28 Tanzania time on 11 Nov is filed under 11 Nov, not 10 Nov', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T04:28:20Z') });
  upserts.length = 0;
  await dailyReport.submit('rep9', { type: 'OPENING', cashOnHand: 50000, customersToVisit: 6 });
  assert.equal(iso(upserts[0].where.salesRepId_reportDate_type.reportDate), '2026-11-11T00:00:00.000Z');
});

test('just after midnight in Tanzania (still the 10th in UTC) the report is the 11th', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T22:15:00Z') }); // 01:15 EAT, 11 Nov
  upserts.length = 0;
  await dailyReport.submit('rep9', { type: 'CLOSING', salesAmount: 1000 });
  assert.equal(iso(upserts[0].create.reportDate), '2026-11-11T00:00:00.000Z');
});

test('a date sent with the report is that calendar date', async () => {
  upserts.length = 0;
  await dailyReport.submit('rep9', { type: 'OPENING', reportDate: '2026-11-09', cashOnHand: 1 });
  assert.equal(iso(upserts[0].create.reportDate), '2026-11-09T00:00:00.000Z');
  await assert.rejects(dailyReport.submit('rep9', { type: 'OPENING', reportDate: 'not-a-date', cashOnHand: 1 }), (e) => e.statusCode === 400);
});

test('sending again only writes what was filled in — the earlier figures are not wiped', async () => {
  upserts.length = 0;
  await dailyReport.submit('rep9', { type: 'OPENING', customersToVisit: 8, openingNote: '   ' });
  assert.deepEqual(upserts[0].update, { customersToVisit: 8 });
  assert.equal('cashOnHand' in upserts[0].update, false);
  // A zero is a figure, not a blank.
  await dailyReport.submit('rep9', { type: 'OPENING', cashOnHand: 0 });
  assert.deepEqual(upserts[1].update, { cashOnHand: 0 });
});

test('the list filter uses calendar dates, not the server\'s midnight', async () => {
  const seen = [];
  prismaStub.dailyReport.findMany = async ({ where }) => { seen.push(where); return []; };
  prismaStub.dailyReport.count = async () => 0;
  await dailyReport.list({ from: '2026-11-10', to: '2026-11-11' }, { skip: 0, take: 20 });
  assert.equal(iso(seen[0].reportDate.gte), '2026-11-10T00:00:00.000Z');
  assert.equal(iso(seen[0].reportDate.lte), '2026-11-11T00:00:00.000Z');
});

test('an empty report is refused; one figure or a note for that kind of report is enough', () => {
  const ok = (body) => dailyReportSubmit.body.safeParse(body).success;
  assert.equal(ok({ type: 'OPENING' }), false);
  assert.equal(ok({ type: 'OPENING', openingNote: '  ' }), false);
  assert.equal(ok({ type: 'OPENING', salesAmount: 5000 }), false, 'closing figures do not fill an opening report');
  assert.equal(ok({ type: 'CLOSING', cashOnHand: 5000 }), false);
  assert.equal(ok({ type: 'OPENING', cashOnHand: 0 }), true);
  assert.equal(ok({ type: 'OPENING', openingNote: 'Kariakoo first' }), true);
  assert.equal(ok({ type: 'CLOSING', debtsCollected: 2000 }), true);
});

// ── 2. Account statement ────────────────────────────────────────────────────

test('the statement balance carries on across pages instead of restarting at today\'s balance', async () => {
  txns.length = 0;
  const at = (d) => new Date(`2026-11-0${d}T09:00:00Z`);
  // Two rows share a date: the page boundary falls between them.
  [
    ['t1', 'IN', 100000, at(1)], ['t2', 'OUT', 20000, at(2)], ['t3', 'IN', 32500, at(6)],
    ['t4', 'IN', 30000, at(6)], ['t5', 'OUT', 5000, at(7)], ['t6', 'IN', 7000, at(8)],
    ['other', 'IN', 999999, at(8)],
  ].forEach(([id, direction, amount, occurredAt]) => txns.push({ id, accountId: id === 'other' ? 'acc-airtel' : 'acc-mpesa', direction, amount, occurredAt }));
  const balance = 100000 - 20000 + 32500 + 30000 - 5000 + 7000;

  // The client's walk, page by page, as AccountStatementModal does it.
  const walk = async (limit) => {
    const out = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await finance.listTransactions({ accountId: 'acc-mpesa' }, { skip: (page - 1) * limit, take: limit, orderBy: { occurredAt: 'desc' } });
      let running = balance - (res.newerNet || 0);
      for (const r of res.items) {
        out.push([r.id, running]);
        running -= (r.direction === 'IN' ? 1 : -1) * r.amount;
      }
    }
    return out;
  };
  const onePage = await walk(10);
  const paged = await walk(2);
  assert.deepEqual(paged, onePage, 'every row has the same balance after, paged or not');
  assert.equal(paged.length, 6);
  // The oldest row's balance-after is just itself: the walk reaches the opening.
  assert.equal(paged[5][1], 100000);

  const first = await finance.listTransactions({ accountId: 'acc-mpesa' }, { skip: 0, take: 2, orderBy: { occurredAt: 'desc' } });
  assert.equal(first.newerNet, 0);
});
