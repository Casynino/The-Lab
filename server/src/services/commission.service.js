'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const notification = require('./notification.service');
const { penaltyBreakdownForRep } = require('./penalty.service');
const { toNumber, round2, formatCurrency, MAX_COMMISSION_CHANGE } = require('../utils/money');

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
  // Only a real figure above zero counts; anything else stored (blank, "250,000", 0, a minus) is the default,
  // so a bad value can never remove the minimum (Settings now refuses such values; audit 11 Nov 2026).
  const minSetting = map.get('commission.amountPerThreshold');
  const amountPerThreshold = Number.isFinite(minSetting) && minSetting > 0 ? minSetting : 250000;
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
//
// `since` narrows it to boxes settled after a moment in time. The settlement
// writes its sale as the boxes are paid for, so a sale's own date IS the date
// the box was settled — which is what makes "since the last payout" answerable
// without storing anything new.
async function earnedForRep(salesRepId, { since = null } = {}) {
  const [items, rates] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        sale: {
          is: {
            salesRepId,
            settlementId: { not: null },
            status: { not: 'CANCELLED' },
            ...(since ? { soldAt: { gt: since } } : {}),
          },
        },
      },
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

// The same arithmetic as earnedBetween — a settled box, at the rate in force when its order was
// issued — but for ONE rep and kept line by line, so a screen can say WHEN and ON WHAT it was earned
// (by month, by brand, by product). One rate rule, two readers: nothing here prices a box on its own.
async function earnedLinesForRep(salesRepId, start, end) {
  const rates = await allRates();
  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        is: {
          soldAt: { gte: start, lte: end },
          settlementId: { not: null },
          status: { not: 'CANCELLED' },
          salesRepId,
        },
      },
    },
    select: {
      baseQuantity: true,
      product: { select: { name: true, brand: { select: { name: true } } } },
      sale: { select: { soldAt: true, settlement: { select: { issuedAt: true } } } },
    },
  });
  return items.map((it) => {
    const when = it.sale?.settlement?.issuedAt || it.sale?.soldAt || new Date();
    const rate = pickRate(rates, normalizeBrand(it.product?.brand?.name), new Date(when).getTime());
    const boxes = it.baseQuantity || 0;
    return {
      soldAt: it.sale?.soldAt,
      brand: it.product?.brand?.name || 'Other',
      product: it.product?.name || 'Product',
      boxes,
      amount: round2(boxes * rate),
    };
  });
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

// Commission only: a BONUS withdrawal (14 Nov 2026) comes out of the bonus pot, never out of commission.
async function withdrawalTotals(salesRepId) {
  const grouped = await prisma.commissionWithdrawal.groupBy({
    by: ['status'],
    where: { salesRepId, source: 'COMMISSION' },
    _sum: { amount: true },
  });
  const m = new Map(grouped.map((g) => [g.status, toNumber(g._sum.amount)]));
  // Approved but not yet paid is still waiting for the money (audit money-flows-7): it counted as paid
  // here, so the rep's wallet and the totals said "paid out" before anything was handed over. Both
  // buckets come off the available balance, so moving it changes no balance, only where it is shown.
  const paid = round2(m.get('PAID') || 0);
  const pendingRequests = round2((m.get('PENDING') || 0) + (m.get('APPROVED') || 0));
  return { paid, pendingRequests };
}

// ── The current run ──────────────────────────────────────────────────────────
// A commission run closes when the rep is paid. Everything after that payout is
// the run they are in now, which is what the owner reads the balances page for:
// not a lifetime total, but "since I last paid him, how is he doing".
//
// The boundary is the LAST withdrawal that was decided for payment, APPROVED or PAID (an approval
// closes the run, as it always has; `withdrawalTotals` shows an approved one as waiting until it is
// paid). The run's brought-forward figure is derived from the balance, so the row still adds up. Ordered in memory rather than
// by SQL because the moment is paidAt when there is one and the decision
// otherwise, and no index can sort across two columns like that.
async function lastPayoutFor(salesRepId) {
  const rows = await prisma.commissionWithdrawal.findMany({
    // A bonus payout does not close a commission run.
    where: { salesRepId, source: 'COMMISSION', status: { in: ['APPROVED', 'PAID'] } },
    select: { id: true, amount: true, status: true, paidAt: true, decidedAt: true, requestedAt: true },
  });
  let best = null;
  for (const r of rows) {
    const at = r.paidAt || r.decidedAt || r.requestedAt;
    if (!at) continue;
    if (!best || new Date(at).getTime() > new Date(best.at).getTime()) {
      best = { id: r.id, at, amount: round2(toNumber(r.amount)), status: r.status };
    }
  }
  return best;
}

