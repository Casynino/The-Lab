'use strict';

// ===========================================================================
// REAL-TIME WHATSAPP NOTIFICATIONS — ZELab's live business feed
//
// Every important business event queues a professional, sectioned WhatsApp
// message to the owner's phone (CallMeBot). The whatsapp_notifications table
// is the single source of truth for delivery: it deduplicates (dedupeKey),
// logs every send with its status, and acts as the retry queue — PENDING
// rows are re-attempted from the daily crons and from admin-polling
// piggybacks, so a failed delivery heals itself.
//
// The WORDING of every message lives in whatsappText.js (plain text, no emoji,
// one shape for all). This file decides who gets what, when, and how often.
// Keep it conservative (no divider runs): CallMeBot fronts its API with a
// scoring firewall that silently 403s messages that look bot-spammy.
//
// Admin controls (Settings → group "whatsapp"):
//   whatsapp.phone / whatsapp.apikey        — CallMeBot credentials
//   whatsapp.notify.<TYPE> = '0'|'1'        — per-type toggle (default on)
//   whatsapp.quietFrom / whatsapp.quietTo   — quiet hours (EAT, 0-23);
//                                             CRITICAL messages bypass them
// ===========================================================================

const prisma = require('../config/prisma');
const { dayjs } = require('../utils/dates');
const ApiError = require('../utils/ApiError');
const wt = require('./whatsappText');
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
  DAILY_SUMMARY: { label: 'Daily business report (21:00, with PDF)', priority: 'INFO' },
  WEEKLY_REPORT: { label: 'Weekly business report (Tuesday 08:00, with PDF)', priority: 'INFO' },
  MONTHLY_REPORT: { label: 'Monthly business report (1st of month 08:00, with PDF)', priority: 'INFO' },
  YEARLY_REPORT: { label: 'Yearly business report (1 January 08:00, with PDF)', priority: 'INFO' },
  DEADLINE_IMMINENT: { label: 'An order is minutes from its deadline', priority: 'WARNING' },
  EXTENSION_TAKEN: { label: 'A rep took the 96-hour extension', priority: 'ACTION' },
  REP_ALERT: { label: "Sales rep alerts (to the rep's own WhatsApp)", priority: 'INFO' },
  TEST: { label: 'Test message', priority: 'INFO' },
};

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
const dateEAT = () => nowEAT().format('YYYY-MM-DD');

