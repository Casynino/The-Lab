// ============================================================================
// PICKING PRODUCTS FOR THE STOCK WINDOWS — the plain rules behind ProductPicker.
//
// Receive stock, Adjust, Record damage, Transfers, New PO and the Finance
// purchase all list every product the same way Record a sale does: the fixed
// order, grouped by brand, each in its box (the base packaging — exactly the
// unit each window chose before), with a  −  qty  +. These are the parts that
// decide a figure, kept apart from the screen so they can be tested.
// ============================================================================

// "Dar es Salaam" in a warehouse's region or name.
export const DSM = /dar\s*es\s*salaam|\bdsm\b/i;

// The warehouse a window starts on (the same rule as Record a sale): the one this
// device last used, if it is still active; else the Dar es Salaam one (the primary
// first); else the primary; else the first active. Its name is always on screen.
export function homeWarehouse(list, lastId) {
  const active = (list || []).filter((w) => w && w.isActive !== false);
  if (!active.length) return null;
  const last = lastId && active.find((w) => w.id === lastId);
  if (last) return last;
  const dsm = active.filter((w) => DSM.test(`${w.region || ''} ${w.name || ''}`));
  if (dsm.length) return dsm.find((w) => w.isPrimary) || dsm[0];
  return active.find((w) => w.isPrimary) || active[0];
}

// The warehouse the server falls back to when a purchase order names none:
// the primary one, else the first active.
export function primaryWarehouse(list) {
  const active = (list || []).filter((w) => w && w.isActive !== false);
  return active.find((w) => w.isPrimary) || active[0] || null;
}

// The packaging every stock window used by default: the base unit (a box), else the first listed.
export function boxPackaging(product) {
  return product?.packagings?.find((pk) => pk.isBaseUnit) || product?.packagings?.[0] || null;
}

// "OHIS Ndogo (White) – Bila Filter" under the OHIS heading reads "Ndogo (White) – Bila Filter".
export function shortName(name, brand) {
  if (!brand) return name;
  const lower = (name || '').toLowerCase();
  const b = brand.toLowerCase();
  return lower.startsWith(`${b} `) ? name.slice(brand.length + 1) : name;
}

// "ndogo brown" finds "OHIS Ndogo (Brown) – Bila Filter": brackets and dashes ignored.
export const plain = (s) => (s || '').toLowerCase().replace(/[()[\]{}–—\-_,./]+/g, ' ').replace(/\s+/g, ' ').trim();

// Every word typed must be somewhere in the text.
export function matches(text, needle) {
  const words = plain(needle).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = plain(text);
  return words.every((w) => hay.includes(w));
}

// "Main Warehouse (Home)" → "Main Warehouse": short enough for a button.
export function shortPlace(name) {
  const s = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return s || String(name || '');
}

// The name on a main button, short enough for one line on a phone:
// "Main Warehouse (Home)" → "Main", "REVA Test Warehouse" → "REVA Test". A name that is only "Warehouse" stays.
export function buttonPlace(name) {
  const s = shortPlace(name);
  return s.replace(/\s+warehouse$/i, '').trim() || s;
}

export const boxWord = (n) => (Number(n) === 1 ? 'box' : 'boxes');

// One row per product with a packaging, in the order given (useProducts already
// sorts into the fixed order). `brandId` keeps only one brand's products.
export function pickerRows(products, { brandId } = {}) {
  return (products || [])
    .filter((p) => p && (!brandId || p.brandId === brandId))
    .map((p) => {
      const pk = boxPackaging(p);
      if (!pk) return null;
      return {
        key: p.id,
        id: p.id,
        name: p.name,
        brand: p.brand?.name || 'Other',
        short: shortName(p.name, p.brand?.name),
        packagingUnitId: pk.packagingUnitId,
        size: Number(pk.baseQuantity) || 1,
        unitName: null, // null = the box; anything else is named on the row
        buyingPrice: Number(p.purchasePrice) || 0,
      };
    })
    .filter(Boolean);
}