// Fines charged inside the current run. WAIVED rows are excluded here exactly as
// they are in the lifetime figure — a forgiven fine costs the rep nothing.
async function penaltiesSince(salesRepId, since) {
  const agg = await prisma.settlementPenalty.aggregate({
    where: { salesRepId, status: 'APPLIED', appliedAt: { gt: since } },
    _sum: { amount: true },
  });
  return round2(toNumber(agg._sum.amount));
}

async function computeForRep(salesRepId) {
  const rule = await getRule();
  const [earnedData, wt, penaltyData, rates, rep, payout] = await Promise.all([
    earnedForRep(salesRepId),
    withdrawalTotals(salesRepId),
    penaltyBreakdownForRep(salesRepId),
    currentRates(),
    prisma.salesRepresentative.findUnique({
      where: { id: salesRepId },
      select: {
        withdrawalThreshold: true, commissionAdjustment: true, commissionAdjustmentNote: true,
        commissionAdjustedAt: true, earnsCommission: true,
        emergencyWindowAt: true, emergencyWindowById: true, emergencyWindowReason: true,
      },
    }).catch(() => null),
    lastPayoutFor(salesRepId),
  ]);
  const { boxes } = earnedData;

  // A rep who is not on commission. Their settlements are still real sales and
  // still count as boxes moved — they simply earn nothing on them, owe nothing
  // against a balance that does not exist, and cannot request a withdrawal.
  // Nothing is deleted: flip the switch back and the history returns.
  if (rep && rep.earnsCommission === false) {
    // Their boxes still belong to a run, so the run figure has to be measured
    // from the payout like everybody else's. The lifetime count sitting under a
    // column headed "this run" would overstate it the moment such a rep had
    // ever been paid — true today only because none of them has.
    const offSince = payout ? new Date(payout.at) : null;
    const offRunBoxes = offSince ? (await earnedForRep(salesRepId, { since: offSince })).boxes : boxes;
    return {
      rule,
      rates,
      minWithdrawal: rule.amountPerThreshold,
      hasCustomThreshold: false,
      earnsCommission: false,
      boxesSettled: round2(boxes),
      earnedByBrand: [],
      grossEarned: 0,
      adjustment: 0,
      adjustmentNote: null,
      adjustedAt: null,
      earned: 0,
      paid: 0,
      pending: 0,
      pendingRequests: 0,
      penalties: 0,
      penaltyBreakdown: [],
      available: 0,
      eligible: false,
      // A rep off commission has no balance, so a window would waive nothing.
      emergency: { open: false, openedAt: null, until: null, reason: null, openedById: null },
      emergencyFloor: 0,
      // Their boxes are still real work and still belong to a run; only the
      // money is nil.
      run: {
        since: payout ? payout.at : null,
        lastPayout: payout ? { at: payout.at, amount: payout.amount } : null,
        boxes: round2(offRunBoxes),
        earned: 0,
        penalties: 0,
        net: 0,
        broughtForward: 0,
      },
    };
  }

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
  // rep with more fines than earnings goes negative (owes ZELab). Future
  // earnings raise `earned`, automatically offsetting the debt.
  const penalties = penaltyData.total;
  const pending = round2(earned - wt.paid);
  const available = round2(earned - wt.paid - wt.pendingRequests - penalties);

  // The run in progress. With no payout behind them the run IS their whole
  // history, so the figures already in hand answer it and no second pass over
  // the boxes is needed.
  const since = payout ? new Date(payout.at) : null;
  const [runEarnedData, runPenalties] = since
    ? await Promise.all([earnedForRep(salesRepId, { since }), penaltiesSince(salesRepId, since)])
    : [earnedData, penalties];
  const runNet = round2(runEarnedData.earned - runPenalties);
  const run = {
    since: payout ? payout.at : null,
    lastPayout: payout ? { at: payout.at, amount: payout.amount } : null,
    boxes: round2(runEarnedData.boxes),
    earned: runEarnedData.earned,
    penalties: runPenalties,
    net: runNet,
    // What the balance was already carrying when this run opened: a part-taken
    // payout leaves the remainder behind, and an agreed adjustment sits outside
    // any run's boxes. Derived from `available` rather than summed separately,
    // so earned − fines + brought forward always equals what he can withdraw.
    broughtForward: round2(available - runNet),
  };

  // The one place the eligibility rule lives. It used to be re-derived in the
  // rep-profile controller as `available >= threshold`, which was the same rule
  // written twice — and with a window in play the two would disagree: the
  // profile would read "not eligible" about a rep who can withdraw right now.
  const emergency = emergencyStateFor(rep);
  const waived = emergency.open && available < minWithdrawal;
  const eligible = available >= minWithdrawal || (waived && available >= EMERGENCY_FLOOR);

  return {
    rule,
    rates,
    minWithdrawal,
    emergency,
    // The floor actually in force, so the button and the server cannot disagree
    // about what the smallest allowed request is.
    emergencyFloor: waived ? EMERGENCY_FLOOR : 0,
    eligible,
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
    run,
  };
}

