'use strict';

// Sales performance bonus, kept in the rep's wallet (owner, 14 Nov 2026).
//
// TIERS are BonusRule rows whose bonusAmount is a TOTAL for the cycle: sell 10,000,000 → 500,000; sell
// 15,000,000 → 1,000,000. A BONUS CYCLE counts the rep's qualifying sales from its start. When a tier is
// reached, the difference between its total and what the cycle has already been credited goes into the
// wallet as a CREDITED BonusAward — 500,000 at 10M, another 500,000 at 15M — once per tier per cycle, under
// the rep's row lock. A cycle never holds more than the top tier reached (1,000,000, never 1,500,000).
//
// The rep chooses. He can withdraw the bonus now: ONE request for the WHOLE bonus credited in the cycle,
// through the ordinary withdrawal workflow with source BONUS, and asking for it ENDS the cycle — his count
// starts again from zero from that moment, so the extra 500,000 of that cycle is gone. Or he keeps selling
// to the next tier first. Commission and bonus are separate pots: each is reduced on its own and never
// pays for the other. Fines never touch the bonus; a sale cancelled after a credit does not take it back.
//
// Nothing about the cycle is stored; it is read from the data:
//   - its start is the request time of the latest BONUS withdrawal that was not REJECTED (asking ends the
//     cycle; a rejection reopens it as if it had never been asked: the bonus is back and the count
//     carries on from the old start),
//   - else the time of the latest bonus paid by hand before the wallet existed (legacy PAID BonusAward,
//     closed history, never withdrawable),
//   - else nothing, and each tier counts from its own effectiveFrom.
// Each tier counts from max(its effectiveFrom, the cycle start), as before (audit money-flows-1).
// While a BONUS withdrawal is PENDING or APPROVED the wallet is FROZEN: no milestone is credited until it
// is paid (the next cycle then counts from the request) or rejected (the old cycle carries on).

const prisma = require('./../config/prisma');
const ApiError = require('../utils/ApiError');
const notification = require('./notification.service');
const { round2, toNumber, formatCurrency } = require('../utils/money');

const CREDITED = 'CREDITED';
const LEGACY_PAID = 'PAID';
const WAITING = ['PENDING', 'APPROVED'];
// A stale screen (the bonus grew, or was already asked for, since it was loaded) is told this and nothing
// is written, so it can never take the wrong amount.
const BONUS_CHANGED = 'Your bonus changed — check it again';

const ms = (d) => (d ? new Date(d).getTime() : null);
const latest = (dates) => {
  const t = dates.filter(Boolean).map(ms);
  return t.length ? new Date(Math.max(...t)) : null;
};
const total = (rows, pick) => round2(rows.reduce((s, r) => s + toNumber(pick(r)), 0));

// Every tier currently in play, cheapest target first. Several active rules are several tiers.
async function activeTiers(at = new Date(), db = prisma) {
  return db.bonusRule.findMany({
    where: { isActive: true, effectiveFrom: { lte: new Date(at) } },
    orderBy: { salesTarget: 'asc' },
  });
}

// Kept for callers that just want "is a bonus configured".
async function activeRule(at = new Date()) {
  const tiers = await activeTiers(at);
  return tiers[0] || null;
}

// Sales that count toward a target: revenue the rep actually brought in, measured the same way commission
// is — money from settled boxes — counted from `since`. Cancelled sales never count. Without a rep there is
// nothing to count (an admin calling a rep's endpoint used to sum every rep's sales).
async function qualifyingSales(salesRepId, since, db = prisma) {
  if (!salesRepId) return 0;
  const agg = await db.sale.aggregate({
    where: {
      salesRepId,
      status: { not: 'CANCELLED' },
      settlementId: { not: null },
      soldAt: { gte: new Date(since) },
    },
    _sum: { total: true },
  });
  return round2(toNumber(agg._sum.total));
}