async function inQuietHours() {
  const [fromRaw, toRaw] = await Promise.all([getSetting('whatsapp.quietFrom'), getSetting('whatsapp.quietTo')]);
  const from = parseInt(fromRaw, 10);
  const to = parseInt(toRaw, 10);
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return false;
  const h = nowEAT().hour();
  return from < to ? h >= from && h < to : h >= from || h < to;
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

// CallMeBot's firewall refuses (HTTP 403, from its Apache) messages carrying a www.zelab.site link — the
// first daily report after the move to the new domain (10 Nov 2026, 21:00) was refused five times and
// never arrived, while the same kind of message with the old vercel.app link went through. So a message
// refused that way is sent again at once WITHOUT its links, saying where the document is kept: every
// report is archived and opens from ZELab → Profile → Reports. The text that was stored is unchanged.
const LINK = /https?:\/\/\S+/g;
async function sendRaw(text, creds = null) {
  const first = await sendRawOnce(text, creds);
  if (!first.sent && first.status === 403 && LINK.test(text)) {
    LINK.lastIndex = 0;
    const plain = text.replace(LINK, '(open it in ZELab → Profile → Reports)');
    const second = await sendRawOnce(plain, creds);
    return { ...second, linkRemoved: true, firstRefusal: first.provider };
  }
  LINK.lastIndex = 0;
  return first;
}

async function sendRawOnce(text, creds = null) {
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
  // Out of retries — surface it inside ZELab so the owner knows a WhatsApp
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
// Only rows from the last FLUSH_WINDOW_HOURS are retried: older news is not sent.
const FLUSH_WINDOW_HOURS = 48;
const PRIORITY_RANK = { CRITICAL: 0, ACTION: 1, WARNING: 2, INFO: 3 };

// A message that is only true until a moment. "An order is minutes from its deadline" is about one
// deadline, kept in its dedupe key (deadlinewarn:<order>:<deadline ms>); once that moment has passed
// the fine has started, or the order was given more time and is warned again before its new deadline.
// Held by quiet hours or a failed try, it used to go out hours later, still saying "3 minutes left".
function expiresAt(row) {
  if (row.type !== 'DEADLINE_IMMINENT') return null;
  const ms = Number(String(row.dedupeKey || '').split(':')[2]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

// Waiting messages that came too late to be true are closed as EXPIRED, never sent. Only the types
// expiresAt() knows are read, so this stays a small query however long the queue is.
async function expireStale(now) {
  const waiting = await prisma.whatsAppNotification.findMany({
    where: { status: 'PENDING', type: 'DEADLINE_IMMINENT' },
    select: { id: true, type: true, dedupeKey: true },
  });
  const ids = waiting.filter((r) => { const at = expiresAt(r); return at && at.getTime() <= now; }).map((r) => r.id);
  if (!ids.length) return 0;
  const { count } = await prisma.whatsAppNotification.updateMany({
    where: { id: { in: ids }, status: 'PENDING' },
    data: { status: 'EXPIRED', lastError: 'Not sent: the deadline it warned about had already passed' },
  });
  return count;
}

// Messages sent to each recipient in the provider's 4-hour window, in one query (null = the owner).
async function budgetUsedByRecipient() {
  const groups = await prisma.whatsAppNotification.groupBy({
    by: ['toPhone'],
    where: { status: 'SENT', sentAt: { gt: new Date(Date.now() - 240 * 60 * 1000) } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.toPhone || null, g._count._all]));
}

let lastFlushAt = 0;
async function flush({ throttleMs = 60000 } = {}) {
  const now = Date.now();
  if (now - lastFlushAt < throttleMs) return { retried: 0, throttled: true };
  lastFlushAt = now;

  const expired = await expireStale(now);
  const quiet = await inQuietHours();
  const waiting = {
    status: 'PENDING',
    attempts: { lt: MAX_ATTEMPTS },
    createdAt: { gt: new Date(now - FLUSH_WINDOW_HOURS * 3600 * 1000) },
    // Anti-duplicate cool-down: an attempt may have actually been delivered
    // even if it read as failed — never echo it within 10 minutes.
    OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now - 10 * 60 * 1000) } }],
  };
  // The candidates are read so that held rows can never fill the window. They were the 50 oldest
  // waiting rows, ranked only afterwards: one busy rep number with 50 INFO alerts over the provider
  // budget filled it, every run sent nothing, and the warnings and other people's messages behind
  // them waited for hours (final audit, 12 Nov 2026). Now the urgent rows (anything not INFO, never
  // held by the budget) are read first, the most urgent first and oldest first within one priority;
  // INFO rows only when fewer than two urgent rows are waiting, and only for recipients with budget
  // left. Quiet hours hold everything but CRITICAL.
  const urgent = await prisma.whatsAppNotification.findMany({
    where: { ...waiting, priority: quiet ? 'CRITICAL' : { not: 'INFO' } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  const rows = [...urgent]
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
    .slice(0, 2);

  if (rows.length < 2 && !quiet) {
    const cap = await providerBudgetCap();
    const used = cap > 0 ? await budgetUsedByRecipient() : new Map();
    const held = [...used.entries()].filter(([, n]) => n >= cap).map(([to]) => to);
    const heldPhones = held.filter(Boolean);
    const ownerHeld = held.includes(null);
    // A test message is never held by the budget (deliver() lets it through too).
    const free = cap > 0 && held.length
      ? {
        OR: [
          { type: 'TEST' },
          ownerHeld
            ? { AND: [{ toPhone: { not: null } }, ...(heldPhones.length ? [{ toPhone: { notIn: heldPhones } }] : [])] }
            : { OR: [{ toPhone: null }, ...(heldPhones.length ? [{ toPhone: { notIn: heldPhones } }] : [])] },
        ],
      }
      : {};
    const info = await prisma.whatsAppNotification.findMany({
      where: { AND: [waiting, { priority: 'INFO' }, free] },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    // Never pick more for one recipient than the budget it has left: deliver() would hold the extra
    // one after an 8-second wait for nothing.
    const left = new Map();
    for (const row of info) {
      if (rows.length >= 2) break;
      const to = row.toPhone || null;
      if (cap > 0 && row.type !== 'TEST') {
        const remaining = left.has(to) ? left.get(to) : cap - (used.get(to) || 0);
        if (remaining <= 0) continue;
        left.set(to, remaining - 1);
      }
      rows.push(row);
    }
  }
  let sent = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = await deliver(rows[i]);
    if (r.sent) sent += 1;
    // The gap is for CallMeBot's burst limit, so it is only needed between two
    // real attempts — not after the last row, nor after a row that was held.
    const attempted = r.attempts !== undefined;
    if (attempted && i < rows.length - 1) await new Promise((res) => setTimeout(res, 8000));
  }
  return { retried: rows.length, sent, ...(expired ? { expired } : {}) };
}

// ── Event notifications ──────────────────────────────────────────────────────

// 1. Stock request submitted (rep asks for stock). `req` is the created
// request including items+product and salesRep.user.
async function stockRequestSubmitted(req) {
  const text = wt.owner.stockRequest({
    by: req.salesRep?.user?.name || req.salesRep?.code || 'A rep',
    city: req.region || null,
    items: (req.items || []).map((i) => {
      // How many boxes one unit of the chosen packaging holds (a carton is more than one box).
      const factor = (i.product?.packagings || []).find((k) => k.packagingUnitId === i.packagingUnitId)?.baseQuantity ?? 1;
      return { name: i.product?.name, qty: i.quantityRequested, unit: i.packagingUnit?.name, boxes: (i.quantityRequested || 0) * factor, city: i.region || null };
    }),
    total: req.totalValue,
    when: req.createdAt,
  });
  return queue('STOCK_REQUEST', { priority: 'ACTION', dedupeKey: `stockreq:${req.id}`, refType: 'StockRequest', refId: req.id, text });
}

// 4. Settlement submitted (rep reports boxes sold + money paid in).
async function settlementSubmitted({ sub, settlement, product, repName }) {
  const commission = require('./commission.service');
  let perBox = 0;
  try { perBox = toNumber(await commission.rateForProductOnOrder(settlement.id, product.id)); } catch { /* rule optional */ }
  const text = wt.owner.settlementSubmitted({
    by: repName,
    order: settlement.settlementNumber,
    product: product.name,
    boxes: sub.boxes,
    amount: sub.amount,
    method: sub.method,
    commission: perBox > 0 ? round2(sub.boxes * perBox) : 0,
    when: sub.createdAt,
  });
  return queue('SETTLEMENT_SUBMITTED', { priority: 'ACTION', dedupeKey: `stlsub:${sub.id}`, refType: 'SettlementSubmission', refId: sub.id, text });
}

// 4b. Several products submitted together: ONE message for the lot, with each product,
// the total boxes, what was paid to each account, and the commission if approved.
async function settlementSubmittedBatch({ results, settlement, repName }) {
  const commission = require('./commission.service');
  let total = 0;
  for (const { sub } of results) {
    try {
      const perBox = toNumber(await commission.rateForProductOnOrder(settlement.id, sub.productId));
      if (perBox > 0) total += sub.boxes * perBox;
    } catch { /* rule optional */ }
  }
  // What was paid, by account: the rep sends one amount per wallet, not per product.
  const byMethod = new Map();
  for (const { sub } of results) byMethod.set(sub.method || '', round2((byMethod.get(sub.method || '') || 0) + toNumber(sub.amount)));
  const text = wt.owner.settlementSubmitted({
    by: repName,
    order: settlement.settlementNumber,
    items: results.map(({ sub, product }) => ({ product: product.name, boxes: sub.boxes })),
    payments: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
    commission: round2(total),
    when: results[0].sub.createdAt,
  });
  const first = results[0].sub;
  return queue('SETTLEMENT_SUBMITTED', { priority: 'ACTION', dedupeKey: `stlsub:${first.id}:batch`, refType: 'SettlementSubmission', refId: first.id, text });
}

// 6. Return request submitted.
async function returnSubmitted(ret) {
  const repName = ret.salesRep?.user?.name || 'Warehouse';
  let orderNumber = null;
  if (ret.settlementId) {
    const s = await prisma.settlement.findUnique({ where: { id: ret.settlementId }, select: { settlementNumber: true } }).catch(() => null);
    orderNumber = s?.settlementNumber || null;
  }
  const text = wt.owner.returnRequest({
    by: repName,
    order: orderNumber,
    items: (ret.items || []).map((i) => ({ name: i.product?.name, quantity: i.quantity })),
    reason: ret.reason,
  });
  return queue('RETURN_SUBMITTED', { priority: 'ACTION', dedupeKey: `return:${ret.id}`, refType: 'Return', refId: ret.id, text });
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
    whatsapp: { kind: 'COMMISSION_READY', available: c.available, minimum: threshold },
  }).catch(() => {});

  const text = wt.owner.commissionReady({
    rep: rep.user?.name || rep.code,
    available: c.available,
    earned: c.earned,
    penalties: c.penalties,
    minimum: threshold,
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
    const text = wt.owner.outOfStock({
      product: product.name,
      brand: product.brand?.name,
      lastSale: lastSale?.sale?.soldAt,
      suggested: recommended,
    });
    return queue('OUT_OF_STOCK', { dedupeKey: `outofstock:${productId}:${dateEAT()}`, refType: 'Product', refId: productId, text });
  }

  const text = wt.owner.lowStock({
    product: product.name,
    remaining: onHand,
    level: product.minStockLevel,
    suggested: recommended,
    high: onHand <= product.minStockLevel / 2,
  });
  return queue('LOW_STOCK', { dedupeKey: `lowstock:${productId}:${dateEAT()}`, refType: 'Product', refId: productId, text });
}

// Cron sweep: catch anything the movement hooks missed.
// A rep bought themselves 96 more hours. The owner does not decide it and
// cannot undo it, so the only thing the app owes him is to say it happened.
async function extensionTaken(settlement, { newDeadline, rate }) {
  const text = wt.owner.extensionGranted({
    rep: settlement.salesRep?.user?.name || settlement.salesRep?.code || 'A rep',
    hours: 96,
    deadline: newDeadline,
    rate,
  });
  return queue('EXTENSION_TAKEN', {
    // The extension can be cancelled and taken again, so the key carries the
    // moment it was taken — otherwise the second one never reaches the owner.
    dedupeKey: `extension:${settlement.id}:${settlement.selfExtendedAt ? new Date(settlement.selfExtendedAt).getTime() : 'x'}`,
    refType: 'Settlement',
    refId: settlement.id,
    text,
  });
}

// ── Orders about to start costing the rep money ─────────────────────────────
// The first fine lands the MOMENT the deadline passes — there is no grace — so
// a warning is only useful before it, not after. Anything already overdue is
// past helping and is left alone.
//
// An order with a return awaiting a decision is skipped, because penalty.service
// skips it too: while a return is pending the clock is paused and no fine is
// charged. Warning about a fine that will not be charged is worse than silence.
//
// Deduplicated on the order AND its deadline, so a deadline is warned about once
// however often the sweep runs — and an order given more time is warned again
// before its new deadline (it was warned once per order, ever: audit #45).
const DEADLINE_WARN_MINUTES = 10;

async function deadlineWarnings(withinMinutes = DEADLINE_WARN_MINUTES) {
  const notification = require('./notification.service');
  const penalty = require('./penalty.service');
  const now = new Date();
  const edge = new Date(now.getTime() + withinMinutes * 60_000);

  const due = await prisma.settlement.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIAL'] },
      deadlineAt: { gt: now, lte: edge },
    },
    include: { salesRep: { include: { user: { select: { id: true, name: true } } } } },
  });

  let queued = 0;
  for (const s of due) {
    const paused = await prisma.return.count({ where: { settlementId: s.id, status: 'PENDING' } });
    if (paused > 0) continue;

    const mins = Math.max(0, Math.round((new Date(s.deadlineAt).getTime() - now.getTime()) / 60_000));
    const rate = penalty.dailyRateFor(s);
    const who = `${s.salesRep?.user?.name || 'A rep'} (${s.salesRep?.code || '—'})`;
    const outstanding = round2(toNumber(s.assignedValue) - toNumber(s.settledValue) - toNumber(s.returnedValue));

    notification.createIfAbsent({
      type: 'GENERAL',
      severity: 'WARNING',
      title: 'A fine is about to start',
      message: `${who} has ${mins} minute${mins === 1 ? '' : 's'} left on order ${s.settlementNumber}. When the deadline passes it starts charging ${fmt(rate)} a day.`,
      entityType: 'Settlement',
      entityId: `deadlinewarn-${s.id}`,
    }).catch(() => {});

    const text = wt.owner.settlementDeadline({
      order: s.settlementNumber,
      rep: s.salesRep?.user?.name || s.salesRep?.code || 'A rep',
      minutes: mins,
      outstanding,
      rate,
    });
    const r = await queue('DEADLINE_IMMINENT', {
      dedupeKey: `deadlinewarn:${s.id}:${new Date(s.deadlineAt).getTime()}`,
      refType: 'Settlement',
      refId: s.id,
      text,
    }).catch(() => ({ queued: false }));
    if (r.queued) queued += 1;
  }
  return { candidates: due.length, queued };
}

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

