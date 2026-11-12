import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Factory, Minus, Plus, Search, Truck, Warehouse } from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Button, NumberInput, Textarea } from '@/components/ui';
import { homeWarehouse, matches, stockByProduct, clampQty, REASONS, reasonChip, withReason, boxWord, lineCost } from '@/lib/stockPick';

// ============================================================================
// PICK PRODUCTS THE QUICK WAY — the list from Record a sale, for the stock windows.
//
// Nino, 11 Nov 2026: "it's hard to add — select the product… make it for me to
// just pick and add the quantity"; "the PO should be easy, not complicated and
// hard to fill and select all the time". So Receive stock, Adjust, Record
// damage, Transfers, New PO and the Finance purchase show every product in the
// fixed order, grouped by brand, each with a  −  qty  +  — no "Add item", no
// product or packaging select. The unit is the box each window used before.
//
// What it can do, per window:
//  - cap: no more than the stock at the place the boxes leave (transfers,
//    decreases, damage); nothing is capped when boxes come in;
//  - stock: show what the place holds ("21 here");
//  - cost: an editable cost per box on each picked line (purchases);
//  - single: one product per request (adjust, damage) — tap a row, then the qty.
// ============================================================================

const stepBtn =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground ring-1 ring-white/[0.12] ' +
  'transition hover:bg-white/[0.1] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ' +
  'disabled:pointer-events-none disabled:opacity-30 sm:h-9 sm:w-9';

export const changeBtn =
  'shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted underline-offset-2 transition hover:bg-white/[0.05] ' +
  'hover:text-foreground hover:underline max-sm:min-h-[44px]';

const chipBase =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:min-h-[36px]';
const chipOn = 'bg-white/[0.12] text-foreground ring-white/30';
const chipOff = 'bg-white/[0.03] text-muted ring-white/[0.1] hover:bg-white/[0.06] hover:text-foreground';

// ── Where the stock sits ─────────────────────────────────────────────────────

const LAST_WAREHOUSE_KEY = 'zl.stock.warehouse';
const readLastWarehouse = () => { try { return localStorage.getItem(LAST_WAREHOUSE_KEY) || ''; } catch { return ''; } };
export const saveStockWarehouse = (id) => { try { if (id) localStorage.setItem(LAST_WAREHOUSE_KEY, id); } catch { /* private window */ } };

// The active warehouses, the one a stock window starts on, and the usual one (Dar es Salaam) to flag any other.
export function useHomeWarehouse(warehouses) {
  const active = useMemo(() => (warehouses || []).filter((w) => w && w.isActive !== false), [warehouses]);
  const [last] = useState(readLastWarehouse);
  const home = useMemo(() => homeWarehouse(active, last), [active, last]);
  const usual = useMemo(() => homeWarehouse(active, ''), [active]);
  return { active, home, usual };
}

