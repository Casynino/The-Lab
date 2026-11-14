'use strict';

// ── Bonus in the wallet (owner, 14 Nov 2026) ──────────────────────────────────────────────────────────
// Tiers are totals: 10,000,000 sold → 500,000; 15,000,000 → 1,000,000. Reaching a tier credits the wallet
// (500,000, then another 500,000), once per tier per cycle. The rep withdraws the WHOLE bonus as one BONUS
// request, which ends the cycle; or he keeps selling to 15M first. Commission and bonus never pay for each
// other. A bonus withdrawal waiting freezes the wallet; rejecting it reopens the cycle; paying it starts the
// next cycle from the request. Only the owner pays a bonus. The database is an in-memory one that runs the
// same where-clauses the services send, and transactions run one at a time, as the rep row lock makes them.

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

function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return cond.some((c) => matches(row, c));
    if (k === 'AND') return cond.every((c) => matches(row, c));
    const v = row[k];
    if (cond === null) return v == null;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (cond && typeof cond === 'object') {
      return Object.entries(cond).every(([op, x]) => {
        const t = (d) => (d instanceof Date ? d.getTime() : d);
        if (op === 'in') return x.includes(v);
        if (op === 'not') return x === null ? v != null : v !== x;
        if (op === 'gte') return v != null && t(v) >= t(x);
        if (op === 'gt') return v != null && t(v) > t(x);
        if (op === 'lte') return v != null && t(v) <= t(x);
        if (op === 'lt') return v != null && t(v) < t(x);
        throw new Error(`stub: unsupported ${op}`);
      });
    }
    return v === cond;
  });
}
const sortRows = (rows, orderBy) => {
  if (!orderBy) return rows;
  const [[f, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    const x = a[f] instanceof Date ? a[f].getTime() : Number(a[f]);
    const y = b[f] instanceof Date ? b[f].getTime() : Number(b[f]);
    return (x - y) * (dir === 'desc' ? -1 : 1);
  });
};

const JUL5 = new Date('2026-07-05T09:36:54Z');
const TIERS = [
  { id: 't10', salesTarget: 10000000, bonusAmount: 500000, effectiveFrom: JUL5, isActive: true },
  { id: 't15', salesTarget: 15000000, bonusAmount: 1000000, effectiveFrom: JUL5, isActive: true },
];

