import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Truck, Ban, ArrowRight, Boxes, Warehouse, UserRound, RotateCcw, ChevronDown } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { keepOnPageTurn } from '@/lib/pageQueries';
import { useProducts, useWarehouses, useSalesReps } from '@/lib/hooks';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import ProductPicker, {
  useHomeWarehouse, useStockAt, saveStockWarehouse, PlaceLine, Chips, Caution, Segmented, MoreToggle, DiscardFooter,
  REP_WARNING, changeBtn,
} from '@/components/ProductPicker';
import { pickerRows, pickedItems, pickedBoxes, shortPlace, buttonPlace, boxWord } from '@/lib/stockPick';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Textarea,
  Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

// New transfer — the quick way. Out to a rep is the usual move, so it is chosen; the warehouse the boxes
// leave is already chosen (Dar es Salaam, or the one this device last used); every product is listed with
// a  −  qty  +  capped at what that place holds. Taking boxes back off a rep stays an explicit choice behind
// "Other moves": it does not touch his open order (audit #23) — a Return does. Once the rep (or the other
// warehouse) is tapped, the choice folds into one line "Main Warehouse → Mrema" with Change, so the list is
// what fills the screen. The request is the old one.
const DIRECTIONS = [
  { value: 'WAREHOUSE_TO_REP', label: 'To a rep' },
  { value: 'WAREHOUSE_TO_WAREHOUSE', label: 'To a warehouse' },
];
const BACK = { value: 'REP_TO_WAREHOUSE', label: 'Back from a rep' };

