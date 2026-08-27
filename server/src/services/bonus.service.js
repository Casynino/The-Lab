'use strict';

// Sales performance bonus.
//
// Deliberately separate from commission. Commission is earned per settled box
// at the brand's rate; a bonus is earned once, for reaching a sales target. The
// two never mix: bonus money is not added into a rep's commission balance, is
// not withdrawable through the commission flow, and does not change what any
// box is worth. Keeping them apart is what stops a target being hit from
// quietly re-pricing settled work.

const prisma = require('./../config/prisma');
const ApiError = require('../utils/ApiError');
const notification = require('./notification.service');
const { round2, toNumber, formatCurrency } = require('../utils/money');

// Every tier currently in play, cheapest target first. Several active rules are
// several tiers — reaching a lower one does not end the run.
async function activeTiers(at = new Date()) {
  return prisma.bonusRule.findMany({
    where: { isActive: true, effectiveFrom: { lte: new Date(at) } },
    orderBy: { salesTarget: 'asc' },
  });
}

// Kept for callers that just want "is a bonus configured".
async function activeRule(at = new Date()) {
  const tiers = await activeTiers(at);
  return tiers[0] || null;
}

// When this rep's current run started. Taking a bonus ends the run and starts a
// new one from the moment it was paid, so the counter goes back to zero and the
// same tiers can be earned again.
async function cycleStartFor(salesRepId, tiers) {
  const lastPaid = await prisma.bonusAward.findFirst({
    where: { salesRepId, status: 'PAID' },
    orderBy: { paidAt: 'desc' },
    select: { paidAt: true },
  });
  const ruleStart = tiers.length
    ? new Date(Math.min(...tiers.map((t) => new Date(t.effectiveFrom).getTime())))
    : new Date();
  if (lastPaid?.paidAt && new Date(lastPaid.paidAt) > ruleStart) return new Date(lastPaid.paidAt);
  return ruleStart;
}

// Sales that count toward a target: revenue the rep actually brought in,
// measured the same way commission is — money from settled boxes — counted from
// the start of their current run. Cancelled sales never count.
async function qualifyingSales(salesRepId, since) {
  const agg = await prisma.sale.aggregate({
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

// Where a rep stands in their current run. Safe to call for a rep with no tiers
// configured — it simply reports there is nothing to chase.
async function progressForRep(salesRepId) {
  const tiers = await activeTiers();
  if (!tiers.length) return { configured: false };

  const cycleStart = await cycleStartFor(salesRepId, tiers);
  const sales = await qualifyingSales(salesRepId, cycleStart);

  const shaped = tiers.map((t) => {
    const target = toNumber(t.salesTarget);
    return {
      ruleId: t.id,
      target,
      bonusAmount: toNumber(t.bonusAmount),
      reached: sales >= target,
      progress: target > 0 ? Math.min(100, Math.round((sales / target) * 100)) : 0,
      remaining: Math.max(0, round2(target - sales)),
    };
  });

  const reached = shaped.filter((t) => t.reached);
  // The best one they could take right now, and the one still worth chasing.
  const claimable = reached.length ? reached[reached.length - 1] : null;
  const next = shaped.find((t) => !t.reached) || null;

  // The bar tracks the next tier while one remains, then the top tier once every
  // target is behind them.
  const bar = next || shaped[shaped.length - 1];

  return {
    configured: true,
    cycleStart,
    sales,
    tiers: shaped,
    claimable,
    next,
    target: bar.target,
    bonusAmount: bar.bonusAmount,
    progress: bar.progress,
    remaining: bar.remaining,
    unlocked: Boolean(claimable),
  };
}

// Tell a rep the moment they cross a tier. No award row is written here: taking
// a bonus is a decision, and writing one would quietly end a run the rep might
// want to push further. Deduplicated per run per tier, so it is said once.
async function checkAndAward(salesRepId) {
  const p = await progressForRep(salesRepId);
  if (!p.configured || !p.claimable) return { awarded: false };

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  });
  const cycleKey = new Date(p.cycleStart).toISOString();
  const stretch = p.next
    ? ` Keep going and ${formatCurrency(p.next.target)} earns ${formatCurrency(p.next.bonusAmount)} instead — taking a bonus starts your count again from zero.`
    : '';

  notification.createIfAbsent({
    type: 'GENERAL',
    severity: 'INFO',
    title: `Bonus unlocked — ${formatCurrency(p.claimable.bonusAmount)}`,
    message: `You reached ${formatCurrency(p.claimable.target)} in sales.${stretch}`,
    entityType: 'BonusAward',
    entityId: `bonus:${salesRepId}:${cycleKey}:${p.claimable.ruleId}`,
    userId: rep?.user?.id || null,
  }).catch(() => {});

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Sales bonus reached',
    message: `${rep?.user?.name || 'A rep'} reached ${formatCurrency(p.claimable.target)} and can take ${formatCurrency(p.claimable.bonusAmount)}.`,
    entityType: 'BonusAward',
    entityId: `bonus-admin:${salesRepId}:${cycleKey}:${p.claimable.ruleId}`,
  }).catch(() => {});

  return { awarded: true, claimable: p.claimable };
}

