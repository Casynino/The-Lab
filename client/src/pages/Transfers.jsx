import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Truck, Ban, ArrowRight, Boxes, Warehouse, UserRound, RotateCcw, ChevronDown } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts, useWarehouses, useSalesReps } from '@/lib/hooks';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import ItemLines from '@/components/ItemLines';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Select, Textarea,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

const DIR_LABEL = {
  WAREHOUSE_TO_REP: 'Warehouse → Rep',
  REP_TO_WAREHOUSE: 'Rep → Warehouse',
  WAREHOUSE_TO_WAREHOUSE: 'Warehouse → Warehouse',
};

function TransferModal({ onClose }) {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: reps = [] } = useSalesReps();

  const [direction, setDirection] = useState('WAREHOUSE_TO_REP');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toRepId, setToRepId] = useState('');
  const [fromRepId, setFromRepId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        direction,
        items: items.filter((l) => l.productId && l.quantity > 0).map((l) => ({ productId: l.productId, packagingUnitId: l.packagingUnitId, quantity: Number(l.quantity) })),
        notes: notes || undefined,
      };
      if (direction === 'WAREHOUSE_TO_REP') { payload.fromWarehouseId = fromWarehouseId; payload.toRepId = toRepId; }
      if (direction === 'REP_TO_WAREHOUSE') { payload.fromRepId = fromRepId; payload.toWarehouseId = toWarehouseId; }
      if (direction === 'WAREHOUSE_TO_WAREHOUSE') { payload.fromWarehouseId = fromWarehouseId; payload.toWarehouseId = toWarehouseId; }
      return api.post('/transfers', payload);
    },
    onSuccess: () => { toast.success('Transfer completed'); qc.invalidateQueries({ queryKey: ['transfers'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const needsFromWh = direction !== 'REP_TO_WAREHOUSE';
  const needsToWh = direction !== 'WAREHOUSE_TO_REP';
  const valid = items.some((l) => l.productId && l.quantity > 0) &&
    (direction === 'WAREHOUSE_TO_REP' ? fromWarehouseId && toRepId :
     direction === 'REP_TO_WAREHOUSE' ? fromRepId && toWarehouseId :
     fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId);

  return (
    <Modal open onClose={onClose} size="lg" title="New stock transfer"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>Dispatch</Button></>}>
      <div className="space-y-4">
        <Field label="Direction">
          <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
            {Object.entries(DIR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {needsFromWh && direction !== 'REP_TO_WAREHOUSE' && (
            <Field label="From warehouse" required>
              <Select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
                <option value="">Select…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          )}
          {direction === 'REP_TO_WAREHOUSE' && (
            <Field label="From rep" required>
              <Select value={fromRepId} onChange={(e) => setFromRepId(e.target.value)}>
                <option value="">Select…</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.user?.name} ({r.code})</option>)}
              </Select>
            </Field>
          )}
          {direction === 'WAREHOUSE_TO_REP' && (
            <Field label="To rep" required>
              <Select value={toRepId} onChange={(e) => setToRepId(e.target.value)}>
                <option value="">Select…</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.user?.name} ({r.code})</option>)}
              </Select>
            </Field>
          )}
          {needsToWh && (
            <Field label="To warehouse" required>
              <Select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">Select…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <ItemLines products={products} value={items} onChange={setItems} />
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// A transfer is a movement of stock. The page leads with how much moved and
// where it went, because "2 items" is a count of form rows, not of boxes.
const DIR_FILTERS = [
  { key: '', label: 'All movements' },
  { key: 'WAREHOUSE_TO_REP', label: 'Out to reps' },
  { key: 'REP_TO_WAREHOUSE', label: 'Back from reps' },
  { key: 'WAREHOUSE_TO_WAREHOUSE', label: 'Between stores' },
];

const DIR_TONE = {
  WAREHOUSE_TO_REP: { chip: 'bg-brand-500/15 text-brand-300', icon: UserRound },
  REP_TO_WAREHOUSE: { chip: 'bg-amber-500/15 text-amber-300', icon: RotateCcw },
  WAREHOUSE_TO_WAREHOUSE: { chip: 'bg-sky-500/15 text-sky-300', icon: Warehouse },
};

function TintCard({ label, value, sub, icon: Icon, ring, glow, chip, num }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ${ring}`}>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glow} to-transparent`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={`rounded-lg p-1.5 ${chip}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <p className={`relative mt-2 text-2xl font-bold tabular-nums ${num}`}>{value}</p>
      <p className="relative mt-0.5 text-[11px] text-faint">{sub}</p>
    </div>
  );
}

export default function Transfers() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [expanded, setExpanded] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', { page, direction }],
    queryFn: async () => unwrap(await api.get('/transfers', { params: { page, limit: 15, direction: direction || undefined } })),
  });

  const cancel = useMutation({
    mutationFn: (id) => api.post(`/transfers/${id}/cancel`, {}),
    onSuccess: () => { toast.success('Transfer cancelled'); qc.invalidateQueries({ queryKey: ['transfers'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const sum = data?.meta?.summary;
  const rows = data?.data || [];
  const top = sum?.destinations?.[0];
  const period = sum?.firstAt
    ? `${formatDate(sum.firstAt)} → ${formatDate(sum.lastAt)}`
    : 'no movements yet';

  const from = (t) => t.direction === 'REP_TO_WAREHOUSE' ? t.fromRep?.user?.name : t.fromWarehouse?.name;
  const to = (t) => t.direction === 'WAREHOUSE_TO_REP' ? t.toRep?.user?.name : t.toWarehouse?.name;

  return (
    <div>
      <PageHeader title="Stock Transfers" subtitle="Every box that left one place and arrived at another.">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New transfer</Button>
      </PageHeader>

      {sum && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <TintCard label="Boxes moved" value={formatNumber(sum.boxes)} sub={period} icon={Boxes}
              ring="ring-violet-500/25" glow="from-violet-500/[0.14]" chip="bg-violet-500/15 text-violet-300" num="text-violet-300" />
            <TintCard label="Movements" value={formatNumber(sum.movements)} sub="completed transfers" icon={Truck}
              ring="ring-brand-500/25" glow="from-brand-500/[0.12]" chip="bg-brand-500/15 text-brand-300" num="text-brand-300" />
            <TintCard label="Took the most" value={top ? top.name : '—'}
              sub={top ? `${formatNumber(top.boxes)} boxes of the ${formatNumber(sum.boxes)}` : 'nothing dispatched'} icon={UserRound}
              ring="ring-emerald-500/25" glow="from-emerald-500/[0.12]" chip="bg-emerald-500/15 text-emerald-300" num="text-lg text-emerald-300" />
            <TintCard label="Reversed" value={formatNumber(sum.cancelled)} sub="cancelled, stock returned" icon={Ban}
              ring={sum.cancelled > 0 ? 'ring-rose-500/25' : 'ring-white/[0.07]'}
              glow={sum.cancelled > 0 ? 'from-rose-500/[0.12]' : 'from-white/[0.02]'}
              chip="bg-rose-500/15 text-rose-300" num={sum.cancelled > 0 ? 'text-rose-300' : 'text-foreground'} />
          </div>

          {/* Where the boxes actually went — the question a list of movements provokes. */}
          {sum.destinations?.length > 0 && (
            <div className="mb-4 rounded-2xl bg-surface p-5 ring-1 ring-white/[0.07]">
              <p className="text-sm font-semibold text-foreground">Where the boxes went</p>
              <p className="mt-0.5 text-xs text-faint">Share of the {formatNumber(sum.boxes)} boxes dispatched, biggest first.</p>
              <div className="mt-4 space-y-2.5">
                {sum.destinations.slice(0, 8).map((d, i) => {
                  const pct = sum.boxes > 0 ? (d.boxes / sum.boxes) * 100 : 0;
                  const tone = ['bg-brand-400', 'bg-violet-400', 'bg-sky-400', 'bg-amber-400', 'bg-emerald-400', 'bg-rose-400'][i % 6];
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-xs text-muted">{d.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
                        {formatNumber(d.boxes)} <span className="font-normal text-faint">· {Math.round(pct)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {DIR_FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => { setDirection(f.key); setPage(1); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
              direction === f.key
                ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30'
                : 'bg-surface text-muted ring-white/[0.07] hover:text-foreground'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? <PageSpinner /> : !rows.length ? (
          <EmptyState title="No transfers here" icon={Truck}
            message={direction ? 'Nothing moved this way yet.' : 'Move stock to a rep or another store to see it here.'}
            action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New transfer</Button>} />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Transfer</TH><TH>Route</TH><TH className="text-right">Boxes</TH><TH>Dispatched</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {rows.map((t) => {
                  const tone = DIR_TONE[t.direction] || DIR_TONE.WAREHOUSE_TO_WAREHOUSE;
                  const Icon = tone.icon;
                  const isOpen = expanded === t.id;
                  const dead = t.status === 'CANCELLED';
                  return (
                    <Fragment key={t.id}>
                      <TR className={dead ? 'opacity-60' : ''}>
                        <TD>
                          <button onClick={() => setExpanded(isOpen ? null : t.id)} className="flex items-center gap-1.5 font-medium text-foreground hover:text-brand-300">
                            <ChevronDown className={`h-3.5 w-3.5 text-faint transition ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
                            {t.transferNumber}
                          </button>
                        </TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-md p-1 ${tone.chip}`}><Icon className="h-3 w-3" /></span>
                            <span className="text-muted">{from(t)}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-faint" />
                            <span className="font-medium text-foreground">{to(t)}</span>
                          </div>
                        </TD>
                        <TD className="text-right">
                          <span className={`font-semibold tabular-nums ${dead ? 'text-faint line-through' : 'text-foreground'}`}>
                            {formatNumber(t.boxes || 0)}
                          </span>
                          <span className="ml-1 text-[11px] text-faint">{t.items.length} line{t.items.length === 1 ? '' : 's'}</span>
                        </TD>
                        <TD className="text-faint">{formatDate(t.dispatchedAt)}</TD>
                        <TD>
                          <Badge className={dead ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}>
                            {dead ? 'Reversed' : 'Delivered'}
                          </Badge>
                        </TD>
                        <TD>{!dead && (
                          <button className="btn-ghost px-2 py-1 text-rose-400" title="Cancel & return the stock"
                            onClick={() => { if (confirm(`Cancel ${t.transferNumber}? All ${t.boxes} boxes go back to ${from(t)}.`)) cancel.mutate(t.id); }}>
                            <Ban className="h-4 w-4" />
                          </button>
                        )}</TD>
                      </TR>
                      {isOpen && (
                        <TR>
                          <TD colSpan={6} className="bg-elevated/40">
                            <div className="px-2 py-1">
                              <p className="mb-2 text-xs font-medium text-muted">
                                What moved · dispatched {formatDateTime(t.dispatchedAt)}
                                {t.dispatchedBy?.name ? ` by ${t.dispatchedBy.name}` : ''}
                              </p>
                              <div className="space-y-1.5">
                                {t.items.map((it) => (
                                  <div key={it.id} className="flex items-baseline justify-between gap-3 text-sm">
                                    <span className="truncate text-foreground">{it.product?.name}</span>
                                    <span className="shrink-0 tabular-nums text-muted">
                                      {formatNumber(it.quantity)} {it.packagingUnit?.name || 'unit'}
                                      {/* Only worth spelling out when the unit is not already a box. */}
                                      {it.baseQuantity !== it.quantity && (
                                        <span className="ml-1.5 text-faint">= {formatNumber(it.baseQuantity)} boxes</span>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {t.notes && <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs text-faint">{t.notes}</p>}
                            </div>
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>
      {open && <TransferModal onClose={() => setOpen(false)} />}
    </div>
  );
}