function TransferModal({ onClose }) {
  const qc = useQueryClient();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
  const { data: reps = [] } = useSalesReps();
  const { active, home, usual } = useHomeWarehouse(warehouses);

  const [direction, setDirection] = useState('WAREHOUSE_TO_REP');
  const [more, setMore] = useState(false);
  const [fromPick, setFromPick] = useState(''); // '' = the home warehouse
  const [editFrom, setEditFrom] = useState(false);
  const [editPlaces, setEditPlaces] = useState(false); // the folded "From → To" line, opened
  const [toRepId, setToRepId] = useState('');
  const [fromRepId, setFromRepId] = useState('');
  const [wwTo, setWwTo] = useState('');
  const [backPick, setBackPick] = useState(''); // '' = the home warehouse
  const [editBack, setEditBack] = useState(false);
  const [qty, setQty] = useState({});
  const [notes, setNotes] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sending = useRef(false);

  const fromRep = direction === 'REP_TO_WAREHOUSE';
  const fromWarehouse = active.find((w) => w.id === fromPick) || home;
  const fromWarehouseId = fromWarehouse?.id || '';
  const others = active.filter((w) => w.id !== fromWarehouseId);
  // Between warehouses: with one other warehouse, that is where they go.
  const wwTarget = others.find((w) => w.id === wwTo) || (others.length === 1 ? others[0] : null);
  const backWarehouse = active.find((w) => w.id === backPick) || home;
  const repOf = (id) => reps.find((r) => r.id === id);
  const repName = (id) => repOf(id)?.user?.name || repOf(id)?.code || '';

  const fromLoc = fromRep
    ? (fromRepId ? { type: 'SALES_REP', id: fromRepId } : null)
    : (fromWarehouseId ? { type: 'WAREHOUSE', id: fromWarehouseId } : null);
  const stock = useStockAt(fromLoc);
  const rows = useMemo(() => pickerRows(products), [products]);
  const items = pickedItems(rows, qty);
  const boxes = pickedBoxes(rows, qty);
  const held = (r) => Math.floor((stock.map.get(r.id) || 0) / (r.size || 1));
  const overStock = items.length > 0 && (!stock.ready || rows.some((r) => (qty[r.key] || 0) > held(r)));

  // Boxes picked against one place are not carried to another kind of place: a different rep, or a rep
  // instead of a warehouse, starts the list again (as Returns does). Between warehouses they stay, re-checked.
  const fromKey = fromLoc ? `${fromLoc.type}:${fromLoc.id}` : '';
  const lastFrom = useRef(fromKey);
  useEffect(() => {
    const was = lastFrom.current;
    lastFrom.current = fromKey;
    if (was === fromKey) return;
    if (!(was.startsWith('WAREHOUSE:') && fromKey.startsWith('WAREHOUSE:'))) setQty({});
  }, [fromKey]);

  const toWarehouseId = direction === 'WAREHOUSE_TO_WAREHOUSE' ? (wwTarget?.id || '') : (backWarehouse?.id || '');

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        direction,
        items,
        notes: notes || undefined,
      };
      if (direction === 'WAREHOUSE_TO_REP') { payload.fromWarehouseId = fromWarehouseId; payload.toRepId = toRepId; }
      if (direction === 'REP_TO_WAREHOUSE') { payload.fromRepId = fromRepId; payload.toWarehouseId = toWarehouseId; }
      if (direction === 'WAREHOUSE_TO_WAREHOUSE') { payload.fromWarehouseId = fromWarehouseId; payload.toWarehouseId = toWarehouseId; }
      return api.post('/transfers', payload);
    },
    onSuccess: () => {
      saveStockWarehouse(fromRep ? toWarehouseId : fromWarehouseId);
      toast.success('Transfer completed');
      qc.invalidateQueries({ queryKey: ['transfers'] });
      onClose();
    },
    onError: (e) => { toast.error(apiError(e)); stock.refetch(); },
    onSettled: () => { sending.current = false; },
  });

  const placesOk = direction === 'WAREHOUSE_TO_REP' ? fromWarehouseId && toRepId
    : direction === 'REP_TO_WAREHOUSE' ? fromRepId && toWarehouseId
      : fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId;
  const valid = items.length > 0 && !!placesOk && !overStock;
  const submit = () => {
    if (sending.current || create.isPending || !valid) return;
    sending.current = true;
    create.mutate();
  };
  const requestClose = () => {
    if (create.isPending) return;
    if (items.length === 0 || confirmDiscard) onClose(); else setConfirmDiscard(true);
  };
  const pick = (next) => { setQty(next); setConfirmDiscard(false); };

  const fromName = fromRep ? repName(fromRepId) : shortPlace(fromWarehouse?.name);
  // The button names the move in a few words: "Move 6 boxes Main → Mrema".
  const fromShort = fromRep ? repName(fromRepId) : buttonPlace(fromWarehouse?.name);
  const toShort = direction === 'WAREHOUSE_TO_REP' ? repName(toRepId)
    : direction === 'WAREHOUSE_TO_WAREHOUSE' ? buttonPlace(wwTarget?.name) : buttonPlace(backWarehouse?.name);
  const label = items.length === 0 ? 'Move boxes'
    : !fromShort ? 'Choose the rep first'
      : !toShort ? (direction === 'WAREHOUSE_TO_REP' ? 'Choose the rep' : 'Choose where to')
        : `Move ${formatNumber(boxes)} ${boxWord(boxes)} ${fromShort} → ${toShort}`;
  // Out of a warehouse, once the other end is chosen: one line "Main Warehouse → Mrema" with Change.
  const folded = !fromRep && !!fromWarehouse && (direction === 'WAREHOUSE_TO_REP' ? !!repOf(toRepId) : !!wwTarget);
  const chooseDirection = (d) => { setDirection(d); setEditPlaces(false); };

  const away = (w) => !!(w && usual && w.id !== usual.id);
  const warehouseOptions = (list) => list.map((w) => ({ value: w.id, label: w.name, sub: w.region }));
  const repOptions = reps.map((r) => ({ value: r.id, label: r.user?.name || r.code, sub: r.code }));
  const directionOptions = more || fromRep ? [...DIRECTIONS, BACK] : DIRECTIONS;

  return (
    <Modal open onClose={requestClose} size="lg" title="New stock transfer"
      footer={confirmDiscard ? (
        <DiscardFooter what="transfer" detail={`${formatNumber(boxes)} ${boxWord(boxes)} picked will be lost.`} onDiscard={onClose} onKeep={() => setConfirmDiscard(false)} />
      ) : (
        <>
          <div className="mr-auto min-w-0 flex-1 basis-0 text-sm">
            {items.length === 0 ? <span className="text-muted">Tap + on what is moving</span> : (
              <div className="truncate text-muted">{items.length} {items.length === 1 ? 'product' : 'products'}</div>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button data-picker-submit="" className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={create.isPending} disabled={!valid} onClick={submit}>
            {label}
          </Button>
        </>
      )}>
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        <div className="space-y-1.5">
          <Segmented label="Direction" value={direction} onChange={chooseDirection} options={directionOptions} />
          {!more && !fromRep && (
            <MoreToggle open={false} onToggle={() => setMore(true)}>Other moves</MoreToggle>
          )}
        </div>

        {fromRep ? (
          <div className="space-y-2.5 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.08]">
            <Caution>{REP_WARNING}</Caution>
            <Chips label="From rep" value={fromRepId} onChange={setFromRepId} options={repOptions} empty="No active reps" />
          </div>
        ) : folded ? (
          <PlaceLine
            parts={[
              { label: 'From', kind: 'warehouse', name: shortPlace(fromWarehouse.name), sub: fromWarehouse.region, amber: away(fromWarehouse), title: fromWarehouse.name },
              direction === 'WAREHOUSE_TO_REP'
                ? { label: 'To rep', kind: 'rep', name: repName(toRepId), sub: repOf(toRepId)?.code }
                : { label: 'To warehouse', kind: 'warehouse', name: shortPlace(wwTarget.name), sub: wwTarget.region, amber: away(wwTarget), title: wwTarget.name },
            ]}
            open={editPlaces}
            onToggle={() => setEditPlaces((x) => !x)}
            note={away(fromWarehouse) && <Caution action={<button type="button" onClick={() => setFromPick(usual.id)} className={changeBtn}>Use {usual.name}</button>}>Not the usual warehouse.</Caution>}
          >
            {active.length > 1 && (
              <Chips label="From warehouse" value={fromWarehouseId} onChange={setFromPick} options={warehouseOptions(active)} />
            )}
            {direction === 'WAREHOUSE_TO_REP' ? (
              <Chips label="To rep" value={toRepId} onChange={(id) => { setToRepId(id); setEditPlaces(false); }} options={repOptions} empty="No active reps" />
            ) : (
              <Chips label="To warehouse" value={wwTarget?.id || ''} onChange={(id) => { setWwTo(id); setEditPlaces(false); }} options={warehouseOptions(others)}
                empty="There is no other active warehouse to move to." />
            )}
          </PlaceLine>
        ) : (
          <PlaceLine
            parts={[{ label: 'From', kind: 'warehouse', name: fromWarehouse ? fromWarehouse.name : warehousesLoading ? '…' : 'No active warehouse', sub: fromWarehouse?.region, amber: away(fromWarehouse), empty: !fromWarehouse }]}
            open={editFrom}
            onToggle={active.length > 1 ? () => setEditFrom((x) => !x) : undefined}
            note={away(fromWarehouse) && <Caution action={<button type="button" onClick={() => setFromPick(usual.id)} className={changeBtn}>Use {usual.name}</button>}>Not the usual warehouse.</Caution>}
          >
            <Chips label="From warehouse" value={fromWarehouseId} onChange={(id) => { setFromPick(id); setEditFrom(false); }} options={warehouseOptions(active)} />
          </PlaceLine>
        )}

        {!folded && direction === 'WAREHOUSE_TO_REP' && (
          <Chips label="To rep" value={toRepId} onChange={setToRepId} options={repOptions} empty="No active reps" />
        )}
        {!folded && direction === 'WAREHOUSE_TO_WAREHOUSE' && (
          <Chips label="To warehouse" value={wwTarget?.id || ''} onChange={setWwTo} options={warehouseOptions(others)}
            empty="There is no other active warehouse to move to." />
        )}
        {fromRep && (
          <PlaceLine
            parts={[{ label: 'Back into', kind: 'warehouse', name: backWarehouse ? backWarehouse.name : '…', sub: backWarehouse?.region, amber: away(backWarehouse), empty: !backWarehouse }]}
            open={editBack}
            onToggle={active.length > 1 ? () => setEditBack((x) => !x) : undefined}
          >
            <Chips label="Back into warehouse" value={backWarehouse?.id || ''} onChange={(id) => { setBackPick(id); setEditBack(false); }} options={warehouseOptions(active)} />
          </PlaceLine>
        )}

        <ProductPicker rows={rows} value={qty} onChange={pick} cap stock={fromLoc ? stock : null} onlyHeld={fromRep}
          locked={fromRep && !fromRepId ? 'Choose the rep first' : ''}
          placeName={fromName || 'here'} loading={productsLoading} emptyText="No products yet." />

        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
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
  WAREHOUSE_TO_REP: { chip: 'bg-violet-500/15 text-violet-300', icon: UserRound },
  REP_TO_WAREHOUSE: { chip: 'bg-amber-500/15 text-amber-300', icon: RotateCcw },
  WAREHOUSE_TO_WAREHOUSE: { chip: 'bg-sky-500/15 text-sky-300', icon: Warehouse },
};

function TintCard({ label, value, sub, icon: Icon, ring, glow, chip, num }) {
  return (
    <div className="stat-glass p-4">
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${chip}`}><Icon className="h-3.5 w-3.5" /></span>
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['transfers', { page, direction }],
    queryFn: async () => unwrap(await api.get('/transfers', { params: { page, limit: 15, direction: direction || undefined } })),
    placeholderData: keepOnPageTurn({ direction }),
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
              ring="ring-sky-500/25" glow="from-sky-500/[0.12]" chip="bg-sky-500/15 text-sky-300" num="text-sky-300" />
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
            <div className="card mb-4 p-5">
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
            className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${
              direction === f.key
                ? 'bg-brand-500/15 text-brand-600 ring-brand-500/30'
                : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the transfers" onRetry={refetch} /> : !rows.length ? (
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
                          <button onClick={() => setExpanded(isOpen ? null : t.id)} className="flex items-center gap-1.5 font-medium text-foreground hover:text-brand-600">
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
                        {/* A transfer to a rep opened his order; its boxes come back through a Return on that
                            order (the server refuses to cancel it), so it offers no cancel here. */}
                        <TD>{!dead && t.direction !== 'WAREHOUSE_TO_REP' && (
                          <button className="btn-ghost px-2 py-1 text-faint hover:text-rose-400" title="Cancel & return the stock"
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