// One rep (r1, user u1), commission earned through a manual adjustment (no boxes needed).
function world({ commissionEarned = 300000, tiers = TIERS, legacyPaidAt = null } = {}) {
  const t = {
    rules: tiers.map((r) => ({ ...r })),
    awards: [],
    withdrawals: [],
    sales: [],
    reps: [{ id: 'r1', code: 'R1', isActive: true, commissionAdjustment: commissionEarned, withdrawalThreshold: null, earnsCommission: true, emergencyWindowAt: null, user: { id: 'u1', name: 'Juma' } }],
  };
  if (legacyPaidAt) {
    t.awards.push({ id: 'legacy', salesRepId: 'r1', bonusRuleId: 't10', status: 'PAID', bonusAmount: 500000, qualifyingSales: 10000000, cycleStart: JUL5, unlockedAt: legacyPaidAt, paidAt: legacyPaidAt });
  }
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const ruleOf = (rid) => t.rules.find((r) => r.id === rid);
  const repOf = (rid) => t.reps.find((r) => r.id === rid);
  const withRep = (w) => ({ ...w, salesRep: { ...repOf(w.salesRepId), user: repOf(w.salesRepId).user } });

  const tables = {
    setting: { findMany: async () => [] },
    bonusRule: {
      findMany: async ({ where, orderBy } = {}) => sortRows(t.rules.filter((r) => matches(r, where)), orderBy),
    },
    bonusAward: {
      findMany: async ({ where, orderBy } = {}) => sortRows(t.awards.filter((a) => matches(a, where)), orderBy)
        .map((a) => ({ ...a, bonusRule: { salesTarget: ruleOf(a.bonusRuleId)?.salesTarget } })),
      create: async ({ data }) => {
        if (t.awards.some((a) => a.salesRepId === data.salesRepId && a.bonusRuleId === data.bonusRuleId
          && new Date(a.cycleStart).getTime() === new Date(data.cycleStart).getTime())) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: id('aw'), paidAt: null, ...data };
        t.awards.push(row);
        return row;
      },
    },
    sale: {
      aggregate: async ({ where }) => ({ _sum: { total: t.sales.filter((s) => matches(s, where)).reduce((x, s) => x + s.total, 0) } }),
    },
    saleItem: { aggregate: async () => ({ _sum: { baseQuantity: 0 } }), findMany: async () => [] },
    commissionWithdrawal: {
      findMany: async ({ where, orderBy, include } = {}) => sortRows(t.withdrawals.filter((w) => matches(w, where)), orderBy)
        .map((w) => (include ? withRep(w) : { ...w })),
      findUnique: async ({ where, include }) => {
        const w = t.withdrawals.find((x) => x.id === where.id);
        if (!w) return null;
        return include ? withRep(w) : { ...w };
      },
      create: async ({ data, include }) => {
        const row = { id: id('wd'), status: 'PENDING', source: 'COMMISSION', requestedAt: new Date(), decidedAt: null, paidAt: null, underEmergency: false, ...data };
        t.withdrawals.push(row);
        return include ? withRep(row) : { ...row };
      },
      updateMany: async ({ where, data }) => {
        await tick();
        const hit = t.withdrawals.filter((w) => matches(w, where));
        hit.forEach((w) => Object.assign(w, data));
        return { count: hit.length };
      },
      groupBy: async ({ where }) => {
        const by = new Map();
        t.withdrawals.filter((w) => matches(w, where)).forEach((w) => by.set(w.status, (by.get(w.status) || 0) + w.amount));
        return [...by].map(([status, amount]) => ({ status, _sum: { amount } }));
      },
    },
    salesRepresentative: {
      findUnique: async ({ where, include }) => {
        const r = repOf(where.id);
        if (!r) return null;
        return include ? { ...r } : { ...r };
      },
      findMany: async () => t.reps.map((r) => ({ ...r })),
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
  };
  const empty = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, groupBy: async () => [], aggregate: async () => ({ _sum: {}, _count: 0 }),
  };
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

  const notices = { user: [], admin: [] };
  stub('../src/config/prisma', proxy);
  stub('../src/services/notification.service', {
    notifyUser: async (userId, data) => { notices.user.push({ userId, ...data }); },
    notifyAdmins: async (data) => { notices.admin.push(data); },
    createIfAbsent: async () => {},
  });
  stub('../src/services/penalty.service', { penaltyBreakdownForRep: async () => ({ total: 0, breakdown: [] }) });
  const bonus = fresh('../src/services/bonus.service');
  const commission = fresh('../src/services/commission.service');

  // A settled sale (what a settlement approval creates); `at` defaults to now.
  const sell = (total, at = new Date()) => t.sales.push({ salesRepId: 'r1', total, status: 'PAID', settlementId: 'st1', soldAt: at });
  const ask = (amount, source = 'BONUS') => commission.requestWithdrawal('r1', amount, null, { id: 'u1' }, { source });
  const admin = { id: 'admin', role: 'ADMIN' };
  const staff = { id: 'staff', role: 'WAREHOUSE_STAFF' };
  return { t, bonus, commission, notices, sell, ask, admin, staff };
}

const wallet = async (bonus) => (await bonus.progressForRep('r1')).wallet;
const later = () => new Promise((r) => setTimeout(r, 3)); // the clock moves on between events

test('below 10M: nothing is credited and the wallet holds no bonus', async () => {
  const { t, bonus, commission, sell } = world();
  sell(9999999);
  assert.deepEqual(await bonus.creditMilestones('r1'), []);
  const p = await bonus.progressForRep('r1');
  assert.equal(t.awards.length, 0);
  assert.equal(p.wallet.available, 0);
  assert.equal(p.wallet.ready, false);
  assert.equal(p.next.ruleId, 't10');
  assert.equal(p.remaining, 1);
  const c = await commission.computeForRep('r1');
  const b = await bonus.walletForRep('r1');
  assert.deepEqual(bonus.combine(c, b), { available: c.available, earned: c.earned, paid: c.paid, pending: c.pendingRequests, canWithdraw: c.eligible });
});

