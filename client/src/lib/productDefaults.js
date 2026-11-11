/*
  WHAT A NEW PRODUCT GETS WITHOUT BEING ASKED.

  Adding a product is four things: its name, its brand, what a box costs us and
  what it sells for (Nino, 11 Nov 2026: "don't make it complicated that we have
  to add SKU or barcode ... the other things should be automatic"). The rest is
  copied from the product most like the new one: a new Civlily Kubwa gets the
  base unit, Box / Carton levels, minimum stock and reorder quantity of the other
  Civlily Kubwa products.

  The SKU is NOT made here. The server makes one when the box is left blank and
  checks that no product has it (products.service.js generateSku: the first three
  letters of the name, then six random characters), so the window only says
  "SKU automatic" and shows the one the server gave once it is saved.
*/
import { productRank } from './productOrder.js';

const SIZE_WORDS = ['ndogo', 'kubwa'];

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// "Ndogo" or "Kubwa" when the name says which, else null.
export function sizeWord(name) {
  const w = words(name);
  return SIZE_WORDS.find((s) => w.includes(s)) || null;
}

// The brand a name spells out ("OHIS Ndogo ..." -> OHIS). Null when it names none, or more than one.
export function brandInName(name, brands = []) {
  const have = new Set(words(name));
  const hits = brands.filter((b) => {
    const w = words(b?.name);
    return w.length > 0 && w.every((x) => have.has(x));
  });
  return hits.length === 1 ? hits[0].id : null;
}

const activeLevels = (p) => {
  const all = p?.packagings || [];
  const live = all.filter((pk) => pk.isActive !== false);
  return live.some((pk) => pk.isBaseUnit) ? live : all;
};

// Two products with the same key are set up the same way.
export function setupKey(p) {
  const levels = activeLevels(p)
    .map((pk) => `${pk.packagingUnitId}:${pk.baseQuantity}:${pk.isBaseUnit ? 1 : 0}`)
    .sort()
    .join('|');
  return [p?.baseUnitName || '', levels, p?.minStockLevel ?? 0, p?.reorderQuantity ?? 0].join('#');
}

/*
  The product a new one should copy. In order of weight: the same brand, the
  same size word (Ndogo / Kubwa), the setup most products share (so a one-off
  product with a minimum of 0 is not copied when its siblings have 50), then
  the most words in common, then the fixed product order. With nothing typed
  and no brand picked this is the most common setup.
*/
export function closestProduct(products = [], { brandId, name } = {}) {
  const list = products.filter((p) => p && p.isActive !== false && activeLevels(p).some((pk) => pk.isBaseUnit));
  if (!list.length) return null;
  const counts = new Map();
  list.forEach((p) => counts.set(setupKey(p), (counts.get(setupKey(p)) || 0) + 1));
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const size = sizeWord(name);
  const mine = new Set(words(name).filter((w) => !SIZE_WORDS.includes(w)));
  const score = (p) => {
    let s = 0;
    if (brandId && p.brandId === brandId) s += 10000;
    if (size && sizeWord(p.name) === size) s += 1000;
    if (setupKey(p) === common) s += 100;
    new Set(words(p.name)).forEach((w) => { if (mine.has(w)) s += 1; });
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a)
    || productRank(a.name) - productRank(b.name)
    || String(a.name).localeCompare(String(b.name)))[0];
}

/*
  What is copied from that product. The packaging levels' own prices are NOT
  copied: a blank level price means "the selling price times the level", which
  follows the new product's own price, where a copied Carton price would carry
  the other product's price.
*/
export function setupFrom(p) {
  return {
    baseUnitName: p?.baseUnitName || 'Pack',
    minStockLevel: p?.minStockLevel ?? 0,
    reorderQuantity: p?.reorderQuantity ?? 0,
    rows: [...activeLevels(p)]
      .sort((a, b) => a.baseQuantity - b.baseQuantity)
      .map((pk) => ({ packagingUnitId: pk.packagingUnitId, baseQuantity: pk.baseQuantity, unitPrice: '', isBaseUnit: !!pk.isBaseUnit })),
  };
}

// Another product (not `exceptId`) already called this, ignoring case, dashes and brackets. The product
// window refuses a new twin; the server itself still allows two products with one name.
export function sameNameAs(products = [], name, exceptId) {
  const want = words(name).join(' ');
  if (!want) return null;
  return products.find((p) => p.id !== exceptId && words(p.name).join(' ') === want) || null;
}

// The category most products are in (there is one today), else the first.
export function usualCategory(products = [], categories = []) {
  const known = new Set(categories.map((c) => c.id));
  const counts = new Map();
  products.forEach((p) => { if (known.has(p.categoryId)) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1); });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : categories[0]?.id || '';
}

// What a name says about a product's kind: the size (Ndogo / Kubwa) and the filter (Na / Bila Filter).
// Two products of one brand that differ in either usually sell at different prices.
export function filterWord(name) {
  const w = words(name);
  if (w.includes('bila')) return 'bila';
  return w.includes('na') && w.includes('filter') ? 'na' : null;
}
// True only when both names say their size or filter and one of them differs.
export function otherKind(a, b) {
  const differ = (x, y) => x != null && y != null && x !== y;
  return differ(sizeWord(a), sizeWord(b)) || differ(filterWord(a), filterWord(b));
}

// "box" -> "boxes", "pack" -> "packs".
export const unitPlural = (unit) => {
  const u = String(unit || '').trim().toLowerCase() || 'unit';
  if (/[^aeiou]y$/.test(u)) return `${u.slice(0, -1)}ies`;
  return /(s|x|z|ch|sh)$/.test(u) ? `${u}es` : `${u}s`;
};

// "Carton = 50 boxes · low-stock alert at 50 · reorder 50 boxes" for the line under the prices.
export function setupParts({ rows = [], units = [], baseUnitName, minStockLevel, reorderQuantity }) {
  const unitName = (id) => units.find((u) => u.id === id)?.name || 'Level';
  const base = rows.find((r) => r.isBaseUnit);
  const baseName = String(baseUnitName || '').trim() || (base ? unitName(base.packagingUnitId) : 'Pack');
  const many = unitPlural(baseName);
  const parts = rows.filter((r) => !r.isBaseUnit)
    .sort((a, b) => Number(a.baseQuantity) - Number(b.baseQuantity))
    .map((r) => `${unitName(r.packagingUnitId)} = ${r.baseQuantity === '' || r.baseQuantity == null ? '?' : r.baseQuantity} ${many}`);
  if (!parts.length) parts.push(`Sold by the ${baseName.toLowerCase()}`);
  parts.push(`low-stock alert at ${Number(minStockLevel) || 0}`);
  parts.push(`reorder ${Number(reorderQuantity) || 0} ${many}`);
  return parts;
}
