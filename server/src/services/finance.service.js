'use strict';

// ===========================================================================
// BUSINESS FINANCE
//
// One ledger (FinanceTransaction) is the single source of truth. An account's
// balance = openingBalance + Σ(IN) − Σ(OUT). Auto-income posts when a settlement
// or a warehouse cash sale completes; expenses post OUT. Net business profit =
// gross profit − expenses.
// ===========================================================================

const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const reports = require('./reports.service');
const inventory = require('./inventory.service');
const commission = require('./commission.service');
const { nextDocNumber } = require('../utils/numbering');
const { toNumber, round2 } = require('../utils/money');
const { dayjs, resolveRange } = require('../utils/dates');

// ── Money that never touches a business account ─────────────────────────────
// The owner pays every rep in physical cash out of his own hand: "no business
// account is involved at any point". The ledger still carries a
// COMMISSION_PAYMENT row for each payout, because the record of what each rep
// was paid is exactly what he asked to keep — but that row is a RECORD, not a
// movement. It may not change an account balance and it may not count as the
// business spending money.
//
// Both legs of such a payout are off-account:
//   • the COMMISSION_PAYMENT OUT — the cash he handed the rep;
//   • an OWNER_CONTRIBUTION IN carrying refType 'CommissionWithdrawal' — a
//     legacy row posted to "fund" a payout. Nothing creates these any more,
//     but migration 20260830000007 stamped surviving ones and production may
//     still hold them. Excluding the OUT while leaving the IN would inflate
//     cash by exactly the amount this fix removes.
//
// Written as positive equalities only. A compound `NOT`/`{ not: … }` over a
// nullable column (refType is NULL on every ordinary contribution) leans on
// Prisma's NULL handling, and this figure is too important to rest on that.
const OFF_ACCOUNT_WHERE = {
  OR: [
    { type: 'COMMISSION_PAYMENT' },
    { AND: [{ type: 'OWNER_CONTRIBUTION' }, { refType: 'CommissionWithdrawal' }] },
  ],
};

// Movements that are NOT the business trading: internal transfers, the owner's
// own money going in or coming out, and rep commission paid from his pocket.
// Excluded from money in/out. COMMISSION_PAYMENT belongs here for the same
// reason OWNER_DRAWING does — it is the owner's money, not the business's.
const NON_TRADE_TYPES = ['TRANSFER', 'OWNER_CONTRIBUTION', 'OWNER_DRAWING', 'COMMISSION_PAYMENT'];

// ── The commission account ──────────────────────────────────────────────────
// Rep commission comes out of the owner's own pocket, in cash, for both brands.
// It may not add to or subtract from M-Pesa or Airtel Money — but the RECORD of
// what each rep was paid is exactly what he asked to keep, "held in one place,
// clearly labelled". That place is an account of type COMMISSION.
//
// It is recognised by TYPE, never by name: a name is something a user can
// change, and a rule that breaks when someone renames a card is not a rule.
// Because every row filed against it is off-account (OFF_ACCOUNT_WHERE), its
// BALANCE is zero by design; what it reports instead is the TOTAL RECORDED.
const COMMISSION_TYPE = 'COMMISSION';
const COMMISSION_ACCOUNT_NAME = 'Commission';
const COMMISSION_ACCOUNT_NOTES =
  "Rep commission, paid by the owner in cash from his own pocket. A record only — no money is held here, so the balance is always zero.";
// Not a wallet the business trades through. Nothing may target one of these by
// default, offer one to a rep, or move money in or out of one.
const MONEY_ACCOUNT_WHERE = { type: { notIn: [COMMISSION_TYPE, 'CASH'] } };

// Generic payment accounts — WHERE money sits. The brand a transaction belongs
// to is a separate dimension (FinanceTransaction.brandId), but a WALLET is now
// bound to its brand: OHIS settles to M-Pesa, Civlily to Airtel Money, so a rep
// settling sees exactly one option instead of a choice they can get wrong.
//
// There is no Cash account. The business does not accept cash payments and
// holds no money in cash; the only cash in the story is the commission the
// owner hands reps himself, and that is a record, not a wallet.
const DEFAULT_ACCOUNTS = [
  { name: 'M-Pesa', type: 'MOBILE_MONEY', sortOrder: 1, brand: /^ohis/i, notes: '0766 790 794 · CASMIRY CHUWA · OHIS payments' },
  { name: 'Airtel Money', type: 'MOBILE_MONEY', sortOrder: 2, brand: /^civ/i, notes: '0788 734 003 · CASMIRY CHUWA · Civlily payments' },
  { name: COMMISSION_ACCOUNT_NAME, type: COMMISSION_TYPE, sortOrder: 90, notes: COMMISSION_ACCOUNT_NOTES },
];
const DEFAULT_CATEGORIES = [
  'Stock Purchase', 'Shipping', 'Freight', 'Customs', 'Warehouse', 'Transport',
  'Fuel', 'Marketing', 'Packaging', 'Salaries', 'Commission Payments', 'Internet',
  'Office Expenses', 'Utilities', 'Miscellaneous',
];

let ensured = false;
// Seed the default accounts + expense categories once (idempotent).
async function ensureDefaults() {
  if (ensured) return;
  if ((await prisma.businessAccount.count()) === 0) {
    const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
    for (const a of DEFAULT_ACCOUNTS) {
      const brand = a.brand ? brands.find((b) => a.brand.test(b.name)) : null;
      await prisma.businessAccount.create({
        data: {
          name: a.name, type: a.type, brandId: brand ? brand.id : null,
          isDefault: false, sortOrder: a.sortOrder, notes: a.notes || null,
        },
      });
    }
  }
  if ((await prisma.expenseCategory.count()) === 0) {
    await prisma.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ name, isDefault: true })), skipDuplicates: true });
  }
  ensured = true;
}

// Delegates to resolveRange so every window is the BUSINESS's day (EAT), not
// the server's. This function used dayjs() directly, which on Vercel (UTC)
// shifted every boundary three hours — the first sales of each Tanzanian
// morning were landing in the previous day, week and month.
function periodRange(period) {
  if (!period || period === 'all') return null; // all time
  return resolveRange({ period });
}

// --- Accounts --------------------------------------------------------------

async function accountBalances() {
  await ensureDefaults();
  // Balances = opening + post-epoch movements. Pre-epoch ledger rows are audit
  // history only; the accounts' openingBalance IS the truth at the epoch.
  const epoch = await reports.financeEpoch();
  const window = epoch ? { occurredAt: { gte: epoch } } : {};
  const [accounts, grouped, offAccount] = await Promise.all([
    prisma.businessAccount.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.financeTransaction.groupBy({
      by: ['accountId', 'direction'],
      where: window,
      _sum: { amount: true },
    }),
    // The same rows again, narrowed to the ones that never touched an account
    // (see OFF_ACCOUNT_WHERE). Taken back off below, so a rep payout leaves the
    // record in the ledger and the balance where it was. Subtracting a second
    // whole population beats filtering the first: no NULL semantics involved.
    prisma.financeTransaction.groupBy({
      by: ['accountId', 'direction'],
      where: { ...window, ...OFF_ACCOUNT_WHERE },
      _sum: { amount: true },
    }),
  ]);
  const inMap = new Map();
  const outMap = new Map();
  grouped.forEach((g) => (g.direction === 'IN' ? inMap : outMap).set(g.accountId, toNumber(g._sum.amount)));
  const offInMap = new Map();
  const offOutMap = new Map();
  offAccount.forEach((g) => (g.direction === 'IN' ? offInMap : offOutMap).set(g.accountId, toNumber(g._sum.amount)));
  return accounts.map((a) => {
    const moneyIn = round2((inMap.get(a.id) || 0) - (offInMap.get(a.id) || 0));
    const moneyOut = round2((outMap.get(a.id) || 0) - (offOutMap.get(a.id) || 0));
    const opening = toNumber(a.openingBalance);
    return {
      id: a.id, name: a.name, type: a.type, currency: a.currency, isDefault: a.isDefault, notes: a.notes,
      brandId: a.brandId || null,
      openingBalance: opening, moneyIn, moneyOut, balance: round2(opening + moneyIn - moneyOut),
      // A commission account holds nothing — every row filed against it is one
      // the owner paid out of his own hand, and those are subtracted back out
      // above. The number that matters on it is what has been RECORDED there,
      // which is the same population, taken from the other side. Reported as
      // its own field so no screen can print it under the word "balance".
      isCommissionRecord: a.type === COMMISSION_TYPE,
      recorded: round2(offOutMap.get(a.id) || 0),
    };
  });
}

