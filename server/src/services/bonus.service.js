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

// The rule a rep is measured against right now: the newest active rule that has
// already taken effect. A rule dated in the future is configured but not yet
// counting, so targets can be announced ahead of time.
async function activeRule(at = new Date()) {
  return prisma.bonusRule.findFirst({
    where: { isActive: true, effectiveFrom: { lte: new Date(at) } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

// Sales that count toward the target: revenue the rep actually brought in,
// measured the same way commission is — money from settled boxes, from the
// moment the rule took effect. Cancelled sales never count.
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

// Where a rep stands against the current target. Safe to call for a rep with no
// rule configured — it simply reports that there is nothing to chase.
async function progressForRep(salesRepId) {
  const rule = await activeRule();
  if (!rule) return { configured: false };

  const [sales, award] = await Promise.all([
    qualifyingSales(salesRepId, rule.effectiveFrom),
    prisma.bonusAward.findUnique({
      where: { salesRepId_bonusRuleId: { salesRepId, bonusRuleId: rule.id } },
    }),
  ]);

  const target = toNumber(rule.salesTarget);
  const bonusAmount = toNumber(rule.bonusAmount);
  const unlocked = Boolean(award) || (target > 0 && sales >= target);
  return {
    configured: true,
    ruleId: rule.id,
    effectiveFrom: rule.effectiveFrom,
    sales,
    target,
    bonusAmount,
    // Capped so a rep past the target sees a full bar rather than 143%.
    progress: target > 0 ? Math.min(100, Math.round((sales / target) * 100)) : 0,
    remaining: Math.max(0, round2(target - sales)),
    unlocked,
    award: award ? { id: award.id, status: award.status, unlockedAt: award.unlockedAt, paidAt: award.paidAt } : null,
  };
}

// Record that a rep reached the target. Called after anything that grows their
// sales; does nothing until the line is crossed, and nothing again afterwards
// because one rep can hold only one award per rule.
async function checkAndAward(salesRepId) {
  const p = await progressForRep(salesRepId);
  if (!p.configured || p.award || p.sales < p.target || p.target <= 0) {
    return { awarded: false };
  }

  let award;
  try {
    award = await prisma.bonusAward.create({
      data: {
        salesRepId,
        bonusRuleId: p.ruleId,
        qualifyingSales: p.sales,
        bonusAmount: p.bonusAmount,
        status: 'ELIGIBLE',
      },
    });
  } catch (e) {
    // Two settlements approved at once can both cross the line; the unique key
    // means the second simply loses, which is the intended outcome.
    if (e.code === 'P2002') return { awarded: false, reason: 'already-awarded' };
    throw e;
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  });

  notification.notifyUser(rep?.user?.id, {
    type: 'GENERAL',
    severity: 'INFO',
    title: `Bonus unlocked — ${formatCurrency(p.bonusAmount)}`,
    message: `You reached ${formatCurrency(p.target)} in sales and earned a ${formatCurrency(p.bonusAmount)} bonus. It is separate from your box commission and will be paid by The Lab.`,
    entityType: 'BonusAward',
    entityId: award.id,
  }).catch(() => {});

  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Sales bonus unlocked',
    message: `${rep?.user?.name || 'A rep'} reached ${formatCurrency(p.target)} in sales and is eligible for a ${formatCurrency(p.bonusAmount)} bonus.`,
    entityType: 'BonusAward',
    entityId: award.id,
  }).catch(() => {});

  return { awarded: true, award };
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

async function markPaid(id, actor, notes) {
  const award = await prisma.bonusAward.findUnique({
    where: { id },
    include: { salesRep: { include: { user: { select: { id: true } } } } },
  });
  if (!award) throw ApiError.notFound('Bonus award not found');
  if (award.status === 'PAID') throw ApiError.badRequest('This bonus is already marked paid');

  const updated = await prisma.bonusAward.update({
    where: { id },
    data: { status: 'PAID', paidAt: new Date(), paidById: actor?.id || null, notes: notes || null },
  });

  notification.notifyUser(award.salesRep?.user?.id, {
    type: 'GENERAL',
    severity: 'INFO',
    title: `Bonus paid — ${formatCurrency(toNumber(award.bonusAmount))}`,
    message: `Your ${formatCurrency(toNumber(award.bonusAmount))} sales bonus has been paid.`,
    entityType: 'BonusAward',
    entityId: award.id,
  }).catch(() => {});

  return updated;
}

module.exports = {
  activeRule,
  qualifyingSales,
  progressForRep,
  checkAndAward,
  summaryAllReps,
  listRules,
  createRule,
  updateRule,
  setRuleActive,
  listAwards,
  markPaid,
};