// An order being edited keeps every line exactly as it was saved. A line in the
// product's box takes that product's row; a line in another unit (cartons), a
// second line of the same product, or a product that is switched off gets a row
// of its own — its unit is named on it and is sent back unchanged, never turned
// into boxes.
export function rowsWithSaved(rows, savedItems, products = []) {
  const out = rows.slice();
  const qty = {};
  const cost = {};
  (savedItems || []).forEach((it) => {
    const base = out.find((r) => r.key === it.productId && !r.unitName);
    let key;
    if (base && base.packagingUnitId === it.packagingUnitId && qty[base.key] == null) {
      key = base.key;
    } else {
      key = `${it.productId}:${it.packagingUnitId}`;
      let n = 1;
      while (out.some((r) => r.key === key)) key = `${it.productId}:${it.packagingUnitId}:${n++}`;
      const product = products.find((p) => p.id === it.productId);
      const pk = product?.packagings?.find((k) => k.packagingUnitId === it.packagingUnitId);
      const brand = product?.brand?.name || base?.brand || 'Other';
      const name = product?.name || it.product?.name || 'Product';
      const size = Number(pk?.baseQuantity) || (it.quantity ? Number(it.baseQuantity) / Number(it.quantity) : 0) || 1;
      const unit = pk?.packagingUnit?.name || it.packagingUnit?.name || 'unit';
      let at = -1;
      out.forEach((r, i) => { if (r.brand === brand) at = i; });
      const row = {
        key, id: it.productId, name, brand, short: shortName(name, brand), packagingUnitId: it.packagingUnitId,
        size, unitName: size === 1 && /^box$/i.test(unit) ? null : unit, buyingPrice: Number(product?.purchasePrice) || 0,
      };
      if (at >= 0) out.splice(at + 1, 0, row); else out.push(row);
    }
    qty[key] = Number(it.quantity) || 0;
    cost[key] = it.unitCost == null ? '' : String(Number(it.unitCost) || 0);
  });
  return { rows: out, qty, cost };
}

// The picked lines, in the list's order, as every stock request carries them.
export function pickedItems(rows, qty) {
  return (rows || [])
    .filter((r) => Number(qty?.[r.key]) > 0)
    .map((r) => ({ productId: r.id, packagingUnitId: r.packagingUnitId, quantity: Number(qty[r.key]) }));
}

// Boxes picked (a carton line counts its boxes).
export function pickedBoxes(rows, qty) {
  return (rows || []).reduce((s, r) => s + (Number(qty?.[r.key]) || 0) * (r.size || 1), 0);
}

// What one location holds of each product, in base units, from /inventory/balances.
export function stockByProduct(balanceRows, loc) {
  const m = new Map();
  if (!loc?.type || !loc?.id) return m;
  (balanceRows || []).forEach((r) => {
    const base = (r.locations || [])
      .filter((l) => l.type === loc.type && l.id === loc.id)
      .reduce((s, l) => s + (Number(l.baseQuantity) || 0), 0);
    m.set(r.productId, base);
  });
  return m;
}

// Whole boxes only, never below zero, never above the cap (when there is one).
export function clampQty(n, max = Infinity) {
  const want = Math.max(0, Math.trunc(Number(n) || 0));
  return Math.min(max, want);
}

// One-tap reasons. The text box still holds what goes to the server.
export const REASONS = ['Damaged in transit', 'Wet', 'Torn', 'Counted wrong', 'Other'];
// Each window offers only the reasons that fit it: damage is never "counted wrong", and adding boxes is never "wet".
export const DAMAGE_REASONS = ['Damaged in transit', 'Wet', 'Torn', 'Other'];
export const ADJUST_REASONS = ['Counted wrong', 'Other'];
const SEP = ' — ';

// The reason chip a text starts with ("Wet — two boxes at the bottom" → "Wet").
export function reasonChip(text, chips = REASONS) {
  const t = String(text || '').trim();
  if (!t) return null;
  const hit = chips.find((c) => c !== 'Other' && (t === c || t.startsWith(c + SEP)));
  return hit || 'Other';
}

// Tapping a chip puts its words first and keeps whatever detail was typed after them.
// "Other" (chip = null) leaves only the detail, for the person to type.
export function withReason(text, chip, chips = REASONS) {
  let rest = String(text || '');
  const head = chips.find((c) => c !== 'Other' && (rest.trim() === c || rest.startsWith(c + SEP)));
  if (head) rest = rest.trim() === head ? '' : rest.slice(head.length + SEP.length);
  rest = rest.trim();
  if (!chip || chip === 'Other') return rest;
  return rest ? `${chip}${SEP}${rest}` : chip;
}

// The cost per box a purchase line carries: what was typed, else the product's buying price
// (as the old forms filled it in), else nothing (sent as 0, as before).
export function lineCost(cost, row) {
  if (cost && cost[row.key] != null) return cost[row.key];
  return row.buyingPrice ? String(row.buyingPrice) : '';
}
