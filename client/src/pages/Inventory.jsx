import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { lazyPart, warmPart, PageLoadBoundary } from '@/components/LazyPage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PackagePlus, SlidersHorizontal, Boxes, Warehouse, Truck, TrendingDown, PackageX } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { useProducts, useWarehouses, useSalesReps, useDebounce } from '@/lib/hooks';
import { formatCurrency, formatNumber, formatDateTime, pluralizeUnit, sharePercents } from '@/lib/format';
import { sortByCanonical } from '@/lib/productOrder';
import { MOVEMENT_META } from '@/lib/constants';
import ProductPicker, {
  useHomeWarehouse, useStockAt, saveStockWarehouse, PlaceLine, Chips, Caution, Segmented, ReasonField, MoreToggle, DiscardFooter,
  REP_WARNING, changeBtn,
} from '@/components/ProductPicker';
import { pickerRows, pickedItems, pickedBoxes, shortPlace, buttonPlace, boxWord, ADJUST_REASONS, DAMAGE_REASONS } from '@/lib/stockPick';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Textarea,
  SearchInput, Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

// Receive stock, Adjust and Record damage — the quick way (Nino, 11 Nov 2026: "make it for me to just pick
// and add the quantity"). The warehouse is already chosen (the Dar es Salaam one, or the one this device last
// used) on one quiet line with Change; every product is listed with a  −  qty  +  in its box, as ItemLines
// chose it. The requests are the old ones, field for field.
function ReceiveModal({ onClose }) {
  const qc = useQueryClient();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
  const { active, home, usual } = useHomeWarehouse(warehouses);
  const [picked, setPicked] = useState(''); // '' = the home warehouse
  const [editPlace, setEditPlace] = useState(false);
  const [qty, setQty] = useState({});
  const [notes, setNotes] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sending = useRef(false);

  const warehouse = active.find((w) => w.id === picked) || home;
  const warehouseId = warehouse?.id || '';
  const away = !!(warehouse && usual && warehouse.id !== usual.id);
  const stock = useStockAt(warehouseId ? { type: 'WAREHOUSE', id: warehouseId } : null);
  const rows = useMemo(() => pickerRows(products), [products]);
  const items = pickedItems(rows, qty);
  const boxes = pickedBoxes(rows, qty);

  const save = useMutation({
    mutationFn: () => api.post('/inventory/stock-in', {
      warehouseId,
      items,
      notes: notes || undefined,
    }),
    onSuccess: () => { saveStockWarehouse(warehouseId); toast.success('Stock received'); qc.invalidateQueries({ queryKey: ['inventory'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
    onSettled: () => { sending.current = false; },
  });

  const canSubmit = !!warehouseId && items.length > 0;
  const submit = () => {
    if (sending.current || save.isPending || !canSubmit) return;
    sending.current = true;
    save.mutate();
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (items.length === 0 || confirmDiscard) onClose(); else setConfirmDiscard(true);
  };
  const pick = (next) => { setQty(next); setConfirmDiscard(false); };

  return (
    <Modal open onClose={requestClose} size="lg" title="Receive stock"
      footer={confirmDiscard ? (
        <DiscardFooter what="delivery" detail={`${formatNumber(boxes)} ${boxWord(boxes)} picked will be lost.`} onDiscard={onClose} onKeep={() => setConfirmDiscard(false)} />
      ) : (
        <>
          <div className="mr-auto min-w-0 flex-1 basis-0 text-sm">
            {items.length === 0 ? <span className="text-muted">Tap + on what arrived</span> : (
              <div className="truncate text-muted">{items.length} {items.length === 1 ? 'product' : 'products'}</div>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button data-picker-submit="" className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={save.isPending} disabled={!canSubmit} onClick={submit}>
            {items.length && warehouse ? `Receive ${formatNumber(boxes)} ${boxWord(boxes)} into ${buttonPlace(warehouse.name)}` : 'Receive stock'}
          </Button>
        </>
      )}>
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        <PlaceLine
          parts={[{ label: 'Into warehouse', kind: 'warehouse', name: warehouse ? warehouse.name : warehousesLoading ? '…' : 'No active warehouse', sub: warehouse?.region, amber: away, empty: !warehouse }]}
          open={editPlace}
          onToggle={active.length > 1 ? () => setEditPlace((x) => !x) : undefined}
          note={away && <Caution action={<button type="button" onClick={() => setPicked(usual.id)} className={changeBtn}>Use {usual.name}</button>}>Not the usual warehouse.</Caution>}
        >
          <Chips label="Into warehouse" value={warehouseId} onChange={(id) => { setPicked(id); setEditPlace(false); }}
            options={active.map((w) => ({ value: w.id, label: w.name, sub: w.region }))} />
        </PlaceLine>

        <ProductPicker rows={rows} value={qty} onChange={pick} stock={warehouseId ? stock : null}
          placeName={warehouse ? shortPlace(warehouse.name) : 'here'} loading={productsLoading} emptyText="No products yet." />

        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Modal>
  );
}

// One product per request (the server takes one): tap the product, then how many. A rep's stock is never
// chosen for you — it sits behind Change → "A rep's stock", with the warning that his order does not move.
function AdjustModal({ mode, onClose }) {
  const isAdjust = mode === 'adjust';
  const qc = useQueryClient();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
  const { data: reps = [] } = useSalesReps();
  const { active, home, usual } = useHomeWarehouse(warehouses);
  const [place, setPlace] = useState(null); // null = the home warehouse; else { type, id }
  const [editPlace, setEditPlace] = useState(false);
  const [showReps, setShowReps] = useState(false);
  const [direction, setDirection] = useState('DECREASE');
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sending = useRef(false);

  const loc = place || (home ? { type: 'WAREHOUSE', id: home.id } : null);
  const warehouse = loc?.type === 'WAREHOUSE' ? active.find((w) => w.id === loc.id) : null;
  const rep = loc?.type === 'SALES_REP' ? reps.find((r) => r.id === loc.id) : null;
  const away = !!(warehouse && usual && warehouse.id !== usual.id);
  const placeName = warehouse ? shortPlace(warehouse.name) : rep ? (rep.user?.name || rep.code) : '';
  const btnPlace = warehouse ? buttonPlace(warehouse.name) : placeName;
  const removing = !isAdjust || direction === 'DECREASE';
  const stock = useStockAt(loc);
  const rows = useMemo(() => pickerRows(products), [products]);
  const key = Object.keys(qty)[0];
  const row = rows.find((r) => r.key === key) || null;
  const quantity = row ? Number(qty[row.key]) || 0 : 0;
  const here = row && stock.ready ? Math.floor((stock.map.get(row.id) || 0) / (row.size || 1)) : null;
  // Never more out than is there — the server refuses it too.
  const overStock = removing && !!row && (!stock.ready || quantity > here);

  const buildLocation = () => {
    if (loc?.type === 'WAREHOUSE') return { type: 'WAREHOUSE', warehouseId: loc.id };
    if (loc?.type === 'SALES_REP') return { type: 'SALES_REP', salesRepId: loc.id };
    return null;
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { location: buildLocation(), productId: row.id, packagingUnitId: row.packagingUnitId, quantity: Number(quantity), reason };
      if (mode === 'adjust') return api.post('/inventory/adjustments', { ...body, direction });
      return api.post('/inventory/damage', body);
    },
    onSuccess: () => {
      if (loc?.type === 'WAREHOUSE') saveStockWarehouse(loc.id);
      toast.success(mode === 'adjust' ? 'Adjustment posted' : 'Damage recorded');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => { toast.error(apiError(e)); stock.refetch(); },
    onSettled: () => { sending.current = false; },
  });

  const valid = !!loc && !!row && quantity > 0 && !!reason.trim() && !overStock;
  const submit = () => {
    if (sending.current || save.isPending || !valid) return;
    sending.current = true;
    save.mutate();
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (!row || confirmDiscard) onClose(); else setConfirmDiscard(true);
  };
  const pick = (next) => { setQty(next); setConfirmDiscard(false); };
  const choosePlace = (next) => { setPlace(next); setEditPlace(false); };

  const n = formatNumber(quantity);
  const what = `${n} ${boxWord(quantity)}`;
  const action = !row
    ? (isAdjust ? 'Post adjustment' : 'Record damage')
    : quantity <= 0 ? 'Type how many'
    : !isAdjust ? `Remove ${n} damaged ${boxWord(quantity)} from ${btnPlace}`
      : removing ? `Remove ${what} from ${btnPlace}` : `Add ${what} to ${btnPlace}`;
  const after = row && here != null ? (removing ? here - quantity : here + quantity) : null;

  return (
    <Modal open onClose={requestClose} size="lg" title={isAdjust ? 'Stock adjustment' : 'Record damage'}
      footer={confirmDiscard ? (
        <DiscardFooter what={isAdjust ? 'adjustment' : 'damage record'} detail={row ? `${row.short}: ${what} picked will be lost.` : undefined}
          onDiscard={onClose} onKeep={() => setConfirmDiscard(false)} />
      ) : (
        <>
          <div className="mr-auto min-w-0 flex-1 basis-0 text-sm">
            {!row ? <span className="text-muted">Tap the product</span> : (
              <>
                <div className="truncate text-muted">
                  <span className="font-medium text-foreground">{row.short}</span>
                  {after != null && <> · {formatNumber(here)} → <span className="font-semibold tabular-nums text-foreground">{formatNumber(after)}</span> at {btnPlace}</>}
                </div>
                {!reason.trim() && <div className="text-xs text-amber-300">Pick or write a reason</div>}
              </>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button data-picker-submit="" className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={save.isPending} disabled={!valid} onClick={submit}>
            {action}
          </Button>
        </>
      )}>
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        <PlaceLine
          parts={[rep
            ? { label: "Rep's stock", kind: 'rep', name: rep.user?.name || rep.code, sub: rep.code, amber: true }
            : { label: 'Warehouse', kind: 'warehouse', name: warehouse ? warehouse.name : warehousesLoading ? '…' : 'No active warehouse', sub: warehouse?.region, amber: away, empty: !warehouse }]}
          open={editPlace}
          onToggle={() => { setEditPlace((x) => !x); setShowReps(!!rep); }}
          note={rep
            ? <Caution>{removing ? REP_WARNING : 'This does not change his open orders.'}</Caution>
            : away && <Caution action={<button type="button" onClick={() => setPlace({ type: 'WAREHOUSE', id: usual.id })} className={changeBtn}>Use {usual.name}</button>}>Not the usual warehouse.</Caution>}
        >
          <Chips label="Warehouse" value={warehouse?.id || ''} onChange={(id) => choosePlace({ type: 'WAREHOUSE', id })}
            options={active.map((w) => ({ value: w.id, label: w.name, sub: w.region }))} />
          <div className="border-t border-white/[0.07] pt-2">
            <MoreToggle open={showReps} onToggle={() => setShowReps((x) => !x)}>A rep&apos;s stock</MoreToggle>
            {showReps && (
              <div className="mt-2 space-y-2">
                <Caution>{REP_WARNING}</Caution>
                <Chips label="Rep" value={rep?.id || ''} onChange={(id) => choosePlace({ type: 'SALES_REP', id })}
                  options={reps.map((r) => ({ value: r.id, label: r.user?.name || r.code, sub: r.code }))} empty="No active reps" />
              </div>
            )}
          </div>
        </PlaceLine>

        {isAdjust && (
          <Segmented label="Direction" value={direction} onChange={setDirection}
            options={[{ value: 'DECREASE', label: 'Remove boxes' }, { value: 'INCREASE', label: 'Add boxes' }]} />
        )}

        <ProductPicker rows={rows} value={qty} onChange={pick} single cap={removing} stock={loc ? stock : null}
          onlyHeld={!!rep && removing} placeName={placeName || 'here'} loading={productsLoading} emptyText="No products yet." />

        <ReasonField value={reason} onChange={setReason} chips={isAdjust ? ADJUST_REASONS : DAMAGE_REASONS} />
      </div>
    </Modal>
  );
}

const BRAND_CHIP = {
  OHIS: 'bg-emerald-500/15 text-emerald-300',
  CIVLILY: 'bg-violet-500/15 text-violet-300',
};

function Balances() {
  // The product the owner opened up: every location and its whole movement
  // history. The cards can only ever show three places.
  const [openProduct, setOpenProduct] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const debounced = useDebounce(search);
  const { data: brands = [] } = useQuery(pageQueries.brandsAll());
  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.inventoryBalances({ page, search: debounced, brand }),
    placeholderData: keepOnPageTurn({ brand }),
  });

  const rows = sortByCanonical(data?.data || []);
  const max = Math.max(1, ...rows.map((r) => r.totalBase));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="max-w-sm flex-1"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search product…" /></div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => { setBrand(''); setPage(1); }}
            className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${brand === '' ? 'bg-brand-500/15 text-brand-600 ring-brand-500/30' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>All brands</button>
          {brands.map((b) => (
            <button key={b.id} onClick={() => { setBrand(b.name); setPage(1); }}
              className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${brand === b.name ? 'bg-brand-500/15 text-brand-600 ring-brand-500/30' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{b.name}</button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <Card><PageSpinner /></Card>
      ) : isError && !data ? (
        <Card><LoadError what="the stock" onRetry={refetch} /></Card>
      ) : !rows.length ? (
        <Card><EmptyState title="No stock on hand" message="Receive stock to get started." icon={Boxes} /></Card>
      ) : (
        <>
          {(() => {
            const sm = data.meta?.summary;
            if (!sm) return null;
            const whPct = sm.totalBoxes > 0 ? (sm.warehouseBoxes / sm.totalBoxes) * 100 : 0;

            // Four tinted cards. A flat grey row of numbers reads as a footnote;
            // a tint and an icon per card gives each figure its own identity and
            // lets the eye go straight to the one that is a problem.
            const cards = [
              { label: 'Stock value', value: formatCurrency(sm.totalValue), sub: `${formatNumber(sm.productCount)} products`,
                icon: Boxes, ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.14]', chip: 'bg-brand-500/15 text-brand-600', num: 'text-foreground' },
              { label: 'Boxes on hand', value: formatNumber(sm.totalBoxes), sub: 'everywhere in the business',
                icon: Warehouse, ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.14]', chip: 'bg-sky-500/15 text-sky-400', num: 'text-foreground' },
              { label: 'Running low', value: formatNumber(sm.lowCount), sub: sm.lowCount ? 'reorder before they go' : 'nothing to reorder',
                icon: TrendingDown, ring: sm.lowCount ? 'ring-amber-500/30' : 'ring-white/[0.07]', glow: sm.lowCount ? 'from-amber-500/[0.16]' : 'from-white/[0.02]',
                chip: 'bg-amber-500/15 text-amber-400', num: sm.lowCount ? 'text-amber-300' : 'text-muted' },
              { label: 'Out of stock', value: formatNumber(sm.outCount), sub: sm.outCount ? 'nothing left to sell' : 'every line in stock',
                icon: PackageX, ring: sm.outCount ? 'ring-rose-500/30' : 'ring-white/[0.07]', glow: sm.outCount ? 'from-rose-500/[0.16]' : 'from-white/[0.02]',
                chip: 'bg-rose-500/15 text-rose-400', num: sm.outCount ? 'text-rose-400' : 'text-muted', tone: sm.outCount ? 'late' : undefined },
            ];

            return (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {cards.map((c) => (
                    <div key={c.label} className="stat-glass p-4" data-tone={c.tone}>
                      <div className="relative flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-muted">{c.label}</p>
                        <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
                      </div>
                      <p className={`relative mt-2 text-2xl font-bold tabular-nums ${c.num}`}>{c.value}</p>
                      <p className="relative mt-0.5 text-[11px] text-faint">{c.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Who is holding the stock, across every product — the question
                    that per-product chips could never answer, because it is a
                    question about people, not about products. */}
                <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card>
                    <div className="p-5">
                      <h3 className="text-sm font-semibold text-foreground">Where every box is</h3>
                      <p className="mt-0.5 text-xs text-muted">Mutually exclusive, and they add up to everything.</p>
                      <p className="mt-4 text-4xl font-bold leading-none tabular-nums text-foreground">
                        {formatNumber(sm.totalBoxes)}
                        <span className="ml-2 text-sm font-normal text-muted">boxes in the business</span>
                      </p>
                      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${whPct}%` }} />
                        <div className="h-full bg-violet-500/80" style={{ width: `${100 - whPct}%` }} />
                      </div>
                      <div className="mt-4 space-y-2.5">
                        {(() => {
                          const shares = sharePercents([sm.warehouseBoxes, sm.repBoxes], sm.totalBoxes);
                          return [
                            { label: 'In the store', value: sm.warehouseBoxes, share: shares[0], colour: 'bg-brand-400' },
                            { label: 'Out with the reps', value: sm.repBoxes, share: shares[1], colour: 'bg-violet-400' },
                          ];
                        })().map((r) => (
                          <div key={r.label} className="flex items-center gap-3">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${r.colour}`} />
                            <span className="flex-1 text-sm text-muted">{r.label}</span>
                            <span className="text-sm font-bold tabular-nums text-foreground">{formatNumber(r.value)}</span>
                            <span className="w-10 text-right text-xs tabular-nums text-faint">
                              {r.share}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <div className="p-5">
                      <h3 className="text-sm font-semibold text-foreground">Who is holding it</h3>
                      <p className="mt-0.5 text-xs text-muted">Every location and rep, biggest first.</p>
                      <div className="mt-4 max-h-[228px] space-y-2.5 overflow-y-auto pr-1">
                        {sm.holders.map((h) => {
                          const pct = sm.totalBoxes > 0 ? (h.boxes / sm.totalBoxes) * 100 : 0;
                          const isStore = h.type === 'WAREHOUSE';
                          return (
                            <div key={`${h.type}:${h.id}`}>
                              <div className="flex items-center gap-2">
                                {isStore
                                  ? <Warehouse className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                                  : <Truck className="h-3.5 w-3.5 shrink-0 text-violet-400" />}
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h.name}</span>
                                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatNumber(h.boxes)}</span>
                                <span className="min-w-[6rem] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-faint">{formatCurrency(h.value)}</span>
                              </div>
                              <div className="mt-1 ml-5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                                <div className={`h-full rounded-full ${isStore ? 'bg-brand-500' : 'bg-violet-500'}`}
                                  style={{ width: `${Math.max(2, pct)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Card>
                </div>
              </>
            );
          })()}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((r, i) => {
              // Where the stock sits, as two numbers rather than a row of chips.
              // The chips wrapped to a different number of lines on every card,
              // which is what made the grid ragged — and a reader cannot hold
              // five names and five counts anyway. Warehouse against out-with-
              // reps is the split that actually decides anything.
              const inWarehouse = r.locations.filter((l) => l.type === 'WAREHOUSE').reduce((a, l) => a + l.baseQuantity, 0);
              const whPct = r.totalBase > 0 ? (inWarehouse / r.totalBase) * 100 : 0;
              const out = r.totalBase <= 0;
              const status = out ? 'Out' : r.lowStock ? 'Low' : 'OK';
              const STATUS = {
                Out: 'bg-rose-500/15 text-rose-400 ring-rose-500/25',
                Low: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
                OK: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
              };
              return (
                <button
                  key={r.productId}
                  type="button"
                  onClick={() => setOpenProduct(r)}
                  title="Open this product — every place it is, and its movement"
                  className="active-card animate-rise flex h-full cursor-pointer flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  {/* Brand and code first and small; the name is the heading. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {r.brandName && (
                        <Badge className={BRAND_CHIP[r.brandName?.toUpperCase()] || 'bg-elevated text-muted'}>{r.brandName}</Badge>
                      )}
                      <span className="truncate text-[11px] text-faint">{r.sku}</span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${STATUS[status]}`}>
                      {status}
                    </span>
                  </div>

                  {/* Two fixed lines, so a long name never changes the card's height. */}
                  <h3 className="mt-2 line-clamp-2 h-[2.5rem] text-sm font-semibold leading-tight text-foreground">
                    {r.name}
                  </h3>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <div className={`text-3xl font-bold leading-none tabular-nums ${out ? 'text-rose-400' : r.lowStock ? 'text-amber-300' : 'text-foreground'}`}>
                        {formatNumber(r.totalBase)}
                      </div>
                      <div className="mt-1 text-[11px] text-faint">{pluralizeUnit(r.baseUnitName)} on hand</div>
                    </div>
                    <div className="text-right">
                      {/* The value is at COST (boxes x purchase price); the line under it is the selling
                          price, so it says so instead of "each" (63 x 30,000 is not 882,000). */}
                      <div className="text-sm font-bold tabular-nums text-foreground" title="Value at cost">{formatCurrency(r.value)}</div>
                      <div className="text-[11px] text-faint">at cost · sells at {formatCurrency(r.sellingPrice)}</div>
                    </div>
                  </div>

                  {/* One bar, split where the stock is: filled part is in the
                      warehouse, the rest is out with the reps. */}
                  <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${whPct}%` }} />
                    <div className="h-full bg-violet-500/70" style={{ width: `${100 - whPct}%` }} />
                  </div>

                  {/* No "in store / with reps" line here: the warehouse is the
                      first row of the list below and states the same number, so
                      the summary printed every count twice. The bar already
                      carries the split. */}
                  {/* Who is holding it. Removing this to make the cards line up
                      threw away the answer to "which rep has my stock" — so it
                      is back, as a fixed three rows rather than a wrapping row
                      of chips. Three rows always, padded when there are fewer,
                      so every card still ends at the same height. */}
                  <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-2.5">
                    {(() => {
                      const sorted = [...r.locations].sort((a, b) => {
                        if ((a.type === 'WAREHOUSE') !== (b.type === 'WAREHOUSE')) return a.type === 'WAREHOUSE' ? -1 : 1;
                        return b.baseQuantity - a.baseQuantity;
                      });
                      const top = sorted.slice(0, 3);
                      const rest = sorted.length - top.length;
                      const pad = Math.max(0, 3 - top.length);
                      return (
                        <>
                          {top.map((loc, k) => (
                            <div key={k} className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {loc.type === 'WAREHOUSE'
                                  ? <Warehouse className="h-3 w-3 shrink-0 text-brand-600" />
                                  : <Truck className="h-3 w-3 shrink-0 text-violet-400" />}
                                <span className="truncate text-[11px] text-muted">{loc.name}</span>
                              </span>
                              <span className="shrink-0 text-[11px] font-bold tabular-nums text-foreground">
                                {formatNumber(loc.baseQuantity)}
                              </span>
                            </div>
                          ))}
                          {Array.from({ length: pad }).map((_, k) => (
                            <div key={`pad-${k}`} className="h-[17px]" aria-hidden="true" />
                          ))}
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[10px] text-faint">
                              {r.locations.length} place{r.locations.length !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[10px] font-semibold text-brand-500">
                              {rest > 0 ? `+${rest} more · see all` : 'see movement'}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </button>
              );
            })}
          </div>
          {openProduct && <ProductStockModal row={openProduct} onClose={() => setOpenProduct(null)} />}

          <div className="mt-4">
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}

function Movements() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory', 'movements', { page, type }],
    queryFn: async () => unwrap(await api.get('/inventory/movements', { params: { page, limit: 20, type: type || undefined } })),
    placeholderData: keepOnPageTurn({ type }),
  });
  return (
    <Card>
      <div className="border-b border-border p-4">
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="sm:w-56">
          <option value="">All movement types</option>
          {Object.entries(MOVEMENT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the movements" onRetry={refetch} /> : !data?.data?.length ? <EmptyState title="No movements" /> : (
        <>
          <Table>
            <THead><TR><TH>When</TH><TH>Type</TH><TH>Product</TH><TH>Qty</TH><TH>Base Δ</TH><TH>Location</TH><TH>By</TH></TR></THead>
            <TBody>
              {data.data.map((m) => {
                const meta = MOVEMENT_META[m.type] || { label: m.type, cls: 'bg-elevated' };
                return (
                  <TR key={m.id}>
                    <TD className="text-muted">{formatDateTime(m.occurredAt)}</TD>
                    <TD><Badge className={meta.cls}>{meta.label}</Badge></TD>
                    <TD className="max-w-[200px] truncate">{m.product?.name}</TD>
                    <TD>{m.quantity} {m.packagingUnit?.name}</TD>
                    <TD className={m.baseQuantity < 0 ? 'text-rose-600' : 'text-emerald-600'}>{m.baseQuantity > 0 ? '+' : ''}{formatNumber(m.baseQuantity)}</TD>
                    <TD>{m.locationType === 'WAREHOUSE' ? m.warehouse?.name : m.salesRep?.user?.name}</TD>
                    <TD>{m.user?.name || '—'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

// One product, opened up: every place its boxes are sitting right now, and
// every movement that put them there.
//
// The cards can only ever show three locations — "+2 more" was the answer to
// "which rep has my stock" being cut off mid-sentence. This is where the rest
// of it lives, so nobody has to go and cross-read the ledger filtered by hand.
function ProductStockModal({ row, onClose }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory', 'movements', { productId: row.productId, page }],
    queryFn: async () => unwrap(await api.get('/inventory/movements', {
      params: { productId: row.productId, page, limit: 15 },
    })),
    placeholderData: keepOnPageTurn({ productId: row.productId }),
  });

  const sorted = [...(row.locations || [])].sort((a, b) => {
    if ((a.type === 'WAREHOUSE') !== (b.type === 'WAREHOUSE')) return a.type === 'WAREHOUSE' ? -1 : 1;
    return b.baseQuantity - a.baseQuantity;
  });
  const unit = pluralizeUnit(row.baseUnitName);
  // The row carries its locations, not a ready-made split — same sum the card
  // draws its bar from.
  const inStore = sorted.filter((l) => l.type === 'WAREHOUSE').reduce((a, l) => a + l.baseQuantity, 0);
  const withReps = row.totalBase - inStore;

  return (
    <Modal open onClose={onClose} size="lg" title={row.name}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        {/* What it is worth and how it splits, before the detail. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-4">
          {[
            ['On hand', `${formatNumber(row.totalBase)} ${unit}`],
            ['In the store', formatNumber(inStore)],
            ['With reps', formatNumber(withReps)],
            ['Stock value', formatCurrency(row.value)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </div>

        {/* Every place, not the first three. */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Where these {unit} are · {sorted.length} place{sorted.length !== 1 ? 's' : ''}
          </h4>
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <div className="divide-y divide-white/[0.06]">
              {sorted.map((loc, i) => {
                const pct = row.totalBase > 0 ? Math.round((loc.baseQuantity / row.totalBase) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 bg-surface px-3 py-2">
                    {loc.type === 'WAREHOUSE'
                      ? <Warehouse className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                      : <Truck className="h-3.5 w-3.5 shrink-0 text-violet-400" />}
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{loc.name}</span>
                    <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.07] sm:block">
                      <span className={`block h-full rounded-full ${loc.type === 'WAREHOUSE' ? 'bg-brand-500' : 'bg-violet-500/80'}`}
                        style={{ width: `${Math.max(3, pct)}%` }} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-faint">{pct}%</span>
                    <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                      {formatNumber(loc.baseQuantity)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* And how they got there. */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Movement of these {unit}
            {data?.meta?.total != null && <span className="ml-1 font-normal text-faint">· {formatNumber(data.meta.total)} recorded</span>}
          </h4>
          {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="this product's movement" onRetry={refetch} /> : !data?.data?.length ? (
            <EmptyState title="No movement recorded for this product yet" icon={Boxes} />
          ) : (
            <>
              <Table>
                <THead><TR><TH>When</TH><TH>What happened</TH><TH className="text-right">Change</TH><TH>Where</TH><TH>By</TH></TR></THead>
                <TBody>
                  {data.data.map((m) => {
                    const meta = MOVEMENT_META[m.type] || { label: m.type, cls: 'bg-elevated' };
                    return (
                      <TR key={m.id}>
                        <TD className="whitespace-nowrap text-faint">{formatDateTime(m.occurredAt)}</TD>
                        <TD><Badge className={meta.cls}>{meta.label}</Badge></TD>
                        <TD className={`text-right font-semibold tabular-nums ${m.baseQuantity < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {m.baseQuantity > 0 ? '+' : ''}{formatNumber(m.baseQuantity)}
                        </TD>
                        <TD className="text-muted">
                          {m.locationType === 'WAREHOUSE' ? m.warehouse?.name : m.salesRep?.user?.name || '—'}
                        </TD>
                        <TD className="text-faint">{m.user?.name || '—'}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Transfers and Reorder live inside Inventory (Nino, 11 Nov 2026: "on Inventory we should see the other
// pages next to it — movement, stock transfer, reorder — and remove them from the sidebar; keep the sidebar
// clean"; "even PO … inside"). The tab is in the address (?tab=), so the old /purchases, /transfers and
// /reorder links land on it.
// Through the app's page loader (lib/pages.js), so a failed fetch-ahead never reloads the app (audit pwa-brand-load-3).
const Purchases = lazyPart('Purchases');
const Transfers = lazyPart('Transfers');
const Reorder = lazyPart('Reorder');
const INVENTORY_TABS = [['balances', 'Stock balances'], ['movements', 'Movement ledger'], ['purchases', 'Purchases'], ['transfers', 'Transfers'], ['reorder', 'Reorder']];
const INNER = { purchases: Purchases, transfers: Transfers, reorder: Reorder };

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = INVENTORY_TABS.some(([k]) => k === asked) ? asked : 'balances';
  const [modal, setModal] = useState(null); // 'receive' | 'adjust' | 'damage'

  // Fetch the inner pages' code while the owner reads the balances, so a tab click never waits for it.
  // Only ahead of the click: one that fails on a weak line is dropped, and the tab asks again when opened.
  useEffect(() => { warmPart('Purchases'); warmPart('Transfers'); warmPart('Reorder'); }, []);

  const tabs = (
    <div className="mb-5 flex flex-wrap gap-2">
      {INVENTORY_TABS.map(([k, label]) => (
        <button key={k} type="button" onClick={() => setParams(k === 'balances' ? {} : { tab: k }, { replace: true })}
          aria-current={tab === k ? 'page' : undefined}
          className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k ? 'bg-brand-500 text-white ring-brand-500' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
      ))}
    </div>
  );

  // The inner pages keep their own title and buttons (New PO, New transfer, the reorder list).
  const Inner = INNER[tab];
  if (Inner) {
    return (
      <div>
        {tabs}
        <PageLoadBoundary what="this tab" resetKey={tab}>
          <Suspense fallback={<PageSpinner />}><Inner /></Suspense>
        </PageLoadBoundary>
      </div>
    );
  }

  return (
    <div>
      {tabs}
      <PageHeader title="Inventory" subtitle="Live balances and the full movement ledger.">
        <Button variant="secondary" onClick={() => setModal('damage')}>Record damage</Button>
        <Button variant="secondary" onClick={() => setModal('adjust')}><SlidersHorizontal className="h-4 w-4" /> Adjust</Button>
        <Button onClick={() => setModal('receive')}><PackagePlus className="h-4 w-4" /> Receive stock</Button>
      </PageHeader>

      {tab === 'balances' ? <Balances /> : <Movements />}

      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)} />}
      {modal === 'adjust' && <AdjustModal mode="adjust" onClose={() => setModal(null)} />}
      {modal === 'damage' && <AdjustModal mode="damage" onClose={() => setModal(null)} />}
    </div>
  );
}