// 15. Daily business report — the 21:00 (Tanzania time) evening report: a short
// WhatsApp summary with the link to the full PDF (built and archived by
// dailyBusinessReport.service). The cheap checks come first so the catch-up
// poll below never builds a PDF for a report that was already sent, switched
// off, or has nowhere to go.
async function dailySummary({ force = false } = {}) {
  if (!force) {
    // Before 21:00 the day is not over: a run then sent and archived a part-day report under the day's
    // key, so the real 21:00 report and the next morning's catch-up both skipped it as already sent
    // (final audit, 12 Nov 2026). The weekly, monthly and yearly reports refuse the same way. A forced
    // send (?force=1) is still a manual look at the day so far, under its own key.
    if (nowEAT().hour() < 21) throw ApiError.badRequest('Today is not over yet: the daily report goes out at 21:00 (Tanzania time)');
    if (!(await isEnabled('DAILY_SUMMARY'))) return { queued: false, reason: 'disabled' };
    if (!(await getConfig()).configured) return { queued: false, reason: 'not-configured' };
    const sent = await prisma.whatsAppNotification.findFirst({ where: { dedupeKey: `daily:${dateEAT()}` }, select: { id: true } });
    if (sent) return { queued: false, reason: 'duplicate' };
  }
  return require('./dailyBusinessReport.service').sendDailyReport({ force, queue });
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

// ── Reports that were missed ─────────────────────────────────────────────────
// A scheduled report whose run failed (the database out of reach for a moment)
// or never ran (a skipped cron) used to be lost for good: the next run builds
// the NEXT period. The morning sweep calls this. For each kind it takes the
// latest period whose send time has passed and, if that period's dedupe key is
// missing, sends it late. A report that went out (or is waiting in the queue)
// has its key, so nothing is ever sent twice; and only one period per kind is
// looked at, so a long outage never ends in a flood of old reports. Reports
// that are switched off, or WhatsApp not set up, are left alone (otherwise the
// same report would be rebuilt every morning).
async function catchUpReports(now = nowEAT()) {
  if (!(await getConfig()).configured) return { skipped: 'not-configured' };
  const isMissing = async (type, dedupeKey) => (await isEnabled(type))
    && !(await prisma.whatsAppNotification.findFirst({ where: { dedupeKey }, select: { id: true } }));

  const out = {};
  const attempt = async (kind, name, key, dedupeKey, type, send) => {
    try {
      out[kind] = (await isMissing(type, dedupeKey)) ? { key, ...(await send()) } : { key, missing: false };
    } catch (err) {
      out[kind] = { key, error: String(err.message).slice(0, 200) };
      require('./notification.service').notifyAdmins({
        type: 'GENERAL',
        severity: 'CRITICAL',
        title: `${name} failed to generate`,
        message: `${name} for ${key} was missed and could not be sent late either: ${String(err.message).slice(0, 200)}. The next morning check tries again.`,
        entityType: 'Report',
        entityId: name,
      }).catch(() => {});
    }
  };

  // Daily: yesterday's, due at 21:00 yesterday. It is built now, so the message says it is late.
  const day = now.subtract(1, 'day').format('YYYY-MM-DD');
  await attempt('daily', 'Daily report', day, `daily:${day}`, 'DAILY_SUMMARY', () =>
    require('./dailyBusinessReport.service').sendDailyReport({ dateKey: day, queue, late: true }));

  // Weekly: due on Tuesday 08:00 for the Monday–Sunday week before it.
  const weekly = require('./weeklyReport.service');
  const monday = now.startOf('isoWeek');
  const weekDue = monday.add(weekly.REPORT_WEEKDAY - 1, 'day').hour(8);
  const weekKey = weekly.weekKeyOf(now.isBefore(weekDue) ? monday.subtract(14, 'day') : monday.subtract(7, 'day'));
  await attempt('weekly', 'Weekly report', weekKey, `weekly:${weekKey}`, 'WEEKLY_REPORT', () => weekly.sendWeeklyReport({ weekKey }));

  // Monthly: due on the 1st at 08:00 for the month before it.
  const first = now.startOf('month');
  const monthKey = (now.isBefore(first.hour(8)) ? first.subtract(2, 'month') : first.subtract(1, 'month')).format('YYYY-MM');
  await attempt('monthly', 'Monthly report', monthKey, `monthly:${monthKey}`, 'MONTHLY_REPORT', () =>
    require('./monthlyReport.service').sendMonthlyReport({ monthKey }));

  // Yearly: due on 1 January at 08:00 for the year before it. Only looked for in January, so the rest of the
  // year this check costs nothing; a January run that failed is sent late on any later January morning.
  if (now.month() === 0 && !now.isBefore(now.startOf('year').hour(8))) {
    const yearKey = now.subtract(1, 'year').format('YYYY');
    await attempt('yearly', 'Yearly report', yearKey, `yearly:${yearKey}`, 'YEARLY_REPORT', () =>
      require('./yearlyReport.service').sendYearlyReport({ yearKey }));
  }

  return out;
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
async function notifyRep(salesRepId, { title, message, severity = 'INFO', dedupeKey = null, whatsapp = null }) {
  const creds = await repCreds(salesRepId);
  if (!creds) return { queued: false, reason: 'no-whatsapp' };
  // `whatsapp` is the structured version of the event (see whatsappText.js). Without one, the
  // in-app title and message go out in the same shape, never raw.
  const text = wt.repText(whatsapp, { title, message });
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
      whatsapp: data.whatsapp || null,
      // Dedupe so a RETRIED notify never double-texts — but only a retry. The key used to be rep +
      // entity + title alone, so a second, real message under the same title about the same order
      // (tomorrow's late fine, a new amount) was silently dropped (audit #45, 11 Nov 2026). The Tanzania
      // day and a fingerprint of the words were added, but a second real event in the SAME words on the
      // same order the same day (two rejections with the same reason) was still dropped while its bell
      // notice arrived. So a copy of an in-app notice is now keyed on that notice: one notice is one
      // event, one WhatsApp. Without a notice (createIfAbsent, which has its own guard) the day-and-words
      // key stands, and dedupeSalt still lets a caller send the same words twice on purpose.
      dedupeKey: data.notificationId
        ? `rep:${rep.id}:notice:${data.notificationId}`
        : data.entityId
        ? `rep:${rep.id}:${data.entityType || 'x'}:${data.entityId}:${data.title}:${dateEAT()}:${require('crypto').createHash('sha1').update(String(data.message || '')).digest('hex').slice(0, 12)}${data.dedupeSalt ? `:${data.dedupeSalt}` : ''}`
        : null,
    });
  } catch {
    return { queued: false };
  }
}

