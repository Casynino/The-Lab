'use strict';

// ── Commission and bonus money, audit round 3 (11 Nov 2026) ────────────────────────────────────────────
// Pinned: two manual commission corrections saved at once both count (#120); a deactivated rep who is
// still owed money stays in the commission totals and in "owed to reps" (#71); a bonus pays the tier
// that was asked for or nothing, and two tiers paid at the same moment can never both stand (#119).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const f = require.resolve(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (rel) => {
  delete require.cache[require.resolve(rel)];
  return require(rel);
};
const tick = () => new Promise((r) => setImmediate(r));

// A database stand-in that answers every table with "nothing"; a test fills in only the tables it is about.
function db(tables = {}) {
  const empty = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, groupBy: async () => [], aggregate: async () => ({ _sum: {}, _count: 0 }),
  };
  // Transactions run one at a time, as the row lock they take makes them run on Postgres.
  let chain = Promise.resolve();
  const proxy = new Proxy({}, {
    get(_t, name) {
      if (name === 'then') return undefined;
      if (name === '$transaction') {
        return (fn) => {
          const run = chain.then(() => fn(proxy));
          chain = run.catch(() => {});
          return run;
        };
      }
      if (name === '$queryRaw' || name === '$executeRaw') return async () => [];
      return { ...empty, ...(tables[name] || {}) };
    },
  });
  return proxy;
}

const notified = [];
stub('../src/services/notification.service', {
  notifyUser: async (userId, data) => { notified.push({ userId, ...data }); },
  notifyAdmins: async () => {},
  createIfAbsent: async () => {},
});
stub('../src/services/penalty.service', { penaltyBreakdownForRep: async () => ({ total: 0, breakdown: [] }) });

// ── #120 manual adjustment ────────────────────────────────────────────────────────────────────────────
test('two commission corrections saved at the same moment both count, and a note is never put back', async () => {
  const rep = { id: 'r1', commissionAdjustment: 0, commissionAdjustmentNote: 'old note' };
  const writes = [];
  stub('../src/config/prisma', db({
    salesRepresentative: {
      // Both callers read before either writes — the interleaving that lost one of them.
      findUnique: async () => { await tick(); return { ...rep }; },
      update: async ({ data }) => {
        writes.push(data);
        const c = data.commissionAdjustment;
        // What Postgres does with { increment }: adds to the value it holds NOW.
        rep.commissionAdjustment = c && typeof c === 'object' ? rep.commissionAdjustment + c.increment : c;
        if ('commissionAdjustmentNote' in data) rep.commissionAdjustmentNote = data.commissionAdjustmentNote;
        return { ...rep };
      },
    },
  }));
  const commission = fresh('../src/services/commission.service');

  await Promise.all([
    commission.adjustEarned({ salesRepId: 'r1', amount: 100000 }, { id: 'admin' }),
    commission.adjustEarned({ salesRepId: 'r1', amount: 100000, note: 'second' }, { id: 'admin' }),
  ]);
  assert.equal(rep.commissionAdjustment, 200000);
  assert.deepEqual(writes.map((w) => w.commissionAdjustment), [{ increment: 100000 }, { increment: 100000 }]);
  // The save without a note leaves whatever note is there now; only the one with a note writes it.
  assert.equal(writes.filter((w) => 'commissionAdjustmentNote' in w).length, 1);
  assert.equal(rep.commissionAdjustmentNote, 'second');

  await assert.rejects(commission.adjustEarned({ salesRepId: 'r1', amount: 0 }), (e) => e.statusCode === 400);
});

