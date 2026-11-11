// ============================================================================
// CANONICAL PRODUCT ORDER
//
// One curated, fixed order for products in EVERY selection list — rep ordering,
// admin Add-stock, sales, transfers, adjustments, inventory. No value-based or
// alphabetical reordering: the position of a product never changes, only
// whether it's shown (stock filtering is handled by each list separately).
//
// Matching is by product NAME, normalized so dash / whitespace / case variants
// don't matter — and the old long names ("OHIS Pepa Ndogo …", "(Mix Colors)") match the
// short ones Nino chose on 11 Nov 2026 ("OHIS Ndogo …", "(Mix)"), so the order holds before
// and after the rename. Anything not in the list sorts last (alphabetically), so adding
// a new product never breaks the UI — it just appends until it's listed here.
// OHIS group first (the main brand), then Civlily, as specified by The Doctor.
// ============================================================================

const CANONICAL = [
  // ── OHIS (main brand — shown first) ──
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

// Normalize a name so en/em dashes, double spaces and case don't affect matching.
function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\bpepa\s+/g, '') // the old long names had "Pepa" in them
    .replace(/\(mix colou?rs\)/g, '(mix)')
    .replace(/[‒–—―]/g, '-') // figure/en/em/horizontal dash → hyphen
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const RANK = new Map(CANONICAL.map((n, i) => [normalizeName(n), i]));

// Position of a product in the fixed order (unknown → last).
export function productRank(name) {
  const r = RANK.get(normalizeName(name));
  return r === undefined ? Number.MAX_SAFE_INTEGER : r;
}

// Return a new array sorted into the canonical order. `getName` extracts the
// product name from each item (defaults to `item.name`).
export function sortByCanonical(list = [], getName = (p) => p?.name) {
  return [...list].sort((a, b) => {
    const ra = productRank(getName(a));
    const rb = productRank(getName(b));
    if (ra !== rb) return ra - rb;
    return (getName(a) || '').localeCompare(getName(b) || '');
  });
}