async function summaryAllReps() {
  // Every rep is read, not only the active ones (audit #71): switching a rep off does not settle what the
  // business owes them, yet their balance and any request still waiting dropped out of these totals and
  // out of Finance's "owed to reps" the moment the account was deactivated. The list stays the working
  // one: active reps, plus a deactivated rep only while money is still in play for them.
  const reps = await prisma.salesRepresentative.findMany({
    include: { user: { select: { name: true } } },
  });
  // Every rep's figures are read at the same time rather than one rep after another (each rep is ~25 DB
  // round trips, so six reps in a row was the slowest part of the dashboard, Finance and Commissions).
  // Same reads per rep; the rows are still built in the reps' own order, so totals add up the same.
  const computed = await Promise.all(reps.map((rep) => computeForRep(rep.id)));
  const items = [];
  reps.forEach((rep, i) => {
    const row = { salesRepId: rep.id, name: rep.user?.name, code: rep.code, ...computed[i], isActive: rep.isActive !== false };
    if (row.isActive || row.available > 0 || (row.pendingRequests || 0) > 0) items.push(row);
  });
  items.sort((a, b) => b.earned - a.earned);
  return {
    totals: {
      earned: round2(items.reduce((s, i) => s + i.earned, 0)),
      paid: round2(items.reduce((s, i) => s + i.paid, 0)),
      pending: round2(items.reduce((s, i) => s + i.pending, 0)),
      penalties: round2(items.reduce((s, i) => s + i.penalties, 0)),
      // What is actually withdrawable / in flight — the business's true
      // payable. `pending` above is earned − paid, which still contains fines.
      available: round2(items.reduce((s, i) => s + Math.max(0, i.available), 0)),
      requested: round2(items.reduce((s, i) => s + (i.pendingRequests || 0), 0)),
      boxes: round2(items.reduce((s, i) => s + (i.boxesSettled || 0), 0)),
      // The current run across everybody: boxes settled and commission earned
      // since each rep's own last payout, which is what the balances page opens
      // on. Each rep's run starts on a different date, so this is a sum of
      // "since I last paid you", not a shared period.
      runBoxes: round2(items.reduce((s, i) => s + (i.run?.boxes || 0), 0)),
      runEarned: round2(items.reduce((s, i) => s + (i.run?.earned || 0), 0)),
    },
    items,
  };
}

const WITHDRAWAL_INCLUDE = {
  // `id` was missing, and decideWithdrawal reads salesRep.user.id to decide who
  // to tell. It was always undefined, so the notify block below it has never
  // once fired: no rep has ever been told their withdrawal was approved,
  // rejected or paid. One word, and it starts working.
  salesRep: { include: { user: { select: { id: true, name: true } } } },
  decidedBy: { select: { id: true, name: true } },
};

// ── The emergency withdrawal window ──────────────────────────────────────────
// A rep may only ask for a payout once their balance reaches a minimum. That
// rule has no exception, and a real emergency needs one, so The Doctor can open
// a window for one rep: while it is open the MINIMUM is waived and nothing
// else — what they may ask for is still capped at what they have.
//
// 48 hours rather than "today": a window opened at 7pm with a 24h clock dies
// while the rep is asleep. It is deliberately shorter than the 72h settlement
// deadline so it never reads as one of the house deadlines.
const EMERGENCY_WINDOW_HOURS = 48;
// A floor under the waived floor, on the AMOUNT and not on the balance. Without
// it a window can be spent on a request for one shilling — and that is not
// cosmetic: approving any withdrawal closes the rep's commission run, because
// lastPayoutFor counts APPROVED as a payout. A dust request would end their
// round and reset the figures the balances page opens on.
const EMERGENCY_FLOOR = 20000;