// Inside a transaction the reads go one after another on its connection; outside it, at the same time.
async function both(db, fns) {
  if (db === prisma) return Promise.all(fns.map((f) => f()));
  const out = [];
  for (const f of fns) out.push(await f());
  return out;
}

// The facts a rep's bonus is worked out from.
async function readState(salesRepId, db = prisma) {
  const [tiers, withdrawals, awards] = await both(db, [
    () => activeTiers(new Date(), db),
    () => db.commissionWithdrawal.findMany({
      where: { salesRepId, source: 'BONUS' },
      select: { id: true, amount: true, status: true, requestedAt: true, decidedAt: true, paidAt: true },
      orderBy: { requestedAt: 'asc' },
    }),
    () => db.bonusAward.findMany({
      where: { salesRepId, status: { in: [CREDITED, LEGACY_PAID] } },
      select: {
        id: true, bonusRuleId: true, bonusAmount: true, status: true, cycleStart: true, unlockedAt: true,
        paidAt: true, qualifyingSales: true, bonusRule: { select: { salesTarget: true } },
      },
      orderBy: { unlockedAt: 'asc' },
    }),
  ]);
  return { tiers: tiers || [], withdrawals: withdrawals || [], awards: awards || [] };
}

// Where the open cycle starts, and whether a bonus withdrawal is waiting (frozen).
function cycleOf({ withdrawals, awards }) {
  const asked = withdrawals.filter((w) => w.status !== 'REJECTED').map((w) => w.requestedAt);
  const legacy = awards.filter((a) => a.status === LEGACY_PAID).map((a) => a.paidAt);
  const lastAsked = latest(asked);
  const lastLegacy = latest(legacy);
  const waiting = withdrawals.filter((w) => WAITING.includes(w.status));
  return {
    boundary: latest([lastAsked, lastLegacy]),
    lastLegacyPaidAt: lastLegacy,
    waiting: waiting.length ? waiting[waiting.length - 1] : null,
    frozen: waiting.length > 0,
  };
}

// The bonus wallet. Only CREDITED awards are wallet money; legacy PAID awards were paid by hand outside it
// and stay history. available = credited in the open cycle, which is always earned − paid − pending (the
// smaller of the two is used, so a broken row can never let more out than was put in).
function walletOf(state, cyc) {
  const credited = state.awards.filter((a) => a.status === CREDITED);
  const legacy = state.awards.filter((a) => a.status === LEGACY_PAID);
  const earned = total(credited, (a) => a.bonusAmount);
  const paid = total(state.withdrawals.filter((w) => w.status === 'PAID'), (w) => w.amount);
  const pending = total(state.withdrawals.filter((w) => WAITING.includes(w.status)), (w) => w.amount);
  const open = credited.filter((a) => !cyc.boundary || ms(a.cycleStart) >= ms(cyc.boundary));
  const openSum = total(open, (a) => a.bonusAmount);
  const available = round2(Math.max(0, Math.min(openSum, round2(earned - paid - pending))));
  return {
    available,
    ready: available > 0,
    earned,
    paid,
    pending,
    frozen: cyc.frozen,
    waiting: cyc.waiting
      ? { id: cyc.waiting.id, amount: round2(toNumber(cyc.waiting.amount)), status: cyc.waiting.status, requestedAt: cyc.waiting.requestedAt }
      : null,
    // What `available` is made of, oldest first.
    credits: open.map((a) => ({
      id: a.id,
      ruleId: a.bonusRuleId,
      amount: round2(toNumber(a.bonusAmount)),
      target: a.bonusRule ? toNumber(a.bonusRule.salesTarget) : null,
      sales: round2(toNumber(a.qualifyingSales)),
      creditedAt: a.unlockedAt,
    })),
    legacyPaid: total(legacy, (a) => a.bonusAmount),
    legacyCount: legacy.length,
  };
}

