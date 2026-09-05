'use strict';

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const dashboard = require('../services/dashboard.service');
const inventory = require('../services/inventory.service');
const commission = require('../services/commission.service');
const settlement = require('../services/settlement.service');
const penalty = require('../services/penalty.service');
const { toNumber, round2 } = require('../utils/money');

const overview = asyncHandler(async (_req, res) => {
  const data = await dashboard.overview();
  return ok(res, data);
});

const activity = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 15;
  const data = await dashboard.recentActivity(limit);
  return ok(res, data);
});

const brands = asyncHandler(async (_req, res) => {
  return ok(res, await dashboard.brandBreakdown());
});

// Personal dashboard for a sales representative — built around the rep's real
// job: stock held, open orders (72h settlements), and commission on settled
// boxes. Reps do not record customer sales, so there are no sales figures here.
const myOverview = asyncHandler(async (req, res) => {
  const salesRepId = req.user.salesRepId;
  if (!salesRepId) throw ApiError.forbidden('Your account has no sales-rep profile');

  // Reps poll this every ~60s, so it doubles as the heartbeat that fires due
  // reminders, applies overdue penalties and retries queued WhatsApp sends.
  // background() keeps the work alive after the response (Vercel freeze).
  const wa = require('../services/whatsappNotify.service');
  wa.background(settlement.sendDueReminders());
  wa.background(penalty.applyDuePenalties());
  wa.background(require('../services/returns.service').expireStaleReturns());
  wa.background(wa.flush());

  const [balances, commissionData, openOrders, pendingRequests] = await Promise.all([
    inventory.repBalances(prisma, salesRepId),
    commission.computeForRep(salesRepId),
    prisma.settlement.findMany({
      where: { salesRepId, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
      orderBy: { deadlineAt: 'asc' },
      include: { salesRep: { include: { user: { select: { name: true } } } } },
    }),
    prisma.stockRequest.count({ where: { salesRepId, status: 'PENDING' } }),
  ]);

  // Value held stock at cost.
  const positive = balances.filter((b) => b.baseQuantity > 0);
  const products = await prisma.product.findMany({
    where: { id: { in: positive.map((b) => b.productId) } },
    select: { id: true, purchasePrice: true },
  });
  const costMap = new Map(products.map((p) => [p.id, toNumber(p.purchasePrice)]));
  const heldValue = round2(positive.reduce((s, b) => s + b.baseQuantity * (costMap.get(b.productId) || 0), 0));
  const heldUnits = positive.reduce((s, b) => s + b.baseQuantity, 0);

  // What each open order is MADE OF, not just what it is worth. Same three
  // queries the orders list already runs, so the two screens can never
  // disagree about how many boxes a rep is carrying.
  const boxesByOrder = await settlement.boxesForOrders(openOrders);

  const orders = openOrders.map((s) => {
    const dec = settlement.decorate(s);
    return {
      boxes: boxesByOrder.get(s.id) || { issued: 0, settled: 0, returned: 0, remaining: 0, pendingSubmitted: 0, pendingReturned: 0 },
      id: s.id,
      settlementNumber: s.settlementNumber,
      value: toNumber(s.assignedValue),
      settled: toNumber(s.settledValue),
      balance: dec.balance,
      deadlineAt: s.deadlineAt,
      hoursRemaining: dec.hoursRemaining,
      status: dec.status,
      approaching: dec.approaching,
    };
  });
  const openSettlementsValue = round2(orders.reduce((s, o) => s + o.balance, 0));
  // Boxes still on the rep across every open order at once — the figure the
  // settlement tile leads with, since a rep carrying two orders thinks in one
  // pile of stock rather than in two.
  const openSettlementBoxes = orders.reduce((s, o) => s + (o.boxes?.remaining || 0), 0);

  return ok(res, {
    heldStock: { value: heldValue, units: heldUnits, lines: positive.length },
    commission: commissionData,
    openSettlements: orders.length,
    openSettlementsValue,
    openSettlementBoxes,
    pendingRequests,
    orders,
  });
});

// Aggregated activity stats for a rep's profile page.
const myStats = asyncHandler(async (req, res) => {
  const salesRepId = req.user.salesRepId;
  if (!salesRepId) throw ApiError.forbidden('Your account has no sales-rep profile');

  const [activeRequests, completedRequests, boxesSettled, boxesReturnedAgg] = await Promise.all([
    prisma.stockRequest.count({ where: { salesRepId, status: { in: ['PENDING', 'APPROVED'] } } }),
    prisma.stockRequest.count({ where: { salesRepId, status: 'FULFILLED' } }),
    commission.boxesSettledByRep(salesRepId),
    prisma.returnItem.aggregate({
      where: { return: { salesRepId, type: 'SALES_RETURN', status: 'COMPLETED' } },
      _sum: { baseQuantity: true },
    }),
  ]);

  return ok(res, {
    activeRequests,
    completedRequests,
    boxesSettled,
    boxesReturned: boxesReturnedAgg._sum.baseQuantity || 0,
  });
});

// Counts of items awaiting The Doctor's action — drives the sidebar badges.
// Each stays counted until it's approved or rejected (i.e. acted on).
const pendingActions = asyncHandler(async (_req, res) => {
  // Admin polls this every ~30s — piggyback WhatsApp delivery retries and the
  // evening-summary fallback here (both internally throttled, never block).
  const wa = require('../services/whatsappNotify.service');
  wa.background(wa.flush());
  wa.background(wa.dailySummaryCatchup());
  wa.background(require('../services/returns.service').expireStaleReturns());

  const [stockRequests, pendingSubs, returns, overdue] = await Promise.all([
    prisma.stockRequest.count({ where: { status: 'PENDING' } }),
    prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
    prisma.return.count({ where: { status: 'PENDING' } }),
    prisma.settlement.count({ where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, deadlineAt: { lt: new Date() } } }),
  ]);
  // Settlements badge = everything needing action there: approvals + overdue.
  return ok(res, { stockRequests, settlements: pendingSubs + overdue, returns });
});

// The composed command-center payload for the admin dashboard.
const command = asyncHandler(async (_req, res) => ok(res, await dashboard.command()));

module.exports = { overview, activity, brands, myOverview, myStats, pendingActions, command };