// ── #71 deactivated reps ──────────────────────────────────────────────────────────────────────────────
test('a deactivated rep still owed money stays in the totals; one owed nothing stays off the list', async () => {
  const reps = [
    { id: 'r-active', code: 'A', isActive: true, user: { name: 'Active' }, adjustment: 0, pending: 0 },
    { id: 'r-left-owed', code: 'B', isActive: false, user: { name: 'Left, owed' }, adjustment: 80000, pending: 0 },
    { id: 'r-left-asked', code: 'C', isActive: false, user: { name: 'Left, asked' }, adjustment: 30000, pending: 30000 },
    { id: 'r-left-square', code: 'D', isActive: false, user: { name: 'Left, square' }, adjustment: 0, pending: 0 },
  ];
  const byId = new Map(reps.map((r) => [r.id, r]));
  let listedWhere = 'unset';
  stub('../src/config/prisma', db({
    salesRepresentative: {
      findMany: async ({ where } = {}) => { listedWhere = where; return reps; },
      findUnique: async ({ where }) => ({ withdrawalThreshold: null, commissionAdjustment: byId.get(where.id).adjustment, earnsCommission: true }),
    },
    commissionWithdrawal: {
      groupBy: async ({ where }) => {
        const r = byId.get(where.salesRepId);
        return r.pending ? [{ status: 'PENDING', _sum: { amount: r.pending } }] : [];
      },
    },
  }));
  const commission = fresh('../src/services/commission.service');

  const s = await commission.summaryAllReps();
  assert.equal(listedWhere?.isActive, undefined, 'only active reps were read');
  assert.deepEqual(s.items.map((i) => i.salesRepId).sort(), ['r-active', 'r-left-asked', 'r-left-owed']);
  assert.equal(s.items.find((i) => i.salesRepId === 'r-left-owed').isActive, false);
  assert.equal(s.items.find((i) => i.salesRepId === 'r-active').isActive, true);
  // What Finance adds up as "owed to reps": withdrawable balances and requests waiting.
  assert.equal(s.totals.available, 80000);
  assert.equal(s.totals.requested, 30000);
});

// ── #119 bonus tiers ─────────────────────────────────────────────────────────────────────────────────
function loadBonus({ sales = 250000 } = {}) {
  const since = new Date('2026-10-01T00:00:00Z');
  const awards = [];
  let n = 0;
  stub('../src/config/prisma', db({
    bonusRule: {
      findMany: async () => [
        { id: 't1', salesTarget: 100000, bonusAmount: 10000, effectiveFrom: since },
        { id: 't2', salesTarget: 200000, bonusAmount: 25000, effectiveFrom: since },
      ],
    },
    bonusAward: {
      findFirst: async () => null, // nothing paid yet: the run starts at the rules
      create: async ({ data }) => {
        const clash = awards.find((a) => a.salesRepId === data.salesRepId && a.bonusRuleId === data.bonusRuleId
          && a.cycleStart.getTime() === data.cycleStart.getTime());
        if (clash) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: `a${++n}`, ...data };
        awards.push(row);
        await tick(); // the other payment gets in here
        return row;
      },
      count: async ({ where }) => awards.filter((a) => a.salesRepId === where.salesRepId
        && a.cycleStart.getTime() === where.cycleStart.getTime() && a.status === where.status && a.id !== where.id.not).length,
      delete: async ({ where }) => {
        const i = awards.findIndex((a) => a.id === where.id);
        return awards.splice(i, 1)[0];
      },
    },
    sale: { aggregate: async () => ({ _sum: { total: sales } }) },
    salesRepresentative: { findUnique: async () => ({ id: 'r1', user: { id: 'u1' } }) },
  }));
  notified.length = 0;
  return { bonus: fresh('../src/services/bonus.service'), awards };
}

test('a bonus tier switched off since the page loaded is refused, not swapped for another tier', async () => {
  const { bonus, awards } = loadBonus();
  await assert.rejects(bonus.payTier({ salesRepId: 'r1', bonusRuleId: 'retired' }, { id: 'admin' }),
    (e) => e.statusCode === 400 && /not active/i.test(e.message));
  assert.equal(awards.length, 0);
  assert.equal(notified.length, 0);
});

test('the tier asked for is the one paid; with none named, the best one reached', async () => {
  const one = loadBonus();
  const paid = await one.bonus.payTier({ salesRepId: 'r1', bonusRuleId: 't1' }, { id: 'admin' });
  assert.equal(paid.bonusRuleId, 't1');
  assert.equal(paid.bonusAmount, 10000);
  assert.equal(one.awards.length, 1);

  const best = loadBonus();
  assert.equal((await best.bonus.payTier({ salesRepId: 'r1' }, { id: 'admin' })).bonusRuleId, 't2');
});

test('two different tiers paid at the same moment: never two bonuses in one run', async () => {
  const { bonus, awards } = loadBonus();
  const results = await Promise.allSettled([
    bonus.payTier({ salesRepId: 'r1', bonusRuleId: 't1' }, { id: 'a' }),
    bonus.payTier({ salesRepId: 'r1', bonusRuleId: 't2' }, { id: 'b' }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.ok(awards.length <= 1, `${awards.length} bonuses stand in one run`);
  assert.equal(ok.length, awards.length);
  assert.ok(refused.length >= 1);
  refused.forEach((r) => assert.equal(r.reason.statusCode, 409));
  assert.equal(notified.length, awards.length); // nobody is told about a payment that was taken back
});