const emptyWallet = () => ({
  available: 0, ready: false, earned: 0, paid: 0, pending: 0, frozen: false, waiting: null,
  credits: [], legacyPaid: 0, legacyCount: 0,
});

// Every bonus withdrawal, newest first, each with the credits it took (a rejected one took none).
function historyOf(state, limit = 24) {
  const live = state.withdrawals.filter((w) => w.status !== 'REJECTED');
  const credited = state.awards.filter((a) => a.status === CREDITED);
  const tookBy = new Map();
  for (const a of credited) {
    const w = live.find((x) => ms(x.requestedAt) > ms(a.cycleStart));
    if (!w) continue;
    if (!tookBy.has(w.id)) tookBy.set(w.id, []);
    tookBy.get(w.id).push({ amount: round2(toNumber(a.bonusAmount)), target: a.bonusRule ? toNumber(a.bonusRule.salesTarget) : null });
  }
  return state.withdrawals.slice().reverse().slice(0, limit).map((w) => ({
    id: w.id,
    amount: round2(toNumber(w.amount)),
    status: w.status,
    requestedAt: w.requestedAt,
    decidedAt: w.decidedAt,
    paidAt: w.paidAt,
    credits: tookBy.get(w.id) || [],
  }));
}

// Progress, wallet and what is due to be credited, from the facts read.
async function evaluate(salesRepId, state, db = prisma) {
  const cyc = cycleOf(state);
  const wallet = walletOf(state, cyc);
  const history = historyOf(state);
  const tiers = state.tiers;
  if (!tiers.length) {
    return {
      due: [],
      progress: { configured: false, cycleStart: cyc.boundary, lastPaidAt: cyc.boundary, frozen: cyc.frozen, wallet, history },
    };
  }

  const starts = tiers.map((t) => {
    const own = new Date(t.effectiveFrom);
    return cyc.boundary && cyc.boundary > own ? new Date(cyc.boundary) : own;
  });
  const cycleStart = new Date(Math.min(...starts.map((d) => d.getTime())));
  const keys = [...new Set([cycleStart, ...starts].map((d) => d.getTime()))];
  const counted = await both(db, keys.map((k) => () => qualifyingSales(salesRepId, new Date(k), db)));
  const salesFrom = new Map(keys.map((k, i) => [k, counted[i]]));
  const sales = salesFrom.get(cycleStart.getTime());

  const creditedRules = new Set(wallet.credits.map((c) => c.ruleId));
  const shaped = tiers.map((t, i) => {
    const target = toNumber(t.salesTarget);
    const own = salesFrom.get(starts[i].getTime());
    return {
      ruleId: t.id,
      target,
      // The tier's TOTAL for a cycle (what the cycle holds once it is reached), not the increment.
      bonusAmount: toNumber(t.bonusAmount),
      since: starts[i],
      sales: own,
      reached: own >= target,
      credited: creditedRules.has(t.id),
      progress: target > 0 ? Math.min(100, Math.round((own / target) * 100)) : 0,
      remaining: Math.max(0, round2(target - own)),
    };
  });

  // Milestones reached and not yet credited in this cycle, cheapest target first; each one adds what its
  // total is above what the cycle already holds, so the cycle adds up to the top tier reached and no more.
  const due = [];
  if (!cyc.frozen) {
    let held = round2(wallet.credits.reduce((s, c) => s + c.amount, 0));
    for (const t of shaped) {
      if (!t.reached || t.credited) continue;
      const amount = round2(t.bonusAmount - held);
      if (!(amount > 0)) continue;
      held = round2(held + amount);
      due.push({ tier: t, amount, totalAfter: held });
    }
  }

  const reached = shaped.filter((t) => t.reached);
  // The best tier reached, and the one still worth chasing: the nearest tier not reached that holds more.
  const claimable = reached.length ? reached[reached.length - 1] : null;
  const ahead = shaped.filter((t) => !t.reached && (!claimable || t.bonusAmount > claimable.bonusAmount));
  const next = ahead.length ? ahead.reduce((a, b) => (b.remaining < a.remaining ? b : a)) : null;
  // The bar tracks the next tier while one remains, then the top tier once every target is behind them.
  const bar = next || shaped[shaped.length - 1];

  return {
    due,
    progress: {
      configured: true,
      cycleStart,
      // When the current count started because a bonus was asked for (or paid by hand before the wallet).
      lastPaidAt: cyc.boundary,
      frozen: cyc.frozen,
      sales,
      tiers: shaped,
      claimable,
      next,
      target: bar.target,
      bonusAmount: bar.bonusAmount,
      progress: bar.progress,
      remaining: bar.remaining,
      unlocked: Boolean(claimable),
      wallet,
      history,
    },
  };
}

