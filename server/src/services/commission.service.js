'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const notification = require('./notification.service');
const { penaltyBreakdownForRep } = require('./penalty.service');
const { toNumber, round2, formatCurrency } = require('../utils/money');

// Commission settings:
//   commission.amountPerThreshold  (default 250000 TZS) — the MINIMUM WITHDRAWAL,
//     a pure money target. A rep can withdraw once their available balance
//     reaches it, however many boxes that took.
//   commission.v1PerBox            (default 5000) — what one box earned before
//     1 Aug 2026. A historical fact, frozen: settings.controller refuses to
//     change it, because re-pricing commission a rep already earned is never a
//     legitimate edit. It used to be derived as amount/boxThreshold, which made
//     raising the withdrawal minimum silently rewrite past earnings.
//   commission.boxThreshold        (default 50) — dead. Kept so old rows read
//     cleanly. Since rates now differ per brand, boxes and money are no longer
//     interchangeable at all: 50 boxes is 250,000 of OHIS but 150,000 of
//     Civlily, so no box count is ever a withdrawal target.
async function getRule() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['commission.boxThreshold', 'commission.amountPerThreshold', 'commission.v1PerBox'] } },
  });
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const boxThreshold = map.get('commission.boxThreshold') || 50;
  const amountPerThreshold = map.get('commission.amountPerThreshold') || 250000;
  // Pre-migration databases fall back to the old derivation, so the rate a rep
  // was earning does not jump the moment this ships.
  const perBox = map.get('commission.v1PerBox') || round2(amountPerThreshold / boxThreshold);
  return { boxThreshold, amountPerThreshold, perBox };
}

// ── Commission rates ─────────────────────────────────────────────────────────
// Rates live in the commission_rates table, not in this file, so The Doctor can
// change them without a deploy. A box is priced by the row in force WHEN ITS
// ORDER WAS CREATED — never when it was settled — so adding a rate today cannot
// reach back and re-price work already done.
//
// The table is append-only and the API refuses a start date in the past, which
// is what makes that guarantee structural rather than a promise.

// Brand names are matched by id, but the seed spells one brand "CIVILLY" and
// production spells it "Civlily", so name lookups normalise before comparing.
const normalizeBrand = (name) => String(name || '').toUpperCase().replace(/[^A-Z]/g, '');

// Rates change rarely and are read on every settled line, so the whole table is
// held for a short spell rather than queried per box. Any write clears it.
let rateCache = null;
let rateCacheAt = 0;
const RATE_CACHE_MS = 60 * 1000;

function clearRateCache() {
  rateCache = null;
  rateCacheAt = 0;
}

async function allRates() {
  if (rateCache && Date.now() - rateCacheAt < RATE_CACHE_MS) return rateCache;
  const rows = await prisma.commissionRate.findMany({
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: 'asc' },
  });
  rateCache = rows.map((r) => ({
    brandId: r.brandId,
    brandKey: r.brand ? normalizeBrand(r.brand.name) : null,
    perBox: toNumber(r.perBox),
    effectiveFrom: new Date(r.effectiveFrom).getTime(),
  }));
  rateCacheAt = Date.now();
  return rateCache;
}

// The rate for one box of `brand` on an order created at `when`: the latest row
// for that brand that had already taken effect, else the fallback row.
function pickRate(rates, brandKey, whenMs) {
  let best = null;
  let fallback = null;
  for (const r of rates) {
    if (r.effectiveFrom > whenMs) continue;
    if (r.brandKey === brandKey && brandKey) {
      if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
    } else if (r.brandId === null) {
      if (!fallback || r.effectiveFrom > fallback.effectiveFrom) fallback = r;
    }
  }
  return (best || fallback)?.perBox ?? 0;
}

// ── Admin writes ─────────────────────────────────────────────────────────────