// The last-resort wallet for money that arrives with no brand on it. It can
// never be the commission account (that would put a payout back into a figure
// the owner wants kept apart) and it can never be a cash account (there is no
// cash) — retiring Cash without this guard would have silently re-targeted
// every commission payout at M-Pesa or Airtel.
async function defaultAccount() {
  await ensureDefaults();
  return (
    (await prisma.businessAccount.findFirst({ where: { ...MONEY_ACCOUNT_WHERE, isDefault: true, isActive: true }, orderBy: { createdAt: 'asc' } })) ||
    (await prisma.businessAccount.findFirst({ where: { ...MONEY_ACCOUNT_WHERE, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }))
  );
}

// The one place the record of commission is held. Self-healing: if the account
// is missing it is created, and if someone deactivated it, it comes back —
// because the alternative is a payout falling back onto a wallet, which is the
// one outcome the owner asked to make impossible.
async function commissionAccount() {
  const existing = await prisma.businessAccount.findFirst({
    where: { type: COMMISSION_TYPE },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    if (existing.isActive) return existing;
    return prisma.businessAccount.update({ where: { id: existing.id }, data: { isActive: true } });
  }
  // `name` is unique, so an unrelated account already called "Commission"
  // would collide. Suffix rather than fail: the type is what identifies it.
  for (const name of [COMMISSION_ACCOUNT_NAME, 'Commission record', 'Commission (record)']) {
    const clash = await prisma.businessAccount.findUnique({ where: { name } });
    if (clash) continue;
    return prisma.businessAccount.create({
      data: { name, type: COMMISSION_TYPE, isDefault: false, sortOrder: 90, notes: COMMISSION_ACCOUNT_NOTES },
    });
  }
  return null;
}

// The accounts a rep may settle into for a given brand — and the accounts the
// owner picks from when money moves. One brand, one wallet: an account bound to
// a brand serves only that brand, and an unbound wallet is offered only when
// the brand has none of its own. Cash and the commission account are never in
// the list. This is THE filter behind GET /settlements/payment-accounts; the
// client renders what it returns rather than re-deciding it on its own.
async function paymentAccountsForBrand(brandId) {
  await ensureDefaults();
  const accounts = await prisma.businessAccount.findMany({
    where: { ...MONEY_ACCOUNT_WHERE, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, type: true, notes: true, isDefault: true, brandId: true },
  });
  // No brand named (a mixed-brand counter sale, or a product with no brand):
  // every wallet, because the money has to go somewhere and there is no
  // general wallet any more. Never an empty list — that would leave the till
  // with nowhere to bank.
  if (!brandId) return accounts;
  const own = accounts.filter((a) => a.brandId === brandId);
  return own.length ? own : accounts.filter((a) => !a.brandId);
}

// Where a brand's money lands when nobody chose an account.
// Where a brand's money goes. Falling through to the default for a KNOWN brand
// is how a third brand's takings would quietly land in OHIS's wallet: the
// default is a real money account, so nothing would look wrong until the
// figures were read. A brand with no account of its own returns null, and the
// caller has to say so out loud instead.
async function settlementAccountFor(brandId) {
  const [first] = await paymentAccountsForBrand(brandId);
  if (first) return first;
  return brandId ? null : defaultAccount();
}

async function createAccount(data) {
  const name = (data.name || '').trim();
  if (!name) throw ApiError.badRequest('Account name is required');
  // One commission account, or the record stops being "held in one place".
  if (data.type === COMMISSION_TYPE) {
    throw ApiError.badRequest('There is already one Commission account, and the record of every payout is held there.');
  }
  if (data.type === 'CASH') {
    throw ApiError.badRequest('The business does not hold money in cash. Add the bank or mobile-money account the money actually sits in.');
  }
  if (data.brandId) {
    const taken = await prisma.businessAccount.findFirst({ where: { brandId: data.brandId, isActive: true } });
    if (taken) throw ApiError.badRequest(`${taken.name} is already this brand's settlement account. A brand settles to one account, so reps see one option.`);
  }
  const max = await prisma.businessAccount.aggregate({ _max: { sortOrder: true } });
  return prisma.businessAccount.create({
    data: {
      name,
      type: data.type || 'OTHER',
      brandId: data.brandId || null,
      openingBalance: round2(toNumber(data.openingBalance)),
      notes: data.notes || null,
      sortOrder: (max._max.sortOrder || 0) + 1,
    },
  });
}

async function updateAccount(id, data) {
  const existing = await prisma.businessAccount.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Account not found');
  if (existing.type === COMMISSION_TYPE) {
    if (data.type !== undefined && data.type !== COMMISSION_TYPE) {
      throw ApiError.badRequest('This is the Commission account. Changing its type would put rep payouts back onto a wallet.');
    }
    if (data.isActive === false) {
      throw ApiError.badRequest('The Commission account cannot be closed — it is where the record of every payout is kept.');
    }
  } else if (data.type === COMMISSION_TYPE) {
    throw ApiError.badRequest('Only the Commission account can be of that type.');
  }
  const patch = {};
  ['name', 'type', 'notes'].forEach((k) => { if (data[k] !== undefined) patch[k] = data[k]; });
  if (data.brandId !== undefined) patch.brandId = data.brandId || null;
  if (data.openingBalance !== undefined) patch.openingBalance = round2(toNumber(data.openingBalance));
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  return { updated: await prisma.businessAccount.update({ where: { id }, data: patch }), previous: existing };
}

// --- Historical backfill -----------------------------------------------------
// Rebuild the finance ledger from the REAL business records that already exist:
// every settled sale and direct warehouse CASH sale becomes an IN transaction
// (dated when the money actually arrived), every PAID commission withdrawal an
// OUT. Idempotent — keyed by refId — so it never double-counts and self-heals
// if an auto-post hook was ever missed. No fake data: only derived records.
async function backfillFromHistory() {
  await ensureDefaults();
  const acc = await defaultAccount();
  if (!acc) return { incomeCreated: 0, paymentsCreated: 0 };
  // Sale money goes to the wallet its brand settles to; only a sale whose brand
  // cannot be determined falls back. Rebuilding every row into "the default"
  // is how 501,000 of settlement money ended up filed under Cash.
  const accountForBrand = new Map();
  const walletFor = async (brandId) => {
    if (!brandId) return acc;
    if (!accountForBrand.has(brandId)) accountForBrand.set(brandId, (await settlementAccountFor(brandId)) || acc);
    return accountForBrand.get(brandId);
  };
  // Only sales from the finance epoch onward create ledger money — pre-epoch
  // activity is history, already represented by the accounts' opening balances.
  const epoch = await reports.financeEpoch();

  // Money in: settlement-linked sales (settled boxes = cash received) and
  // direct warehouse CASH sales (no rep).
  const [sales, existingSaleTxns] = await Promise.all([
    prisma.sale.findMany({
      where: {
        status: { not: 'CANCELLED' },
        type: 'CASH',
        OR: [{ settlementId: { not: null } }, { salesRepId: null }],
        ...(epoch ? { soldAt: { gte: epoch } } : {}),
      },
      select: {
        id: true, saleNumber: true, total: true, soldAt: true, settlementId: true,
        salesRep: { select: { user: { select: { name: true } } } },
      },
      orderBy: { soldAt: 'asc' },
    }),
    prisma.financeTransaction.findMany({ where: { refType: 'Sale' }, select: { refId: true } }),
  ]);
  const have = new Set(existingSaleTxns.map((t) => t.refId));

  // Which brand each sale belongs to (single-brand sales only; mixed = null).
  const saleIds = sales.map((s) => s.id);
  const saleItems = saleIds.length
    ? await prisma.saleItem.findMany({
        where: { saleId: { in: saleIds } },
        select: { saleId: true, product: { select: { brandId: true } } },
      })
    : [];
  const brandsBySale = new Map();
  for (const it of saleItems) {
    const set = brandsBySale.get(it.saleId) || new Set();
    if (it.product?.brandId) set.add(it.product.brandId);
    brandsBySale.set(it.saleId, set);
  }
  const saleBrand = (saleId) => {
    const set = brandsBySale.get(saleId);
    return set && set.size === 1 ? [...set][0] : null;
  };

  let incomeCreated = 0;
  for (const s of sales) {
    if (have.has(s.id)) continue;
    const fromSettlement = !!s.settlementId;
    const txnNumber = await nextDocNumber(prisma.financeTransaction, 'txnNumber', 'FTX');
    const wallet = await walletFor(saleBrand(s.id));
    await prisma.financeTransaction.create({
      data: {
        txnNumber,
        accountId: wallet.id,
        direction: 'IN',
        type: fromSettlement ? 'SETTLEMENT' : 'WAREHOUSE_SALE',
        amount: round2(toNumber(s.total)),
        brandId: saleBrand(s.id),
        category: fromSettlement ? 'Settlement received' : 'Warehouse sale',
        description: fromSettlement
          ? `Settlement received${s.salesRep?.user?.name ? ` — ${s.salesRep.user.name}` : ''}`
          : 'Direct warehouse sale',
        reference: s.saleNumber,
        refType: 'Sale',
        refId: s.id,
        occurredAt: s.soldAt,
      },
    });
    incomeCreated++;
  }

  // Retro-tag brand on sale-income rows created before the brand dimension
  // existed (idempotent — only touches rows still missing a brand).
  const untagged = await prisma.financeTransaction.findMany({
    where: { refType: 'Sale', brandId: null, refId: { in: saleIds } },
    select: { id: true, refId: true },
  });
  let brandTagged = 0;
  for (const t of untagged) {
    const b = saleBrand(t.refId);
    if (!b) continue;
    await prisma.financeTransaction.update({ where: { id: t.id }, data: { brandId: b } });
    brandTagged++;
  }

  // Money out: commission withdrawals PAID from the epoch onward.
  const [paidWithdrawals, existingWTxns] = await Promise.all([
    prisma.commissionWithdrawal.findMany({
      where: { status: 'PAID', ...(epoch ? { OR: [{ paidAt: { gte: epoch } }, { paidAt: null, decidedAt: { gte: epoch } }] } : {}) },
      include: { salesRep: { include: { user: { select: { name: true } } } } },
    }),
    prisma.financeTransaction.findMany({ where: { refType: 'CommissionWithdrawal' }, select: { refId: true } }),
  ]);
  const haveW = new Set(existingWTxns.map((t) => t.refId));
  let paymentsCreated = 0;
  // The record of every payout is held in one place — never rebuilt onto a
  // wallet, which is what the owner asked to make impossible.
  const commAcc = paidWithdrawals.length ? await commissionAccount() : null;
  for (const w of paidWithdrawals) {
    if (haveW.has(w.id)) continue;
    if (!commAcc) break;
    const txnNumber = await nextDocNumber(prisma.financeTransaction, 'txnNumber', 'FTX');
    await prisma.financeTransaction.create({
      data: {
        txnNumber,
        accountId: commAcc.id,
        direction: 'OUT',
        type: 'COMMISSION_PAYMENT',
        amount: round2(toNumber(w.amount)),
        category: 'Commission Payments',
        description: `Commission paid${w.salesRep?.user?.name ? ` — ${w.salesRep.user.name}` : ''}`,
        refType: 'CommissionWithdrawal',
        refId: w.id,
        occurredAt: w.paidAt || w.decidedAt || w.createdAt,
      },
    });
    paymentsCreated++;
  }

  return { incomeCreated, paymentsCreated, brandTagged };
}

// --- Transactions ----------------------------------------------------------

// A date-only value ("2026-07-05") parses to midnight and would sort BEFORE
// same-day transactions (and before the finance epoch on go-live day), silently
// excluding it from balances. Anchor date-only inputs to the current clock time.
function resolveOccurredAt(v) {
  if (!v) return new Date();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const now = new Date();
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
    return d;
  }
  return new Date(v);
}

async function recordTransaction(data, actor) {
  const amount = round2(toNumber(data.amount));
  if (!(amount > 0)) throw ApiError.badRequest('Amount must be greater than zero');
  const account = await prisma.businessAccount.findUnique({ where: { id: data.accountId } });
  if (!account || !account.isActive) throw ApiError.badRequest('Select a valid account');
  // The commission account holds the record of rep payouts and nothing else.
  // An expense, an income or the owner's own money filed there would print a
  // figure under "recorded" that was never commission.
  if (account.type === COMMISSION_TYPE && data.type !== 'COMMISSION_PAYMENT') {
    throw ApiError.badRequest('The Commission account only holds the record of rep commission. Choose the account the money actually moved through.');
  }
  const txnNumber = await nextDocNumber(prisma.financeTransaction, 'txnNumber', 'FTX');
  return prisma.financeTransaction.create({
    data: {
      txnNumber,
      accountId: data.accountId,
      direction: data.direction,
      type: data.type || (data.direction === 'IN' ? 'INCOME' : 'EXPENSE'),
      amount,
      brandId: data.brandId || null,
      category: data.category || null,
      description: data.description || null,
      reference: data.reference || null,
      refType: data.refType || null,
      refId: data.refId || null,
      receiptUrl: data.receiptUrl || null,
      notes: data.notes || null,
      occurredAt: resolveOccurredAt(data.occurredAt),
      createdById: actor ? actor.id : null,
    },
  });
}

// Money spent on stock is not a P&L expense — the cost of those boxes reaches
// profit as COGS when they sell. Recording it as EXPENSE charged the business
// twice (once here, once in COGS): OHIS's stock buys went through this flow
// and pushed its brand net TSh 3.3M below the truth. The category the user
// picks still shows on the row; only the P&L treatment changes.
const isStockPurchaseCategory = (c) => /stock\s*purchase/i.test(String(c || ''));
// The owner's own money. A contribution is his personal cash entering the
// business (he pays rep commissions this way); a drawing is profit he takes
// out. Neither is trade: excluded from revenue, profit, and money in/out.
const recordOwnerMoney = ({ direction, ...data }, actor) => recordTransaction({
  ...data,
  direction,
  type: direction === 'IN' ? 'OWNER_CONTRIBUTION' : 'OWNER_DRAWING',
  category: direction === 'IN' ? 'Owner contribution' : 'Owner drawing',
}, actor);

const recordExpense = (data, actor) => recordTransaction({
  ...data,
  direction: 'OUT',
  type: isStockPurchaseCategory(data.category) ? 'STOCK_PURCHASE' : 'EXPENSE',
}, actor);
const recordIncome = (data, actor) => recordTransaction({ ...data, direction: 'IN', type: 'INCOME' }, actor);

// Automatic money-in for a completed cash sale (settlement or direct warehouse).
// `accountId` = the payment account the money actually went to (rep's choice on
// submission); falls back to the default (Cash). `brandId` tags whose money it
// is. Best-effort — never throws into the sale/settlement flow.
async function recordSaleIncome({ saleId, saleNumber, amount, fromSettlement, who, occurredAt, accountId, brandId }, actor) {
  try {
    const amt = round2(toNumber(amount));
    if (!(amt > 0)) return null;
    // The rep's chosen account, then the wallet this brand settles to, then
    // the last-resort default. A commission account is never a landing place
    // for sale money, whoever named it.
    let account = null;
    if (accountId) {
      account = await prisma.businessAccount.findFirst({
        where: { id: accountId, isActive: true, ...MONEY_ACCOUNT_WHERE },
      });
    }
    if (!account) account = await settlementAccountFor(brandId || null);
    if (!account) return null;
    return await recordTransaction(
      {
        accountId: account.id,
        direction: 'IN',
        type: fromSettlement ? 'SETTLEMENT' : 'WAREHOUSE_SALE',
        amount: amt,
        brandId: brandId || null,
        category: fromSettlement ? 'Settlement received' : 'Warehouse sale',
        description: fromSettlement ? `Settlement received${who ? ` — ${who}` : ''}` : 'Direct warehouse sale',
        reference: saleNumber || null,
        refType: 'Sale',
        refId: saleId || null,
        occurredAt,
      },
      actor,
    );
  } catch (e) {
    return null;
  }
}

// Automatic money-out when a commission withdrawal is paid.
async function recordCommissionPayment({ amount, who, reference, refId, occurredAt, fromOwnPocket }, actor) {
  try {
    const amt = round2(toNumber(amount));
    if (!(amt > 0)) return null;
    // Reps are paid from the owner's own pocket, never from M-Pesa or Airtel.
    // Those are the brands' income accounts and commission has no business
    // touching them. This used to pin the payout to a CASH account and fall
    // back to the DEFAULT one — so retiring Cash would have quietly sent every
    // payout into a brand's wallet. It now targets the commission account and
    // nothing else: if that account cannot be had, no row is written at all,
    // because a payout on the wrong account is worse than a missing record we
    // can rebuild from the withdrawal itself.
    const acc = await commissionAccount();
    if (!acc) return null;
    // The owner pays reps directly from his pocket — no business account is
    // involved on either side. This row exists ONLY as the record of what the
    // rep was paid (rule: "i only want the record of rep to be there"). It
    // carries an accountId because the column is required, but no aggregate
    // treats it as account movement: OFF_ACCOUNT_WHERE takes it back out of
    // every balance, and NON_TRADE_TYPES keeps it out of money in/out. What he
    // lays out is an investment the business owes him — see ownerFigures().
    return await recordTransaction(
      {
        accountId: acc.id,
        direction: 'OUT',
        type: 'COMMISSION_PAYMENT',
        amount: amt,
        category: 'Commission Payments',
        description: `Commission paid${who ? ` — ${who}` : ''}`,
        reference: reference || null,
        refType: 'CommissionWithdrawal',
        refId: refId || null,
        occurredAt,
      },
      actor,
    );
  } catch (e) {
    return null;
  }
}

async function listTransactions(filters, pagination) {
  const where = {};
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.direction) where.direction = filters.direction;
  if (filters.type) where.type = filters.type;
  if (filters.category) where.category = filters.category;
  // Free-text search across everything a person might remember about a
  // movement — what it was, its reference, its note.
  if (filters.search && String(filters.search).trim()) {
    const term = String(filters.search).trim();
    where.OR = [
      { description: { contains: term, mode: 'insensitive' } },
      { category: { contains: term, mode: 'insensitive' } },
      { reference: { contains: term, mode: 'insensitive' } },
      { notes: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (filters.brandId) where.brandId = filters.brandId === 'none' ? null : filters.brandId;
  if (filters.from || filters.to) {
    where.occurredAt = {};
    if (filters.from) where.occurredAt.gte = new Date(filters.from);
    if (filters.to) where.occurredAt.lte = new Date(filters.to);
  }
  if (filters.minAmount != null || filters.maxAmount != null) {
    where.amount = {};
    if (filters.minAmount != null) where.amount.gte = filters.minAmount;
    if (filters.maxAmount != null) where.amount.lte = filters.maxAmount;
  }
  // Composed with AND, never by spreading: `where` may already carry an `OR`
  // from the free-text search, and a second `OR` key would silently replace it.
  const and = (...parts) => ({ AND: [where, ...parts] });
  const [items, total, brands, inAgg, outAgg, offInAgg, offOutAgg, byCatRows] = await Promise.all([
    prisma.financeTransaction.findMany({
      where,
      include: { account: { select: { name: true, type: true } } },
      skip: pagination.skip,
      take: pagination.take,
      orderBy: pagination.orderBy,
    }),
    prisma.financeTransaction.count({ where }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
    // Totals of the WHOLE filtered view, not the visible page — a strip that
    // changes as you page through it is worse than none.
    prisma.financeTransaction.aggregate({ where: and({ direction: 'IN' }), _sum: { amount: true } }),
    prisma.financeTransaction.aggregate({ where: and({ direction: 'OUT' }), _sum: { amount: true } }),
    // Rows that moved no account balance — rep commission out of the owner's
    // pocket. The ROWS stay in the list (they are the record of what each rep
    // was paid); they come off the money in/out strip so the Ledger agrees with
    // the account balances and with every other screen.
    prisma.financeTransaction.aggregate({ where: and(OFF_ACCOUNT_WHERE, { direction: 'IN' }), _sum: { amount: true } }),
    prisma.financeTransaction.aggregate({ where: and(OFF_ACCOUNT_WHERE, { direction: 'OUT' }), _sum: { amount: true } }),
    prisma.financeTransaction.groupBy({
      by: ['category'],
      // Spending by category, so rep commission has no place in it.
      where: and({ direction: 'OUT' }, { type: { notIn: ['COMMISSION_PAYMENT'] } }),
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const fromPocket = round2(toNumber(offOutAgg._sum.amount));
  const sumIn = round2(toNumber(inAgg._sum.amount) - toNumber(offInAgg._sum.amount));
  const sumOut = round2(toNumber(outAgg._sum.amount) - fromPocket);
  return {
    items: items.map((t) => ({
      ...t,
      brandName: t.brandId ? brandName.get(t.brandId) || null : null,
      // Flagged for the row itself, so a reader can see why a listed amount is
      // absent from the totals above it.
      offAccount: isOffAccount(t),
    })),
    total,
    // `fromPocket` is reported beside in/out, never inside them.
    sums: { in: sumIn, out: sumOut, net: round2(sumIn - sumOut), fromPocket },
    byCategory: byCatRows
      .map((c) => ({ category: c.category || 'Uncategorised', amount: round2(toNumber(c._sum.amount)), count: c._count }))
      .sort((a, b) => b.amount - a.amount),
  };
}

async function updateTransaction(id, data) {
  const existing = await prisma.financeTransaction.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Transaction not found');
  const patch = {};
  ['category', 'description', 'notes', 'accountId', 'reference', 'brandId'].forEach((k) => { if (data[k] !== undefined) patch[k] = data[k]; });
  if (data.amount !== undefined) {
    // Sale-linked money mirrors the sale document — correcting the amount here
    // would silently desync revenue. The sale itself must be cancelled/redone.
    if (existing.refType === 'Sale' && round2(toNumber(data.amount)) !== round2(toNumber(existing.amount))) {
      throw ApiError.badRequest('This amount comes from a sale and cannot be edited here. Recall/cancel the sale instead.');
    }
    patch.amount = round2(toNumber(data.amount));
  }
  if (data.occurredAt !== undefined) patch.occurredAt = resolveOccurredAt(data.occurredAt);

  // A brand-reserved account only holds its own brand's money.
  const targetAccountId = patch.accountId ?? existing.accountId;
  const targetBrandId = patch.brandId !== undefined ? patch.brandId : existing.brandId;
  const account = await prisma.businessAccount.findUnique({ where: { id: targetAccountId } });
  if (!account) throw ApiError.badRequest('Account not found');
  // Correcting a row may not move ordinary money onto the commission record,
  // nor move a payout off it — the record is held in one place or it is not a
  // record at all.
  if (account.type === COMMISSION_TYPE && existing.type !== 'COMMISSION_PAYMENT') {
    throw ApiError.badRequest('The Commission account only holds the record of rep commission. Choose the account the money actually moved through.');
  }
  if (existing.type === 'COMMISSION_PAYMENT' && account.type !== COMMISSION_TYPE) {
    throw ApiError.badRequest('Commission you paid from your own pocket is recorded in one place and cannot be filed against a wallet.');
  }
  if (account.brandId && targetBrandId && targetBrandId !== account.brandId) {
    throw ApiError.badRequest(`${account.name} is reserved for another brand's payments`);
  }

  const updated = await prisma.financeTransaction.update({ where: { id }, data: patch });
  return { updated, previous: existing };
}

// Move money between two business accounts (e.g. banked cash into M-Pesa, or
// fixing money recorded against the wrong account when an edit isn't enough).
// Posts a linked OUT + IN pair of type TRANSFER — balance-effective on both
// accounts but excluded from income/expense/cash-flow reporting.
async function transferBetweenAccounts({ fromAccountId, toAccountId, amount, notes, occurredAt }, actor) {
  const amt = round2(toNumber(amount));
  if (!(amt > 0)) throw ApiError.badRequest('Enter an amount greater than zero');
  if (!fromAccountId || !toAccountId) throw ApiError.badRequest('Choose both accounts');
  if (fromAccountId === toAccountId) throw ApiError.badRequest('Choose two different accounts');

  const balances = await accountBalances();
  const from = balances.find((a) => a.id === fromAccountId);
  const to = balances.find((a) => a.id === toAccountId);
  if (!from || !to) throw ApiError.badRequest('Account not found');
  // No money is held in the commission account, so none can be moved in or out
  // of it. Its figure is a record of what the owner paid, not a balance.
  const commission = [from, to].find((a) => a.type === COMMISSION_TYPE);
  if (commission) {
    throw ApiError.badRequest(`${commission.name} is a record of what you paid reps, not a wallet — there is no money in it to move.`);
  }
  if (from.balance < amt) {
    throw ApiError.badRequest(`${from.name} only holds ${from.balance.toLocaleString('en-US')} — cannot transfer ${amt.toLocaleString('en-US')}`);
  }

  const when = resolveOccurredAt(occurredAt);
  const reference = `Transfer ${from.name} → ${to.name}`;
  return prisma.$transaction(async (tx) => {
    const outNumber = await nextDocNumber(tx.financeTransaction, 'txnNumber', 'FTX');
    const outTxn = await tx.financeTransaction.create({
      data: {
        txnNumber: outNumber, accountId: from.id, direction: 'OUT', type: 'TRANSFER', amount: amt,
        category: 'Account transfer', description: `Transfer to ${to.name}`, reference,
        notes: notes || null, occurredAt: when, createdById: actor?.id || null,
      },
    });
    const inNumber = await nextDocNumber(tx.financeTransaction, 'txnNumber', 'FTX');
    const inTxn = await tx.financeTransaction.create({
      data: {
        txnNumber: inNumber, accountId: to.id, direction: 'IN', type: 'TRANSFER', amount: amt,
        category: 'Account transfer', description: `Transfer from ${from.name}`, reference,
        refType: 'Transfer', refId: outTxn.id,
        notes: notes || null, occurredAt: when, createdById: actor?.id || null,
      },
    });
    return { out: outTxn, in: inTxn, amount: amt, from: from.name, to: to.name };
  });
}

async function deleteTransaction(id) {
  const existing = await prisma.financeTransaction.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Transaction not found');
  // Rows that mirror a source document cannot be deleted here: the next
  // backfill would quietly re-create them — into the DEFAULT account, dated
  // from the document — so the "deleted" money would reappear somewhere else.
  // The honest way to remove them is to cancel the document they mirror.
  if (existing.refType === 'Sale') {
    throw ApiError.badRequest('This row mirrors a sale. Cancel the sale itself and this entry follows — deleting it here would only make the books disagree with the sales record.');
  }
  if (existing.refType === 'CommissionWithdrawal') {
    throw ApiError.badRequest('This row mirrors a commission payout. Reverse the payout from the Commissions screen instead.');
  }
  // A transfer is two legs of one movement. Removing one leg would conjure
  // money out of (or into) thin air, so both legs go together.
  if (existing.type === 'TRANSFER') {
    await prisma.financeTransaction.deleteMany({
      where: {
        OR: [
          { id },
          { type: 'TRANSFER', refType: 'Transfer', refId: id },
          ...(existing.refType === 'Transfer' && existing.refId ? [{ id: existing.refId }] : []),
        ],
      },
    });
    return existing;
  }
  await prisma.financeTransaction.delete({ where: { id } });
  return existing;
}

// --- Categories ------------------------------------------------------------

async function listCategories() {
  await ensureDefaults();
  return prisma.expenseCategory.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
}
async function createCategory(name) {
  const n = (name || '').trim();
  if (!n) throw ApiError.badRequest('Category name is required');
  return prisma.expenseCategory.upsert({ where: { name: n }, create: { name: n }, update: { isActive: true } });
}

// --- Cash flow ----------------------------------------------------------------

// Resolve { period } or { from, to } into a date range (null = all time).
function rangeFor(opts = {}) {
  if (opts.start && opts.end) return resolveRange({ start: opts.start, end: opts.end });
  if (opts.from || opts.to) return resolveRange({ from: opts.from, to: opts.to });
  if (opts.period && opts.period !== 'all') return resolveRange({ period: opts.period });
  return null;
}

// occurredAt filter for aggregates, clamped to the finance epoch: a null range
// means "since the epoch" (or truly all time when no epoch is set).
function epochWhere(range, epoch) {
  const start = range && epoch ? (range.start > epoch ? range.start : epoch) : range ? range.start : epoch;
  const end = range ? range.end : null;
  if (!start && !end) return {};
  return { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } };
}

// ── The owner's own money, in ONE shape ───────────────────────────────────────
// Every screen that says "your money" reads from here. Three places used to
// compute it three ways — the balance sheet unclamped and unfiltered, the
// period strip epoch-clamped, the cash-flow tab clamped AND active-only — so
// one drawing made the same label print two different numbers. The population
// is fixed here and cannot be varied by a caller:
//
//   • ACTIVE accounts only, from the finance epoch on — exactly the population
//     `accountBalances()` builds the cash figure from, so his money and the
//     cash it moved are always measured against the same books.
//   • The only thing a caller may narrow is the TIME WINDOW, and any screen
//     that narrows it has to say so in its label.
//
// The four parts, and what each one is allowed to be used for:
//   intoAccounts         cash he moved INTO a business account. Contributions
//                        only — drawings are their own line, never netted in.
//   commissionFromPocket cash he handed reps directly. Never touched an
//                        account, so it can never appear in cash flow.
//   drawn                profit he has taken back out.
//   accountMovement      intoAccounts − drawn. The ONLY part that moved a
//                        balance, so this is what a closing balance uses.
//   total                putIn − drawn. What the business owes him.
async function ownerFigures({ start = null, end = null } = {}) {
  const epoch = await reports.financeEpoch();
  const from = start && epoch ? (start > epoch ? start : epoch) : (start || epoch);
  const scope = { account: { is: { isActive: true } } };
  if (from || end) scope.occurredAt = { ...(from ? { gte: from } : {}), ...(end ? { lte: end } : {}) };
  const [contribAgg, fundingAgg, drawAgg, pocketAgg, byBrandRows] = await Promise.all([
    prisma.financeTransaction.aggregate({ where: { ...scope, direction: 'IN', type: 'OWNER_CONTRIBUTION' }, _sum: { amount: true } }),
    // Legacy rows that "funded" a payout — the same shilling recorded on both
    // sides. Queried as its own whole population and subtracted, never as a
    // `refType: { not: … }` filter: refType is NULL on every ordinary
    // contribution and that filter's NULL handling is a Prisma detail.
    prisma.financeTransaction.aggregate({ where: { ...scope, direction: 'IN', type: 'OWNER_CONTRIBUTION', refType: 'CommissionWithdrawal' }, _sum: { amount: true } }),
    prisma.financeTransaction.aggregate({ where: { ...scope, direction: 'OUT', type: 'OWNER_DRAWING' }, _sum: { amount: true } }),
    prisma.financeTransaction.aggregate({ where: { ...scope, direction: 'OUT', type: 'COMMISSION_PAYMENT' }, _sum: { amount: true } }),
    // Which brand each contribution was put behind. Older rows carry no brand
    // and group under null — named "not tagged" rather than guessed at.
    prisma.financeTransaction.groupBy({
      by: ['brandId'],
      where: { ...scope, direction: 'IN', type: 'OWNER_CONTRIBUTION' },
      _sum: { amount: true },
    }),
  ]);
  const repFundingExcluded = round2(toNumber(fundingAgg._sum.amount));
  const intoAccounts = round2(round2(toNumber(contribAgg._sum.amount)) - repFundingExcluded);
  const commissionFromPocket = round2(toNumber(pocketAgg._sum.amount));
  const drawn = round2(toNumber(drawAgg._sum.amount));
  return {
    intoAccounts,
    commissionFromPocket,
    drawn,
    repFundingExcluded,
    byBrand: byBrandRows
      .map((r) => ({ brandId: r.brandId, amount: round2(toNumber(r._sum.amount)) }))
      .filter((r) => r.amount !== 0)
      .sort((a, b) => b.amount - a.amount),
    putIn: round2(intoAccounts + commissionFromPocket),
    accountMovement: round2(intoAccounts - drawn),
    total: round2(intoAccounts + commissionFromPocket - drawn),
  };
}

async function flowBetween(start, end) {
  // Internal account-to-account transfers move balances but are not business
  // cash flow (they would inflate money-in AND money-out by the same amount).
  // Only active accounts: the opening balance sums active accounts' openings,
  // so counting a deactivated account's movements here would make
  // Opening + In − Out drift from the account balances it must reconcile to.
  // Transfers move balances without being business cash flow; owner money is
  // the owner's, not the business's trading. Both would inflate in/out.
  const where = { type: { notIn: NON_TRADE_TYPES }, account: { is: { isActive: true } } };
  if (start || end) where.occurredAt = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  const [i, o] = await Promise.all([
    prisma.financeTransaction.aggregate({ where: { ...where, direction: 'IN' }, _sum: { amount: true } }),
    prisma.financeTransaction.aggregate({ where: { ...where, direction: 'OUT' }, _sum: { amount: true } }),
  ]);
  const moneyIn = round2(toNumber(i._sum.amount));
  const moneyOut = round2(toNumber(o._sum.amount));
  return { moneyIn, moneyOut, net: round2(moneyIn - moneyOut) };
}

// Cash-flow statement for a window: opening balance (all money before the
// window), money in/out, and the closing balance. All-time uses the accounts'
// opening balances as the opening figure.
async function cashflow(opts = {}) {
  await ensureDefaults();
  await backfillFromHistory().catch(() => {});
  const range = rangeFor(opts);
  const epoch = await reports.financeEpoch();
  const openAgg = await prisma.businessAccount.aggregate({ where: { isActive: true }, _sum: { openingBalance: true } });
  const baseOpening = round2(toNumber(openAgg._sum.openingBalance));
  // Opening = account openings (the truth at the epoch) + movements between the
  // epoch and the window start. Pre-epoch ledger rows never count.
  const before = range
    ? await flowBetween(epoch || null, new Date(range.start.getTime() - 1))
    : { net: 0 };
  const openingBalance = round2(baseOpening + (range && (!epoch || range.start > epoch) ? before.net : 0));
  const start = range && epoch ? (range.start > epoch ? range.start : epoch) : range ? range.start : epoch;
  const inPeriod = await flowBetween(start || null, range ? range.end : null);

  // The owner's own money is not trading, so it is kept out of money in/out —
  // but the part of it that went through an account DOES move balances, and
  // leaving it out of the statement made the closing balance disagree with the
  // cash actually held (2,439,500 against a real 2,915,500). It gets its own
  // lines instead: excluded from trade, included in the balance.
  //
  // One shape, shared with the Overview and the balance sheet, so no two
  // screens can print different numbers under the same label.
  const owner = await ownerFigures({ start: start || null, end: range ? range.end : null });
  const ownerIn = owner.intoAccounts;
  const ownerOut = owner.drawn;
  // ACCOUNT MOVEMENT ONLY, and the closing balance is built from it. Commission
  // he pays reps from his own hand never lands in an account, so it is not
  // here; `owner.commissionFromPocket` carries that half.
  const ownerNet = owner.accountMovement;

  // Where the money actually came from and went, by kind — settlements vs
  // counter sales vs other income; stock vs commissions vs expenses. The four
  // headline figures say HOW MUCH moved; this says WHAT moved it.
  const typeWhere = { type: { notIn: NON_TRADE_TYPES }, account: { is: { isActive: true } } };
  if (start || (range && range.end)) {
    typeWhere.occurredAt = { ...(start ? { gte: start } : {}), ...(range ? { lte: range.end } : {}) };
  }
  const byTypeRows = await prisma.financeTransaction.groupBy({
    by: ['type', 'direction'],
    where: typeWhere,
    _sum: { amount: true },
    _count: true,
  });
  const byType = byTypeRows
    .map((r) => ({ type: r.type, direction: r.direction, amount: round2(toNumber(r._sum.amount)), count: r._count }))
    .sort((a, b) => b.amount - a.amount);

  // Six EAT months of in/out/net, so the tab can show motion, not one frame.
  // Anchored to the business's clock like every other window.
  const { eatNow, eatToUtc } = require('../utils/dates');
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const m = eatNow().subtract(i, 'month');
    const mStart = eatToUtc(m.startOf('month')).toDate();
    const mEnd = eatToUtc(m.endOf('month')).toDate();
    const from = epoch && mStart < epoch ? epoch : mStart;
    if (epoch && mEnd < epoch) { series.push({ period: m.format('MMM'), moneyIn: 0, moneyOut: 0, net: 0 }); continue; }
    const f = await flowBetween(from, mEnd);
    series.push({ period: m.format('MMM'), moneyIn: f.moneyIn, moneyOut: f.moneyOut, net: f.net });
  }

  return {
    period: opts.from || opts.to ? 'custom' : opts.period || 'all',
    range: range ? { start: range.start, end: range.end } : null,
    openingBalance,
    ...inPeriod,
    // Contributions in, drawings out, and the net of the two — the part of his
    // money that actually moved a balance in this window.
    ownerIn,
    ownerOut,
    ownerNet,
    // The whole of his money in this window, in the shared shape: intoAccounts,
    // commissionFromPocket, drawn, putIn, accountMovement, total. Nothing on
    // screen may label account movement as everything he has put in.
    owner,
    // Opening + trade + the owner's own money = what the accounts actually
    // hold. Every part is on screen, so the reader can add it up themselves.
    closingBalance: round2(openingBalance + inPeriod.net + ownerNet),
    byType,
    series,
  };
}

// --- Financial report ----------------------------------------------------------

// One consolidated report for a period or custom date range: P&L, cash flow,
// supplier/commission payments, stock-purchase spend, top products & brands.
async function report(opts = {}) {
  await ensureDefaults();
  const profOpts = opts.start && opts.end
    ? { start: opts.start, end: opts.end }
    : opts.from || opts.to ? { from: opts.from, to: opts.to } : { period: opts.period || 'all' };
  const [prof, cf, epoch] = await Promise.all([reports.profitOverview(profOpts), cashflow(opts), reports.financeEpoch()]);
  const range = rangeFor(opts);
  const base = epochWhere(range, epoch);
  const sumOf = async (extra) =>
    round2(toNumber((await prisma.financeTransaction.aggregate({ where: { ...base, ...extra }, _sum: { amount: true } }))._sum.amount));
  const [expenses, supplierPayments, commissionPaid, otherIncome] = await Promise.all([
    sumOf({ direction: 'OUT', type: 'EXPENSE' }),
    sumOf({ direction: 'OUT', type: 'STOCK_PURCHASE' }),
    // A RECORD of what reps were paid, reported on its own line. It is the
    // owner's money, not the business's, so it is absent from cash flow above
    // and from netProfit below — by design, not by omission.
    sumOf({ direction: 'OUT', type: 'COMMISSION_PAYMENT' }),
    sumOf({ direction: 'IN', type: 'INCOME' }),
  ]);
  return {
    range: range ? { start: range.start, end: range.end } : null,
    period: cf.period,
    revenue: prof.totals.revenue,
    cogs: prof.totals.cost,
    grossProfit: prof.totals.profit,
    margin: prof.totals.margin,
    boxesSold: prof.totals.boxes,
    expenses,
    commissionAccrued: prof.totals.commission,
    netProfit: round2(prof.totals.profit - expenses),
    supplierPayments,
    commissionPaid,
    otherIncome,
    cashFlow: {
      openingBalance: cf.openingBalance,
      moneyIn: cf.moneyIn,
      moneyOut: cf.moneyOut,
      net: cf.net,
      closingBalance: cf.closingBalance,
    },
    topProducts: prof.byProduct.slice(0, 8),
    topBrands: prof.byBrand,
  };
}

// --- Suppliers (accounts payable) -----------------------------------------------

// Every supplier with their financial picture: total purchased (non-cancelled
// POs), total paid (ledger payments keyed to their POs), outstanding balance.
async function supplierSummaries() {
  await ensureDefaults();
  const [suppliers, pos, brands] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.purchaseOrder.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true, supplierId: true, totalCost: true, receivedAt: true, createdAt: true },
    }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const poIds = pos.map((p) => p.id);
  const supplierIds = suppliers.map((s) => s.id);
  // Payments live at two levels: keyed to a specific PO, or to the supplier as
  // a whole (paying down the running balance). Both reduce what is owed.
  const [payRows, supplierPayRows] = await Promise.all([
    poIds.length
      ? prisma.financeTransaction.groupBy({
          by: ['refId'],
          where: { refType: 'PurchaseOrder', refId: { in: poIds }, direction: 'OUT' },
          _sum: { amount: true },
        })
      : [],
    prisma.financeTransaction.groupBy({
      by: ['refId'],
      where: { refType: 'Supplier', refId: { in: supplierIds }, direction: 'OUT' },
      _sum: { amount: true },
      _max: { occurredAt: true },
    }),
  ]);
  const paidByPo = new Map(payRows.map((p) => [p.refId, toNumber(p._sum.amount)]));
  const paidBySupplier = new Map(supplierPayRows.map((p) => [p.refId, toNumber(p._sum.amount)]));
  const lastPayBySupplier = new Map(supplierPayRows.map((p) => [p.refId, p._max.occurredAt]));

  const agg = new Map();
  for (const p of pos) {
    const cur = agg.get(p.supplierId) || { purchased: 0, paid: 0, poCount: 0, last: null };
    cur.purchased += toNumber(p.totalCost);
    cur.paid += paidByPo.get(p.id) || 0;
    cur.poCount += 1;
    const d = p.receivedAt || p.createdAt;
    if (!cur.last || d > cur.last) cur.last = d;
    agg.set(p.supplierId, cur);
  }
  for (const [sid, amt] of paidBySupplier) {
    const cur = agg.get(sid) || { purchased: 0, paid: 0, poCount: 0, last: null };
    cur.paid += amt;
    agg.set(sid, cur);
  }
  return suppliers.map((s) => {
    const f = agg.get(s.id) || { purchased: 0, paid: 0, poCount: 0, last: null };
    return {
      id: s.id, name: s.name, country: s.country, contactName: s.contactName,
      phone: s.phone, email: s.email, isActive: s.isActive,
      brandId: s.brandId || null, brandName: s.brandId ? brandName.get(s.brandId) || null : null,
      totalPurchased: round2(f.purchased),
      totalPaid: round2(f.paid),
      outstanding: round2(f.purchased - f.paid),
      poCount: f.poCount,
      lastActivity: f.last,
      lastPayment: lastPayBySupplier.get(s.id) || null,
    };
  });
}

// One supplier's full accounts-payable profile: purchases, payments (both
// PO-level and supplier-level), products supplied, balances and last activity.
async function supplierDetail(id) {
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Supplier not found');
  const [pos, brand] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { supplierId: id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, poNumber: true, status: true, totalCost: true, receivedAt: true, createdAt: true,
        items: { select: { quantity: true, product: { select: { name: true } } } },
      },
    }),
    s.brandId ? prisma.brand.findUnique({ where: { id: s.brandId }, select: { name: true } }) : null,
  ]);
  const poIds = pos.map((p) => p.id);
  const txns = await prisma.financeTransaction.findMany({
    where: {
      direction: 'OUT',
      OR: [
        ...(poIds.length ? [{ refType: 'PurchaseOrder', refId: { in: poIds } }] : []),
        { refType: 'Supplier', refId: id },
      ],
    },
    include: { account: { select: { name: true } } },
    orderBy: { occurredAt: 'desc' },
  });
  const paidByPo = new Map();
  txns.forEach((t) => {
    if (t.refType === 'PurchaseOrder') paidByPo.set(t.refId, (paidByPo.get(t.refId) || 0) + toNumber(t.amount));
  });

  const orders = pos.map((p) => {
    const total = toNumber(p.totalCost);
    const paid = round2(paidByPo.get(p.id) || 0);
    return {
      id: p.id, poNumber: p.poNumber, status: p.status,
      totalCost: round2(total), paid, outstanding: round2(total - paid),
      boxes: p.items.reduce((n, it) => n + it.quantity, 0),
      products: [...new Set(p.items.map((it) => it.product?.name).filter(Boolean))],
      receivedAt: p.receivedAt, createdAt: p.createdAt,
    };
  });
  const purchased = round2(orders.reduce((x, o) => x + o.totalCost, 0));
  const paid = round2(txns.reduce((x, t) => x + toNumber(t.amount), 0));
  const productsPurchased = [...new Set(orders.flatMap((o) => o.products))];
  return {
    supplier: { ...s, brandName: brand?.name || null },
    orders,
    payments: txns.map((t) => ({
      id: t.id, txnNumber: t.txnNumber, amount: toNumber(t.amount), account: t.account?.name,
      reference: t.refType === 'Supplier' ? 'Balance payment' : t.reference,
      occurredAt: t.occurredAt, notes: t.notes,
    })),
    productsPurchased,
    lastPurchase: orders[0]?.receivedAt || orders[0]?.createdAt || null,
    lastPayment: txns[0]?.occurredAt || null,
    totals: { purchased, paid, outstanding: round2(purchased - paid) },
  };
}

