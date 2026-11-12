'use strict';

// The fixed product order, the same as the client's src/lib/productOrder.js (keep the two lists in step).
// OHIS first (the main brand), then Civlily; within a brand the curated order, never alphabetical.
// Matching is by name, normalised so dash / space / case variants and the old long names
// ("OHIS Pepa Ndogo …", "(Mix Colors)") match today's short ones. A product not in the list sorts after
// the listed ones, alphabetically.

const CANONICAL = [
  // ── OHIS ──
  'OHIS Ndogo (Brown) - Bila Filter',
  'OHIS Ndogo (White) - Bila Filter',
  'OHIS Ndogo (Brown) - Na Filter',
  'OHIS Kubwa (Brown) - Na Filter',
  'OHIS Kubwa (Brown) - Bila Filter',
  // ── Civlily ──
  'Civlily Ndogo (Brown) - Bila Filter',
  'Civlily Ndogo (White) - Bila Filter',
  'Civlily Ndogo (Brown) - Na Filter',
  'Civlily Kubwa (Brown) - Bila Filter',
  'Civlily Kubwa (White) - Bila Filter',
  'Civlily Kubwa (Brown) - Na Filter',
  'Civlily Kubwa (Mix) - Na Filter',
  'Civlily Ndogo (Mix) - Bila Filter',
];

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bpepa\s+/g, '')
    .replace(/\(mix colou?rs\)/g, '(mix)')
    .replace(/[‒–—―]/g, '-')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const RANK = new Map(CANONICAL.map((n, i) => [normalizeName(n), i]));

function productRank(name) {
  const r = RANK.get(normalizeName(name));
  return r === undefined ? Number.MAX_SAFE_INTEGER : r;
}

function compareProducts(a, b) {
  const ra = productRank(a);
  const rb = productRank(b);
  if (ra !== rb) return ra - rb;
  return String(a || '').localeCompare(String(b || ''));
}

// Brands in the owner's order: OHIS, then Civlily, then any other brand alphabetically, no brand last.
const BRAND_RANK = { ohis: 0, civlily: 1 };
function compareBrands(a, b) {
  const ka = String(a || '').trim().toLowerCase();
  const kb = String(b || '').trim().toLowerCase();
  const ra = BRAND_RANK[ka] ?? (ka ? 2 : 3);
  const rb = BRAND_RANK[kb] ?? (kb ? 2 : 3);
  if (ra !== rb) return ra - rb;
  return ka.localeCompare(kb);
}

module.exports = { CANONICAL, normalizeName, productRank, compareProducts, compareBrands };
