import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PackagePlus, SlidersHorizontal, Boxes, Warehouse, Truck, TrendingDown, PackageX } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts, useWarehouses, useSalesReps, useDebounce } from '@/lib/hooks';
import { formatCurrency, formatNumber, formatDateTime, pluralizeUnit } from '@/lib/format';
import { sortByCanonical } from '@/lib/productOrder';
import { MOVEMENT_META } from '@/lib/constants';
import ItemLines from '@/components/ItemLines';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Input, Textarea,
  SearchInput, Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function ReceiveModal({ onClose }) {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () => api.post('/inventory/stock-in', {
      warehouseId,
      items: items.filter((l) => l.productId && l.quantity > 0).map((l) => ({ productId: l.productId, packagingUnitId: l.packagingUnitId, quantity: Number(l.quantity) })),
      notes: notes || undefined,
    }),
    onSuccess: () => { toast.success('Stock received'); qc.invalidateQueries({ queryKey: ['inventory'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal open onClose={onClose} size="lg" title="Receive stock"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!warehouseId || !items.some((l) => l.productId && l.quantity > 0)} onClick={() => save.mutate()}>Receive</Button></>}>
      <div className="space-y-4">
        <Field label="Into warehouse" required>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <ItemLines products={products} value={items} onChange={setItems} />
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ mode, onClose }) {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: reps = [] } = useSalesReps();
  const [source, setSource] = useState('');
  const [productId, setProductId] = useState('');
  const [packagingUnitId, setPackagingUnitId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [direction, setDirection] = useState('DECREASE');
  const [reason, setReason] = useState('');

  const product = products.find((p) => p.id === productId);
  const packagings = (product?.packagings || []).slice().sort((a, b) => a.baseQuantity - b.baseQuantity);

  const buildLocation = () => {
    if (source.startsWith('w:')) return { type: 'WAREHOUSE', warehouseId: source.slice(2) };
    if (source.startsWith('r:')) return { type: 'SALES_REP', salesRepId: source.slice(2) };
    return null;
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { location: buildLocation(), productId, packagingUnitId, quantity: Number(quantity), reason };
      if (mode === 'adjust') return api.post('/inventory/adjustments', { ...body, direction });
      return api.post('/inventory/damage', body);
    },
    onSuccess: () => { toast.success(mode === 'adjust' ? 'Adjustment posted' : 'Damage recorded'); qc.invalidateQueries({ queryKey: ['inventory'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = source && productId && packagingUnitId && quantity > 0 && reason.trim();

  return (
    <Modal open onClose={onClose} title={mode === 'adjust' ? 'Stock adjustment' : 'Record damage'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{mode === 'adjust' ? 'Post adjustment' : 'Record damage'}</Button></>}>
      <div className="space-y-4">
        <Field label="Location" required>
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Select…</option>
            <optgroup label="Warehouses">{warehouses.map((w) => <option key={w.id} value={`w:${w.id}`}>{w.name}</option>)}</optgroup>
            <optgroup label="Sales reps">{reps.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.user?.name} ({r.code})</option>)}</optgroup>
          </Select>
        </Field>
        <Field label="Product" required>
          <Select value={productId} onChange={(e) => { setProductId(e.target.value); const p = products.find((x) => x.id === e.target.value); const b = p?.packagings?.find((k) => k.isBaseUnit) || p?.packagings?.[0]; setPackagingUnitId(b?.packagingUnitId || ''); }}>
            <option value="">Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Packaging">
            <Select value={packagingUnitId} onChange={(e) => setPackagingUnitId(e.target.value)} disabled={!product}>
              {packagings.map((pk) => <option key={pk.id} value={pk.packagingUnitId}>{pk.packagingUnit.name} (×{pk.baseQuantity})</option>)}
            </Select>
          </Field>
          <Field label="Quantity"><Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        </div>
        {mode === 'adjust' && (
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="DECREASE">Decrease (remove)</option><option value="INCREASE">Increase (add)</option>
            </Select>
          </Field>
        )}
        <Field label="Reason" required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const BRAND_CHIP = {
  OHIS: 'bg-emerald-100 text-emerald-700',
  CIVLILY: 'bg-violet-100 text-violet-700',
};

function Balances() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const debounced = useDebounce(search);
  const { data: brands = [] } = useQuery({
    queryKey: ['brands', 'all'],
    queryFn: async () => unwrap(await api.get('/brands', { params: { limit: 50 } })).data,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'balances', { page, search: debounced, brand }],
    queryFn: async () => unwrap(await api.get('/inventory/balances', { params: { page, limit: 24, search: debounced, brand: brand || undefined } })),
  });

  const rows = sortByCanonical(data?.data || []);
  const max = Math.max(1, ...rows.map((r) => r.totalBase));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="max-w-sm flex-1"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search product…" /></div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => { setBrand(''); setPage(1); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${brand === '' ? 'bg-brand-500 text-slate-950' : 'border border-border text-muted hover:bg-elevated'}`}>All brands</button>
          {brands.map((b) => (
            <button key={b.id} onClick={() => { setBrand(b.name); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${brand === b.name ? 'bg-brand-500 text-slate-950' : 'border border-border text-muted hover:bg-elevated'}`}>{b.name}</button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <Card><PageSpinner /></Card>
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
                icon: Boxes, ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.14]', chip: 'bg-brand-500/15 text-brand-400', num: 'text-foreground' },
              { label: 'Boxes on hand', value: formatNumber(sm.totalBoxes), sub: 'everywhere in the business',
                icon: Warehouse, ring: 'ring-sky-500/25', glow: 'from-sky-500/[0.14]', chip: 'bg-sky-500/15 text-sky-400', num: 'text-foreground' },
              { label: 'Running low', value: formatNumber(sm.lowCount), sub: sm.lowCount ? 'reorder before they go' : 'nothing to reorder',
                icon: TrendingDown, ring: sm.lowCount ? 'ring-amber-500/30' : 'ring-white/[0.07]', glow: sm.lowCount ? 'from-amber-500/[0.16]' : 'from-white/[0.02]',
                chip: 'bg-amber-500/15 text-amber-400', num: sm.lowCount ? 'text-amber-300' : 'text-muted' },
              { label: 'Out of stock', value: formatNumber(sm.outCount), sub: sm.outCount ? 'nothing left to sell' : 'every line in stock',
                icon: PackageX, ring: sm.outCount ? 'ring-rose-500/30' : 'ring-white/[0.07]', glow: sm.outCount ? 'from-rose-500/[0.16]' : 'from-white/[0.02]',
                chip: 'bg-rose-500/15 text-rose-400', num: sm.outCount ? 'text-rose-400' : 'text-muted' },
            ];

            return (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {cards.map((c) => (
                    <div key={c.label} className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${c.ring}`}>
                      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent`} aria-hidden="true" />
                      <div className="relative flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-muted">{c.label}</p>
                        <span className={`rounded-lg p-1.5 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
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
                        {[
                          { label: 'In the store', value: sm.warehouseBoxes, colour: 'bg-brand-400' },
                          { label: 'Out with the reps', value: sm.repBoxes, colour: 'bg-violet-400' },
                        ].map((r) => (
                          <div key={r.label} className="flex items-center gap-3">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${r.colour}`} />
                            <span className="flex-1 text-sm text-muted">{r.label}</span>
                            <span className="text-sm font-bold tabular-nums text-foreground">{formatNumber(r.value)}</span>
                            <span className="w-10 text-right text-xs tabular-nums text-faint">
                              {sm.totalBoxes > 0 ? Math.round((r.value / sm.totalBoxes) * 100) : 0}%
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
                                  ? <Warehouse className="h-3.5 w-3.5 shrink-0 text-brand-400" />
                                  : <Truck className="h-3.5 w-3.5 shrink-0 text-violet-400" />}
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{h.name}</span>
                                <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatNumber(h.boxes)}</span>
                                <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-faint">{formatCurrency(h.value)}</span>
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
                <div
                  key={r.productId}
                  className="animate-rise flex h-full flex-col rounded-2xl border border-white/[0.07] bg-surface p-4 transition duration-200 hover:border-white/15"
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
                      <div className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(r.value)}</div>
                      <div className="text-[11px] text-faint">{formatCurrency(r.sellingPrice)} each</div>
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
                                  ? <Warehouse className="h-3 w-3 shrink-0 text-brand-400" />
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
                          <div className="pt-0.5 text-[10px] text-faint">
                            {rest > 0 ? `+${rest} more · ` : ''}{r.locations.length} place{r.locations.length !== 1 ? 's' : ''}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
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
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'movements', { page, type }],
    queryFn: async () => unwrap(await api.get('/inventory/movements', { params: { page, limit: 20, type: type || undefined } })),
  });
  return (
    <Card>
      <div className="border-b border-border p-4">
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="sm:w-56">
          <option value="">All movement types</option>
          {Object.entries(MOVEMENT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {isLoading ? <PageSpinner /> : !data?.data?.length ? <EmptyState title="No movements" /> : (
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

export default function Inventory() {
  const [tab, setTab] = useState('balances');
  const [modal, setModal] = useState(null); // 'receive' | 'adjust' | 'damage'

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Live balances and the full movement ledger.">
        <Button variant="secondary" onClick={() => setModal('damage')}>Record damage</Button>
        <Button variant="secondary" onClick={() => setModal('adjust')}><SlidersHorizontal className="h-4 w-4" /> Adjust</Button>
        <Button onClick={() => setModal('receive')}><PackagePlus className="h-4 w-4" /> Receive stock</Button>
      </PageHeader>

      <div className="mb-4 flex gap-2">
        {[['balances', 'Stock balances'], ['movements', 'Movement ledger']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === k ? 'bg-brand-600 text-slate-950' : 'bg-surface text-muted hover:bg-elevated'}`}>{label}</button>
        ))}
      </div>

      {tab === 'balances' ? <Balances /> : <Movements />}

      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)} />}
      {modal === 'adjust' && <AdjustModal mode="adjust" onClose={() => setModal(null)} />}
      {modal === 'damage' && <AdjustModal mode="damage" onClose={() => setModal(null)} />}
    </div>
  );
}