async function listRates() {
  return prisma.commissionRate.findMany({
    include: { brand: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
    orderBy: [{ effectiveFrom: 'desc' }, { brandId: 'asc' }],
  });
}

// Add a rate. The start date must be in the future, which is the whole reason
// history is safe: a rate can never be introduced behind an order that has
// already been issued, so no settled box can be re-priced. Editing an existing
// rate is deliberately not offered for the same reason.
async function createRate({ brandId, perBox, effectiveFrom, note }, actor) {
  const amount = round2(perBox);
  if (!(amount > 0)) throw ApiError.badRequest('Commission per box must be greater than zero');

  const from = effectiveFrom ? new Date(effectiveFrom) : null;
  if (!from || Number.isNaN(from.getTime())) throw ApiError.badRequest('Choose the date this rate starts');
  if (from.getTime() <= Date.now()) {
    throw ApiError.badRequest(
      'A new rate must start in the future. Orders already issued keep the rate they were created under, so a start date in the past would re-price work that is already done.',
    );
  }

  if (brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw ApiError.notFound('Brand not found');
  }

  try {
    const row = await prisma.commissionRate.create({
      data: { brandId: brandId || null, perBox: amount, effectiveFrom: from, note: note || null, createdById: actor?.id || null },
    });
    clearRateCache();
    return row;
  } catch (e) {
    if (e.code === 'P2002') throw ApiError.badRequest('That brand already has a rate starting at exactly this time');
    throw e;
  }
}

// Remove a rate that has not taken effect yet. Once a rate is live it may have
// priced an order, so it stays.
async function deleteRate(id) {
  const row = await prisma.commissionRate.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Rate not found');
  if (new Date(row.effectiveFrom).getTime() <= Date.now()) {
    throw ApiError.badRequest('This rate has already taken effect and cannot be removed — add a new rate to change what boxes earn from now on.');
  }
  await prisma.commissionRate.delete({ where: { id } });
  clearRateCache();
  return { deleted: true };
}

// Every rate in force on a given date, one row per brand — drives the rate card
// and the admin screen.
async function ratesOn(when = new Date()) {
  const [rates, brands] = await Promise.all([
    allRates(),
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const whenMs = new Date(when).getTime();
  return brands.map((b) => ({
    brandId: b.id,
    brand: b.name,
    perBox: pickRate(rates, normalizeBrand(b.name), whenMs),
  }));
}

// Kept for callers that price a single box by brand NAME.
async function rateForBrandAt(brandName, when) {
  const rates = await allRates();
  return pickRate(rates, normalizeBrand(brandName), new Date(when || Date.now()).getTime());
}

// What a rep has EARNED: every settled box priced with its own order's rule and
// its own product's brand. Returns the total plus a per-brand breakdown.
async function earnedForRep(salesRepId) {
  const [items, rates] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { is: { salesRepId, settlementId: { not: null }, status: { not: 'CANCELLED' } } } },
      select: {
        baseQuantity: true,
        product: { select: { brand: { select: { name: true } } } },
        sale: { select: { soldAt: true, settlement: { select: { issuedAt: true } } } },
      },
    }),
    allRates(),
  ]);

  let earned = 0;
  let boxes = 0;
  const byBrand = new Map();
  for (const it of items) {
    const qty = it.baseQuantity || 0;
    const brand = it.product?.brand?.name || '—';
    // The order's issue date decides the rate. A sale whose settlement vanished
    // falls back to its own date, which is never earlier.
    const when = it.sale?.settlement?.issuedAt || it.sale?.soldAt || new Date();
    const rate = pickRate(rates, normalizeBrand(brand), new Date(when).getTime());
    const amount = qty * rate;
    earned += amount;
    boxes += qty;
    const row = byBrand.get(brand) || { brand, boxes: 0, amount: 0, rates: new Set() };
    row.boxes += qty;
    row.amount += amount;
    row.rates.add(rate);
    byBrand.set(brand, row);
  }
  return {
    earned: round2(earned),
    boxes,
    // `rate` is only meaningful when every box of this brand was paid the same.
    // One brand can span both rules — Civlily on a pre-August order earns 5,000,
    // on a later one 3,000 — and quoting either would contradict `amount`.
    byBrand: [...byBrand.values()]
      .map((b) => ({
        brand: b.brand,
        boxes: b.boxes,
        amount: round2(b.amount),
        rate: b.rates.size === 1 ? [...b.rates][0] : null,
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// The rates in force for an order created RIGHT NOW, labelled with the real
// brand names from the catalogue (production spells it "Civlily", the seed
// "CIVILLY" — both resolve to the same rate). Drives the rate card in the UI.
async function currentRates() {
  const perBrand = await ratesOn(new Date());
  return { effectiveFrom: null, perBrand };
}

// Per-box rate for one product on one order — the number the "you earned X"
// messages quote. Resolves the order's frozen rule and the product's brand.
async function rateForProductOnOrder(settlementId, productId) {
  const [rates, stl, prod] = await Promise.all([
    allRates(),
    settlementId
      ? prisma.settlement.findUnique({ where: { id: settlementId }, select: { issuedAt: true } }).catch(() => null)
      : null,
    productId
      ? prisma.product.findUnique({ where: { id: productId }, select: { brand: { select: { name: true } } } }).catch(() => null)
      : null,
  ]);
  const when = stl?.issuedAt ? new Date(stl.issuedAt).getTime() : Date.now();
  return pickRate(rates, normalizeBrand(prod?.brand?.name), when);
}

// Commission earned inside a date window (by sale date), priced per box with
// each order's own rule. Used by the weekly and monthly reports.
async function earnedBetween(start, end) {
  const rates = await allRates();
  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        is: {
          soldAt: { gte: start, lte: end },
          settlementId: { not: null },
          status: { not: 'CANCELLED' },
          salesRepId: { not: null },
        },
      },
    },
    select: {
      baseQuantity: true,
      product: { select: { brand: { select: { name: true } } } },
      sale: { select: { salesRepId: true, soldAt: true, settlement: { select: { issuedAt: true } } } },
    },
  });
  let total = 0;
  const byRep = new Map();
  for (const it of items) {
    const when = it.sale?.settlement?.issuedAt || it.sale?.soldAt || new Date();
    const rate = pickRate(rates, normalizeBrand(it.product?.brand?.name), new Date(when).getTime());
    const amount = (it.baseQuantity || 0) * rate;
    total += amount;
    const id = it.sale.salesRepId;
    byRep.set(id, round2((byRep.get(id) || 0) + amount));
  }
  return { total: round2(total), byRep };
}

