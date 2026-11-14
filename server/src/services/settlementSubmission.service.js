'use strict';

// Settlement submissions — the approval gate for settling boxes. A rep submits;
// the record sits PENDING with ZERO business impact (no Sale, so no revenue,
// profit, commission or today's-sales). Only when The Doctor APPROVES does the
// real settle effect run (settlement.settleBoxesTx creates the CASH sale, which
// is what feeds every metric). Mirrors the Return approval flow.

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const inventory = require('./inventory.service');
const settlement = require('./settlement.service');
const finance = require('./finance.service');
const notification = require('./notification.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2, formatCurrency } = require('../utils/money');

// ── Submit (PENDING — no Sale, no impact) ────────────────────────────────────

// ONE line of a submission, inside a transaction: every check, and the PENDING
// row. Shared by the single submit and the several-at-once submit below, so a
// product can never be accepted by one and refused by the other.
async function submitLineTx(tx, settlementId, payload, actor) {
  const productId = payload.productId;
  const boxes = Math.trunc(Number(payload.boxes));
  if (!productId) throw ApiError.badRequest('Select a product to settle');
  if (!Number.isInteger(boxes) || boxes <= 0) throw ApiError.badRequest('Boxes settled must be a positive whole number');

  await settlement.lockOrder(tx, settlementId);
  const s = await tx.settlement.findUnique({
    where: { id: settlementId },
    include: { salesRep: { include: { user: { select: { id: true, name: true } } } } },
  });
  if (!s) throw ApiError.notFound('Settlement not found');
  if (s.status === 'SETTLED') throw ApiError.badRequest('This order is already closed');
  // Reps may only submit against their own order.
  if (actor?.salesRepId && s.salesRepId !== actor.salesRepId) {
    throw ApiError.forbidden('This order is not yours');
  }

  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, sellingPrice: true, brandId: true, isActive: true } });
  if (!product) throw ApiError.badRequest('Product not found');
  // A switched-off product cannot be sold, so its settlement could never be approved: it was accepted and
  // then sat waiting for good (audit #110). Said now, with the two ways out.
  if (product.isActive === false) {
    throw ApiError.badRequest(`${product.name} is switched off, so it can't be settled. Ask ZELab to switch it back on, or return these boxes on the order.`);
  }

  // Where the rep says the money went. Stored on the submission; on approval
  // the income lands in THIS account. A brand settles to ONE account — OHIS
  // to M-Pesa, Civlily to Airtel Money — so what may be ACCEPTED here is
  // exactly what the rep was OFFERED, read from the same function rather
  // than re-derived: a second copy of the rule is a second rule.
  // The account is ALWAYS resolved here, as the screen does it: the one account offered, or the one the rep
  // picked. A submission with no account used to be saved under whatever `method` the caller typed
  // ("CASH"), which the owner then read while the money was booked to the brand's wallet (audit, 11 Nov 2026).
  const allowed = await finance.paymentAccountsForBrand(product.brandId || null);
  const account = payload.accountId
    ? allowed.find((a) => a.id === payload.accountId) || null
    : allowed.length === 1 ? allowed[0] : null;
  if (!account) {
    const one = payload.accountId ? allowed[0] : null; // no account chosen where there is a choice: say so
    throw ApiError.badRequest(one
      ? `${product.name} settles to ${one.name}. Submit the money there.`
      : 'Select a valid payment account');
  }
  const pkg = await tx.productPackaging.findFirst({ where: { productId, isBaseUnit: true } });
  if (!pkg) throw ApiError.badRequest(`${product.name} has no base (Box) packaging configured`);
  const { baseQuantity } = await inventory.convertToBase(tx, productId, pkg.packagingUnitId, boxes);

  // Outstanding boxes, minus boxes already sitting on PENDING submissions for the same product (so a rep
  // can't submit the same boxes twice) AND boxes locked in a PENDING return (so the same boxes can't be both
  // settled and returned — audit, 11 Nov 2026).
  const outstanding = await settlement.productOutstanding(tx, s, productId);
  const [pendingSubs, pendingRets] = await Promise.all([
    settlement.pendingSubmissionBoxes(tx, settlementId),
    settlement.pendingReturnBoxes(tx, settlementId),
  ]);
  const inReturn = pendingRets.get(productId) || 0;
  const inSettlement = pendingSubs.get(productId) || 0;
  const available = outstanding - inSettlement - inReturn;
  if (baseQuantity > available) {
    // Nothing left because the boxes are already sent and waiting (typically a retry after a lost
    // answer): say that, so the rep knows his first send went through (audit backend-integrity-5).
    if (available <= 0 && inSettlement > 0 && inReturn === 0) {
      throw ApiError.badRequest(`These ${product.name} boxes are already sent and waiting for ZELab to approve — nothing more to submit on this order.`);
    }
    throw ApiError.badRequest(inReturn > 0
      ? `Only ${Math.max(0, available)} box(es) of ${product.name} can still be submitted on this order — ${inReturn} box(es) are in a return waiting for ZELab.`
      : `Only ${Math.max(0, available)} box(es) of ${product.name} can still be submitted on this order${inSettlement > 0 ? ` — ${inSettlement} box(es) are already sent and waiting for ZELab` : ''}`);
  }

  const amount = round2(baseQuantity * toNumber(product.sellingPrice));
  const submissionNumber = await nextDocNumber(tx.settlementSubmission, 'submissionNumber', 'SUB');
  const sub = await tx.settlementSubmission.create({
    data: {
      submissionNumber,
      settlementId,
      salesRepId: s.salesRepId,
      productId,
      packagingUnitId: pkg.packagingUnitId,
      productName: product.name,
      boxes,
      baseQuantity,
      amount,
      method: account.name,
      accountId: account.id,
      status: 'PENDING',
      submittedById: actor ? actor.id : null,
    },
  });
  return { sub, settlement: s, product };
}