test('10M credits 500,000 once, however many times or ways it is asked', async () => {
  const { t, bonus, notices, sell } = world();
  sell(10000000);
  await Promise.all([bonus.creditMilestones('r1'), bonus.creditMilestones('r1'), bonus.progressForRep('r1'), bonus.creditMilestones('r1')]);
  await bonus.creditMilestones('r1');
  assert.equal(t.awards.length, 1);
  assert.equal(t.awards[0].bonusAmount, 500000);
  assert.equal(t.awards[0].status, 'CREDITED');
  const w = await wallet(bonus);
  assert.equal(w.available, 500000);
  assert.equal(w.earned, 500000);
  // Told once — the rep and the owner — tied to the award.
  const told = notices.user.filter((x) => x.whatsapp?.kind === 'BONUS_UNLOCKED');
  assert.equal(told.length, 1);
  assert.equal(told[0].entityId, t.awards[0].id);
  assert.deepEqual(told[0].whatsapp, { kind: 'BONUS_UNLOCKED', amount: 500000, total: 500000, nextTarget: 15000000, nextTotal: 1000000 });
  assert.equal(notices.admin.length, 1);
  assert.equal(notices.admin[0].entityId, t.awards[0].id);
});

test('15M credits another 500,000: 1,000,000 in the cycle, never 1,500,000', async () => {
  const { t, bonus, sell } = world();
  sell(10000000);
  await bonus.creditMilestones('r1');
  sell(5000000);
  await bonus.creditMilestones('r1');
  sell(20000000); // far beyond the top tier: nothing more in this cycle
  await bonus.creditMilestones('r1');
  assert.deepEqual(t.awards.map((a) => a.bonusAmount), [500000, 500000]);
  const w = await wallet(bonus);
  assert.equal(w.available, 1000000);
  assert.deepEqual(w.credits.map((c) => c.target), [10000000, 15000000]);
});

test('one approval from 9M to 16M credits both milestones, 1,000,000 in all', async () => {
  const { t, bonus, notices, sell } = world();
  sell(9000000);
  await bonus.creditMilestones('r1');
  assert.equal(t.awards.length, 0);
  sell(7000000);
  const made = await bonus.creditMilestones('r1');
  assert.deepEqual(made.map((m) => m.amount), [500000, 500000]);
  assert.equal(round(t.awards.reduce((s, a) => s + a.bonusAmount, 0)), 1000000);
  assert.equal(notices.user.filter((x) => x.whatsapp?.kind === 'BONUS_UNLOCKED').length, 2);
  assert.equal((await wallet(bonus)).available, 1000000);
});
const round = (x) => Math.round(x * 100) / 100;

test('a bonus request takes the whole bonus and ends the cycle', async () => {
  const { t, bonus, commission, sell, ask } = world();
  sell(12000000, new Date(Date.now() - 3600000));
  await bonus.creditMilestones('r1');
  const before = await commission.computeForRep('r1');
  const w = await ask(500000);
  assert.equal(w.source, 'BONUS');
  assert.equal(w.amount, 500000);
  assert.equal(w.status, 'PENDING');
  const p = await bonus.progressForRep('r1');
  assert.equal(p.wallet.available, 0);
  assert.equal(p.wallet.pending, 500000);
  assert.equal(p.wallet.frozen, true);
  assert.equal(p.sales, 0, 'his count starts again from zero at the request');
  assert.equal(new Date(p.cycleStart).getTime(), new Date(w.requestedAt).getTime());
  // Commission did not move.
  const after = await commission.computeForRep('r1');
  assert.equal(after.available, before.available);
  assert.equal(after.pendingRequests, before.pendingRequests);
  assert.equal(t.withdrawals.length, 1);
});

