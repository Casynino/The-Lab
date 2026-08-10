'use strict';

// ===========================================================================
// REAL-TIME WHATSAPP NOTIFICATIONS — The Lab's live business feed
//
// Every important business event queues a professional, sectioned WhatsApp
// message to the owner's phone (CallMeBot). The whatsapp_notifications table
// is the single source of truth for delivery: it deduplicates (dedupeKey),
// logs every send with its status, and acts as the retry queue — PENDING
// rows are re-attempted from the daily crons and from admin-polling
// piggybacks, so a failed delivery heals itself.
//
// Formatting rules are deliberately conservative (no divider runs, no
// https:// links): CallMeBot fronts its API with a scoring firewall that
// silently 403s messages that look bot-spammy. See weeklyReport.service.
//
// Admin controls (Settings → group "whatsapp"):
//   whatsapp.phone / whatsapp.apikey        — CallMeBot credentials
//   whatsapp.notify.<TYPE> = '0'|'1'        — per-type toggle (default on)
//   whatsapp.quietFrom / whatsapp.quietTo   — quiet hours (EAT, 0-23);
//                                             CRITICAL messages bypass them
// ===========================================================================

const prisma = require('../config/prisma');
const { dayjs } = require('../utils/dates');
const { toNumber, round2 } = require('../utils/money');

const MAX_ATTEMPTS = 5;
// CallMeBot silently truncates free-tier messages at roughly 700-750 chars
// (observed: a 990-char report was cut mid-word around 716). Trim ourselves so
// the cut is never mid-sentence and important lines are ordered first.
const MAX_TEXT = 700;
const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// Notification catalogue: label + default priority, used by the Settings UI.
const TYPES = {
  STOCK_REQUEST: { label: 'Stock request submitted', priority: 'ACTION' },
  SETTLEMENT_SUBMITTED: { label: 'Settlement submitted', priority: 'ACTION' },
  RETURN_SUBMITTED: { label: 'Return request submitted', priority: 'ACTION' },
  COMMISSION_READY: { label: 'Rep commission ready for withdrawal', priority: 'INFO' },
  LOW_STOCK: { label: 'Low stock alert', priority: 'WARNING' },
  OUT_OF_STOCK: { label: 'Out of stock alert', priority: 'CRITICAL' },
  DAILY_SUMMARY: { label: 'Daily business report (21:00)', priority: 'INFO' },
  WEEKLY_REPORT: { label: 'Weekly business report (Monday 08:00, with PDF)', priority: 'INFO' },
  MONTHLY_REPORT: { label: 'Monthly business report (1st of month 08:00, with PDF)', priority: 'INFO' },
  REP_ALERT: { label: "Sales rep alerts (to the rep's own WhatsApp)", priority: 'INFO' },
  TEST: { label: 'Test message', priority: 'INFO' },
};

const PRIORITY_ICON = { INFO: '🟢', ACTION: '🟡', WARNING: '🟠', CRITICAL: '🔴' };

// ── Settings helpers ─────────────────────────────────────────────────────────
async function getSetting(key) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? null;
}

async function getConfig() {
  const [phone, apikey] = await Promise.all([getSetting('whatsapp.phone'), getSetting('whatsapp.apikey')]);
  return { phone, apikey, configured: Boolean(phone && apikey) };
}

async function isEnabled(type) {
  const v = await getSetting(`whatsapp.notify.${type}`);
  return v !== '0'; // default on
}

// East Africa Time (UTC+3, no DST) — the business's clock.
const nowEAT = () => dayjs().utc().add(3, 'hour');
const fmtWhen = (d) => (d ? dayjs(d) : dayjs()).utc().add(3, 'hour').format('D MMM YYYY, HH:mm') + ' EAT';
const dateEAT = () => nowEAT().format('YYYY-MM-DD');