// Boxes a rep has SETTLED (paid for) across all their orders. Each settlement
// records a CASH sale linked to the order, so settled boxes = base units sold
// on settlement-linked sales (the base unit is the Box). Commission is earned
// on settled boxes only — not on stock issued, and not on returns.
async function boxesSettledByRep(salesRepId) {
  const agg = await prisma.saleItem.aggregate({
    where: { sale: { is: { salesRepId, settlementId: { not: null }, status: { not: 'CANCELLED' } } } },
    _sum: { baseQuantity: true },
  });
  return agg._sum.baseQuantity || 0;
}

async function withdrawalTotals(salesRepId) {
  const grouped = await prisma.commissionWithdrawal.groupBy({
    by: ['status'],
    where: { salesRepId },
    _sum: { amount: true },
  });
  const m = new Map(grouped.map((g) => [g.status, toNumber(g._sum.amount)]));
  const paid = round2((m.get('APPROVED') || 0) + (m.get('PAID') || 0));
  const pendingRequests = round2(m.get('PENDING') || 0);
  return { paid, pendingRequests };
}

async function computeForRep(salesRepId) {
  const rule = await getRule();
  const [earnedData, wt, penaltyData, rates, rep] = await Promise.all([
    earnedForRep(salesRepId),
    withdrawalTotals(salesRepId),
    penaltyBreakdownForRep(salesRepId),
    currentRates(),
    prisma.salesRepresentative.findUnique({
      where: { id: salesRepId },
      select: { withdrawalThreshold: true, commissionAdjustment: true, commissionAdjustmentNote: true, commissionAdjustedAt: true },
    }).catch(() => null),
  ]);
  const { boxes } = earnedData;
  // A one-off correction to a squared-up account. Kept separate from the
  // derived figure so the boxes that produced it stay untouched and visible.
  const adjustment = round2(toNumber(rep?.commissionAdjustment));
  const grossEarned = earnedData.earned;
  const earned = round2(grossEarned + adjustment);
  // This rep's own minimum, where one has been agreed; otherwise the business
  // default. Everything downstream must quote THIS, never rule.amountPerThreshold.
  const minWithdrawal = rep?.withdrawalThreshold != null
    ? round2(toNumber(rep.withdrawalThreshold))
    : rule.amountPerThreshold;
  // Penalties are REAL applied deductions (persisted transactions). The balance
  // is earned − paid − pending withdrawals − penalties, and is NOT clamped, so a
  // rep with more fines than earnings goes negative (owes The Lab). Future
  // earnings raise `earned`, automatically offsetting the debt.
  const penalties = penaltyData.total;
  const pending = round2(earned - wt.paid);
  const available = round2(earned - wt.paid - wt.pendingRequests - penalties);
  return {
    rule,
    rates,
    minWithdrawal,
    // True when this rep is on terms of their own, so the UI can say so rather
    // than silently showing a number that differs from every other rep's.
    hasCustomThreshold: rep?.withdrawalThreshold != null,
    boxesSettled: round2(boxes),
    earnedByBrand: earnedData.byBrand,
    grossEarned,
    adjustment,
    adjustmentNote: rep?.commissionAdjustmentNote || null,
    adjustedAt: rep?.commissionAdjustedAt || null,
    earned,
    paid: wt.paid,
    pending,
    pendingRequests: wt.pendingRequests,
    penalties,
    penaltyBreakdown: penaltyData.breakdown,
    available, // can be negative when penalties exceed remaining balance
  };
}

async function summaryAllReps() {
  const reps = await prisma.salesRepresentative.findMany({
    where: { isActive: true },
    include: { user: { select: { name: true } } },
  });
  const items = [];
  for (const rep of reps) {
    const c = await computeForRep(rep.id);
    items.push({ salesRepId: rep.id, name: rep.user?.name, code: rep.code, ...c });
  }
  items.sort((a, b) => b.earned - a.earned);
  return {
    totals: {
      earned: round2(items.reduce((s, i) => s + i.earned, 0)),
      paid: round2(items.reduce((s, i) => s + i.paid, 0)),
      pending: round2(items.reduce((s, i) => s + i.pending, 0)),
      penalties: round2(items.reduce((s, i) => s + i.penalties, 0)),
    },
    items,
  };
}