test('a stale amount (500,000 when 1,000,000 is in the wallet) is refused with 409 and nothing is written', async () => {
  const { t, bonus, sell, ask } = world();
  sell(15000000);
  await bonus.creditMilestones('r1');
  await assert.rejects(ask(500000), (e) => e.statusCode === 409 && e.message === bonus.BONUS_CHANGED);
  await assert.rejects(ask(1200000), (e) => e.statusCode === 409);
  assert.equal(t.withdrawals.length, 0);
  assert.equal((await ask(1000000)).amount, 1000000);
});

test('part of a bonus cannot be taken: 400, nothing written', async () => {
  const { t, bonus, sell, ask } = world();
  sell(10000000);
  await bonus.creditMilestones('r1');
  await assert.rejects(ask(200000), (e) => e.statusCode === 400 && /withdrawn whole/.test(e.message));
  assert.equal(t.withdrawals.length, 0);
  // With no bonus at all there is nothing to ask for.
  const empty = world();
  await assert.rejects(empty.ask(500000), (e) => e.statusCode === 400 && /no bonus/i.test(e.message));
});

test('two bonus requests at the same moment: exactly one is made', async () => {
  const { t, bonus, sell, ask } = world();
  sell(10000000);
  await bonus.creditMilestones('r1');
  const results = await Promise.allSettled([ask(500000), ask(500000)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.find((r) => r.status === 'rejected');
  assert.equal(refused.reason.statusCode, 409);
  assert.equal(t.withdrawals.filter((w) => w.source === 'BONUS').length, 1);
});

test('while a bonus withdrawal waits, nothing new is credited', async () => {
  const { t, bonus, commission, sell, ask, admin } = world();
  sell(10000000);
  await bonus.creditMilestones('r1');
  const w = await ask(500000);
  await later();
  sell(11000000); // after the request: the next cycle's sales, frozen until it is paid
  assert.deepEqual(await bonus.creditMilestones('r1'), []);
  await commission.decideWithdrawal(w.id, 'APPROVE', admin);
  assert.deepEqual(await bonus.creditMilestones('r1'), []);
  assert.equal(t.awards.length, 1);
  const p = await bonus.progressForRep('r1');
  assert.equal(p.frozen, true);
  assert.equal(p.wallet.available, 0);
});

test('a rejected bonus request reopens the cycle: the bonus is back and the count carries on', async () => {
  const { t, bonus, commission, sell, ask, admin, notices } = world();
  const start = new Date(Date.now() - 86400000);
  sell(10000000, start);
  await bonus.creditMilestones('r1');
  const w = await ask(500000);
  await later();
  sell(6000000); // sold while it waited
  await commission.decideWithdrawal(w.id, 'REJECT', admin);
  const p = await bonus.progressForRep('r1');
  assert.equal(new Date(p.cycleStart).getTime(), JUL5.getTime(), 'counted from the old start again');
  assert.equal(p.sales, 16000000, 'nothing he sold is lost');
  // 16M: the second milestone is credited once the cycle is open again.
  assert.deepEqual(t.awards.map((a) => a.bonusAmount), [500000, 500000]);
  assert.equal(p.wallet.available, 1000000);
  assert.equal(p.wallet.pending, 0);
  assert.equal(p.frozen, false);
  const said = notices.user.find((x) => x.title === 'Bonus withdrawal rejected');
  assert.match(said.message, /back in your wallet/);
  assert.equal(said.whatsapp.source, 'BONUS');
});

test('a paid bonus starts the next cycle from the request; earlier sales never count again', async () => {
  const { t, bonus, commission, sell, ask, admin } = world();
  sell(10000000, new Date(Date.now() - 86400000));
  await bonus.creditMilestones('r1');
  const w = await ask(500000);
  await later();
  sell(4000000); // after the request: the new cycle
  const paid = await commission.decideWithdrawal(w.id, 'PAY', admin);
  assert.equal(paid.status, 'PAID');
  let p = await bonus.progressForRep('r1');
  assert.equal(new Date(p.cycleStart).getTime(), new Date(w.requestedAt).getTime());
  assert.equal(p.sales, 4000000);
  assert.equal(p.wallet.available, 0);
  assert.equal(p.wallet.paid, 500000);
  assert.equal(p.wallet.earned, 500000);
  sell(6000000); // 10M in the new cycle: 500,000 again
  p = await bonus.progressForRep('r1');
  assert.equal(p.wallet.available, 500000);
  assert.equal(t.awards.length, 2);
  assert.ok(new Date(t.awards[1].cycleStart).getTime() >= new Date(w.requestedAt).getTime());
  assert.equal(p.history[0].status, 'PAID');
  assert.deepEqual(p.history[0].credits, [{ amount: 500000, target: 10000000 }]);
});

test('commission cannot be withdrawn beyond commission, even when the bonus makes the card bigger', async () => {
  const { t, bonus, commission, sell, ask } = world({ commissionEarned: 300000 });
  sell(10000000);
  const c = await commission.computeForRep('r1');
  const b = await bonus.walletForRep('r1');
  const card = bonus.combine(c, b);
  assert.equal(card.available, 800000, 'the card shows commission + bonus');
  assert.equal(card.earned, 800000);
  assert.equal(card.canWithdraw, true);
  await assert.rejects(ask(800000, 'COMMISSION'), (e) => e.statusCode === 400 && /exceeds available commission/.test(e.message));
  await assert.rejects(ask(300001, 'COMMISSION'), (e) => e.statusCode === 400);
  const w = await ask(300000, 'COMMISSION');
  assert.equal(w.source, 'COMMISSION');
  // The bonus is untouched by the commission request, and vice versa.
  assert.equal((await bonus.walletForRep('r1')).available, 500000);
  assert.equal((await ask(500000)).source, 'BONUS');
  assert.equal((await commission.computeForRep('r1')).available, 0);
  assert.equal(t.withdrawals.length, 2);
});

test('a bonus has no minimum and needs no window; a rep off commission still gets his bonus', async () => {
  const { t, bonus, commission, sell, ask } = world({ commissionEarned: 0 });
  t.reps[0].earnsCommission = false;
  t.reps[0].withdrawalThreshold = 2000000;
  sell(10000000);
  const c = await commission.computeForRep('r1');
  assert.equal(c.available, 0);
  const b = await bonus.walletForRep('r1');
  assert.equal(bonus.combine(c, b).canWithdraw, true);
  assert.equal((await ask(500000)).amount, 500000);
});

test('only the owner pays a bonus withdrawal; staff may still pay commission', async () => {
  const { t, bonus, commission, sell, ask, admin, staff } = world();
  sell(10000000);
  await bonus.creditMilestones('r1');
  const bw = await ask(500000);
  await assert.rejects(commission.decideWithdrawal(bw.id, 'PAY', staff), (e) => e.statusCode === 403);
  assert.equal(t.withdrawals.find((w) => w.id === bw.id).status, 'PENDING', 'nothing changed');
  await commission.decideWithdrawal(bw.id, 'APPROVE', staff); // approving moves no money
  assert.equal((await commission.decideWithdrawal(bw.id, 'PAY', admin)).status, 'PAID');
  const cw = await ask(300000, 'COMMISSION');
  assert.equal((await commission.decideWithdrawal(cw.id, 'PAY', staff)).status, 'PAID');
});

test('a bonus paid by hand before the wallet starts the cycle and is never withdrawable', async () => {
  const paidAt = new Date('2026-10-01T00:00:00Z');
  const { t, bonus, sell, ask } = world({ legacyPaidAt: paidAt });
  sell(12000000, new Date('2026-09-15T00:00:00Z')); // before the hand payment: already rewarded
  sell(3000000, new Date('2026-10-05T00:00:00Z'));
  const p = await bonus.progressForRep('r1');
  assert.equal(new Date(p.cycleStart).getTime(), paidAt.getTime());
  assert.equal(p.sales, 3000000);
  assert.equal(p.wallet.available, 0);
  assert.equal(p.wallet.legacyPaid, 500000);
  assert.equal(p.wallet.earned, 0, 'wallet figures hold wallet money only');
  assert.equal(t.awards.length, 1);
  await assert.rejects(ask(500000), (e) => e.statusCode === 400);
  const listed = await bonus.listAwards();
  assert.equal(listed[0].state, 'PAID_BEFORE_WALLET');
});

test('every withdrawal from before reads as COMMISSION and commission figures stay exactly as they were', async () => {
  const { t, bonus, commission, sell, admin } = world({ commissionEarned: 400000 });
  // Rows from before the migration carry the column default.
  t.withdrawals.push({ id: 'old1', salesRepId: 'r1', amount: 100000, status: 'PAID', source: 'COMMISSION', requestedAt: new Date('2026-09-01'), paidAt: new Date('2026-09-02'), decidedAt: new Date('2026-09-02') });
  t.withdrawals.push({ id: 'old2', salesRepId: 'r1', amount: 50000, status: 'PENDING', source: 'COMMISSION', requestedAt: new Date('2026-09-03'), paidAt: null, decidedAt: null });
  const before = await commission.computeForRep('r1');
  assert.equal(before.available, 250000);
  sell(15000000);
  const bw = await commission.requestWithdrawal('r1', 1000000, null, { id: 'u1' }, { source: 'BONUS' });
  await commission.decideWithdrawal(bw.id, 'PAY', admin);
  const after = await commission.computeForRep('r1');
  for (const k of ['earned', 'paid', 'pending', 'pendingRequests', 'penalties', 'available', 'eligible']) {
    assert.deepEqual(after[k], before[k], `commission ${k} moved`);
  }
  assert.deepEqual(after.run.lastPayout, before.run.lastPayout, 'a bonus payout does not close a commission run');
  // The old default: a request with no source is commission.
  const w = await commission.requestWithdrawal('r1', 250000, null, { id: 'u1' });
  assert.equal(w.source, 'COMMISSION');
  assert.equal((await bonus.walletForRep('r1')).paid, 1000000);
});

test('award states for the admin: in the wallet, requested, paid', async () => {
  const { bonus, sell, ask, commission, admin } = world();
  // Sold before he asks (as in life: a sale is approved before the bonus it unlocks is withdrawn). Sold "now",
  // it could share the request's millisecond and count in the next cycle too, crediting a second award.
  sell(10000000, new Date(Date.now() - 3600000));
  await bonus.creditMilestones('r1');
  assert.equal((await bonus.listAwards())[0].state, 'IN_WALLET');
  const w = await ask(500000);
  let a = (await bonus.listAwards())[0];
  assert.equal(a.state, 'REQUESTED');
  assert.equal(a.withdrawal.id, w.id);
  await commission.decideWithdrawal(w.id, 'PAY', admin);
  a = (await bonus.listAwards())[0];
  assert.equal(a.state, 'PAID');
  const s = await bonus.summaryAllReps();
  assert.equal(s.items[0].wallet.paid, 500000);
  assert.equal(s.items[0].history, undefined, 'the admin list stays light');
});

// ── The HTTP edge ─────────────────────────────────────────────────────────────────────────────────────
const run = (handler, req) => new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code || 200, body: b }); } };
  handler(req, res, (err) => resolve({ error: err }));
});