async function inQuietHours() {
  const [fromRaw, toRaw] = await Promise.all([getSetting('whatsapp.quietFrom'), getSetting('whatsapp.quietTo')]);
  const from = parseInt(fromRaw, 10);
  const to = parseInt(toRaw, 10);
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return false;
  const h = nowEAT().hour();
  return from < to ? h >= from && h < to : h >= from || h < to;
}

// ── Message composer (the notification standard) ─────────────────────────────
// Title → date/time → person → reference → details → status → action.
function compose({ priority = 'INFO', title, ref, when, who, lines = [], status, action }) {
  const out = [
    `${PRIORITY_ICON[priority] || PRIORITY_ICON.INFO} *${title}*${ref ? ` — ${ref}` : ''}`,
    `_${fmtWhen(when)}_`,
  ];
  if (who) out.push('', `*By:* ${who}`);
  if (lines.length) out.push('', ...lines);
  if (status || action) out.push('');
  if (status) out.push(`*Status:* ${status}`);
  if (action) out.push(`*Action:* ${action}`);
  return out.join('\n');
}

// ── Delivery ─────────────────────────────────────────────────────────────────

// Run a notification without blocking the caller's response — but keep the
// serverless function alive until it finishes. Vercel freezes the lambda the
// moment the HTTP response is sent, which kills plain fire-and-forget fetches
// ("fetch failed"); waitUntil() is the sanctioned way to outlive the response.
// Outside Vercel (local dev server) it just runs as a normal promise.
function background(promise) {
  const p = Promise.resolve(promise).catch(() => {});
  try {
    require('@vercel/functions').waitUntil(p);
  } catch {
    // Not on Vercel — long-running process keeps the promise alive anyway.
  }
  return p;
}