// Credit every milestone due in the rep's open cycle. Runs inside the caller's transaction, which must hold
// the rep's row lock (SELECT … FOR UPDATE on sales_representatives), so two calls can never both credit the
// same milestone; the unique (rep, tier, cycleStart) key is the second guard. Returns what was credited.
async function creditMilestonesTx(tx, salesRepId) {
  const state = await readState(salesRepId, tx);
  const { due, progress } = await evaluate(salesRepId, state, tx);
  if (!due.length) return [];
  const now = new Date();
  const created = [];
  for (const d of due) {
    const award = await tx.bonusAward.create({
      data: {
        salesRepId,
        bonusRuleId: d.tier.ruleId,
        cycleStart: d.tier.since,
        qualifyingSales: d.tier.sales,
        bonusAmount: d.amount,
        status: CREDITED,
        unlockedAt: now,
      },
    });
    created.push({ award, amount: d.amount, total: d.totalAfter, target: d.tier.target });
  }
  // What he can still aim at in this cycle, for the notice.
  const held = created[created.length - 1].total;
  const ahead = progress.tiers.filter((t) => !t.reached && t.bonusAmount > held);
  const next = ahead.length ? ahead.reduce((a, b) => (b.remaining < a.remaining ? b : a)) : null;
  return created.map((c) => ({ ...c, next: next ? { target: next.target, total: next.bonusAmount } : null }));
}

// Tell the rep and the owner, once per credited milestone: the notice is tied to the award row, which is
// written once. Called only after the transaction that wrote the awards has committed.
async function announce(salesRepId, created) {
  if (!created || !created.length) return;
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  }).catch(() => null);
  const name = rep?.user?.name || rep?.code || 'A rep';
  for (const c of created) {
    const more = c.total > c.amount;
    const what = c.next
      ? `Withdraw it now, or keep selling to ${formatCurrency(c.next.target)} for ${formatCurrency(c.next.total)} in total.`
      : 'Withdraw it whenever you are ready.';
    notification.notifyUser(rep?.user?.id, {
      type: 'GENERAL',
      severity: 'INFO',
      title: `Bonus added — ${formatCurrency(c.amount)}`,
      message: `${formatCurrency(c.amount)}${more ? ' more' : ''} is in your wallet${more ? ` — ${formatCurrency(c.total)} bonus in all` : ''}. ${what} Withdrawing starts your bonus count again from zero.`,
      whatsapp: {
        kind: 'BONUS_UNLOCKED',
        amount: c.amount,
        total: c.total,
        nextTarget: c.next ? c.next.target : null,
        nextTotal: c.next ? c.next.total : null,
      },
      entityType: 'BonusAward',
      entityId: c.award.id,
    }).catch(() => {});
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Sales bonus added',
      message: `${name} reached ${formatCurrency(c.target)} in sales. ${formatCurrency(c.amount)} bonus went into their wallet (${formatCurrency(c.total)} this bonus cycle).`,
      entityType: 'BonusAward',
      entityId: c.award.id,
    }).catch(() => {});
  }
}

