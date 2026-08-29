import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PackagePlus, SlidersHorizontal, Boxes, Warehouse, Truck } from 'lucide-react';
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
          {/* The page opened straight into a wall of cards with no total
              anywhere. Four figures first: what it is worth, how much of it
              there is, and how many lines need attention. */}
          {(() => {
            const totalValue = rows.reduce((a, r) => a + (r.value || 0), 0);
            const totalBoxes = rows.reduce((a, r) => a + (r.totalBase || 0), 0);
            const lowCount = rows.filter((r) => r.lowStock && r.totalBase > 0).length;
            const outCount = rows.filter((r) => (r.totalBase || 0) <= 0).length;
            const cells = [
              { label: 'Stock value', value: formatCurrency(totalValue), sub: `${rows.length} product${rows.length !== 1 ? 's' : ''} on this page`, tone: 'text-foreground' },
              { label: 'Boxes on hand', value: formatNumber(totalBoxes), sub: 'across every location', tone: 'text-foreground' },
              { label: 'Running low', value: formatNumber(lowCount), sub: lowCount ? 'reorder before they go' : 'nothing to reorder', tone: lowCount ? 'text-amber-300' : 'text-muted' },
              { label: 'Out of stock', value: formatNumber(outCount), sub: outCount ? 'nothing left to sell' : 'all lines in stock', tone: outCount ? 'text-rose-400' : 'text-muted' },
            ];
            return (
              <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] lg:grid-cols-4">
                {cells.map((c) => (
                  <div key={c.label} className="flex items-baseline justify-between gap-3 bg-surface px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{c.label}</p>
                      <p className="truncate text-[11px] text-faint">{c.sub}</p>
                    </div>
                    <p className={`shrink-0 text-base font-bold tabular-nums ${c.tone}`}>{c.value}</p>
                  </div>
                ))}
              </div>
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
              const withReps = Math.max(0, r.totalBase - inWarehouse);
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

                  <div className="mt-2.5 flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1 text-brand-400">
                      <Warehouse className="h-3 w-3" /> {formatNumber(inWarehouse)} in store
                    </span>
                    <span className="inline-flex items-center gap-1 text-violet-400">
                      <Truck className="h-3 w-3" /> {formatNumber(withReps)} with reps
                    </span>
                  </div>

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