test('the old "pay a bonus" endpoint is gone (410); an admin asking for "my bonus" is refused, not shown every rep', async () => {
  world();
  stub('../src/services/audit.service', { record: async () => {} });
  stub('../src/services/finance.service', { recordCommissionPayment: async () => null });
  const ctrl = fresh('../src/controllers/commissions.controller');
  const gone = await run(ctrl.payBonusAward, { user: { id: 'admin', role: 'ADMIN' }, body: { salesRepId: 'r1' } });
  assert.equal(gone.error.statusCode, 410);
  const mine = await run(ctrl.bonusMe, { user: { id: 'admin', role: 'ADMIN', salesRepId: null } });
  assert.equal(mine.error.statusCode, 403);
  const { progressForRep } = require('../src/services/bonus.service');
  assert.equal((await progressForRep(undefined)).configured, false);
});

test('GET /commissions/me keeps every commission field and adds bonus + combined', async () => {
  const { commission, sell } = world({ commissionEarned: 300000 });
  sell(10000000);
  stub('../src/services/audit.service', { record: async () => {} });
  stub('../src/services/finance.service', { recordCommissionPayment: async () => null });
  const ctrl = fresh('../src/controllers/commissions.controller');
  const c = await commission.computeForRep('r1');
  const out = await run(ctrl.me, { user: { id: 'u1', role: 'SALES_REP', salesRepId: 'r1' } });
  const d = out.body.data;
  for (const k of ['available', 'earned', 'paid', 'pending', 'pendingRequests', 'penalties', 'eligible', 'minWithdrawal']) {
    assert.deepEqual(d[k], c[k], k);
  }
  assert.equal(d.bonus.available, 500000);
  assert.equal(d.bonus.ready, true);
  assert.deepEqual(d.combined, { available: 800000, earned: 800000, paid: 0, pending: 0, canWithdraw: true });
});