// Credit what is due, under the rep's row lock (the same lock a withdrawal request takes), then tell them.
// Called after every settlement approval, after a bonus withdrawal is rejected or paid, and by a read that
// finds a milestone not yet credited. Safe to call any number of times: a milestone is credited once.
async function creditMilestones(salesRepId) {
  if (!salesRepId) return [];
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "sales_representatives" WHERE id = ${salesRepId} FOR UPDATE`;
    return creditMilestonesTx(tx, salesRepId);
  }, { maxWait: 10_000, timeout: 20_000 });
  await announce(salesRepId, created);
  return created;
}

// Where a rep stands: the cycle's progress per tier, the bonus wallet and the bonus withdrawals. A milestone
// reached but not yet credited (the approval's own credit did not run) is credited here first, so what the
// rep sees is always what he can withdraw.
async function progressForRep(salesRepId, { heal = true } = {}) {
  if (!salesRepId) return { configured: false, cycleStart: null, lastPaidAt: null, frozen: false, wallet: emptyWallet(), history: [] };
  let { due, progress } = await evaluate(salesRepId, await readState(salesRepId));
  if (heal && due.length) {
    try {
      await creditMilestones(salesRepId);
      ({ progress } = await evaluate(salesRepId, await readState(salesRepId)));
    } catch {
      // Shown as it stands; the next approval or read credits it.
    }
  }
  return progress;
}

// The bonus part of a wallet, as GET /commissions/me and the admin rep view carry it.
async function walletForRep(salesRepId) {
  const p = await progressForRep(salesRepId);
  return {
    configured: Boolean(p.configured),
    ...p.wallet,
    cycleStart: p.cycleStart || null,
  };
}

// The card's figures, commission and bonus together (owner: the balance is "mixed" while a bonus is ready;
// they are still withdrawn separately). Each total is commission + bonus, so the card still adds up:
// available = earned − paid − pending − fines. `canWithdraw` = either pot can be withdrawn now.
// The two pots never borrow from each other and fines never reduce the bonus, so while a bonus is ready a
// commission deficit counts as 0 here (the bonus is what he can take); with no bonus ready the balance is
// the commission figure exactly as before, negative included.
function combine(c, b) {
  const ca = toNumber(c.available);
  return {
    available: round2((b.available > 0 ? Math.max(0, ca) : ca) + b.available),
    earned: round2(toNumber(c.earned) + b.earned),
    paid: round2(toNumber(c.paid) + b.paid),
    pending: round2(toNumber(c.pendingRequests) + b.pending),
    canWithdraw: Boolean(c.eligible) || b.available > 0,
  };
}

// A BONUS withdrawal request: ONE request for the WHOLE bonus credited in the open cycle. Runs inside the
// requester's transaction, after the rep's row lock. Anything due is credited first, so the amount is
// checked against what the wallet really holds; a different amount is refused and nothing is written.
async function requestBonusTx(tx, salesRepId, amt, notes, include) {
  const credited = await creditMilestonesTx(tx, salesRepId);
  const state = await readState(salesRepId, tx);
  const w = walletOf(state, cycleOf(state));
  const whole = w.available;
  if (!(whole > 0)) {
    // Asked for already (another tap, another phone): the screen is stale.
    if (w.pending > 0) throw ApiError.conflict(BONUS_CHANGED);
    throw ApiError.badRequest('You have no bonus ready to withdraw yet.');
  }
  if (Math.abs(amt - whole) > 0.005) {
    // An amount the wallet held earlier in this cycle (500,000 before the second milestone) or more than it
    // holds is a stale screen; any other amount is an attempt to split it.
    const before = [];
    let run = 0;
    for (const c of w.credits) {
      run = round2(run + c.amount);
      if (run < whole) before.push(run);
    }
    if (amt > whole || before.some((v) => Math.abs(v - amt) < 0.005)) throw ApiError.conflict(BONUS_CHANGED);
    throw ApiError.badRequest(`A bonus is withdrawn whole: ${formatCurrency(whole)}. It cannot be split.`);
  }
  const withdrawal = await tx.commissionWithdrawal.create({
    data: {
      salesRepId,
      amount: whole,
      notes: notes || null,
      status: 'PENDING',
      source: 'BONUS',
      // The moment the cycle ends: the next cycle counts sales from here.
      requestedAt: new Date(),
    },
    ...(include ? { include } : {}),
  });
  return { withdrawal, credited };
}

// Progress and wallet for every rep — the admin view. Active reps, plus a deactivated rep only while bonus
// money is still in play for them.
async function summaryAllReps({ heal = true } = {}) {
  const reps = await prisma.salesRepresentative.findMany({
    include: { user: { select: { name: true } } },
  });
  // All reps at once, not one after another; rows keep the reps' order. `heal: false` (Finance) only reads.
  const progress = await Promise.all(reps.map((rep) => progressForRep(rep.id, { heal })));
  const items = [];
  reps.forEach((rep, i) => {
    const { history, ...p } = progress[i]; // eslint-disable-line no-unused-vars
    const w = p.wallet || emptyWallet();
    const isActive = rep.isActive !== false;
    if (!isActive && !(w.available > 0 || w.pending > 0)) return;
    items.push({ salesRepId: rep.id, code: rep.code, name: rep.user?.name || rep.code, isActive, ...p });
  });
  items.sort((a, b) => (b.sales || 0) - (a.sales || 0));
  const add = (k) => round2(items.reduce((s, i) => s + ((i.wallet && i.wallet[k]) || 0), 0));
  return {
    items,
    totals: { available: add('available'), pending: add('pending'), paid: add('paid'), earned: add('earned'), legacyPaid: add('legacyPaid') },
  };
}

// Bonuses paid by hand before the wallet existed, newest first, for the rep's own Bonus tab (audit
// money-flows-10). Closed history: never withdrawable.
async function paidAwardsForRep(salesRepId, limit = 24) {
  if (!salesRepId) return [];
  const rows = await prisma.bonusAward.findMany({
    where: { salesRepId, status: 'PAID' },
    orderBy: { paidAt: 'desc' },
    take: limit,
    select: { id: true, bonusAmount: true, paidAt: true, bonusRule: { select: { salesTarget: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: toNumber(r.bonusAmount),
    paidAt: r.paidAt,
    target: r.bonusRule ? toNumber(r.bonusRule.salesTarget) : null,
  }));
}

// ── Rules (admin) ────────────────────────────────────────────────────────────

async function listRules() {
  return prisma.bonusRule.findMany({
    include: { createdBy: { select: { name: true } }, _count: { select: { awards: true } } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

async function createRule({ salesTarget, bonusAmount, effectiveFrom, isActive = true, note }, actor) {
  const target = round2(salesTarget);
  const amount = round2(bonusAmount);
  if (!(target > 0)) throw ApiError.badRequest('Sales target must be greater than zero');
  if (!(amount > 0)) throw ApiError.badRequest('Bonus amount must be greater than zero');
  const from = effectiveFrom ? new Date(effectiveFrom) : new Date();
  if (Number.isNaN(from.getTime())) throw ApiError.badRequest('Enter a valid start date');

  return prisma.bonusRule.create({
    data: {
      salesTarget: target,
      bonusAmount: amount,
      effectiveFrom: from,
      isActive: Boolean(isActive),
      note: note || null,
      createdById: actor?.id || null,
    },
  });
}

// Change a rule's figures or its start date — but only while nothing has been
// awarded under it. Once a rep has been told they earned a bonus, the target
// and amount behind it are a matter of record, and the way to change the deal
// is a new rule rather than an edit to the old one.
async function updateRule(id, { salesTarget, bonusAmount, effectiveFrom, note }, actor) {
  const rule = await prisma.bonusRule.findUnique({
    where: { id },
    include: { _count: { select: { awards: true } } },
  });
  if (!rule) throw ApiError.notFound('Bonus rule not found');
  if (rule._count.awards > 0) {
    throw ApiError.badRequest(
      `${rule._count.awards} rep(s) have already earned this bonus, so its figures are fixed. Add a new rule for the new terms and switch this one off.`,
    );
  }

  const data = {};
  if (salesTarget != null) {
    const t = round2(salesTarget);
    if (!(t > 0)) throw ApiError.badRequest('Sales target must be greater than zero');
    data.salesTarget = t;
  }
  if (bonusAmount != null) {
    const a = round2(bonusAmount);
    if (!(a > 0)) throw ApiError.badRequest('Bonus amount must be greater than zero');
    data.bonusAmount = a;
  }
  if (effectiveFrom != null) {
    const from = new Date(effectiveFrom);
    if (Number.isNaN(from.getTime())) throw ApiError.badRequest('Enter a valid start date');
    data.effectiveFrom = from;
  }
  if (note !== undefined) data.note = note || null;
  if (!Object.keys(data).length) return rule;

  return prisma.bonusRule.update({ where: { id }, data });
}

async function setRuleActive(id, isActive) {
  const rule = await prisma.bonusRule.findUnique({ where: { id } });
  if (!rule) throw ApiError.notFound('Bonus rule not found');
  return prisma.bonusRule.update({ where: { id }, data: { isActive: Boolean(isActive) } });
}

// Every award, newest first, with where its money is now:
//   IN_WALLET          credited in the rep's open cycle, withdrawable
//   REQUESTED          its cycle was ended by a bonus withdrawal still waiting (PENDING / APPROVED)
//   PAID               its cycle's bonus withdrawal was paid
//   PAID_BEFORE_WALLET paid by hand before 14 Nov 2026 (legacy), closed history
// `withdrawal` is the bonus withdrawal that took it, if any.
async function listAwards({ status } = {}) {
  const rows = await prisma.bonusAward.findMany({
    where: status ? { status } : {},
    include: {
      salesRep: { include: { user: { select: { name: true } } } },
      bonusRule: { select: { salesTarget: true, bonusAmount: true } },
    },
    orderBy: { unlockedAt: 'desc' },
  });
  const repIds = [...new Set(rows.filter((r) => r.status === CREDITED).map((r) => r.salesRepId))];
  const taken = repIds.length
    ? await prisma.commissionWithdrawal.findMany({
      where: { salesRepId: { in: repIds }, source: 'BONUS', status: { not: 'REJECTED' } },
      select: { id: true, salesRepId: true, amount: true, status: true, requestedAt: true, paidAt: true },
      orderBy: { requestedAt: 'asc' },
    })
    : [];
  return rows.map((r) => {
    if (r.status !== CREDITED) {
      return { ...r, state: r.status === LEGACY_PAID ? 'PAID_BEFORE_WALLET' : r.status, withdrawal: null };
    }
    const w = taken.find((x) => x.salesRepId === r.salesRepId && ms(x.requestedAt) > ms(r.cycleStart)) || null;
    const state = !w ? 'IN_WALLET' : w.status === 'PAID' ? 'PAID' : 'REQUESTED';
    return {
      ...r,
      state,
      withdrawal: w ? { id: w.id, amount: round2(toNumber(w.amount)), status: w.status, requestedAt: w.requestedAt, paidAt: w.paidAt } : null,
    };
  });
}

module.exports = {
  BONUS_CHANGED,
  activeRule,
  activeTiers,
  qualifyingSales,
  progressForRep,
  walletForRep,
  combine,
  creditMilestones,
  creditMilestonesTx,
  // The old name, for anything still calling it after a settlement approval.
  checkAndAward: creditMilestones,
  announce,
  requestBonusTx,
  paidAwardsForRep,
  summaryAllReps,
  listRules,
  createRule,
  updateRule,
  setRuleActive,
  listAwards,
};