// Pay down a supplier's overall balance (installments welcome): one OUT
// transaction from the chosen account, keyed to the supplier, brand-tagged.
// Not an expense — it settles the liability created when stock was received;
// the P&L cost is recognised as COGS when boxes sell.
async function paySupplierBalance(supplierId, { accountId, amount, notes, occurredAt }, actor) {
  const s = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw ApiError.notFound('Supplier not found');
  const detail = await supplierDetail(supplierId);
  const outstanding = detail.totals.outstanding;
  const amt = amount != null ? round2(toNumber(amount)) : outstanding;
  if (!(amt > 0)) throw ApiError.badRequest('Payment amount must be greater than zero');
  if (amt > outstanding + 0.001) {
    throw ApiError.badRequest(`You only owe ${s.name} TZS ${outstanding.toLocaleString()}`);
  }
  return recordTransaction(
    {
      accountId,
      direction: 'OUT',
      type: 'STOCK_PURCHASE',
      amount: amt,
      brandId: s.brandId || null,
      category: 'Supplier Payment',
      description: `Supplier payment — ${s.name}`,
      reference: s.name,
      refType: 'Supplier',
      refId: s.id,
      notes,
      occurredAt,
    },
    actor,
  );
}

// Pay a supplier against a purchase order: posts a STOCK_PURCHASE OUT
// transaction from the chosen account (immediately reducing its balance) and
// tracks against the PO so the supplier's outstanding falls. Over-payment is
// blocked.
async function paySupplier({ purchaseOrderId, accountId, amount, notes, occurredAt }, actor) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { supplier: { select: { name: true, brandId: true } } },
  });
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status === 'CANCELLED') throw ApiError.badRequest('This purchase order is cancelled');
  const paidAgg = await prisma.financeTransaction.aggregate({
    where: { refType: 'PurchaseOrder', refId: po.id, direction: 'OUT' },
    _sum: { amount: true },
  });
  const alreadyPaid = toNumber(paidAgg._sum.amount);
  const remaining = round2(toNumber(po.totalCost) - alreadyPaid);
  const amt = amount != null ? round2(toNumber(amount)) : remaining;
  if (!(amt > 0)) throw ApiError.badRequest('Payment amount must be greater than zero');
  if (amt > remaining + 0.001) {
    throw ApiError.badRequest(`Only TZS ${remaining.toLocaleString()} is outstanding on ${po.poNumber}`);
  }
  return recordTransaction(
    {
      accountId,
      direction: 'OUT',
      type: 'STOCK_PURCHASE',
      amount: amt,
      // Supplier's brand → this spend belongs to that brand's books.
      brandId: po.supplier?.brandId || null,
      category: 'Stock Purchase',
      description: `Supplier payment — ${po.supplier?.name || 'supplier'} (${po.poNumber})`,
      reference: po.poNumber,
      refType: 'PurchaseOrder',
      refId: po.id,
      notes,
      occurredAt,
    },
    actor,
  );
}