async function sendRaw(text, creds = null) {
  const { phone, apikey, configured } = creds && creds.phone && creds.apikey
    ? { phone: creds.phone, apikey: creds.apikey, configured: true }
    : await getConfig();
  if (!configured) return { sent: false, reason: 'WhatsApp not configured' };
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(text)}`;
  // Browser UA on purpose — CallMeBot's firewall 403s bot user agents.
  // Generous timeout + trust any 2xx: CallMeBot can take >15s to answer while
  // having ALREADY queued the message — classifying that as failure made the
  // retry deliver the same text twice. A 2xx from them means accepted.
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(45000),
  });
  const body = await res.text().catch(() => '');
  // CallMeBot returns HTTP 200 even when it REFUSES to send (quota exhausted,
  // bot paused). Trusting the status alone logged those as delivered — silently
  // lying about messages the owner never received. Detect explicit refusals.
  const refused = /message not sent|messages left|subscribe here/i.test(body);
  const quotaExhausted = /messages left|subscribe here/i.test(body);
  return {
    sent: res.ok && !refused,
    quotaExhausted,
    status: res.status,
    provider: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

// CallMeBot's free tier delivers ~16 messages per 240 minutes immediately;
// past that, messages sit in THEIR queue and arrive late, grouped. Spend that
// budget on what matters: when it's nearly gone, hold INFO-priority rows in
// our own queue (flush retries them once the window frees) so action-required
// and critical alerts still land instantly.
// Free CallMeBot delivers ~16 messages per 4 hours immediately and queues the
// rest to arrive late and grouped, so we stop short of that. A paid plan raises
// the provider's own limit, and this ceiling must be raised to match or it
// becomes the thing delaying messages. 0 disables the cap entirely.
async function providerBudgetCap() {
  const raw = await getSetting('whatsapp.providerBudget');
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 14 : n;
}

async function providerBudgetUsed(toPhone = null) {
  return prisma.whatsAppNotification.count({
    where: {
      status: 'SENT',
      sentAt: { gt: new Date(Date.now() - 240 * 60 * 1000) },
      toPhone: toPhone || null, // null = owner's number; each recipient has its own 16/4h budget
    },
  });
}

async function deliver(row) {
  const cap = await providerBudgetCap();
  if (cap > 0 && row.priority === 'INFO' && row.type !== 'TEST' && (await providerBudgetUsed(row.toPhone)) >= cap) {
    return { queued: true, sent: false, status: 'PENDING', reason: 'provider-budget', id: row.id };
  }

  // Optimistic claim: bump attempts only if nobody else has. Two concurrent
  // flushes (separate serverless instances) can pick the same PENDING row;
  // the loser of this update skips, so a message is never sent twice.
  const claimed = await prisma.whatsAppNotification.updateMany({
    where: { id: row.id, status: 'PENDING', attempts: row.attempts },
    data: { attempts: row.attempts + 1, lastAttemptAt: new Date() },
  });
  if (claimed.count === 0) {
    return { queued: true, sent: false, status: 'PENDING', reason: 'claimed-elsewhere', id: row.id };
  }

  const creds = row.toPhone && row.toApiKey ? { phone: row.toPhone, apikey: row.toApiKey } : null;
  const result = await sendRaw(row.text, creds).catch((e) => ({ sent: false, provider: e.message }));
  const attempts = row.attempts + 1;
  // A quota refusal will never succeed on retry — fail it immediately so the
  // owner is told now instead of after five pointless attempts.
  const status = result.sent ? 'SENT'
    : result.quotaExhausted || attempts >= MAX_ATTEMPTS ? 'FAILED'
    : 'PENDING';
  const updated = await prisma.whatsAppNotification.update({
    where: { id: row.id },
    data: {
      status,
      sentAt: result.sent ? new Date() : null,
      lastError: result.sent ? null : String(result.reason || result.provider || 'send failed').slice(0, 300),
    },
  });
  // Out of retries — surface it inside The Lab so the owner knows a WhatsApp
  // message was lost (reliability rule: log, retry, then notify the admin).
  if (status === 'FAILED') {
    require('./notification.service').notifyAdmins({
      type: 'GENERAL',
      severity: 'CRITICAL',
      title: result.quotaExhausted ? 'WhatsApp quota exhausted — messages are NOT being delivered' : 'WhatsApp notification failed',
      message: result.quotaExhausted
        ? `WhatsApp alerts to ${row.toPhone || 'the owner number'} are no longer being delivered: the messaging provider reports the quota is used up. Every alert to that number will fail until it is renewed or the provider is changed.`
        : `A ${row.type.replaceAll('_', ' ').toLowerCase()} message could not be delivered after ${attempts} attempts. Check Settings → WhatsApp notifications.`,
      entityType: 'WhatsAppNotification',
      entityId: row.id,
    }).catch(() => {});
  }
  return { queued: true, sent: result.sent, status: updated.status, attempts, id: row.id };
}

// Queue a notification: log it (dedupe on dedupeKey) and try to send now.
// Quiet hours hold non-critical messages as PENDING; flush() sends them later.
async function queue(type, { priority, dedupeKey = null, refType = null, refId = null, text, toPhone = null, toApiKey = null }) {
  if (!(await isEnabled(type))) return { queued: false, reason: 'disabled' };
  // A rep recipient carries its own creds; the owner path needs the settings.
  if (!(toPhone && toApiKey)) {
    const { configured } = await getConfig();
    if (!configured) return { queued: false, reason: 'not-configured' };
  }

  const prio = priority || TYPES[type]?.priority || 'INFO';
  // Trim on whole lines so a provider-side cut can't leave half a sentence.
  let body = text;
  if (body.length > MAX_TEXT) {
    const lines = body.split('\n');
    body = '';
    for (const line of lines) {
      if (body.length + line.length + 2 > MAX_TEXT) break;
      body += (body ? '\n' : '') + line;
    }
    body += '\n…';
  }
  let row;
  try {
    row = await prisma.whatsAppNotification.create({
      data: { type, priority: prio, dedupeKey, refType, refId, text: body, toPhone, toApiKey },
    });
  } catch (e) {
    if (e.code === 'P2002') return { queued: false, reason: 'duplicate' };
    throw e;
  }
  if (prio !== 'CRITICAL' && (await inQuietHours())) {
    return { queued: true, sent: false, status: 'PENDING', reason: 'quiet-hours', id: row.id };
  }
  return deliver(row);
}

// Re-attempt undelivered rows. Called from crons and (throttled) from admin
// polling. Sends at most two per run with a gap — CallMeBot rate-limits bursts.
let lastFlushAt = 0;
async function flush({ throttleMs = 60000 } = {}) {
  const now = Date.now();
  if (now - lastFlushAt < throttleMs) return { retried: 0, throttled: true };
  lastFlushAt = now;

  const quiet = await inQuietHours();
  const rows = await prisma.whatsAppNotification.findMany({
    where: {
      status: 'PENDING',
      attempts: { lt: MAX_ATTEMPTS },
      createdAt: { gt: new Date(now - 48 * 3600 * 1000) },
      // Anti-duplicate cool-down: an attempt may have actually been delivered
      // even if it read as failed — never echo it within 10 minutes.
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now - 10 * 60 * 1000) } }],
      ...(quiet ? { priority: 'CRITICAL' } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  let sent = 0;
  for (const row of rows) {
    const r = await deliver(row);
    if (r.sent) sent += 1;
    if (rows.length > 1) await new Promise((res) => setTimeout(res, 8000));
  }
  return { retried: rows.length, sent };
}

// ── Event notifications ──────────────────────────────────────────────────────

// 1. Stock request submitted (rep asks for stock). `req` is the created
// request including items+product and salesRep.user.
async function stockRequestSubmitted(req) {
  const repName = req.salesRep?.user?.name || 'A rep';
  const boxes = (req.items || []).reduce((s, i) => s + (i.quantityRequested || 0), 0);
  const itemLines = (req.items || []).map((i) => `${i.product?.name}: ${i.quantityRequested} ${i.packagingUnit?.name || 'box'}(s)`);
  const text = compose({
    priority: 'ACTION',
    title: 'STOCK REQUEST',
    ref: req.requestNumber,
    who: `${repName} (${req.salesRep?.code || 'rep'})`,
    lines: [...itemLines, `*Total:* ${boxes} box(es) worth ${fmt(req.totalValue)}`],
    status: 'Pending approval',
    action: 'Approve or reject in The Lab',
  });
  return queue('STOCK_REQUEST', { dedupeKey: `stockreq:${req.id}`, refType: 'StockRequest', refId: req.id, text });
}

// 4. Settlement submitted (rep reports boxes sold + money paid in).
async function settlementSubmitted({ sub, settlement, product, repName }) {
  const commission = require('./commission.service');
  let perBox = 0;
  try { perBox = toNumber(await commission.rateForProductOnOrder(settlement.id, product.id)); } catch { /* rule optional */ }
  const text = compose({
    priority: 'ACTION',
    title: 'SETTLEMENT SUBMITTED',
    ref: sub.submissionNumber,
    who: repName,
    lines: [
      `*Order:* ${settlement.settlementNumber}`,
      `*Product:* ${product.name}`,
      `*Boxes sold:* ${sub.boxes}`,
      `*Payment:* ${fmt(sub.amount)} via ${sub.method || 'Cash'}`,
      perBox > 0 ? `*Commission if approved:* ${fmt(round2(sub.boxes * perBox))}` : null,
    ].filter(Boolean),
    status: 'Pending approval — no business impact yet',
    action: 'Verify the money arrived, then approve',
  });
  return queue('SETTLEMENT_SUBMITTED', { dedupeKey: `stlsub:${sub.id}`, refType: 'SettlementSubmission', refId: sub.id, text });
}

// 6. Return request submitted.
async function returnSubmitted(ret) {
  const repName = ret.salesRep?.user?.name || 'Warehouse';
  const boxes = (ret.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const itemLines = (ret.items || []).map((i) => `${i.product?.name}: ${i.quantity} box(es)`);
  let orderNumber = null;
  if (ret.settlementId) {
    const s = await prisma.settlement.findUnique({ where: { id: ret.settlementId }, select: { settlementNumber: true } }).catch(() => null);
    orderNumber = s?.settlementNumber || null;
  }
  const text = compose({
    priority: 'ACTION',
    title: 'RETURN REQUEST',
    ref: ret.returnNumber,
    who: repName,
    lines: [
      orderNumber ? `*Order:* ${orderNumber}` : null,
      ...itemLines,
      `*Total returned:* ${boxes} box(es)`,
      ret.reason ? `*Reason:* ${ret.reason}` : null,
    ].filter(Boolean),
    status: 'Pending inspection',
    action: 'Inspect the goods, then approve or reject',
  });
  return queue('RETURN_SUBMITTED', { dedupeKey: `return:${ret.id}`, refType: 'Return', refId: ret.id, text });
}

// 8. Commission ready — a rep's available balance reached the withdrawal
// threshold. WhatsApp goes to the owner (CallMeBot only reaches the owner's
// phone); the rep gets an in-app notification. Once per rep per day.
async function commissionReadyCheck(salesRepId) {
  const commission = require('./commission.service');
  const notification = require('./notification.service');
  const c = await commission.computeForRep(salesRepId);
  const threshold = toNumber(c.minWithdrawal) || 0;
  if (threshold <= 0 || c.available < threshold) return { queued: false, reason: 'below-threshold' };

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!rep) return { queued: false, reason: 'rep-not-found' };

  notification.createIfAbsent({
    type: 'GENERAL',
    severity: 'INFO',
    title: 'Commission ready for withdrawal',
    message: `Your available commission is ${fmt(c.available)} — above the ${fmt(threshold)} minimum. You can request a withdrawal.`,
    entityType: 'Commission',
    entityId: `commready-${salesRepId}`,
    userId: rep.user?.id || null,
  }).catch(() => {});

  const text = compose({
    priority: 'INFO',
    title: 'COMMISSION READY',
    who: `${rep.user?.name || rep.code} (${rep.code})`,
    lines: [
      `*Available commission:* ${fmt(c.available)}`,
      `*Earned to date:* ${fmt(c.earned)}`,
      c.penalties > 0 ? `*Penalties applied:* ${fmt(c.penalties)}` : null,
      `*Withdrawal minimum:* ${fmt(threshold)}`,
    ].filter(Boolean),
    status: 'Eligible for withdrawal',
  });
  return queue('COMMISSION_READY', {
    dedupeKey: `commready:${salesRepId}:${dateEAT()}`,
    refType: 'SalesRepresentative',
    refId: salesRepId,
    text,
  });
}

// 10 & 11. Low stock / out of stock for one product. Once per product per day.
async function stockAlertForProduct(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, minStockLevel: true, brand: { select: { name: true } } },
  });
  if (!product || product.minStockLevel <= 0) return { queued: false, reason: 'no-min-level' };

  const agg = await prisma.warehouseStock.aggregate({ where: { productId }, _sum: { baseQuantity: true } });
  const onHand = agg._sum.baseQuantity || 0;
  if (onHand > product.minStockLevel) return { queued: false, reason: 'in-stock' };

  const recommended = Math.max(product.minStockLevel * 2 - onHand, product.minStockLevel);
  if (onHand <= 0) {
    const lastSale = await prisma.saleItem.findFirst({
      where: { productId, sale: { status: { not: 'CANCELLED' } } },
      orderBy: { sale: { soldAt: 'desc' } },
      select: { sale: { select: { soldAt: true } } },
    }).catch(() => null);
    const text = compose({
      priority: 'CRITICAL',
      title: 'OUT OF STOCK',
      lines: [
        `*Product:* ${product.name}`,
        `*Brand:* ${product.brand?.name || '-'}`,
        `*Warehouse stock:* 0 boxes`,
        lastSale?.sale?.soldAt ? `*Last sale:* ${fmtWhen(lastSale.sale.soldAt)}` : null,
        `*Suggested purchase:* ${recommended} box(es)`,
      ].filter(Boolean),
      status: 'Sales of this product are blocked',
      action: 'Restock immediately',
    });
    return queue('OUT_OF_STOCK', { dedupeKey: `outofstock:${productId}:${dateEAT()}`, refType: 'Product', refId: productId, text });
  }

  const text = compose({
    priority: 'WARNING',
    title: 'LOW STOCK',
    lines: [
      `*Product:* ${product.name}`,
      `*Remaining:* ${onHand} box(es)`,
      `*Reorder level:* ${product.minStockLevel}`,
      `*Suggested purchase:* ${recommended} box(es)`,
    ],
    status: onHand <= product.minStockLevel / 2 ? 'High priority' : 'Medium priority',
    action: 'Plan a restock',
  });
  return queue('LOW_STOCK', { dedupeKey: `lowstock:${productId}:${dateEAT()}`, refType: 'Product', refId: productId, text });
}

// Cron sweep: catch anything the movement hooks missed.
async function scanStockAlerts() {
  const reorder = require('./reorder.service');
  const low = await reorder.lowStock();
  let queued = 0;
  for (const p of low) {
    const r = await stockAlertForProduct(p.id).catch(() => ({ queued: false }));
    if (r.queued) queued += 1;
  }
  return { candidates: low.length, queued };
}

// 15. Daily business report — the 21:00 (Tanzania time) evening pulse.
// Message-only by design; the day is anchored to the EAT calendar day.
async function dailySummary({ force = false } = {}) {
  const finance = require('./finance.service');
  const reorder = require('./reorder.service');
  const settlementSvc = require('./settlement.service');
  const { eatRange } = require('../utils/dates');

  const day = eatRange('day');
  const [rep, accounts, val, low, stl, counts, repRows] = await Promise.all([
    finance.report({ start: day.start, end: day.end }),
    finance.accountBalances(),
    require('./inventory.service').valuation(prisma),
    reorder.lowStock(),
    settlementSvc.summary(),
    prisma.$transaction([
      prisma.stockRequest.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'PENDING' } }),
      prisma.return.count({ where: { status: 'PENDING' } }),
      prisma.settlementSubmission.count({ where: { status: 'APPROVED', decidedAt: { gte: day.start, lte: day.end } } }),
      prisma.return.count({ where: { createdAt: { gte: day.start, lte: day.end } } }),
      prisma.stockRequest.count({ where: { createdAt: { gte: day.start, lte: day.end } } }),
    ]),
    prisma.sale.groupBy({
      by: ['salesRepId'],
      where: { soldAt: { gte: day.start, lte: day.end }, status: { not: 'CANCELLED' }, salesRepId: { not: null } },
      _sum: { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 3,
    }).catch(() => []),
  ]);

  // Names for the day's selling reps.
  const repIds = repRows.map((r) => r.salesRepId);
  const reps = repIds.length
    ? await prisma.salesRepresentative.findMany({ where: { id: { in: repIds } }, include: { user: { select: { name: true } } } }).catch(() => [])
    : [];
  const nameOf = new Map(reps.map((r) => [r.id, r.user?.name || r.code]));
  const repLines = repRows.map((r) => `${nameOf.get(r.salesRepId) || 'Rep'}: ${fmt(r._sum.total)}`);

  const cashPosition = accounts.reduce((s, a) => s + a.balance, 0);
  const outOfStock = val.items.filter((i) => i.totalBase <= 0).length;
  const negAccounts = accounts.filter((a) => a.balance < 0);
  const pendingTotal = counts[0] + counts[1] + counts[2];

  const alerts = [];
  alerts.push(`Approvals waiting: ${pendingTotal} (${counts[0]} req / ${counts[1]} stl / ${counts[2]} ret)`);
  if (stl.overdueCount) alerts.push(`Overdue orders: ${stl.overdueCount} (${fmt(stl.overdueValue)})`);
  if (negAccounts.length) alerts.push(`Account below zero: ${negAccounts.map((a) => a.name).join(', ')}`);

  const lines = [
    '🟢 *THE LAB — DAILY REPORT*',
    `_${nowEAT().format('dddd, D MMM YYYY')}_`,
    '',
    '💰 *TODAY*',
    `Sales: ${fmt(rep.revenue)} (${rep.boxesSold} boxes)`,
    `Gross: ${fmt(rep.grossProfit)} / Expenses: ${fmt(rep.expenses)}`,
    `*Net profit: ${fmt(rep.netProfit)}*`,
    `🏦 Cash: *${fmt(cashPosition)}* (${accounts.map((a) => `${a.name} ${fmt(a.balance)}`).join(' / ')})`,
    '',
    '📋 *ACTIVITY*',
    `New orders: ${counts[5]} / Settlements: ${counts[3]} / Returns: ${counts[4]}`,
    ...(repLines.length ? ['⭐ ' + repLines.join(' · ')] : []),
    '',
    '📦 *INVENTORY*',
    `Value: ${fmt(val.totals.totalValue)} (${val.totals.totalBaseUnits} boxes)`,
    `Low stock: ${low.length} / Out of stock: ${outOfStock}`,
    `Active orders with reps: ${stl.outstandingCount} (${fmt(stl.outstandingValue)})`,
    '',
    alerts.length > 1 || stl.overdueCount || negAccounts.length ? '⚠️ *NEEDS ATTENTION*' : '✅ *ALL CLEAR*',
    ...alerts,
  ];

  return queue('DAILY_SUMMARY', {
    dedupeKey: force ? `daily:${dateEAT()}:${Date.now()}` : `daily:${dateEAT()}`,
    text: lines.join('\n'),
  });
}

// Fallback for the evening summary: piggybacks on admin polling in case the
// daily cron slot isn't available on the hosting plan. The dedupeKey makes
// this idempotent with the cron.
let lastCatchupAt = 0;
async function dailySummaryCatchup() {
  if (nowEAT().hour() < 21) return { queued: false, reason: 'too-early' };
  const now = Date.now();
  if (now - lastCatchupAt < 10 * 60 * 1000) return { queued: false, reason: 'throttled' };
  lastCatchupAt = now;
  return dailySummary();
}

// ── Per-rep alerts ───────────────────────────────────────────────────────────
// Reps activate their own CallMeBot number; when both phone+apikey are stored
// on their profile, their important alerts are pushed to their WhatsApp.

const SEVERITY_PRIORITY = { INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' };

async function repCreds(salesRepId) {
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: salesRepId },
    select: { whatsappPhone: true, whatsappApiKey: true },
  }).catch(() => null);
  if (rep?.whatsappPhone && rep?.whatsappApiKey) return { phone: rep.whatsappPhone, apikey: rep.whatsappApiKey };
  return null;
}

// Queue a message to a specific rep's WhatsApp. Returns {queued:false} when the
// rep has no WhatsApp configured (caller ignores — in-app notice still stands).
async function notifyRep(salesRepId, { title, message, severity = 'INFO', dedupeKey = null }) {
  const creds = await repCreds(salesRepId);
  if (!creds) return { queued: false, reason: 'no-whatsapp' };
  const text = [`${PRIORITY_ICON[SEVERITY_PRIORITY[severity]] || '🟢'} *${title}*`, '', message, '', '_The Lab_'].join('\n');
  return queue('REP_ALERT', {
    priority: SEVERITY_PRIORITY[severity] || 'INFO',
    dedupeKey,
    refType: 'SalesRepresentative',
    refId: salesRepId,
    text,
    toPhone: creds.phone,
    toApiKey: creds.apikey,
  });
}

// Mirror an in-app user notification to the rep's WhatsApp, if that user is a
// rep with WhatsApp set. Called from notification.notifyUser — one hook that
// covers every rep alert (approvals, rejections, penalties, reminders,
// commission earned/ready). Never throws.
async function mirrorToRep(userId, data) {
  try {
    if (!userId) return { queued: false };
    const rep = await prisma.salesRepresentative.findFirst({
      where: { userId, whatsappPhone: { not: null }, whatsappApiKey: { not: null } },
      select: { id: true },
    });
    if (!rep) return { queued: false, reason: 'no-whatsapp' };
    return await notifyRep(rep.id, {
      title: data.title,
      message: data.message,
      severity: data.severity || 'INFO',
      // Dedupe on the linked entity so a retried in-app notify never double-texts.
      dedupeKey: data.entityId ? `rep:${rep.id}:${data.entityType || 'x'}:${data.entityId}:${data.title}` : null,
    });
  } catch {
    return { queued: false };
  }
}

// Test message to a specific rep's number (admin "Send test" on the profile).
async function testRep(salesRepId) {
  const creds = await repCreds(salesRepId);
  if (!creds) return { sent: false, reason: 'no-whatsapp' };
  const text = ['🟢 *THE LAB*', '', 'WhatsApp alerts are now active for you. You will get a message here whenever something important happens with your stock, settlements and commission.', '', '_The Lab_'].join('\n');
  const result = await sendRaw(text, creds);
  await prisma.whatsAppNotification.create({
    data: {
      type: 'TEST', priority: 'INFO', text, toPhone: creds.phone, toApiKey: creds.apikey,
      refType: 'SalesRepresentative', refId: salesRepId,
      status: result.sent ? 'SENT' : 'FAILED', attempts: 1, sentAt: result.sent ? new Date() : null,
      lastError: result.sent ? null : String(result.reason || result.provider || 'send failed').slice(0, 300),
    },
  }).catch(() => {});
  return result;
}

// ── Admin endpoints ──────────────────────────────────────────────────────────
// Put failed messages back in the queue. Used after the cause of the failure is
// fixed — a renewed provider plan, a corrected number — since those rows are
// otherwise terminal and their text would never be delivered at all.
async function retryFailed({ hours = 168 } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const { count } = await prisma.whatsAppNotification.updateMany({
    where: { status: 'FAILED', createdAt: { gt: since } },
    // attempts reset so the retry budget applies afresh; lastAttemptAt cleared
    // so the ten-minute anti-duplicate cool-down does not hold them back.
    data: { status: 'PENDING', attempts: 0, lastAttemptAt: null, lastError: null },
  });
  // flush() sends two per run on purpose — CallMeBot rate-limits bursts — so the
  // rest go out on the following cron passes rather than all at once.
  const flushed = await flush({ throttleMs: 0 });
  return { requeued: count, ...flushed };
}

async function history(limit = 30) {
  return prisma.whatsAppNotification.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 30, 100),
  });
}

async function test() {
  const text = compose({
    priority: 'INFO',
    title: 'TEST NOTIFICATION',
    lines: ['WhatsApp notifications are working.', 'This is how live business alerts will look.'],
    status: 'Delivered',
  });
  return queue('TEST', { text });
}

module.exports = {
  retryFailed,
  providerBudgetCap,
  TYPES,
  compose,
  background,
  sendRaw,
  queue,
  flush,
  stockRequestSubmitted,
  settlementSubmitted,
  returnSubmitted,
  commissionReadyCheck,
  stockAlertForProduct,
  scanStockAlerts,
  dailySummary,
  dailySummaryCatchup,
  notifyRep,
  mirrorToRep,
  testRep,
  history,
  test,
};
