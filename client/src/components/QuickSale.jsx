import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ChevronDown, Minus, Plus, Search, UserRound, Warehouse } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts, useCustomers, useWarehouses } from '@/lib/hooks';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Modal, Button, Select, NumberInput, Field } from '@/components/ui';

// ============================================================================
// RECORD A SALE — THE QUICK WAY (staff only; reps never record sales).
//
// Nino, 11 Nov 2026: recording a sale was "complicated and hard". Almost every
// sale is a walk-in customer served from the Dar es Salaam warehouse, so both
// are already chosen and shown as one quiet line, and every product is on the
// screen with its box price and a  −  qty  +  — no "Add item", no product or
// packaging select. Discount and part payment are rare, so they sit behind one
// small toggle. Where the money goes is named in the footer, next to the total.
//
// The request is the one the old window sent, field for field: type CASH,
// customerId | null, items [{ productId, packagingUnitId, quantity, unitPrice }],
// discount, amountPaid (= the total when untouched), warehouseId, and accountId
// only when somebody picked an account. Prices come from the product exactly as
// ItemLines took them (the base packaging — a box — at its own price, or the
// product's selling price × its size); the server prices and checks it again.
// A product with no price cannot be added: a TSh 0 sale would still take boxes
// out of stock with nothing in any account.
// ============================================================================

const LAST_WAREHOUSE_KEY = 'zl.quickSale.warehouse';
const readLastWarehouse = () => { try { return localStorage.getItem(LAST_WAREHOUSE_KEY) || ''; } catch { return ''; } };
const saveLastWarehouse = (id) => { try { localStorage.setItem(LAST_WAREHOUSE_KEY, id); } catch { /* private window */ } };

const DSM = /dar\s*es\s*salaam|\bdsm\b/i;
// The warehouse a sale leaves from unless somebody changes it: the one this
// device last sold from (a convenience only — flagged on screen when it is not
// the usual one), else the Dar es Salaam warehouse (by its region, or its name),
// else the primary one, else the first active one. Whichever it is, its name is
// on the screen — never a silent guess.
function homeWarehouse(list, lastId) {
  const active = (list || []).filter((w) => w && w.isActive !== false);
  if (!active.length) return null;
  const last = lastId && active.find((w) => w.id === lastId);
  if (last) return last;
  const dsm = active.filter((w) => DSM.test(`${w.region || ''} ${w.name || ''}`));
  if (dsm.length) return dsm.find((w) => w.isPrimary) || dsm[0];
  return active.find((w) => w.isPrimary) || active[0];
}

// Same choice and price as ItemLines: the base packaging (a box), else the first.
function boxPackaging(product) {
  return product?.packagings?.find((pk) => pk.isBaseUnit) || product?.packagings?.[0] || null;
}
function boxPrice(product, pk) {
  if (!product || !pk) return 0;
  if (pk.unitPrice != null) return Number(pk.unitPrice);
  return Number(product.sellingPrice) * pk.baseQuantity;
}
// "OHIS Ndogo (White) – Bila Filter" under the OHIS heading reads "Ndogo (White) – Bila Filter".
function shortName(name, brand) {
  if (!brand) return name;
  const lower = (name || '').toLowerCase();
  const b = brand.toLowerCase();
  return lower.startsWith(`${b} `) ? name.slice(brand.length + 1) : name;
}
// "ndogo brown" finds "OHIS Ndogo (Brown) – Bila Filter": every word must be in the name, brackets and dashes ignored.
const plain = (s) => (s || '').toLowerCase().replace(/[()[\]{}–—\-_,./]+/g, ' ').replace(/\s+/g, ' ').trim();

const stepBtn =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground ring-1 ring-white/[0.12] ' +
  'transition hover:bg-white/[0.1] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ' +
  'disabled:pointer-events-none disabled:opacity-30 sm:h-9 sm:w-9';

const changeBtn =
  'shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:bg-white/[0.05] ' +
  'hover:text-foreground hover:underline max-sm:min-h-[44px]';

