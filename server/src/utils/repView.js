'use strict';

// What a sales rep must not see in a shared record: ZELab's own costs and margins (Rule: stock levels and
// purchase costs stay with the owner). Removes these keys at any depth of plain objects and arrays; Prisma
// Decimals, Dates and other class instances are left untouched.
const COST_KEYS = new Set([
  'unitCost', 'costTotal', 'purchasePrice', 'costPrice', 'profit', 'grossProfit', 'stockValue', 'margin',
  // Added 11 Nov 2026 (GET /sales summaries carried these): the cost of goods and the margins by any name.
  'cost', 'landedUnitCost', 'cogs', 'costOfSold', 'inventoryValue', 'grossMargin', 'netProfit',
]);

function stripCosts(value) {
  if (Array.isArray(value)) return value.map(stripCosts);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (COST_KEYS.has(k)) continue;
      out[k] = stripCosts(v);
    }
    return out;
  }
  return value;
}

const forRole = (req, data) => (req.user && req.user.role === 'SALES_REP' ? stripCosts(data) : data);

module.exports = { stripCosts, forRole, COST_KEYS };