// --- Capital ---------------------------------------------------------------
// "What do I have in this business?" — the balance sheet, in the owner's own
// terms. Deliberately PURE: every input is a figure another screen already
// shows, so this can never invent a number, can be tested without a database,
// and cannot drift from the pages it summarises.
//
// WHAT IT HOLDS   cash in the accounts + stock at what it cost.
// WHAT IT OWES    the supplier's outstanding bill + commission reps can still
//                 withdraw + what the business owes the OWNER.
// YOUR CAPITAL    holds − the outside debts (supplier + reps). Sole owner, so
//                 everything left after outsiders are squared is his.
// WHAT IS LEFT    holds − everything owed, the owner included: the worth the
//                 business has built beyond the money he put in.
//
// Everything here is ALL TIME and as-things-stand-right-now. It never narrows
// to the selected period: a balance sheet that moved when you clicked "Today"
// would not be a balance sheet.
//
// Three double-counts are avoided here on purpose, and each has a test:
//  1. Stock a rep is holding is counted ONCE, as stock at cost. The
//     settlement "outstanding" for those same boxes is their SELLING value —
//     adding it would count the same boxes twice and book unearned profit as
//     an asset. It is reported as `stock.withReps` instead, at cost.
//  2. Commission the owner paid reps is counted ONCE, as money the business
//     owes him. It moves no account balance and is no business spending, so
//     it appears in `owner.commissionFromPocket` and nowhere else.
//  3. An OWNER_CONTRIBUTION posted to fund a rep payout is left out of
//     `intoAccounts` (and out of the cash balance), because the payout it
//     funded is already counted in `commissionFromPocket`.
//
// WHAT CUSTOMERS OWE IS A MEMO, NOT AN ASSET — deliberately.
// Credit collections do not post a finance transaction (credit.service.js
// reduces CreditSale.balance and stops there), so a collected shilling leaves
// the receivable and never arrives in cash. Counted inside the total, that
// makes collecting 50,000 SHRINK the owner's capital by 50,000 — a total that
// moves the wrong way on good news is worse than a total that is missing a
// real asset. So it is carried as `memo.customersOwe`: named, on screen, and
// outside every total until the credit ledger posts cash. Production carries
// roughly 7.18M of it across 73 overdue accounts, so this is not a rounding
// choice — it is the difference between a figure the owner can trust and one
// that argues with him.
// What one supplier is owed RIGHT NOW: the cost of what has already SOLD, less
// what he has been paid — never more than he is actually invoiced for.
// Over-payment shows as zero due, not as a negative.
function supplierDueNow({ outstanding, costOfSold, alreadyPaid }) {
  const bill = round2(toNumber(outstanding));
  const earned = round2(toNumber(costOfSold) - toNumber(alreadyPaid));
  return round2(Math.min(bill, Math.max(0, earned)));
}