export default function QuickSale({ onClose }) {
  const qc = useQueryClient();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const { data: customers = [] } = useCustomers();
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();

  const type = 'CASH'; // cash-only business — no credit sales
  const [customerId, setCustomerId] = useState('');
  const [pickedWarehouse, setPickedWarehouse] = useState(''); // '' = the home warehouse
  const [editBoth, setEditBoth] = useState(false); // one Change opens both selects
  const [qty, setQty] = useState({}); // productId -> boxes
  const [capped, setCapped] = useState({}); // productId -> the number typed before it was cut to the stock
  const [search, setSearch] = useState('');
  const [extras, setExtras] = useState(false);
  const [discount, setDiscount] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [accountId, setAccountId] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const sending = useRef(false);

  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive !== false), [warehouses]);
  const [lastWarehouse] = useState(readLastWarehouse);
  const home = useMemo(() => homeWarehouse(activeWarehouses, lastWarehouse), [activeWarehouses, lastWarehouse]);
  // The usual one (Dar es Salaam) whatever this device remembers — to flag a sale leaving from elsewhere.
  const dsmHome = useMemo(() => homeWarehouse(activeWarehouses, ''), [activeWarehouses]);
  const warehouse = activeWarehouses.find((w) => w.id === pickedWarehouse) || home;
  const warehouseId = warehouse?.id || '';
  const awayFromHome = !!(warehouse && dsmHome && warehouse.id !== dsmHome.id);
  const customer = customers.find((c) => c.id === customerId) || null;

  // What this warehouse holds right now — the same balances the Inventory page reads.
  const stock = useQuery({
    queryKey: ['inventory', 'balances', 'warehouse', warehouseId, 'quick-sale'],
    queryFn: async () => unwrap(await api.get('/inventory/balances', { params: { scope: 'WAREHOUSE', warehouseId, limit: 200 } })).data,
    enabled: !!warehouseId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const onShelf = useMemo(() => {
    const m = new Map();
    (stock.data || []).forEach((r) => {
      const base = (r.locations || [])
        .filter((l) => l.type === 'WAREHOUSE' && l.id === warehouseId)
        .reduce((s, l) => s + (Number(l.baseQuantity) || 0), 0);
      m.set(r.productId, base);
    });
    return m;
  }, [stock.data, warehouseId]);
  const stockReady = !!warehouseId && stock.isSuccess;

  // Every active product, in the one fixed order (useProducts sorts it), with its box price and how many boxes are here.
  const rows = useMemo(() => products.map((p) => {
    const pk = boxPackaging(p);
    if (!pk) return null;
    const size = Number(pk.baseQuantity) || 1;
    const price = boxPrice(p, pk);
    return {
      id: p.id,
      name: p.name,
      brandId: p.brandId,
      brand: p.brand?.name || 'Other',
      short: shortName(p.name, p.brand?.name),
      search: plain(p.name),
      packagingUnitId: pk.packagingUnitId,
      price,
      noPrice: !(price > 0),
      max: Math.floor((onShelf.get(p.id) || 0) / size),
    };
  }).filter(Boolean), [products, onShelf]);

  const showSearch = rows.length > 10;
  const needle = plain(search);
  const groups = useMemo(() => {
    const words = needle.split(' ').filter(Boolean);
    const out = [];
    rows.forEach((r) => {
      if (words.length && !words.every((w) => r.search.includes(w))) return;
      let g = out.find((x) => x.brand === r.brand);
      if (!g) { g = { brand: r.brand, rows: [] }; out.push(g); }
      g.rows.push(r);
    });
    return out;
  }, [rows, needle]);

  // Desktop only: the cursor starts in the search box, so a person can just type. Never on a phone (the keyboard would jump up).
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!showSearch || focusedOnce.current) return;
    focusedOnce.current = true;
    try { if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus(); } catch { /* old browser */ }
  }, [showSearch]);

  const lines = rows
    .filter((r) => (qty[r.id] || 0) > 0)
    .map((r) => ({ ...r, quantity: qty[r.id], lineTotal: r.price * qty[r.id] }));
  const boxes = lines.reduce((s, l) => s + l.quantity, 0);
  const overStock = stockReady && lines.some((l) => l.quantity > l.max);

  // A typed number above the stock is cut to the stock — and the row says so in rose until it is next changed.
  const setBoxes = (row, n, typed) => {
    const cap = stockReady && !row.noPrice ? row.max : 0;
    const want = Math.max(0, Math.trunc(Number(n) || 0));
    const v = Math.min(cap, want);
    setQty((q) => {
      const next = { ...q };
      if (v > 0) next[row.id] = v; else delete next[row.id];
      return next;
    });
    setCapped((c) => {
      const tooMany = typed && want > cap && cap > 0;
      if (!tooMany && !(row.id in c)) return c;
      const next = { ...c };
      if (tooMany) next[row.id] = want; else delete next[row.id];
      return next;
    });
    setConfirmDiscard(false);
  };

  // Same totals as before: Σ price × quantity, less the discount, never below zero.
  const subtotal = useMemo(() => lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0), [lines]);
  const discountN = Number(discount) || 0;
  const total = Math.max(0, subtotal - discountN);
  const discountTooBig = discountN > subtotal && lines.length > 0;
  // Only a typed-in amount can be short; empty means the full total.
  const paidTyped = amountPaid !== '';
  const paidN = Number(amountPaid) || 0;
  const shortfall = paidTyped ? Math.max(0, total - paidN) : 0;
  // More than the total is change for the customer, not takings — the server refuses it too.
  const overpaid = paidTyped ? Math.max(0, paidN - total) : 0;
  const nothingPaid = paidTyped && paidN === 0 && total > 0; // the server saves this as UNPAID

  // A single-brand sale banks into that brand's account — OHIS to M-Pesa, Civlily to Airtel Money —
  // and a mixed one may go to either. The server decides, from the brand sent up (as before).
  const productBrand = useMemo(() => {
    const set = new Set(lines.map((l) => l.brandId).filter(Boolean));
    return set.size === 1 ? [...set][0] : null;
  }, [lines]);
  const accounts = useQuery({
    queryKey: ['payment-accounts', productBrand || ''],
    queryFn: async () => unwrap(await api.get('/settlements/payment-accounts', {
      params: productBrand ? { brandId: productBrand } : undefined,
    })).data,
  });
  const accountOptions = accounts.data || [];
  // Only an account the select is actually showing is sent; otherwise the brand's own account (server default:
  // the first one listed for this brand).
  const accountChoice = accountOptions.some((a) => a.id === accountId) ? accountId : '';
  const intoName = accountChoice
    ? accountOptions.find((a) => a.id === accountChoice)?.name
    : accountOptions[0]?.name;

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        type,
        customerId: customerId || null,
        items: lines.map((l) => ({
          productId: l.id, packagingUnitId: l.packagingUnitId, quantity: Number(l.quantity), unitPrice: Number(l.price) || undefined,
        })),
        discount: Number(discount) || 0,
      };
      // Cash-only business — every sale is paid in full at the counter unless a smaller amount was typed.
      payload.amountPaid = amountPaid === '' ? total : Number(amountPaid);
      payload.warehouseId = warehouseId;
      if (accountChoice) payload.accountId = accountChoice;
      return api.post('/sales', payload);
    },
    onSuccess: () => {
      saveLastWarehouse(warehouseId);
      toast.success('Sale recorded');
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    // The server refused (most often: somebody else sold the last boxes) — reload the stock so the caps are true again.
    onError: (e) => { toast.error(apiError(e)); stock.refetch(); },
    onSettled: () => { sending.current = false; },
  });

  const canSubmit =
    lines.length > 0 && !!warehouseId && stockReady && !overStock && !discountTooBig && overpaid === 0
    && lines.every((l) => l.price > 0);

  // One sale per press, however fast the taps come (a ghost double tap must not send it twice).
  const submit = () => {
    if (sending.current || create.isPending || !canSubmit) return;
    sending.current = true;
    create.mutate();
  };

  // Esc, the X or Cancel with boxes picked asks once ("Discard this sale?") instead of dropping them.
  const requestClose = () => {
    if (create.isPending) return;
    if (lines.length === 0 || confirmDiscard) onClose();
    else setConfirmDiscard(true);
  };

  // Closing the toggle takes its figures away with it — a discount nobody can see must not ride along.
  const toggleExtras = () => {
    if (extras) { setDiscount(''); setAmountPaid(''); }
    setExtras((x) => !x);
  };

  const qtyInputs = () => [...(listRef.current?.querySelectorAll('input[data-qty]:not(:disabled)') || [])];
  // Enter on a quantity moves to the next product that can be sold; after the last, to Complete sale.
  // Up/Down step by one box.
  const onQtyKey = (row, q) => (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setBoxes(row, q + (e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = qtyInputs();
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) { next.focus(); next.select(); } else document.querySelector('[data-complete-sale]')?.focus();
  };
  // Enter in the search box goes to the first product it found.
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = qtyInputs()[0];
    if (first) { first.focus(); first.select(); }
  };

  const loading = productsLoading || warehousesLoading;
  const fewLeft = (n) => n > 0 && n < 10;

  // The second line of a row keeps its place: before a pick "TSh 30,000 · 21 in stock",
  // after "2 × 30,000 = 60,000 · 19 left" — the row never grows under the thumb.
  const subLine = (r, q) => {
    const on = q > 0;
    if (r.noPrice) return <span className="text-amber-300">No price set — fix it in Products</span>;
    if (stockReady && capped[r.id] != null && on) {
      return <span className="font-medium text-rose-300">Only {formatNumber(r.max)} in stock — you typed {formatNumber(capped[r.id])}</span>;
    }
    if (stockReady && q > r.max) return <span className="font-medium text-rose-300">Only {formatNumber(r.max)} in stock here</span>;
    let stockPart;
    if (!warehouseId) stockPart = null;
    else if (stock.isLoading) stockPart = <span className="text-faint">Checking stock…</span>;
    else if (stock.isError) stockPart = <span className="text-faint">Stock not loaded</span>;
    else if (r.max <= 0) stockPart = <span className="text-faint">Out of stock</span>;
    else if (on) {
      const left = r.max - q;
      stockPart = left === 0
        ? <span className="text-amber-300">none left</span>
        : <span className="text-faint"><span className={clsx('tabular-nums', fewLeft(left) && 'text-amber-300')}>{formatNumber(left)}</span> left</span>;
    } else {
      stockPart = <span className="text-faint"><span className={clsx('tabular-nums', fewLeft(r.max) && 'text-amber-300')}>{formatNumber(r.max)}</span> in stock</span>;
    }
    return (
      <>
        {/* Phone: the price, or the sum once picked. Desktop has its own price and line-total columns. */}
        <span className="tabular-nums text-muted sm:hidden">
          {on
            ? <>{formatNumber(q)} × {formatNumber(r.price)} = <span className="font-semibold text-emerald-300">{formatNumber(r.price * q)}</span></>
            : formatCurrency(r.price)}
          {stockPart && ' · '}
        </span>
        {stockPart}
      </>
    );
  };

  const changeable = customers.length > 0 || activeWarehouses.length > 1;
  const warehouseClass = awayFromHome ? 'text-amber-300' : 'text-foreground';
  const warehouseTitle = warehouse ? `${warehouse.name}${warehouse.region ? ` · ${warehouse.region}` : ''}` : undefined;

  const customerSelect = (props) => (
    <Select
      aria-label="Customer"
      value={customerId}
      onChange={(e) => setCustomerId(e.target.value)}
      className="py-1.5 sm:py-1.5"
      {...props}
    >
      <option value="">Walk-in customer</option>
      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.region ? ` · ${c.region}` : ''}</option>)}
    </Select>
  );
  const warehouseSelect = (props) => (
    <Select
      aria-label="Sell from warehouse"
      value={warehouseId}
      onChange={(e) => setPickedWarehouse(e.target.value)}
      className="py-1.5 sm:py-1.5"
      {...props}
    >
      {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.region ? ` · ${w.region}` : ''}</option>)}
    </Select>
  );

  // The button names what is being collected: the total, or "50,000 paid of 93,000" when it is a part payment.
  const buttonLabel = lines.length === 0
    ? <span>Complete sale</span>
    : shortfall > 0 && overpaid === 0
      ? (
        <span className="tabular-nums">
          <span className="sm:hidden">Complete · {formatNumber(paidN)} paid of {formatNumber(total)}</span>
          <span className="hidden sm:inline">Complete sale · {formatCurrency(paidN)} paid of {formatNumber(total)}</span>
        </span>
      )
      : <span>Complete sale<span className="tabular-nums"> · {formatCurrency(total)}</span></span>;

  return (
    <Modal
      open
      onClose={requestClose}
      size="lg"
      title="Record a sale"
      footer={confirmDiscard ? (
        <>
          <div className="min-w-0 text-sm max-sm:w-full sm:mr-auto">
            <div className="font-medium text-foreground">Discard this sale?</div>
            <div className="text-xs text-muted">{formatNumber(boxes)} {boxes === 1 ? 'box' : 'boxes'} picked will be lost.</div>
          </div>
          <Button variant="secondary" className="h-12 flex-1 sm:h-auto sm:flex-none" onClick={() => onClose()}>Discard</Button>
          <Button autoFocus className="h-12 flex-1 sm:h-auto sm:flex-none" onClick={() => setConfirmDiscard(false)}>Keep</Button>
        </>
      ) : (
        <>
          <div className="mr-auto min-w-0 text-sm">
            {lines.length === 0 ? (
              <span className="text-muted">Tap + on what the customer is buying</span>
            ) : (
              <>
                <div className="truncate text-muted">
                  <span className="font-semibold tabular-nums text-foreground">{formatNumber(boxes)}</span> {boxes === 1 ? 'box' : 'boxes'}
                  {' · '}{lines.length} {lines.length === 1 ? 'product' : 'products'}
                  {intoName && <> · into <span className="font-medium text-foreground">{intoName}</span></>}
                </div>
                {discountN > 0 && (
                  <div className="text-xs text-muted">
                    <span className="tabular-nums">{formatCurrency(subtotal)}</span> less <span className="tabular-nums text-amber-300">{formatCurrency(discountN)}</span> discount
                  </div>
                )}
                {shortfall > 0 && overpaid === 0 && (
                  <div className="text-xs text-amber-300">
                    Paid <span className="tabular-nums">{formatCurrency(paidN)}</span> · owes <span className="tabular-nums">{formatCurrency(shortfall)}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button
            data-complete-sale=""
            className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm"
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={submit}
          >
            {buttonLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        {/* Who and where — already chosen: one quiet line, one Change. Warehouses only — rep stock is
            settled through Orders & Settlements, and the server refuses it here. */}
        <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.08]">
          {editBoth ? (
            <div className="grid gap-2 p-3 sm:grid-cols-2 sm:gap-3">
              <label className="block text-xs text-muted">Customer{customerSelect({ className: 'mt-1 max-sm:min-h-[44px]' })}</label>
              {activeWarehouses.length > 1 && (
                <label className="block text-xs text-muted">Sell from{warehouseSelect({ className: 'mt-1 max-sm:min-h-[44px]' })}</label>
              )}
              <div className="flex justify-end sm:col-span-2">
                <button type="button" onClick={() => setEditBoth(false)} className={clsx(changeBtn, 'text-foreground')}>Done</button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[44px] items-center gap-2 py-1 pl-3 pr-1 text-sm leading-tight sm:gap-3 sm:py-1.5 sm:pr-2">
              <UserRound className="hidden h-4 w-4 shrink-0 text-faint sm:block" aria-hidden="true" />
              <div className="min-w-0 max-w-[40%] shrink-0">
                <div className="truncate font-medium text-foreground">{customer ? customer.name : 'Walk-in'}</div>
                <div className="truncate text-[11px] text-faint">Customer{customer?.region ? ` · ${customer.region}` : ''}</div>
              </div>
              <div className="h-7 w-px shrink-0 bg-white/[0.08]" aria-hidden="true" />
              <Warehouse className="hidden h-4 w-4 shrink-0 text-faint sm:block" aria-hidden="true" />
              <div className="min-w-0 flex-1" title={warehouseTitle}>
                <div className={clsx('truncate font-medium', warehouseClass)}>
                  {warehouse ? warehouse.name : warehousesLoading ? '…' : 'No active warehouse'}
                </div>
                <div className="truncate text-[11px] text-faint">Warehouse{warehouse?.region ? ` · ${warehouse.region}` : ''}</div>
              </div>
              {changeable && <button type="button" onClick={() => setEditBoth(true)} className={changeBtn}>Change</button>}
            </div>
          )}
          {awayFromHome && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/[0.07] py-1 pl-3 pr-1 text-xs text-amber-300">
              <span>This sale takes stock from {warehouse.name}, not the usual warehouse.</span>
              <button type="button" onClick={() => setPickedWarehouse(dsmHome.id)} className={clsx(changeBtn, 'text-foreground')}>
                Use {dsmHome.name}
              </button>
            </div>
          )}
        </div>

        {showSearch && (
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Find a product"
              aria-label="Find a product"
              className="input pl-9 max-sm:h-10 max-sm:py-0"
            />
          </label>
        )}

        {stock.isError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            <span>Could not load the stock in {warehouse?.name || 'this warehouse'}.</span>
            <button type="button" onClick={() => stock.refetch()} className="font-medium underline underline-offset-2">Try again</button>
          </div>
        )}

        {/* Every product, in the fixed order, grouped by brand. */}
        <div ref={listRef} className="-mx-5 sm:mx-0">
          {loading ? (
            <div className="space-y-2 px-5 sm:px-0">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}
            </div>
          ) : !warehouse ? (
            <p className="px-5 py-6 text-center text-sm text-muted sm:px-0">There is no active warehouse to sell from. Add one under Inventory first.</p>
          ) : groups.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted sm:px-0">{needle ? `No product matches “${search.trim()}”.` : 'No products to sell yet.'}</p>
          ) : (
            <div className="space-y-3">
              <div className="hidden px-3 text-[11px] text-faint sm:flex sm:items-center sm:gap-3">
                <span className="flex-1">Product</span>
                <span className="w-24 text-right">Price / box</span>
                <span className="w-[122px] text-center">Boxes</span>
                <span className="w-24 text-right">Line total</span>
              </div>
              {groups.map((g) => {
                const picked = g.rows.reduce((s, r) => s + (qty[r.id] || 0), 0);
                return (
                  <section key={g.brand} aria-label={g.brand}>
                    <div className="flex items-baseline justify-between px-4 pb-1 sm:px-1 sm:pb-1.5">
                      <h4 className="text-[13px] font-semibold text-foreground">{g.brand}</h4>
                      {picked > 0 && <span className="text-[11px] tabular-nums text-muted">{formatNumber(picked)} {picked === 1 ? 'box' : 'boxes'}</span>}
                    </div>
                    <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08] bg-white/[0.025] sm:overflow-hidden sm:rounded-xl sm:border-0 sm:ring-1 sm:ring-white/[0.08]">
                      {g.rows.map((r) => {
                        const q = qty[r.id] || 0;
                        const on = q > 0;
                        const blocked = (stockReady && r.max <= 0) || r.noPrice;
                        const over = stockReady && q > r.max;
                        return (
                          <li
                            key={r.id}
                            className={clsx(
                              'flex items-center gap-2 px-4 py-2 transition-colors sm:gap-3 sm:px-3 sm:py-2.5',
                              on && 'bg-white/[0.04] shadow-[inset_2px_0_0_0_rgba(255,255,255,0.35)]',
                              blocked && !on && 'opacity-45',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-foreground" title={r.name}>{r.short}</div>
                              <div className="mt-0.5 truncate text-xs">{subLine(r, q)}</div>
                            </div>
                            <div className="hidden w-24 text-right text-sm tabular-nums text-muted sm:block">{formatCurrency(r.price)}</div>
                            <div className="flex shrink-0 items-center gap-1.5 sm:gap-1">
                              <button type="button" className={stepBtn} onClick={() => setBoxes(r, q - 1)} disabled={q <= 0} aria-label={`One box fewer of ${r.name}`}>
                                <Minus className="h-4 w-4" />
                              </button>
                              <input
                                data-qty=""
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                value={q ? String(q) : ''}
                                placeholder="0"
                                disabled={!stockReady || r.max <= 0 || r.noPrice}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  // Whole boxes only: "1.5", "-3" or "2e1" is refused (the box keeps its number), never turned into 15, 3 or 21.
                                  const raw = e.target.value.trim();
                                  if (!/^\d*$/.test(raw)) return;
                                  setBoxes(r, raw === '' ? 0 : parseInt(raw, 10), true);
                                }}
                                onKeyDown={onQtyKey(r, q)}
                                aria-label={`Boxes of ${r.name}`}
                                className={clsx(
                                  'h-11 w-10 min-w-0 rounded-lg bg-elevated text-center text-base font-bold tabular-nums text-foreground ring-1 placeholder:font-normal placeholder:text-faint',
                                  'focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 sm:h-9 sm:w-11 sm:text-sm',
                                  over || (capped[r.id] != null && on) ? 'ring-rose-500/60' : 'ring-white/[0.08]',
                                )}
                              />
                              <button type="button" className={stepBtn} onClick={() => setBoxes(r, q + 1)} disabled={!stockReady || q >= r.max || r.noPrice} aria-label={`One box more of ${r.name}`}>
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="hidden w-24 text-right text-sm font-semibold tabular-nums sm:block">
                              {on && <span className="text-emerald-300">{formatCurrency(r.price * q)}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* The rare parts: discount and part payment behind one toggle; where the money went, small (also named in the footer). */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={toggleExtras}
            aria-expanded={extras}
            className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-md text-sm font-medium text-muted transition hover:text-foreground sm:min-h-[40px]"
          >
            <ChevronDown className={clsx('h-4 w-4 transition-transform', extras && 'rotate-180')} aria-hidden="true" />
            Discount or part payment
          </button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="shrink-0">Paid into</span>
            <Select
              value={accountChoice}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="Where was it paid?"
              className="w-auto min-w-[11rem] py-1.5 max-sm:min-h-[44px] sm:py-1.5"
            >
              {/* No account chosen means the brand's own account (the first listed) — there is no cash till. */}
              <option value="">{accountOptions[0] ? `${accountOptions[0].name} (default)` : 'Brand account (default)'}</option>
              {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </label>
        </div>

        {extras && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount">
              <NumberInput min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" aria-label="Discount" />
            </Field>
            <Field label="Amount paid" hint="Leave empty for the full amount">
              <NumberInput min="0" max={total} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={String(total)} aria-label="Amount paid" />
            </Field>
          </div>
        )}

        {discountTooBig && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">The discount is more than the boxes cost.</span>{' '}
            The most it can be is {formatCurrency(subtotal)}.
          </div>
        )}

        {shortfall > 0 && (nothingPaid ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">This sale will be saved as UNPAID</span> — nothing goes into the account; the customer owes{' '}
            {formatCurrency(total)}. Leave “Amount paid” empty if the customer paid in full.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">This sale will be saved as PARTIAL.</span>{' '}
            Paid {formatCurrency(paidN)} of {formatCurrency(total)}, leaving{' '}
            {formatCurrency(shortfall)} owed — and only {formatCurrency(paidN)} goes into the account.
            Leave “Amount paid” empty if the customer paid in full.
          </div>
        ))}

        {overpaid > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="font-medium">Amount paid is more than the total.</span>{' '}
            Enter {formatCurrency(total)} — the {formatCurrency(overpaid)} change goes back to the customer, not into the account.
          </div>
        )}
      </div>
    </Modal>
  );
}