// What one place holds right now — the same balances the Inventory page reads. `loc` = { type, id }.
export function useStockAt(loc) {
  const type = loc?.type || '';
  const id = loc?.id || '';
  const rep = type === 'SALES_REP';
  const q = useQuery({
    queryKey: ['inventory', 'balances', rep ? 'rep' : 'warehouse', id, 'stock-pick'],
    queryFn: async () => unwrap(await api.get('/inventory/balances', {
      params: rep ? { scope: 'SALES_REP', salesRepId: id, limit: 200 } : { scope: 'WAREHOUSE', warehouseId: id, limit: 200 },
    })).data,
    enabled: !!(type && id),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const map = useMemo(() => stockByProduct(q.data, { type, id }), [q.data, type, id]);
  return { map, ready: !!id && q.isSuccess, loading: !!id && q.isLoading, error: !!id && q.isError, refetch: q.refetch };
}

const PLACE_ICON = { warehouse: Warehouse, rep: Truck, supplier: Factory };

// One quiet line: what is already chosen, and Change. `open` swaps it for the chooser (children) and Done.
export function PlaceLine({ parts, open, onToggle, children, note, changeLabel = 'Change' }) {
  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/[0.08]">
      {open ? (
        <div className="space-y-3 p-3">
          {children}
          <div className="flex justify-end">
            <button type="button" onClick={onToggle} className={clsx(changeBtn, 'text-foreground')}>Done</button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[44px] items-center gap-2 py-1 pl-3 pr-1 text-sm leading-tight sm:gap-3 sm:py-1.5 sm:pr-2">
          {parts.map((p, i) => {
            const Icon = PLACE_ICON[p.kind] || Warehouse;
            return (
              <div key={p.label} className={clsx('flex min-w-0 items-center gap-2 sm:gap-3', i === parts.length - 1 ? 'flex-1' : 'max-w-[45%] shrink-0')}>
                {i > 0 && <span className="shrink-0 text-faint" aria-hidden="true">→</span>}
                <Icon className="hidden h-4 w-4 shrink-0 text-faint sm:block" aria-hidden="true" />
                <div className="min-w-0" title={p.title}>
                  <div className={clsx('truncate font-medium', p.amber ? 'text-amber-300' : p.empty ? 'text-muted' : 'text-foreground')}>{p.name}</div>
                  <div className="truncate text-[11px] text-faint">{p.label}{p.sub ? ` · ${p.sub}` : ''}</div>
                </div>
              </div>
            );
          })}
          {onToggle && <button type="button" onClick={onToggle} className={changeBtn}>{changeLabel}</button>}
        </div>
      )}
      {note && !open && <div className="border-t border-white/[0.07] py-1 pl-3 pr-1">{note}</div>}
    </div>
  );
}

// A short amber line under a choice (a rep's stock, a warehouse that is not the usual one).
export function Caution({ children, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-amber-300">
      <span className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{children}</span>
      {action}
    </div>
  );
}

export const REP_WARNING = 'This does not change his open orders — use a Return for boxes he is giving back.';

// One choice out of a few, as chips. A search box appears when the list is long.
export function Chips({ label, options, value, onChange, searchAt = 9, empty = 'Nothing to choose' }) {
  const [q, setQ] = useState('');
  const long = options.length >= searchAt;
  const shown = long ? options.filter((o) => matches(`${o.label} ${o.sub || ''}`, q)) : options;
  return (
    <div className="space-y-2">
      {label && <div className="text-xs text-muted">{label}</div>}
      {long && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find ${label ? label.toLowerCase() : ''}`.trim()}
            aria-label={`Find ${label || 'one'}`} className="input pl-9 max-sm:h-10 max-sm:py-0" />
        </label>
      )}
      {options.length === 0 ? <p className="text-sm text-muted">{empty}</p> : shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing matches “{q.trim()}”.</p>
      ) : (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
          {shown.map((o) => {
            const on = o.value === value;
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
                className={clsx(chipBase, on ? chipOn : chipOff)}>
                <span className="truncate">{o.label}</span>
                {o.sub && <span className="text-[11px] font-normal text-faint">{o.sub}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Two (or three) side-by-side buttons, one of them chosen — Remove / Add, To a rep / Between warehouses.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.08]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={clsx('min-h-[44px] rounded-lg px-3 text-sm font-medium transition sm:min-h-[38px]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
              on ? 'bg-white/[0.12] text-foreground ring-1 ring-white/25' : 'text-muted hover:bg-white/[0.05] hover:text-foreground')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// A few one-tap reasons over the text box. The text box is what the server gets.
export function ReasonField({ value, onChange, chips = REASONS, optional = false }) {
  const box = useRef(null);
  const active = reasonChip(value, chips);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">Reason {optional ? <span className="text-faint">(optional)</span> : <span className="text-rose-400">*</span>}</div>
      <div role="group" aria-label="Reason" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c} type="button" aria-pressed={active === c}
            onClick={() => {
              onChange(withReason(value, c, chips));
              if (c === 'Other') box.current?.focus();
            }}
            className={clsx(chipBase, active === c ? chipOn : chipOff)}>
            {c}
          </button>
        ))}
      </div>
      <Textarea ref={box} rows={2} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="What happened? Add any detail" aria-label="Reason" />
    </div>
  );
}

// A small toggle for the rare parts (extra costs).
export function MoreToggle({ open, onToggle, children }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-md text-sm font-medium text-muted transition hover:text-foreground sm:min-h-[36px]">
      <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      {children}
    </button>
  );
}

// The footer that asks once before throwing away what was picked.
export function DiscardFooter({ what, detail, onDiscard, onKeep }) {
  return (
    <>
      <div className="min-w-0 text-sm max-sm:w-full sm:mr-auto">
        <div className="font-medium text-foreground">Discard this {what}?</div>
        {detail && <div className="text-xs text-muted">{detail}</div>}
      </div>
      <Button variant="secondary" className="h-12 flex-1 sm:h-auto sm:flex-none" onClick={onDiscard}>Discard</Button>
      <Button autoFocus className="h-12 flex-1 sm:h-auto sm:flex-none" onClick={onKeep}>Keep</Button>
    </>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

/**
 * rows     — from pickerRows()/rowsWithSaved(): { key, id, name, brand, short, packagingUnitId, size, unitName, buyingPrice }
 * value    — { [row.key]: quantity }; onChange(next)
 * stock    — useStockAt() result, or null: shows "N here"
 * cap      — no more than the stock (needs stock)
 * locked   — a sentence instead of the steppers (e.g. "Choose the rep first")
 * single   — one product at a time: tap a row, then its quantity. Once picked, the list folds to that row
 *            (with "Change product"), so what comes after it (the reason) is right there.
 * onlyHeld — a rep's stock: list only what he holds, with "Show all products" to see the rest
 * cost     — { [row.key]: '12000' } typed costs per box, or undefined for no cost column; onCost(key, value)
 * placeName — "Main Warehouse", for the stock messages
 */
export default function ProductPicker({
  rows, value, onChange, stock = null, cap = false, locked = '', single = false, onlyHeld = false, cost, onCost,
  placeName = 'here', emptyText = 'No products yet.', loading = false, submitSelector = '[data-picker-submit]',
}) {
  const [search, setSearch] = useState('');
  const [capped, setCapped] = useState({}); // key -> the number typed before it was cut to the stock
  const [browse, setBrowse] = useState(false); // single: the whole list again after "Change product"
  const [showAll, setShowAll] = useState(false); // onlyHeld: every product, not only what he holds
  const [costOpen, setCostOpen] = useState(null); // the row whose cost box is open (phone, or an unpicked row on desktop)
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const focusPicked = useRef(false);
  const withCost = !!cost;
  const stockReady = !!stock?.ready;
  const waitStock = cap && !stockReady;

  const held = (r) => (stockReady ? Math.floor((stock.map.get(r.id) || 0) / (r.size || 1)) : null);
  const maxOf = (r) => (cap ? (stockReady ? held(r) : 0) : Infinity);

  const pickedKey = single ? Object.keys(value)[0] || null : null;
  const folded = single && !!pickedKey && !browse && rows.some((r) => r.key === pickedKey);
  const filterHeld = onlyHeld && stockReady && !showAll && !folded;
  const heldCount = onlyHeld && stockReady ? rows.filter((r) => held(r) > 0).length : 0;
  const showSearch = rows.length > 10 && !folded;

  const groups = [];
  rows.forEach((r) => {
    if (folded) { if (r.key !== pickedKey) return; }
    else {
      if (search && !matches(r.name, search)) return;
      if (filterHeld && !(held(r) > 0) && !(r.key in value)) return;
    }
    let g = groups.find((x) => x.brand === r.brand);
    if (!g) { g = { brand: r.brand, rows: [] }; groups.push(g); }
    g.rows.push(r);
  });

  // Desktop only: the cursor starts in the search box, so a person can just type. Never on a phone.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!showSearch || focusedOnce.current || loading) return;
    focusedOnce.current = true;
    try { if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus(); } catch { /* old browser */ }
  }, [showSearch, loading]);

  // In single mode a row picked from the keyboard gets its quantity box focused once it is drawn.
  // (A picked row stays picked while its box is cleared to type a new number.)
  useEffect(() => {
    if (!focusPicked.current || !pickedKey) return;
    focusPicked.current = false;
    const el = listRef.current?.querySelector(`input[data-qty="${CSS.escape(pickedKey)}"]`);
    if (el) { el.focus(); el.select(); }
  }, [pickedKey]);

  const setBoxes = (row, n, typed) => {
    const max = maxOf(row);
    const want = clampQty(n);
    const v = Math.min(max, want);
    // One product at a time: the − at one lets go of it; a box emptied by typing keeps it picked.
    if (single) onChange(v > 0 || typed ? { [row.key]: v } : {});
    else {
      const next = { ...value };
      if (v > 0) next[row.key] = v; else delete next[row.key];
      onChange(next);
    }
    setCapped((c) => {
      const tooMany = typed && want > max && max > 0 && max !== Infinity;
      if (!tooMany && !(row.key in c)) return c;
      const next = { ...c };
      if (tooMany) next[row.key] = want; else delete next[row.key];
      return next;
    });
  };

  const choose = (row) => {
    if (locked || waitStock) return;
    if (row.key in value) { setBrowse(false); return; }
    if (maxOf(row) < 1) return;
    setBoxes(row, 1);
    setBrowse(false);
    setSearch('');
  };

  const qtyInputs = () => [...(listRef.current?.querySelectorAll('input[data-qty]:not(:disabled)') || [])];
  const nextFrom = (row) => {
    const inputs = qtyInputs();
    const at = inputs.findIndex((x) => x.dataset.qty === row.key);
    const next = inputs[at + 1];
    if (next) { next.focus(); next.select(); } else document.querySelector(submitSelector)?.focus();
  };
  // Enter on a quantity (or a cost) moves to the next quantity; after the last, to the main button. Up/Down step by one.
  // A key that is not a digit is stopped before it reaches the box, so a selected number is still selected
  // and the next digit replaces it ("-3" over 15 never becomes 153). Pasted text is checked in onChange.
  const onQtyKey = (row, q) => (e) => {
    if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setBoxes(row, q + (e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    nextFrom(row);
  };
  const onCostKey = (row) => (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    nextFrom(row);
  };
  // Enter in the search box goes to the first product it found (in single mode it picks it).
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (single) {
      const first = groups.flatMap((g) => g.rows).find((r) => maxOf(r) >= 1);
      if (first) { focusPicked.current = true; if (first.key in value) { focusPicked.current = false; setBrowse(false); qtyInputs()[0]?.focus(); } else choose(first); }
      return;
    }
    const first = qtyInputs()[0];
    if (first) { first.focus(); first.select(); }
  };

  const costOf = (r) => lineCost(cost, r);
  const unitLabel = (r, n) => (r.unitName ? `${r.unitName}${n === 1 ? '' : 's'}` : boxWord(n));
  const few = (n) => n > 0 && n < 10;

  // The second line keeps its place: before a pick "21 here", after "19 left" (or "23 after" when boxes come in).
  const subLine = (r, q) => {
    const on = q > 0;
    const max = maxOf(r);
    const h = held(r);
    if (r.unitName) {
      return <span className="text-amber-300">In {r.unitName.toLowerCase()}s of {formatNumber(r.size)} — as it was saved</span>;
    }
    if (cap && stockReady && capped[r.key] != null && on) {
      return <span className="font-medium text-rose-300">Only {formatNumber(max)} {placeName === 'here' ? 'here' : `at ${placeName}`} — you typed {formatNumber(capped[r.key])}</span>;
    }
    if (cap && stockReady && q > max) return <span className="font-medium text-rose-300">Only {formatNumber(max)} {placeName === 'here' ? 'here' : `at ${placeName}`}</span>;
    const parts = [];
    if (withCost) {
      const c = Number(costOf(r)) || 0;
      // A picked line with no cost would land at cost 0 and set the buying price to 0 — say so on the row.
      if (on && !c) parts.push(<span key="c" className="text-amber-300">No cost — type the cost per box</span>);
      else {
        parts.push(
          <span key="c" className="tabular-nums text-muted sm:hidden">
            {on ? <>{formatNumber(q)} × {formatNumber(c)} = <span className="font-semibold text-foreground">{formatNumber(c * q * (r.size || 1))}</span></> : (c ? `${formatCurrency(c)} a box` : 'No buying price')}
          </span>,
        );
      }
    }
    if (stock) {
      let s;
      if (stock.loading) s = <span className="text-faint">Checking stock…</span>;
      else if (stock.error) s = <span className="text-faint">Stock not loaded</span>;
      else if (!stockReady) s = null;
      else if (cap) {
        if (h <= 0 && !on) s = <span className="text-faint">None here</span>;
        else if (on) {
          const left = h - q;
          s = left === 0 ? <span className="text-amber-300">none left here</span>
            : <span className="text-faint"><span className={clsx('tabular-nums', few(left) && 'text-amber-300')}>{formatNumber(left)}</span> left here</span>;
        } else s = <span className="text-faint"><span className={clsx('tabular-nums', few(h) && 'text-amber-300')}>{formatNumber(h)}</span> here</span>;
      } else {
        s = on
          ? <span className="text-faint"><span className="tabular-nums">{formatNumber(h)}</span> here · <span className="tabular-nums text-foreground">{formatNumber(h + q)}</span> after</span>
          : <span className="text-faint"><span className="tabular-nums">{formatNumber(h)}</span> here</span>;
      }
      if (s) parts.push(<span key="s">{parts.length ? <span className="sm:hidden"> · </span> : null}{s}</span>);
    }
    if (!parts.length && locked) parts.push(<span key="l" className="text-faint">{locked}</span>);
    return parts;
  };

  const stepper = (r, q) => {
    const max = maxOf(r);
    const off = !!locked || waitStock;
    const over = cap && stockReady && q > max;
    return (
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-1">
        <button type="button" className={stepBtn} onClick={() => setBoxes(r, q - 1)} disabled={off || (q <= 0 && !single)} aria-label={`One ${unitLabel(r, 1)} fewer of ${r.name}`}>
          <Minus className="h-4 w-4" />
        </button>
        <input
          data-qty={r.key}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={q ? String(q) : ''}
          placeholder="0"
          disabled={off || max <= 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            // Whole boxes only: "1.5", "-3" or "2e1" is refused (the box keeps its number), never turned into 15, 3 or 21.
            const raw = e.target.value.trim();
            if (!/^\d*$/.test(raw)) return;
            setBoxes(r, raw === '' ? 0 : parseInt(raw, 10), true);
          }}
          onKeyDown={onQtyKey(r, q)}
          aria-label={`${r.unitName ? `${r.unitName}s` : 'Boxes'} of ${r.name}`}
          className={clsx(
            'h-11 w-12 min-w-0 rounded-lg bg-elevated text-center text-base font-bold tabular-nums text-foreground ring-1 placeholder:font-normal placeholder:text-faint',
            'focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 sm:h-9 sm:w-12 sm:text-sm',
            over || (capped[r.key] != null && q > 0) ? 'ring-rose-500/60' : 'ring-white/[0.08]',
          )}
        />
        <button type="button" className={stepBtn} onClick={() => setBoxes(r, q + 1)} disabled={off || q >= max} aria-label={`One ${unitLabel(r, 1)} more of ${r.name}`}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const costInput = (r, extra, focus) => (
    <NumberInput
      min="0"
      value={costOf(r)}
      onChange={(e) => onCost?.(r.key, e.target.value)}
      onKeyDown={onCostKey(r)}
      onBlur={() => setCostOpen((k) => (k === r.key ? null : k))}
      autoFocus={!!focus}
      placeholder="0"
      aria-label={`Cost per box of ${r.name}`}
      className={clsx('text-right tabular-nums', extra)}
    />
  );

  return (
    <div className="space-y-2.5 sm:space-y-3">
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

      {onlyHeld && stockReady && !folded && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span className="min-w-0 truncate">{filterHeld ? `${placeName === 'here' ? 'Held here' : `${placeName} holds`}: ${heldCount} of ${rows.length} products` : 'Every product'}</span>
          <button type="button" onClick={() => setShowAll((x) => !x)} className={changeBtn}>
            {filterHeld ? 'Show all products' : 'Only what he holds'}
          </button>
        </div>
      )}

      {stock?.error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          <span>Could not load the stock {placeName === 'here' ? 'here' : `at ${placeName}`}.</span>
          <button type="button" onClick={() => stock.refetch()} className="font-medium underline underline-offset-2">Try again</button>
        </div>
      )}

      <div ref={listRef} className="-mx-5 sm:mx-0">
        {loading ? (
          <div className="space-y-2 px-5 sm:px-0">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted sm:px-0">
            {search ? `No product matches “${search.trim()}”.` : filterHeld ? 'He holds none of these products — tap Show all products.' : emptyText}
          </p>
        ) : (
          <div className="space-y-3">
            {!folded && (
              <div className="hidden px-3 text-[11px] text-faint sm:flex sm:items-center sm:gap-3">
                <span className="flex-1">Product</span>
                {withCost && <span className="w-28 text-right">Cost / box</span>}
                <span className="w-[130px] text-center">{single ? 'Quantity' : 'Boxes'}</span>
                {withCost && <span className="w-24 text-right">Line total</span>}
              </div>
            )}
            {groups.map((g) => {
              const picked = g.rows.reduce((s, r) => s + (value[r.key] || 0) * (r.size || 1), 0);
              return (
                <section key={g.brand} aria-label={g.brand}>
                  <div className="flex min-h-[28px] items-center justify-between gap-3 px-4 pb-1 sm:px-1 sm:pb-1.5">
                    <h4 className="text-[13px] font-semibold text-foreground">{g.brand}</h4>
                    {folded ? (
                      <button type="button" onClick={() => setBrowse(true)} className={changeBtn}>Change product</button>
                    ) : picked > 0 && <span className="text-[11px] tabular-nums text-muted">{formatNumber(picked)} {boxWord(picked)}</span>}
                  </div>
                  <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08] bg-white/[0.025] sm:overflow-hidden sm:rounded-xl sm:border-0 sm:ring-1 sm:ring-white/[0.08]">
                    {g.rows.map((r) => {
                      const q = value[r.key] || 0;
                      const on = single ? r.key in value : q > 0;
                      const max = maxOf(r);
                      const blocked = !locked && !waitStock && max <= 0;
                      const c = Number(costOf(r)) || 0;
                      const lineTotal = c * q * (r.size || 1);
                      const nameBlock = (
                        <>
                          <div className="truncate text-sm font-medium text-foreground" title={r.name}>
                            {r.short}{r.unitName && <span className="ml-1 text-xs font-normal text-amber-300">· {r.unitName}s</span>}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                            <div className="min-w-0 truncate">{subLine(r, q)}</div>
                            {/* Phone: the cost is plain text; Edit opens its box (the row only grows when asked to). */}
                            {withCost && on && !single && costOpen !== r.key && (
                              <button type="button" onClick={() => setCostOpen(r.key)} aria-label={`Change the cost per box of ${r.name}`}
                                className="relative shrink-0 font-medium text-muted underline underline-offset-2 hover:text-foreground after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] sm:hidden">
                                Edit
                              </button>
                            )}
                          </div>
                        </>
                      );
                      const ringOn = max >= 1 && !locked && !waitStock;
                      return (
                        <li
                          key={r.key}
                          className={clsx(
                            'flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 transition-colors sm:flex-nowrap sm:gap-3 sm:px-3 sm:py-2.5',
                            on && 'bg-white/[0.04] shadow-[inset_2px_0_0_0_rgba(255,255,255,0.35)]',
                            blocked && !on && 'opacity-45',
                          )}
                        >
                          {single && !on ? (
                            // The whole row is the button, the circle on the right included.
                            <button
                              type="button"
                              role="radio"
                              aria-checked={false}
                              onClick={() => choose(r)}
                              disabled={!!locked || waitStock || max < 1}
                              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed"
                            >
                              <div className="min-w-0 flex-1">{nameBlock}</div>
                              <div className="flex shrink-0 justify-end sm:w-[130px] sm:justify-center">
                                <span className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full ring-1', ringOn ? 'ring-white/25' : 'ring-white/10')} aria-hidden="true" />
                              </div>
                            </button>
                          ) : single ? (
                            <>
                              <button
                                type="button"
                                role="radio"
                                aria-checked
                                onClick={() => choose(r)}
                                className="min-w-0 flex-1 rounded-md py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                              >
                                {nameBlock}
                              </button>
                              {stepper(r, q)}
                            </>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1">{nameBlock}</div>
                              {withCost && (
                                // Desktop: plain figures; a box only on a picked row, or when the figure is clicked.
                                <div className="hidden w-28 text-right text-sm tabular-nums sm:block">
                                  {on || costOpen === r.key ? costInput(r, clsx('h-9 py-0', on && !c && 'ring-1 ring-amber-400/60'), costOpen === r.key) : (
                                    <button type="button" onClick={() => setCostOpen(r.key)} aria-label={`Change the cost per box of ${r.name}`}
                                      className="w-full rounded-md px-2 py-1.5 text-right text-muted transition hover:bg-white/[0.05] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                                      {c ? formatNumber(c) : '—'}
                                    </button>
                                  )}
                                </div>
                              )}
                              {stepper(r, q)}
                              {withCost && (
                                <div className="hidden w-24 text-right text-sm font-semibold tabular-nums sm:block">
                                  {on && <span className="text-foreground">{formatCurrency(lineTotal)}</span>}
                                </div>
                              )}
                              {withCost && costOpen === r.key && (
                                <label className="flex w-full items-center gap-2 text-xs text-muted sm:hidden">
                                  <span className="shrink-0">Cost per box</span>
                                  {costInput(r, 'h-11 flex-1', true)}
                                </label>
                              )}
                            </>
                          )}
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
    </div>
  );
}
