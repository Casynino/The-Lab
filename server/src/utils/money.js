'use strict';

const env = require('../config/env');
const { Prisma } = require('@prisma/client');

// Coerce a value that may be a Prisma.Decimal, string, or number into a JS
// number. Prisma returns Decimal instances for @db.Decimal columns.
function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

// Round to 2 decimal places, avoiding binary float drift (e.g. 1.005).
function round2(value) {
  const n = toNumber(value);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Build a Prisma.Decimal from any numeric-ish input, rounded to 2dp.
function toDecimal(value) {
  return new Prisma.Decimal(round2(value).toFixed(2));
}

function sum(values) {
  return round2(values.reduce((acc, v) => acc + toNumber(v), 0));
}

// Format for reports/exports using the configured locale & currency.
function formatCurrency(value) {
  try {
    return new Intl.NumberFormat(env.business.locale, {
      style: 'currency',
      currency: env.business.currency,
      maximumFractionDigits: 0,
    }).format(toNumber(value));
  } catch {
    return `${env.business.currency} ${round2(value).toLocaleString()}`;
  }
}

// The largest amount a money column (Decimal(14,2)) can hold. A bigger one reached Prisma and came back
// as a 500 with the database's error text (audit backend-integrity-4); it is refused as a 400 instead.
const DB_MAX_AMOUNT = 999_999_999_999.99;
// A hand-made commission deduction or correction above this is a typo (extra zeros), not a real figure:
// every commission ever earned is a few million shillings. Change here if the business ever needs more.
const MAX_COMMISSION_CHANGE = 100_000_000;

module.exports = { toNumber, round2, toDecimal, sum, formatCurrency, DB_MAX_AMOUNT, MAX_COMMISSION_CHANGE };