const WITHDRAWAL_INCLUDE = {
  salesRep: { include: { user: { select: { name: true } } } },
  decidedBy: { select: { id: true, name: true } },
};

async function requestWithdrawal(salesRepId, amount, notes, actor) {
  const amt = round2(amount);
  if (amt <= 0) throw ApiError.badRequest('Amount must be greater than zero');
  const c = await computeForRep(salesRepId);
  const minWithdrawal = c.minWithdrawal;
  if (c.available < minWithdrawal) {
    throw ApiError.badRequest(`Minimum withdrawal is TZS ${minWithdrawal.toLocaleString()}. Your available balance is TZS ${c.available.toLocaleString()}.`);
  }
  if (amt > c.available + 0.001) {
    throw ApiError.badRequest(`Amount exceeds available commission (${c.available})`);
  }
  const w = await prisma.commissionWithdrawal.create({
    data: { salesRepId, amount: amt, notes: notes || null, status: 'PENDING' },
    include: WITHDRAWAL_INCLUDE,
  });

  const repName = w.salesRep?.user?.name || 'A rep';
  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Commission withdrawal requested',
    message: `${repName} requested a commission withdrawal of ${formatCurrency(amt)}.`,
    entityType: 'CommissionWithdrawal',
    entityId: w.id,
  }).catch(() => {});
  if (actor?.id) {
    notification.notifyUser(actor.id, {
      type: 'GENERAL',
      severity: 'INFO',
      title: 'Withdrawal request submitted',
      message: `Your withdrawal request of ${formatCurrency(amt)} has been submitted and is pending approval.`,
      entityType: 'CommissionWithdrawal',
      entityId: w.id,
    }).catch(() => {});
  }

  return w;
}

async function listWithdrawals(filters, pagination) {
  const where = {};
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.status) where.status = filters.status;
  const [items, total] = await Promise.all([
    prisma.commissionWithdrawal.findMany({ where, include: WITHDRAWAL_INCLUDE, skip: pagination.skip, take: pagination.take, orderBy: pagination.orderBy }),
    prisma.commissionWithdrawal.count({ where }),
  ]);
  return { items, total };
}

async function decideWithdrawal(id, action, actor) {
  const w = await prisma.commissionWithdrawal.findUnique({ where: { id } });
  if (!w) throw ApiError.notFound('Withdrawal request not found');

  const transitions = {
    APPROVE: { from: ['PENDING'], to: 'APPROVED' },
    REJECT: { from: ['PENDING'], to: 'REJECTED' },
    PAY: { from: ['PENDING', 'APPROVED'], to: 'PAID' },
  };
  const t = transitions[action];
  if (!t) throw ApiError.badRequest('Unknown action');
  if (!t.from.includes(w.status)) {
    throw ApiError.badRequest(`Cannot ${action.toLowerCase()} a ${w.status} request`);
  }

  const updated = await prisma.commissionWithdrawal.update({
    where: { id },
    data: {
      status: t.to,
      decidedAt: new Date(),
      decidedById: actor ? actor.id : null,
      paidAt: t.to === 'PAID' ? new Date() : w.paidAt,
    },
    include: WITHDRAWAL_INCLUDE,
  });

  const repUserId = updated.salesRep?.user?.id;
  const decisionMsgs = {
    APPROVED: { title: 'Withdrawal approved', message: `Your commission withdrawal of ${formatCurrency(updated.amount)} has been approved.`, severity: 'INFO' },
    REJECTED: { title: 'Withdrawal rejected', message: `Your commission withdrawal of ${formatCurrency(updated.amount)} was not approved.`, severity: 'WARNING' },
    PAID: { title: 'Commission payment received', message: `Your commission withdrawal of ${formatCurrency(updated.amount)} has been paid out.`, severity: 'INFO' },
  };
  const dm = decisionMsgs[t.to];
  if (dm && repUserId) {
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: dm.severity,
      title: dm.title,
      message: dm.message,
      entityType: 'CommissionWithdrawal',
      entityId: id,
    }).catch(() => {});
  }

  return updated;
}

module.exports = {
  getRule,
  ratesOn,
  listRates,
  createRate,
  deleteRate,
  rateForBrandAt,
  clearRateCache,
  earnedForRep,
  earnedBetween,
  currentRates,
  rateForProductOnOrder,
  computeForRep,
  summaryAllReps,
  requestWithdrawal,
  listWithdrawals,
  decideWithdrawal,
};