// The owner is told once per submission: a bell notice and a WhatsApp message.
// Several products sent together are ONE notice and ONE message, not one each.
function tellOwner(results, actor) {
  const { settlement: s } = results[0];
  const repName = s.salesRep?.user?.name || actor?.name || 'A rep';
  const wa = require('./whatsappNotify.service');
  if (results.length === 1) {
    const { sub, product } = results[0];
    notification.notifyAdmins({
      type: 'GENERAL',
      severity: 'INFO',
      title: 'New settlement awaiting approval',
      forStaff: true, // staff approve settlements today (D32)
      message: `${repName} submitted ${sub.boxes} box(es) of ${product.name} (${formatCurrency(sub.amount)}) on order ${s.settlementNumber}. Verify the money and approve.`,
      entityType: 'Settlement',
      entityId: s.id,
    }).catch(() => {});
    wa.background(wa.settlementSubmitted({ sub, settlement: s, product, repName }));
    return;
  }
  const boxes = results.reduce((n, r) => n + r.sub.boxes, 0);
  const total = results.reduce((n, r) => n + toNumber(r.sub.amount), 0);
  notification.notifyAdmins({
    type: 'GENERAL',
    severity: 'INFO',
    title: 'New settlement awaiting approval',
    forStaff: true, // staff approve settlements today (D32)
    message: `${repName} submitted ${results.length} products (${boxes} box(es), ${formatCurrency(total)}) on order ${s.settlementNumber}. Verify the money and approve.`,
    entityType: 'Settlement',
    entityId: s.id,
  }).catch(() => {});
  wa.background(wa.settlementSubmittedBatch({ results, settlement: s, repName }));
}

async function submit(settlementId, payload, actor) {
  const result = await prisma.$transaction((tx) => submitLineTx(tx, settlementId, payload, actor), { timeout: 30000 });
  tellOwner([result], actor);
  return result.sub;
}