// Pay a tier a rep has reached. This is what ends the run: the award records the
// run it belonged to, and everything after the payment counts toward the next.
async function payTier({ salesRepId, bonusRuleId }, actor, notes) {
  const p = await progressForRep(salesRepId);
  if (!p.configured) throw ApiError.badRequest('No bonus is configured');

  const tier = p.tiers.find((t) => t.ruleId === bonusRuleId) || p.claimable;
  if (!tier) throw ApiError.badRequest('That bonus tier does not exist');
  if (!tier.reached) {
    throw ApiError.badRequest(
      `This rep is on ${formatCurrency(p.sales)} — ${formatCurrency(tier.remaining)} short of the ${formatCurrency(tier.target)} target.`,
    );
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true } } },
  });
  if (!rep) throw ApiError.notFound('Sales rep not found');

  let award;
  try {
    award = await prisma.bonusAward.create({
      data: {
        salesRepId,
        bonusRuleId: tier.ruleId,
        cycleStart: p.cycleStart,
        qualifyingSales: p.sales,
        bonusAmount: tier.bonusAmount,
        status: 'PAID',
        paidAt: new Date(),
        paidById: actor?.id || null,
        notes: notes || null,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') throw ApiError.badRequest('This bonus has already been paid for this run');
    throw e;
  }

  notification.notifyUser(rep.user?.id, {
    type: 'GENERAL',
    severity: 'INFO',
    title: `Bonus paid — ${formatCurrency(tier.bonusAmount)}`,
    message: `Your ${formatCurrency(tier.bonusAmount)} sales bonus has been paid. Your sales count starts again from zero for the next one.`,
    entityType: 'BonusAward',
    entityId: award.id,
  }).catch(() => {});

  return award;
}

// Progress for every rep — the admin view.
async function summaryAllReps() {
  const reps = await prisma.salesRepresentative.findMany({
    where: { isActive: true },
    include: { user: { select: { name: true } } },
  });
  const items = [];
  for (const rep of reps) {
    const p = await progressForRep(rep.id);
    items.push({ salesRepId: rep.id, code: rep.code, name: rep.user?.name || rep.code, ...p });
  }
  items.sort((a, b) => (b.sales || 0) - (a.sales || 0));
  return { items };
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

async function listAwards({ status } = {}) {
  return prisma.bonusAward.findMany({
    where: status ? { status } : {},
    include: {
      salesRep: { include: { user: { select: { name: true } } } },
      bonusRule: { select: { salesTarget: true, bonusAmount: true } },
    },
    orderBy: { unlockedAt: 'desc' },
  });
}

module.exports = {
  activeRule,
  activeTiers,
  cycleStartFor,
  payTier,
  qualifyingSales,
  progressForRep,
  checkAndAward,
  summaryAllReps,
  listRules,
  createRule,
  updateRule,
  setRuleActive,
  listAwards,
};