// Test message to a specific rep's number (admin "Send test" on the profile).
async function testRep(salesRepId) {
  const creds = await repCreds(salesRepId);
  if (!creds) return { sent: false, reason: 'no-whatsapp' };
  const text = wt.repText({ kind: 'TEST' });
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
// Only rows flush() can still send are put back: it skips anything older than
// FLUSH_WINDOW_HOURS, so an older row would sit PENDING and never go out.
async function retryFailed({ hours = FLUSH_WINDOW_HOURS } = {}) {
  const h = Math.min(Number(hours) || FLUSH_WINDOW_HOURS, FLUSH_WINDOW_HOURS);
  const since = new Date(Date.now() - h * 3600 * 1000);
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

// `failedOnly`: the newest FAILED rows, whatever came after them. The Settings
// "Retry failed" button needs to know about a failure even when a busy day has
// pushed it off the short list of recent messages.
async function history(limit = 30, { failedOnly = false } = {}) {
  return prisma.whatsAppNotification.findMany({
    ...(failedOnly ? { where: { status: 'FAILED' } } : {}),
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 30, 100),
  });
}

// A sample of a real alert, so a new one can be seen before it has to fire for
// real. `kind` picks which; anything else is the plain connectivity check.
// Sent with a fresh dedupe key every time, or the second press would be
// swallowed as a duplicate and look like a failure.
const SAMPLES = {
  deadline: () => wt.owner.settlementDeadline({ order: 'STL-20261110-0001', rep: 'Paul', minutes: 8, outstanding: 30000, rate: 10000 }),
  extension: () => wt.owner.extensionGranted({ rep: 'Paul', hours: 96, deadline: new Date(Date.now() + 96 * 3600_000), rate: 20000 }),
};

async function test(kind) {
  const sample = SAMPLES[kind];
  const text = sample ? sample() : wt.owner.test();
  return queue('TEST', { text, dedupeKey: `test:${kind || 'plain'}:${Date.now()}` });
}

module.exports = {
  retryFailed,
  deadlineWarnings,
  extensionTaken,
  DEADLINE_WARN_MINUTES,
  providerBudgetCap,
  TYPES,
  background,
  sendRaw,
  queue,
  flush,
  stockRequestSubmitted,
  settlementSubmitted,
  settlementSubmittedBatch,
  returnSubmitted,
  commissionReadyCheck,
  stockAlertForProduct,
  scanStockAlerts,
  dailySummary,
  dailySummaryCatchup,
  catchUpReports,
  notifyRep,
  mirrorToRep,
  testRep,
  history,
  test,
};