// The same split across every supplier, driven by ONE map of cost-of-sales.
// The balance sheet must hand it the ALL-TIME map: fed a period's cost of sales
// it answers "what would be due if the business had only ever traded today",
// which is not a thing anybody wants to know and moved when a tab was clicked.
function supplierDueNowAcross(supplierByKey, costByKey) {
  let total = 0;
  for (const [key, sup] of supplierByKey) {
    total += supplierDueNow({
      outstanding: sup.outstanding,
      costOfSold: (costByKey.get(key) || {}).cost || 0,
      alreadyPaid: sup.paid,
    });
  }
  return round2(total);
}

// True for a ledger row that is a RECORD rather than a movement of money: the
// owner's cash, hand to hand, with no business account on either side. Used to
// flag the row for the Ledger; the aggregates use OFF_ACCOUNT_WHERE, which is
// the same rule expressed as a query.
function isOffAccount(txn = {}) {
  return txn.type === 'COMMISSION_PAYMENT'
    || (txn.type === 'OWNER_CONTRIBUTION' && txn.refType === 'CommissionWithdrawal');
}

function buildCapital(input = {}) {
  const v = (x) => round2(toNumber(x));
  const int = (x) => Math.round(toNumber(x));

  // ── What the business holds ────────────────────────────────────────────
  const cash = v(input.cash);
  const stock = {
    // At cost — what the boxes were actually paid for. The basis every other
    // asset here uses, and the only one that is not a guess about the future.
    atCost: v(input.stockAtCost),
    inWarehouse: v(input.stockInWarehouse),
    withReps: v(input.stockWithReps),
    // What the same boxes would bring in at today's selling price. Context,
    // never an asset: nothing has been sold yet.
    atSellingPrice: v(input.stockAtSellingPrice),
    units: int(input.stockUnits),
  };
  const holdsTotal = round2(cash + stock.atCost);

  // ── Owed to the business, but not yet countable ────────────────────────
  const customersOwe = {
    // The UNPAID balance of live credit sales, never the invoice total. A
    // written-off debt is zeroed at source, so it drops out on its own.
    amount: v(input.customersOwe),
    count: int(input.customersOweCount),
  };

  // ── What it owes ───────────────────────────────────────────────────────
  const supplierTotal = v(input.supplierOutstanding);
  // Bonge is paid box by box: only the cost of what has SOLD is due today.
  // The rest of the invoice is still a debt — it simply falls due later.
  const dueNow = round2(Math.min(supplierTotal, Math.max(0, v(input.supplierDueNow))));
  const suppliers = {
    total: supplierTotal,
    dueNow,
    dueLater: round2(supplierTotal - dueNow),
    name: input.supplierLabel || null,
  };
  const reps = v(input.repCommissionPayable);

  // His own money, straight from `ownerFigures()` — one shape for every screen.
  const src = input.owner || {};
  const owner = {
    // (i) Cash he moved INTO a business account. Contributions only; what he
    //     has taken back out is its own line and is never netted in here.
    intoAccounts: v(src.intoAccounts),
    // (ii) Commission he handed reps himself. It never touched an account,
    //      which is exactly why it is a separate line and not merged above.
    commissionFromPocket: v(src.commissionFromPocket),
    drawn: v(src.drawn),
    // Diagnostic only — legacy rows deliberately left out of (i) AND out of the
    // cash balance. Not for display; it exists so the exclusion is testable.
    repFundingExcluded: v(src.repFundingExcluded),
  };
  owner.putIn = round2(owner.intoAccounts + owner.commissionFromPocket);
  owner.total = round2(owner.putIn - owner.drawn);

  const outside = round2(suppliers.total + reps);
  const owesTotal = round2(outside + owner.total);

  // ── What is left ───────────────────────────────────────────────────────
  const yourCapital = round2(holdsTotal - outside);
  const left = round2(holdsTotal - owesTotal); // === yourCapital − owner.total
  // A share only means something when he is actually owed money. When he has
  // drawn more than he put in, `owner.total` is negative and a percentage of
  // his capital "out of his own pocket" would be a negative share of a thing
  // he is not owed — nonsense on screen, so it is zero and the page says why.
  owner.shareOfCapitalPct = yourCapital > 0 && owner.total > 0
    ? round2((owner.total / yourCapital) * 100)
    : 0;

  return {
    holds: {
      cash,
      stock,
      total: holdsTotal,
      lines: [
        { key: 'cash', label: 'Cash in your accounts', amount: cash, hint: 'across every account' },
        { key: 'stock', label: 'Stock you are holding', amount: stock.atCost, hint: 'at what it cost you' },
      ],
    },
    owes: {
      suppliers,
      reps,
      owner,
      outside,
      total: owesTotal,
      lines: [
        { key: 'suppliers', label: `Owed to ${suppliers.name || 'your supplier'}`, amount: suppliers.total, hint: 'stock they financed' },
        { key: 'reps', label: 'Owed to your reps', amount: reps, hint: 'commission they can withdraw' },
        { key: 'owner', label: 'Owed back to you', amount: owner.total, hint: 'money out of your own pocket' },
      ],
    },
    // Real, owed to the business, and deliberately outside every total above —
    // see the note on this function. The page must say so in words.
    memo: {
      customersOwe,
      note: 'Collecting a credit sale does not yet post money into an account, so this is kept out of the totals — counting it would make your capital fall every time a customer pays you.',
    },
    // What the business is worth to YOU once the outside debts are settled.
    yourCapital,
    // What it has built on top of your own money. Negative means the business
    // is still behind what you have put in.
    left,
  };
}