test('the request body: source defaults to COMMISSION; anything else is refused', () => {
  const { withdrawRequest, withdrawalQuery } = require('../src/validators/phase2.validator');
  assert.equal(withdrawRequest.body.parse({ amount: 1000 }).source, 'COMMISSION');
  assert.equal(withdrawRequest.body.parse({ amount: '500000', source: 'BONUS' }).source, 'BONUS');
  assert.throws(() => withdrawRequest.body.parse({ amount: 1000, source: 'SAVINGS' }));
  assert.equal(withdrawalQuery.query.parse({ source: 'BONUS' }).source, 'BONUS');
});

test('the rep is told in plain words: BONUS ADDED, and a bonus withdrawal named as one', () => {
  const wt = require('../src/services/whatsappText');
  assert.equal(
    wt.repText({ kind: 'BONUS_UNLOCKED', amount: 500000, total: 500000, nextTarget: 15000000, nextTotal: 1000000 }),
    '*BONUS ADDED*\n\nTSh 500,000 is in your wallet.\n\nWithdraw it now, or keep selling to TSh 15,000,000 for TSh 1,000,000 in total. Withdrawing starts your bonus count again from zero.\n\nZELab',
  );
  assert.equal(
    wt.repText({ kind: 'BONUS_UNLOCKED', amount: 500000, total: 1000000, nextTarget: null }),
    '*BONUS ADDED*\n\nTSh 500,000 more is in your wallet. Your bonus is now TSh 1,000,000.\n\nWithdraw it whenever you are ready. Withdrawing starts your bonus count again from zero.\n\nZELab',
  );
  assert.match(wt.repText({ kind: 'WITHDRAWAL_PAID', amount: 1000000, source: 'BONUS' }), /^\*BONUS PAID\*/);
  assert.match(wt.repText({ kind: 'WITHDRAWAL_PAID', amount: 5000 }), /^\*COMMISSION PAID\*/);
  assert.match(wt.repText({ kind: 'WITHDRAWAL_REQUESTED', amount: 5000 }), /^\*WITHDRAWAL REQUESTED\*/);
});

test('a commission deficit never eats a ready bonus on the card; with no bonus the deficit shows as before', async () => {
  const { bonus } = world();
  const c = { available: -6500, earned: 100000, paid: 90000, pendingRequests: 0, eligible: false };
  const ready = { available: 500000, earned: 500000, paid: 0, pending: 0 };
  const none = { available: 0, earned: 0, paid: 0, pending: 0 };
  assert.equal(bonus.combine(c, ready).available, 500000, 'the card shows what he can take: the bonus');
  assert.equal(bonus.combine(c, ready).canWithdraw, true);
  assert.equal(bonus.combine(c, none).available, -6500, 'no bonus: the commission figure exactly');
  assert.equal(bonus.combine(c, { ...none, pending: 500000, earned: 500000 }).available, -6500, 'a bonus asked for is not in the balance');
  assert.equal(bonus.combine({ ...c, available: 300000 }, ready).available, 800000);
});