const windowCutoff = () => new Date(Date.now() - EMERGENCY_WINDOW_HOURS * 3_600_000);

// Expiry is arithmetic on read, never a swept job — so a window cannot outlive
// a cron that stopped running, which is the one failure worse than a forgotten
// window. The stale timestamp is deliberately left in the row: it is the record
// of a press, and clearing it on read would turn a GET into a write.
function emergencyStateFor(rep) {
  const at = rep?.emergencyWindowAt ? new Date(rep.emergencyWindowAt) : null;
  const open = Boolean(at && at.getTime() > windowCutoff().getTime());
  return {
    open,
    openedAt: at ? at.toISOString() : null,
    until: open ? new Date(at.getTime() + EMERGENCY_WINDOW_HOURS * 3_600_000).toISOString() : null,
    reason: rep?.emergencyWindowReason || null,
    openedById: rep?.emergencyWindowById || null,
  };
}

const SOURCES = ['COMMISSION', 'BONUS'];
// How a withdrawal is named to the rep and the owner.
const withdrawalWord = (source) => (source === 'BONUS' ? 'bonus withdrawal' : 'commission withdrawal');

// `source` says which pot it comes from (owner, 14 Nov 2026). COMMISSION is the request as it has always
// been: any amount up to the commission available, the minimum, the emergency window. BONUS is one request
// for the WHOLE bonus credited in the rep's current bonus cycle (bonus.requestBonusTx): no minimum, no
// window, and it ends the bonus cycle. Neither pot ever pays for the other.
async function requestWithdrawal(salesRepId, amount, notes, actor, { source = 'COMMISSION' } = {}) {
  const amt = round2(amount);
  if (amt <= 0) throw ApiError.badRequest('Amount must be greater than zero');
  if (!SOURCES.includes(source)) throw ApiError.badRequest('Withdraw from commission or from bonus');
  const isBonus = source === 'BONUS';
  const bonus = require('./bonus.service');
  let credited = [];

  // One request at a time per rep (audit #30, 11 Nov 2026): the balance check and the create used to be a
  // read followed by a write with nothing between them, so two taps at the same instant both saw the
  // whole balance and both asked for it. The rep's row is locked for the check and the create; a second
  // request waits, then reads a balance that already has the first one taken off (available counts
  // pending requests), and is refused if nothing is left. computeForRep only reads, on its own
  // connection, so it sees the first request once that has committed.
  const w = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "sales_representatives" WHERE id = ${salesRepId} FOR UPDATE`;
    if (isBonus) {
      const r = await bonus.requestBonusTx(tx, salesRepId, amt, notes, WITHDRAWAL_INCLUDE);
      credited = r.credited;
      return r.withdrawal;
    }
    return createWithdrawalTx(tx, salesRepId, amt, notes);
  }, { maxWait: 10_000, timeout: 20_000 });
  // A milestone credited on the way in (its own credit had not run yet) is announced once it is committed.
  if (credited.length) await bonus.announce(salesRepId, credited).catch(() => {});

  const repName = w.salesRep?.user?.name || 'A rep';
  const what = withdrawalWord(source);
  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: isBonus ? 'Bonus withdrawal requested' : 'Commission withdrawal requested',
    message: `${repName} requested a ${what} of ${formatCurrency(w.amount)}.`,
    entityType: 'CommissionWithdrawal',
    entityId: w.id,
  }).catch(() => {});
  if (actor?.id) {
    notification.notifyUser(actor.id, {
      type: 'GENERAL',
      severity: 'INFO',
      title: isBonus ? 'Bonus withdrawal submitted' : 'Withdrawal request submitted',
      message: isBonus
        ? `Your bonus withdrawal of ${formatCurrency(w.amount)} has been submitted and is pending approval. Your bonus count starts again from zero.`
        : `Your withdrawal request of ${formatCurrency(amt)} has been submitted and is pending approval.`,
      whatsapp: { kind: 'WITHDRAWAL_REQUESTED', amount: toNumber(w.amount), source },
      entityType: 'CommissionWithdrawal',
      entityId: w.id,
    }).catch(() => {});
  }

  return w;
}

// The checks and the create, run while the rep's row is locked (see requestWithdrawal).
async function createWithdrawalTx(tx, salesRepId, amt, notes) {
  const c = await computeForRep(salesRepId);
  const minWithdrawal = c.minWithdrawal;

  // The ceiling is checked FIRST, and outside the emergency branch. A request
  // refused for asking more than the rep has must never cost them the window
  // they were given.
  if (amt > c.available + 0.001) {
    throw ApiError.badRequest(`Amount exceeds available commission (${c.available})`);
  }

  // The window is only ever read by a rep who is actually below their minimum.
  // One whose balance has climbed above it takes the ordinary path and leaves
  // the window untouched, rather than silently spending it on a request that
  // never needed it.
  let underEmergency = false;
  if (c.available < minWithdrawal) {
    if (!c.emergency.open) {
      throw ApiError.badRequest(`Minimum withdrawal is TZS ${minWithdrawal.toLocaleString()}. Your available balance is TZS ${c.available.toLocaleString()}.`);
    }
    if (amt < EMERGENCY_FLOOR) {
      throw ApiError.badRequest(`An emergency withdrawal has to be at least TZS ${EMERGENCY_FLOOR.toLocaleString()}.`);
    }
    // Claiming the window is a conditional UPDATE, not a read followed by a
    // write. The balance check above is a check-then-create with nothing
    // serialising it, and decideWithdrawal never re-checks solvency — so two
    // taps at the same instant would otherwise both pass and both create a
    // request for the whole balance. This is the compare-and-swap the rest of
    // the codebase uses for exactly this: exactly one caller can win.
    const claimed = await tx.salesRepresentative.updateMany({
      where: { id: salesRepId, emergencyWindowAt: { not: null, gt: windowCutoff() } },
      data: { emergencyWindowAt: null },
    });
    if (claimed.count !== 1) {
      throw ApiError.badRequest('That withdrawal window has already been used, or it has closed.');
    }
    underEmergency = true;
  }

  return tx.commissionWithdrawal.create({
    data: {
      salesRepId,
      amount: amt,
      notes: notes || null,
      status: 'PENDING',
      source: 'COMMISSION',
      // Stamped on the money, because it is the only record of the exception
      // that can be read without opening the database.
      underEmergency,
      minWaived: underEmergency ? minWithdrawal : null,
    },
    include: WITHDRAWAL_INCLUDE,
  });
}

async function listWithdrawals(filters, pagination) {
  const where = {};
  if (filters.salesRepId) where.salesRepId = filters.salesRepId;
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
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
  // Paying a bonus is the owner's (it was admin-only before bonuses lived in the wallet); staff may still
  // approve or reject one, and pay commission as before.
  const isBonus = w.source === 'BONUS';
  if (isBonus && t.to === 'PAID' && actor?.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the owner can pay a bonus withdrawal.');
  }
  if (!t.from.includes(w.status)) {
    // Already where this press wanted it (a retry after a lost answer): say the first one went through,
    // not "Cannot pay a PAID request" (audit backend-integrity-5).
    if (w.status === t.to) {
      throw ApiError.conflict(`This withdrawal is already ${t.to === 'PAID' ? 'paid' : t.to.toLowerCase()} — your first press went through. Refresh to see it.`);
    }
    throw ApiError.badRequest(`Cannot ${action.toLowerCase()} a ${w.status} request`);
  }

  // Claim the decision (audit #31, 11 Nov 2026): the status moves only if it is still the one read above.
  // Two taps on "Approve & pay", or a PAY racing a REJECT, used to both pass the check and both write —
  // and every PAID answer records a payout in finance, so one withdrawal could be booked twice. Now
  // exactly one caller wins; the other is told it was already decided and nothing else happens.
  const now = new Date();
  const claimed = await prisma.commissionWithdrawal.updateMany({
    where: { id, status: w.status },
    data: {
      status: t.to,
      decidedAt: now,
      decidedById: actor ? actor.id : null,
      ...(t.to === 'PAID' ? { paidAt: now } : {}),
    },
  });
  if (claimed.count !== 1) {
    const fresh = await prisma.commissionWithdrawal.findUnique({ where: { id }, select: { status: true } });
    throw ApiError.conflict(`This withdrawal was already ${String(fresh?.status || 'decided').toLowerCase()} — refresh to see it.`);
  }
  const updated = await prisma.commissionWithdrawal.findUnique({ where: { id }, include: WITHDRAWAL_INCLUDE });

  // A rejected emergency request hands the window back. The rep spent it on a
  // wrong phone number, not on the money, and the alternative is that a typo at
  // 9pm costs him the one shot he was given and the only person who can reopen
  // it has gone to bed.
  if (t.to === 'REJECTED' && w.underEmergency) {
    await prisma.salesRepresentative.update({
      where: { id: w.salesRepId },
      data: { emergencyWindowAt: new Date() },
    }).catch(() => {});
  }

  // A rejected bonus request reopens the cycle it ended (the bonus is back, the count carries on); a paid
  // one starts the next cycle. Either way a milestone may now be due, and is credited here.
  if (isBonus && (t.to === 'REJECTED' || t.to === 'PAID')) {
    await require('./bonus.service').creditMilestones(w.salesRepId).catch(() => []);
  }

  const repUserId = updated.salesRep?.user?.id;
  const what = withdrawalWord(w.source);
  const decisionMsgs = {
    APPROVED: { kind: 'WITHDRAWAL_APPROVED', title: isBonus ? 'Bonus withdrawal approved' : 'Withdrawal approved', message: `Your ${what} of ${formatCurrency(updated.amount)} has been approved.`, severity: 'INFO' },
    REJECTED: { kind: 'WITHDRAWAL_REJECTED', title: isBonus ? 'Bonus withdrawal rejected' : 'Withdrawal rejected', message: `Your ${what} of ${formatCurrency(updated.amount)} was not approved.${isBonus ? ' The bonus is back in your wallet.' : ''}`, severity: 'WARNING' },
    PAID: { kind: 'WITHDRAWAL_PAID', title: isBonus ? 'Bonus payment received' : 'Commission payment received', message: `Your ${what} of ${formatCurrency(updated.amount)} has been paid out.`, severity: 'INFO' },
  };
  const dm = decisionMsgs[t.to];
  if (dm && repUserId) {
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: dm.severity,
      title: dm.title,
      message: dm.message,
      whatsapp: { kind: dm.kind, amount: updated.amount, source: w.source || 'COMMISSION' },
      entityType: 'CommissionWithdrawal',
      entityId: id,
    }).catch(() => {});
  }

  return updated;
}

// Open or close a rep's emergency withdrawal window.
//
// Opening requires a reason. It is the only account of why a money rule was set
// aside for one person, and it is kept on the REP rather than on the payout:
// listWithdrawals ships every scalar of a withdrawal to the rep's own browser,
// and this sentence is The Doctor's, not theirs.
async function setEmergencyWindow({ salesRepId, open, reason }, actor) {
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!rep) throw ApiError.notFound('Sales rep not found');

  if (open) {
    if (rep.earnsCommission === false) {
      throw ApiError.badRequest('This rep is not on commission, so there is no balance for a window to open.');
    }
    if (!String(reason || '').trim()) {
      throw ApiError.badRequest('Say what the emergency is — it is the only record of why the minimum was waived.');
    }
  }

  const at = new Date();
  const updated = await prisma.salesRepresentative.update({
    where: { id: salesRepId },
    data: open
      ? { emergencyWindowAt: at, emergencyWindowById: actor?.id || null, emergencyWindowReason: String(reason).trim().slice(0, 300) }
      : { emergencyWindowAt: null },
    select: { id: true, emergencyWindowAt: true, emergencyWindowById: true, emergencyWindowReason: true },
  });

  const repUserId = rep.user?.id;
  if (repUserId) {
    notification.notifyUser(repUserId, {
      type: 'GENERAL',
      severity: 'INFO',
      title: open ? 'You can withdraw now' : 'Withdrawal window closed',
      message: open
        ? 'ZELab has opened a one-off withdrawal for you. Your usual minimum does not apply — request it from your Commission page within the next two days.'
        : 'The one-off withdrawal opened for you has been closed. Your usual minimum applies again.',
      whatsapp: { kind: open ? 'WINDOW_OPEN' : 'WINDOW_CLOSED' },
      entityType: 'SalesRepresentative',
      // The WhatsApp mirror deduplicates on rep + entity + title, all of which
      // would be identical every time — so a rep's SECOND window would never
      // reach their phone. The instant makes each one its own event.
      entityId: `${salesRepId}:${at.getTime()}`,
    }).catch(() => {});
  }

  return { ...updated, emergency: emergencyStateFor(updated) };
}

// Credit or claw back commission by hand. The `commissionAdjustment` column has
// been read by summaryForRep since go-live — `earned = grossEarned +
// adjustment` — but nothing has ever been able to write it, so the only manual
// lever was the penalty, which can only ever subtract. That left no way to
// correct a rep upwards, or to put a figure on the account for a dry run.
//
// It accumulates rather than replaces: two corrections of 100,000 leave 200,000,
// which is what "add" means to the person clicking it. Pass a negative amount
// to take it back off, so a correction is always reversible by its opposite.
// A correction identical to one made for the same rep within this window is taken as the same press sent
// twice (a double tap, or a retry after a lost answer), not as a second correction.
const CORRECTION_REPEAT_MS = 60_000;

// `record(tx, row)` writes the audit row for this correction inside the same transaction (the controller
// passes it). The audit row is also what a repeat is recognised by, so it must be written under the lock.
async function adjustEarned({ salesRepId, amount, note }, actor, { record } = {}) {
  const amt = round2(toNumber(amount));
  if (!salesRepId) throw ApiError.badRequest('Which rep is this for?');
  if (!Number.isFinite(amt) || amt === 0) throw ApiError.badRequest('Enter an amount to add or take off');
  if (Math.abs(amt) > MAX_COMMISSION_CHANGE) {
    throw ApiError.badRequest(`That is more than ${formatCurrency(MAX_COMMISSION_CHANGE)} — check the number of zeros`);
  }
  const rep = await prisma.salesRepresentative.findUnique({ where: { id: salesRepId } });
  if (!rep) throw ApiError.notFound('Sales rep not found');
  const cleanNote = note ? String(note).trim().slice(0, 500) : null;
  // Added by the database, not read-then-written (audit #120): two corrections saved at the same moment
  // both read the same old figure, and the second write replaced the first instead of adding to it.
  // The note is only written when one is given, so it cannot put back a note another save just changed.
  //
  // Sent twice = added once (audit backend-integrity-2): the rep's row is locked, the same correction
  // (amount and note) recorded for him in the last minute is looked for in the audit log, and the
  // change and its audit row are written in the same transaction. No schema change (D34).
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "sales_representatives" WHERE id = ${salesRepId} FOR UPDATE`;
    const recent = await tx.auditLog.findMany({
      where: {
        entityType: 'SalesRepresentative', entityId: salesRepId,
        createdAt: { gte: new Date(Date.now() - CORRECTION_REPEAT_MS) },
      },
      select: { newValues: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const repeat = recent.some((a) => a.newValues && a.newValues.kind === 'COMMISSION_ADJUSTMENT'
      && round2(toNumber(a.newValues.amount)) === amt
      && (a.newValues.note || null) === (cleanNote || null));
    if (repeat) {
      throw ApiError.conflict(`This correction of ${formatCurrency(amt)} was already recorded a moment ago — it went through. To make the same correction again on purpose, wait a minute and send it again.`);
    }
    const row = await tx.salesRepresentative.update({
      where: { id: salesRepId },
      data: {
        commissionAdjustment: { increment: amt },
        ...(cleanNote ? { commissionAdjustmentNote: cleanNote } : {}),
        commissionAdjustedAt: new Date(),
      },
      select: { id: true, commissionAdjustment: true, commissionAdjustmentNote: true, commissionAdjustedAt: true },
    });
    if (record) await record(tx, row, { amount: amt, note: cleanNote });
    return row;
  }, { maxWait: 10_000, timeout: 20_000 });
}

module.exports = {
  adjustEarned,
  setEmergencyWindow,
  EMERGENCY_WINDOW_HOURS,
  EMERGENCY_FLOOR,
  getRule,
  ratesOn,
  listRates,
  createRate,
  deleteRate,
  rateForBrandAt,
  clearRateCache,
  earnedForRep,
  earnedBetween,
  earnedLinesForRep,
  boxesSettledByRep,
  currentRates,
  rateForProductOnOrder,
  computeForRep,
  summaryAllReps,
  requestWithdrawal,
  listWithdrawals,
  decideWithdrawal,
};