// --- Finance dashboard -----------------------------------------------------

async function overview(period = 'month') {
  await ensureDefaults();
  // Self-healing sync: fold any business activity not yet in the ledger
  // (historical or missed) into finance before computing. Idempotent by refId.
  await backfillFromHistory().catch(() => {});
  const [accounts, prof, inv, commSummary] = await Promise.all([
    accountBalances(),
    reports.profitOverview(period),
    inventory.valuation(),
    commission.summaryAllReps(),
  ]);

  const cashPosition = round2(accounts.reduce((s, a) => s + a.balance, 0));
  const epoch = await reports.financeEpoch();

  // Money in / out for each window (from the epoch onward).
  const flow = {};
  for (const p of ['today', 'week', 'month', 'all']) {
    const r = periodRange(p);
    const base = epochWhere(r, epoch);
    const [inAgg, outAgg] = await Promise.all([
      prisma.financeTransaction.aggregate({ where: { ...base, direction: 'IN', type: { notIn: NON_TRADE_TYPES } }, _sum: { amount: true } }),
      prisma.financeTransaction.aggregate({ where: { ...base, direction: 'OUT', type: { notIn: NON_TRADE_TYPES } }, _sum: { amount: true } }),
    ]);
    const moneyIn = round2(toNumber(inAgg._sum.amount));
    const moneyOut = round2(toNumber(outAgg._sum.amount));
    // The owner's own money is not trade, but the part that went through an
    // account does move the balances. The overview showed only the trading net
    // (2,439,500) directly under the cash held (2,915,500) — the same 476,000
    // gap that made the cash-flow statement disagree with reality. Carried
    // here, in the SHARED shape, so the strip, the cash-flow tab and the
    // balance sheet cannot print three different numbers for the same thing.
    const owner = await ownerFigures({ start: r ? r.start : null, end: r ? r.end : null });
    flow[p] = {
      moneyIn,
      moneyOut,
      // Account movement only (contributions − drawings). `owner` below is the
      // honest whole; anything labelled "your own money" comes from there.
      ownerNet: owner.accountMovement,
      net: round2(moneyIn - moneyOut),
      // What the accounts actually moved by: trade plus the owner's money.
      netWithOwner: round2(moneyIn - moneyOut + owner.accountMovement),
      // His money in this window, in parts that add up: cash he moved into an
      // account, cash he handed reps, and anything he has taken back out.
      // Never one merged figure — they are different kinds of money.
      owner,
    };
  }

  // Expenses + breakdown for the selected period.
  const range = periodRange(period);
  const expWhere = { direction: 'OUT', type: 'EXPENSE', ...epochWhere(range, epoch) };
  const [expAgg, byCat] = await Promise.all([
    prisma.financeTransaction.aggregate({ where: expWhere, _sum: { amount: true } }),
    prisma.financeTransaction.groupBy({ by: ['category'], where: expWhere, _sum: { amount: true }, _count: true }),
  ]);
  const expenses = round2(toNumber(expAgg._sum.amount));
  const expenseBreakdown = byCat
    .map((c) => ({ category: c.category || 'Uncategorised', amount: round2(toNumber(c._sum.amount)), count: c._count }))
    .sort((a, b) => b.amount - a.amount);

  const grossProfit = prof.totals.profit;
  // What the boxes earned reps — reported, never subtracted. The owner funds
  // every commission himself, so it never leaves the business's money and
  // cannot reduce what the business made.
  const commissionAccrued = prof.totals.commission;
  const netProfit = round2(grossProfit - expenses);

  // ── Per-brand finance: each brand's P&L, cash movement and inventory value,
  // computed from real transactions/records only. Scales to any brand count.
  const [allBrands, brandTxnRows, products] = await Promise.all([
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.financeTransaction.groupBy({
      by: ['brandId', 'direction', 'type'],
      // A brand's money in/out has to reconcile to the wallets it moved. Rep
      // commission moved none of them, so it cannot appear in either figure.
      where: { ...epochWhere(range, epoch), type: { notIn: ['COMMISSION_PAYMENT'] } },
      _sum: { amount: true },
    }),
    prisma.product.findMany({ select: { id: true, brandId: true } }),
  ]);
  const productBrand = new Map(products.map((p) => [p.id, p.brandId]));
  const invByBrand = new Map();
  for (const it of inv.items) {
    const b = productBrand.get(it.productId);
    if (!b) continue;
    const cur = invByBrand.get(b) || { cost: 0, units: 0 };
    cur.cost += it.costValue;
    cur.units += it.totalBase;
    invByBrand.set(b, cur);
  }
  const profByBrand = new Map(prof.byBrand.map((b) => [b.brandId, b]));
  const brandFinance = allBrands.map((b) => {
    const p = profByBrand.get(b.id) || { revenue: 0, cost: 0, profit: 0, boxes: 0, margin: 0, commission: 0 };
    let moneyIn = 0;
    let moneyOut = 0;
    let brandExpenses = 0;
    for (const r of brandTxnRows) {
      if (r.brandId !== b.id) continue;
      const amt = toNumber(r._sum.amount);
      if (r.direction === 'IN') moneyIn += amt;
      else {
        moneyOut += amt;
        // Stock purchases settle a supplier liability — cash out, not P&L.
        if (r.type === 'EXPENSE') brandExpenses += amt;
      }
    }
    const invB = invByBrand.get(b.id) || { cost: 0, units: 0 };
    return {
      brandId: b.id,
      name: b.name,
      revenue: p.revenue,
      cogs: p.cost,
      grossProfit: p.profit,
      margin: p.margin,
      boxesSold: p.boxes,
      commission: round2(p.commission || 0),
      expenses: round2(brandExpenses),
      netProfit: round2(p.profit - brandExpenses),
      moneyIn: round2(moneyIn),
      moneyOut: round2(moneyOut),
      netCash: round2(moneyIn - moneyOut),
      inventoryValue: round2(invB.cost),
      inventoryUnits: invB.units,
    };
  });

  // What is waiting for the owner, so the Overview can lead with it — the
  // Target-style "needs you" strip: nothing here means genuinely nothing.
  // Payments must be counted against the SAME population as the purchases.
  // Summing every PO payment ever made — including payments against orders
  // later cancelled, which drop out of the purchased side — understated the
  // debt here while the Suppliers tab (which excludes them) showed more.
  const livePos = await prisma.purchaseOrder.findMany({
    where: { status: { not: 'CANCELLED' } },
    select: { id: true },
  });
  const livePoIds = livePos.map((x) => x.id);
  const [poAgg, poPayAgg, wdAgg, pendingApprovals] = await Promise.all([
    prisma.purchaseOrder.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { totalCost: true } }),
    prisma.financeTransaction.aggregate({
      where: {
        direction: 'OUT',
        OR: [
          { refType: 'PurchaseOrder', refId: { in: livePoIds } },
          { refType: 'Supplier' },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.commissionWithdrawal.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } }),
    prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
  ]);
  // Approved but not yet paid. The rep's available balance already treats it
  // as gone, and no payout has been recorded against it, so without this line
  // the money the owner has promised a rep sits in no figure at all.
  const approvedWdAgg = await prisma.commissionWithdrawal.aggregate({
    where: { status: 'APPROVED' },
    _sum: { amount: true },
  });
  const approvedUnpaidCommission = round2(toNumber(approvedWdAgg._sum.amount));
  // ── Where the profit actually IS ────────────────────────────────────────
  // The owner has taken nothing out: every shilling earned went back into
  // stock or to the supplier. "Profit" and "cash" are therefore different
  // numbers, and the page has to say so plainly rather than let the reader
  // assume the profit is sitting in an account.
  //
  // ALL TIME and epoch-clamped, from the same shared shape the period strip and
  // the cash-flow tab use. The balance sheet is "as things stand right now", so
  // it never narrows the window — but it must not use a different POPULATION
  // either, which is what let the same label print 476,000 in one place and
  // 426,000 in another.
  const ownerAllTime = await ownerFigures();
  const ownerIn = ownerAllTime.intoAccounts;
  const ownerOut = ownerAllTime.drawn;
  // All-time earnings, so "taken out" and "still working" compare like with
  // like no matter which period is on screen.
  const lifetime = period === 'all' ? prof : await reports.profitOverview('all');
  const lifetimeExpAgg = await prisma.financeTransaction.aggregate({
    where: { direction: 'OUT', type: 'EXPENSE', ...epochWhere(null, epoch) },
    _sum: { amount: true },
  });
  const earnedAllTime = round2(lifetime.totals.profit - round2(toNumber(lifetimeExpAgg._sum.amount)));
  // Every shilling of rep commission comes out of the owner's pocket, so the
  // payouts themselves are the record of what he has put in. The business owes
  // him this back when it can afford to. Counted HERE and nowhere else: no
  // balance moves by it and no money-out aggregate includes it.
  const paidRepsFromPocket = ownerAllTime.commissionFromPocket;

  // What customers still owe on credit sales. The UNPAID balance only, and
  // `balance > 0` is the same test the Debts page uses, so the two screens can
  // never quote different debt. A written-off debt is zeroed at source.
  const debtAgg = await prisma.creditSale.aggregate({
    where: { balance: { gt: 0 } },
    _sum: { balance: true },
    _count: true,
  });
  const customersOwe = round2(toNumber(debtAgg._sum.balance));

  const needsYou = {
    supplierOutstanding: round2(Math.max(0, toNumber(poAgg._sum.totalCost) - toNumber(poPayAgg._sum.amount))),
    pendingWithdrawals: { count: wdAgg._count, amount: round2(toNumber(wdAgg._sum.amount)) },
    pendingApprovals,
    negativeAccounts: accounts.filter((a) => a.balance < 0).map((a) => a.name),
  };

  // ── Whose money is this? ────────────────────────────────────────────────
  // The supplier is paid the COST of the boxes that actually SOLD — not the
  // whole stock bill. The rest of his invoice comes due only as the boxes on
  // the shelf sell. Setting aside the entire outstanding balance was wrong:
  // it demanded money the owner does not owe yet, and hid the profit that is
  // genuinely his. Everything above the cost of sold goods is his.
  const suppliersForSplit = await supplierSummaries();
  const supplierByBrand = new Map();
  for (const sup of suppliersForSplit) {
    const key = sup.brandId || 'general';
    const row = supplierByBrand.get(key) || { outstanding: 0, paid: 0, name: null };
    row.outstanding = round2(row.outstanding + sup.outstanding);
    row.paid = round2(row.paid + sup.totalPaid);
    if (!row.name && sup.outstanding > 0) row.name = sup.name;
    if (!row.name) row.name = sup.name;
    supplierByBrand.set(key, row);
  }
  const brandNameById = new Map(allBrands.map((b) => [b.id, b.name]));
  const profitByBrandId = new Map((prof.byBrand || []).map((b) => [b.brandId, b]));

  // What has actually been spent putting stock back — supplier payments and
  // stock purchases, by the brand the money BOUGHT (not the account it left).
  // This is what decides whether the cost of the boxes sold has been covered
  // yet, and therefore whether the cash on hand is cost or profit.
  const stockSpendRows = await prisma.financeTransaction.groupBy({
    by: ['brandId'],
    where: { direction: 'OUT', type: 'STOCK_PURCHASE' },
    _sum: { amount: true },
  });
  const stockSpendByBrand = new Map(stockSpendRows.map((r) => [r.brandId || 'general', round2(toNumber(r._sum.amount))]));

  const cashByBrand = new Map();
  for (const a of accounts) {
    const key = a.brandId || 'general';
    const row = cashByBrand.get(key) || { key, cash: 0, moneyIn: 0, moneyOut: 0, accounts: [] };
    row.cash = round2(row.cash + a.balance);
    // What actually moved through this wallet. These DO reconcile to the
    // balance above it; all-time sales figures never could, which is what
    // made the card contradict itself.
    row.moneyIn = round2(row.moneyIn + toNumber(a.moneyIn));
    row.moneyOut = round2(row.moneyOut + toNumber(a.moneyOut));
    row.accounts.push({ name: a.name, balance: a.balance });
    cashByBrand.set(key, row);
  }
  for (const key of supplierByBrand.keys()) {
    if (!cashByBrand.has(key)) cashByBrand.set(key, { key, cash: 0, moneyIn: 0, moneyOut: 0, accounts: [] });
  }

  const buckets = [...cashByBrand.values()].map((row) => {
    const sup = supplierByBrand.get(row.key) || { outstanding: 0, paid: 0, name: null };
    const p = profitByBrandId.get(row.key) || { cost: 0, commission: 0, profit: 0, revenue: 0 };
    const costOfSold = round2(p.cost);
    const stockSpend = stockSpendByBrand.get(row.key) || 0;
    const costStillToCover = round2(Math.max(0, costOfSold - stockSpend));
    const costPart = round2(Math.min(row.cash, costStillToCover));
    // What the supplier is owed RIGHT NOW, for THIS period's sales — the card
    // this bucket feeds sits beside period-scoped figures. The balance sheet
    // uses the same arithmetic over all-time sales; see supplierDueNowAllTime.
    const dueNow = supplierDueNow({ outstanding: sup.outstanding, costOfSold, alreadyPaid: sup.paid });
    // His remaining invoice, which falls due only as shelf stock sells.
    const dueLater = round2(Math.max(0, sup.outstanding - dueNow));
    const paidAhead = round2(Math.max(0, sup.paid - costOfSold));
    const setAside = round2(Math.min(row.cash, dueNow));
    return {
      key: row.key,
      brandName: row.key === 'general' ? 'General business' : (brandNameById.get(row.key) || 'Brand'),
      supplierName: sup.name,
      accounts: row.accounts,
      cash: row.cash,
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      // Is the cash on hand cost or profit? Split it the same way the SALES
      // split. Money in a wallet has no label on it: every shilling that came
      // in was partly the cost of a box and partly profit, in a fixed ratio,
      // so the money still sitting there carries that same ratio. Saying "the
      // cost is covered, so all of it is profit" was technically defensible
      // and useless — it told the owner he holds pure profit when what he
      // holds is simply what has not been spent yet.
      spentOnStock: stockSpend,
      costStillToCover,
      // The share of every shilling sold that was the cost of the boxes.
      costShare: p.revenue > 0 ? round2((costOfSold / p.revenue) * 100) : 0,
      profitShare: p.revenue > 0 ? round2(((p.revenue - costOfSold) / p.revenue) * 100) : 0,
      costPart: p.revenue > 0 ? round2(row.cash * (costOfSold / p.revenue)) : 0,
      profitPart: p.revenue > 0
        ? round2(row.cash - round2(row.cash * (costOfSold / p.revenue)))
        : row.cash,
      // Profit that has already gone back into stock rather than sitting here.
      profitReinvested: round2(Math.max(0, stockSpend - costOfSold)),
      // What the brand's sales were made of, so "where is the cost and where
      // is the profit" is answered on the row itself.
      revenue: round2(p.revenue),
      costOfSold,
      commission: round2(p.commission || 0),
      profitEarned: round2(p.contribution ?? p.profit),
      // What this wallet's sales left after paying for the boxes. Rep
      // commission is not taken out here: the owner pays that himself, so it
      // never comes out of this money.
      grossKept: round2(p.revenue - p.cost),
      supplierPaid: sup.paid,
      supplierOwedTotal: sup.outstanding,
      dueNow,
      dueLater,
      paidAhead,
      setAside,
      yours: round2(row.cash - setAside),
    };
  }).sort((a, b) => b.cash - a.cash);

  // Name the supplier when there is only one owed, so the cards can say
  // "due to Bonge" rather than the vaguer "suppliers".
  const owedNames = [...new Set(buckets.filter((b) => b.supplierOwedTotal > 0 && b.supplierName).map((b) => b.supplierName))];
  const cashSplit = {
    totalCash: cashPosition,
    supplierLabel: owedNames.length === 1 ? owedNames[0] : 'your suppliers',
    paidAhead: round2(buckets.reduce((a, b) => a + b.paidAhead, 0)),
    setAside: round2(buckets.reduce((a, b) => a + b.setAside, 0)),
    yours: round2(buckets.reduce((a, b) => a + b.yours, 0)),
    dueLater: round2(buckets.reduce((a, b) => a + b.dueLater, 0)),
    buckets,
  };

  // ── What the business is really worth ───────────────────────────────────
  // Profit alone answers "did the boxes sell for more than they cost". It
  // does NOT answer "am I ahead", because the stock those boxes came from is
  // partly the supplier's money. Everything the business HOLDS against
  // everything it OWES — the only figure that settles the question.
  // What the reps can actually take: withdrawable balances, requests in
  // flight, and requests already approved but not yet handed over. One figure,
  // used by the capital block and by `outstandingCommission` alike, so no two
  // places on the page can quote a different debt to the same reps.
  const repCommissionPayable = round2(
    commSummary.totals.available + commSummary.totals.requested + approvedUnpaidCommission,
  );
  // ── The supplier split, ALL TIME ────────────────────────────────────────
  // A balance sheet answers "right now", so what the supplier is owed today
  // must not move when the reader clicks Today or Week. The buckets above are
  // period-scoped on purpose — they sit beside period-scoped sales — so the
  // capital block recomputes the same split from ALL-TIME cost of sales
  // instead. The identity `dueNow + dueLater === total` held throughout and
  // hid this: both halves moved together while the bill stayed all-time.
  const lifetimeByBrand = new Map((lifetime.byBrand || []).map((b) => [b.brandId, b]));
  const supplierDueNowAllTime = supplierDueNowAcross(supplierByBrand, lifetimeByBrand);

  const capital = buildCapital({
    cash: cashPosition,
    stockAtCost: inv.totals.totalValue,
    stockInWarehouse: inv.totals.warehouseValue,
    // Boxes a rep is holding are still the business's stock, counted here at
    // COST — once, on this line. The settlement balance for the same boxes is
    // their selling value and is deliberately NOT added anywhere.
    stockWithReps: inv.totals.repValue,
    stockAtSellingPrice: inv.totals.retailValue,
    stockUnits: inv.totals.totalBaseUnits,
    customersOwe,
    customersOweCount: debtAgg._count,
    supplierOutstanding: needsYou.supplierOutstanding,
    // Only the cost of what has already SOLD is due today; the rest of the
    // invoice falls due as the shelf empties. ALL-TIME, never the selected
    // period — see supplierDueNowAllTime above.
    supplierDueNow: supplierDueNowAllTime,
    supplierLabel: cashSplit.supplierLabel,
    repCommissionPayable,
    // One shape, one query, all time — the same `ownerFigures()` the period
    // strip and the cash-flow tab read from.
    owner: ownerAllTime,
  });

  // The banner's figures ARE the capital block's, so the two can never read as
  // a contradiction: one arithmetic, quoted in two places.
  const ownerMoney = {
    contributed: capital.owes.owner.intoAccounts,
    paidRepsFromPocket: capital.owes.owner.commissionFromPocket,
    // What the business owes him: money he has laid out, less anything taken.
    owedBackToOwner: capital.owes.owner.total,
    drawn: capital.owes.owner.drawn,
    earnedAllTime,
    stillWorking: round2(earnedAllTime - ownerOut),
    // Where it is working, at cost — the stock the profit turned into.
    stockAtCost: capital.holds.stock.atCost,
    owedToSuppliers: capital.owes.suppliers.total,
    // Which brand he put his cash behind, named for display.
    byBrand: (ownerAllTime.byBrand || []).map((r) => ({
      brandId: r.brandId,
      name: r.brandId ? (brandNameById.get(r.brandId) || 'Unknown brand') : 'Not tagged to a brand',
      amount: r.amount,
    })),
  };

  // Kept as the older name for the same balance sheet, derived from `capital`
  // so it cannot drift. It no longer counts rep-held boxes twice.
  const position = {
    owns: capital.holds.lines,
    owes: capital.owes.lines,
    totalOwns: capital.holds.total,
    totalOwes: capital.owes.total,
    worth: capital.left,
  };

  return {
    period,
    cashPosition,
    accounts,
    flow,
    needsYou,
    ownerMoney,
    capital,
    position,
    cashSplit,
    brandFinance,
    revenue: prof.totals.revenue,
    cogs: prof.totals.cost,
    boxesSold: prof.totals.boxes,
    grossProfit,
    commissionAccrued,
    expenses,
    netProfit,
    expenseBreakdown,
    byBrand: prof.byBrand,
    // The five products that matter most this period, for the front page —
    // name, boxes, and what each one left in the owner's pocket.
    topProducts: (prof.byProduct || []).slice(0, 5).map((x) => ({
      productId: x.productId,
      name: x.name,
      brandName: x.brandName,
      boxes: x.boxes,
      revenue: x.revenue,
      contribution: x.contribution,
      contributionMargin: x.contributionMargin,
    })),
    // What the business actually owes reps right now: withdrawable balances
    // plus requests in flight. The old figure (earned − paid) included fines
    // the reps will never receive. Same figure the capital block owes.
    outstandingCommission: repCommissionPayable,
    inventoryValue: {
      cost: inv.totals.totalValue,
      selling: inv.totals.retailValue,
      potential: round2(inv.totals.retailValue - inv.totals.totalValue),
      units: inv.totals.totalBaseUnits,
    },
  };
}

module.exports = {
  ensureDefaults,
  backfillFromHistory,
  accountBalances,
  defaultAccount,
  commissionAccount,
  paymentAccountsForBrand,
  settlementAccountFor,
  COMMISSION_TYPE,
  createAccount,
  updateAccount,
  recordTransaction,
  recordExpense,
  recordIncome,
  recordSaleIncome,
  transferBetweenAccounts,
  recordCommissionPayment,
  recordOwnerMoney,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  listCategories,
  createCategory,
  buildCapital,
  ownerFigures,
  supplierDueNow,
  supplierDueNowAcross,
  isOffAccount,
  overview,
  cashflow,
  report,
  supplierSummaries,
  supplierDetail,
  paySupplier,
  paySupplierBalance,
};