// Several products on one order in one go ("submit what I sold" as a list, not one
// at a time). Each line is its own PENDING submission — approving, rejecting and
// commission work exactly as they do for a single one — but all of them are
// created in ONE transaction, so a line that fails (too many boxes, a wrong
// payment account) saves none of the others, and the owner gets one message.
const MAX_LINES = 20;
async function submitMany(settlementId, payload, actor) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) throw ApiError.badRequest('Choose at least one product to settle');
  if (items.length > MAX_LINES) throw ApiError.badRequest(`Submit at most ${MAX_LINES} products at once`);
  const ids = items.map((i) => i?.productId);
  if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Each product can be listed once');

  const results = await prisma.$transaction(async (tx) => {
    const done = [];
    for (const item of items) done.push(await submitLineTx(tx, settlementId, item, actor));
    return done;
  }, { timeout: 30000 });

  tellOwner(results, actor);
  return results.map((r) => r.sub);
}

// ── Approve — run the real settle effect (sale + commission + all metrics) ────
async function approve(submissionId, actor) {
  const sub = await prisma.settlementSubmission.findUnique({ where: { id: submissionId } });
  if (!sub) throw ApiError.notFound('Settlement submission not found');
  if (sub.status !== 'PENDING') throw ApiError.conflict(`This submission is already ${sub.status.toLowerCase()}`);

  const out = await prisma.$transaction(async (tx) => {
    // Claim it first, and only if it is still pending (audit, 11 Nov 2026): a double tap or a second admin
    // waits for this one, then finds it decided — the sale and the commission are recorded exactly once.
    const claimed = await tx.settlementSubmission.updateMany({
      where: { id: submissionId, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById: actor ? actor.id : null, decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw ApiError.conflict('This submission was already decided.');
    const { sale, settlement: dec } = await settlement.settleBoxesTx(
      tx,
      { settlementId: sub.settlementId, productId: sub.productId, packagingUnitId: sub.packagingUnitId, boxes: sub.boxes, method: sub.method },
      actor,
    );
    await tx.settlementSubmission.update({ where: { id: submissionId }, data: { saleId: sale.id } });
    return { dec, sale };
  }, { timeout: 30000 });

  // Approved settlement money lands in the ledger — in the payment account the
  // rep chose on submission (falls back to Cash), tagged with the product's
  // brand so OHIS and Civlily books stay separate. Keyed to the sale (refId) so
  // the historical backfill never double-counts it.
  const prod = await prisma.product.findUnique({ where: { id: sub.productId }, select: { brandId: true } }).catch(() => null);
  finance.recordSaleIncome({
    saleId: out.sale.id,
    saleNumber: out.sale.saleNumber,
    amount: toNumber(out.sale.total),
    fromSettlement: true,
    who: out.dec.salesRep?.user?.name,
    occurredAt: out.sale.soldAt,
    accountId: sub.accountId || null,
    brandId: prod?.brandId || null,
  }, actor).catch(() => {});

  const rep = await prisma.salesRepresentative.findUnique({ where: { id: sub.salesRepId }, select: { userId: true } });
  const closed = out.dec.status === 'SETTLED';
  // Commission the rep just earned on these boxes + their new available balance,
  // so the "settlement approved" message shows the money — in-app and WhatsApp.
  let earnedLine = 'Commission has been credited.';
  let figures = { earned: null, available: null }; // for the WhatsApp text; null leaves those two lines out
  try {
    const commission = require('./commission.service');
    const perBox = toNumber(await commission.rateForProductOnOrder(sub.settlementId, sub.productId));
    const earned = round2(sub.boxes * perBox);
    const c = await commission.computeForRep(sub.salesRepId);
    figures = { earned, available: c.available };
    earnedLine = `You earned ${formatCurrency(earned)} commission (${sub.boxes} box(es) × ${formatCurrency(perBox)}). Available balance: ${formatCurrency(c.available)}.`;
  } catch { /* rule optional */ }
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Settlement approved',
    message: closed
      ? `Your settlement of ${sub.boxes} box(es) of ${sub.productName} was approved and order ${out.dec.settlementNumber} is now fully closed. ${earnedLine}`
      : `Your settlement of ${sub.boxes} box(es) of ${sub.productName} (${formatCurrency(sub.amount)}) was approved. ${earnedLine}`,
    whatsapp: {
      kind: 'SETTLEMENT_APPROVED',
      boxes: sub.boxes,
      product: sub.productName,
      amount: sub.amount,
      earned: figures.earned,
      available: figures.available,
      closed,
      order: out.dec.settlementNumber,
    },
    entityType: 'Settlement',
    entityId: sub.settlementId,
  }).catch(() => {});
  // Commission just accrued — tell the rep (and the owner) if the balance
  // now clears the withdrawal threshold.
  const wa = require('./whatsappNotify.service');
  wa.background(wa.commissionReadyCheck(sub.salesRepId));
  // An approved settlement is the only thing that grows qualifying sales, so
  // this is where a rep can cross a bonus target: the milestone is credited into
  // his wallet (once, under his row lock) and he and the owner are told. Runs
  // after the response; a no-op until a line is actually crossed.
  wa.background(
    require('./bonus.service').creditMilestones(sub.salesRepId).catch(() => null),
  );

  return out.dec;
}

// ── Reject — no business impact ──────────────────────────────────────────────
async function reject(submissionId, actor, reason) {
  const sub = await prisma.settlementSubmission.findUnique({ where: { id: submissionId } });
  if (!sub) throw ApiError.notFound('Settlement submission not found');
  if (sub.status !== 'PENDING') throw ApiError.conflict(`This submission is already ${sub.status.toLowerCase()}`);

  // Only if it is still pending at the moment of writing (an approval may be landing at the same time).
  const done = await prisma.settlementSubmission.updateMany({
    where: { id: submissionId, status: 'PENDING' },
    data: { status: 'REJECTED', rejectionReason: reason || null, decidedById: actor ? actor.id : null, decidedAt: new Date() },
  });
  if (done.count !== 1) throw ApiError.conflict('This submission was already decided.');
  const updated = await prisma.settlementSubmission.findUnique({ where: { id: submissionId } });

  const rep = await prisma.salesRepresentative.findUnique({ where: { id: sub.salesRepId }, select: { userId: true } });
  notification.notifyUser(rep?.userId, {
    type: 'GENERAL',
    severity: 'WARNING',
    title: 'Settlement rejected',
    message: `Your settlement of ${sub.boxes} box(es) of ${sub.productName} was rejected. Please review and resubmit.${reason ? ` Reason: ${reason}` : ''}`,
    whatsapp: { kind: 'SETTLEMENT_REJECTED', boxes: sub.boxes, product: sub.productName, reason },
    entityType: 'Settlement',
    entityId: sub.settlementId,
  }).catch(() => {});

  return updated;
}

// ── Pending approvals list (admin approval center) ───────────────────────────
async function listPending() {
  const subs = await prisma.settlementSubmission.findMany({ where: { status: 'PENDING' }, orderBy: { submittedAt: 'asc' } });
  const repIds = [...new Set(subs.map((s) => s.salesRepId))];
  const stlIds = [...new Set(subs.map((s) => s.settlementId))];
  const [reps, stls] = await Promise.all([
    prisma.salesRepresentative.findMany({ where: { id: { in: repIds } }, include: { user: { select: { name: true } } } }),
    prisma.settlement.findMany({ where: { id: { in: stlIds } }, select: { id: true, settlementNumber: true } }),
  ]);
  const repName = new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
  const stlNum = new Map(stls.map((s) => [s.id, s.settlementNumber]));
  return subs.map((s) => ({
    id: s.id,
    submissionNumber: s.submissionNumber,
    settlementId: s.settlementId,
    settlementNumber: stlNum.get(s.settlementId) || null,
    salesRep: repName.get(s.salesRepId) || null,
    productName: s.productName,
    boxes: s.boxes,
    amount: toNumber(s.amount),
    method: s.method,
    submittedAt: s.submittedAt,
  }));
}

module.exports = { submit, submitMany, approve, reject, listPending };
