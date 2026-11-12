import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Ship, PackageCheck, Pencil, Trash2, Eye } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { keepOnPageTurn } from '@/lib/pageQueries';
import { useProducts, useWarehouses, useBrands } from '@/lib/hooks';
import { wentThrough } from '@/lib/once';
import { PO_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDate, formatNumber, pluralizeUnit } from '@/lib/format';
import { eatISODate } from '@/lib/tz';
import ProductPicker, { useHomeWarehouse, PlaceLine, Chips, Caution, MoreToggle, DiscardFooter, changeBtn } from '@/components/ProductPicker';
import { pickerRows, rowsWithSaved, pickedBoxes, primaryWarehouse, lineCost, boxWord, shortPlace, buttonPlace } from '@/lib/stockPick';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, NumberInput, Textarea, Select,
  Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

// New purchase order — the quick way (Nino, 11 Nov 2026: "the PO should be easy, not complicated and hard to
// fill and select all the time"). The supplier is the one this device last ordered from; the order goes to the
// primary warehouse (named in no request, as before) unless changed here — never to the warehouse another
// window last used; ordered today; every product is listed with a  −  qty  +  and its cost per box filled in
// from the buying price (still editable). The dates and the shipping, clearing and other costs sit behind two
// quiet toggles that only show or hide them — closing one never changes a figure. An order being edited keeps
// every saved line as it was — a carton line stays in cartons.
// The request is the old one, field for field.
const LAST_SUPPLIER_KEY = 'zl.po.supplier';
const readLastSupplier = () => { try { return localStorage.getItem(LAST_SUPPLIER_KEY) || ''; } catch { return ''; } };
const saveLastSupplier = (id) => { try { if (id) localStorage.setItem(LAST_SUPPLIER_KEY, id); } catch { /* private window */ } };

function POModal({ onClose, editing }) {
  const qc = useQueryClient();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({ queryKey: ['suppliers', 'opts'], queryFn: async () => unwrap(await api.get('/suppliers', { params: { limit: 200 } })).data });
  const { active } = useHomeWarehouse(warehouses);
  const primary = primaryWarehouse(active);

  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const [lastSupplier] = useState(readLastSupplier);
  const [supplierPick, setSupplierPick] = useState(editing?.supplierId || '');
  const [editSupplier, setEditSupplier] = useState(false);
  // '' = the primary warehouse (the server's own choice when none is named), as the old "Primary warehouse".
  const [whPick, setWhPick] = useState(editing?.warehouseId || '');
  const [editWh, setEditWh] = useState(false);
  const [qty, setQty] = useState({});
  const [cost, setCost] = useState({});
  const [costs, setCosts] = useState({
    shippingCost: Number(editing?.shippingCost) || 0,
    clearingCost: Number(editing?.clearingCost) || 0,
    otherCost: Number(editing?.otherCost) || 0,
  });
  const [extras, setExtras] = useState(!!(Number(editing?.shippingCost) || Number(editing?.clearingCost) || Number(editing?.otherCost)));
  const [showDates, setShowDates] = useState(false);
  const [expectedArrival, setExpectedArrival] = useState(day(editing?.expectedArrival));
  // No date by default, as before: a new PO starts as a DRAFT. A date makes it ORDERED, and whether an ordered
  // PO already counts as money owed to the supplier is the owner's open decision (D8) — not changed here.
  const [orderedAt, setOrderedAt] = useState(day(editing?.orderedAt));
  const [notes, setNotes] = useState(editing?.notes || '');
  const [touched, setTouched] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sending = useRef(false);

  const supplierId = supplierPick || (!editing && suppliers.some((s) => s.id === lastSupplier) ? lastSupplier : '');
  const supplier = suppliers.find((s) => s.id === supplierId) || (editing && editing.supplierId === supplierId ? editing.supplier : null);
  // A new order names no warehouse unless one is picked here (the server then uses the primary, as before).
  const warehouseId = whPick;
  const into = warehouseId ? (active.find((w) => w.id === warehouseId) || (editing?.warehouseId === warehouseId ? editing.warehouse : null)) : primary;
  const intoAway = !!(warehouseId && primary && warehouseId !== primary.id);

  // Every product in its box; an order being edited also gets a row for any saved line that is not that.
  const baseRows = useMemo(() => pickerRows(products), [products]);
  const productsReady = !productsLoading;
  const saved = useMemo(
    () => (editing && productsReady ? rowsWithSaved(baseRows, editing.items, products) : null),
    [editing, productsReady, baseRows, products],
  );
  const rows = saved ? saved.rows : baseRows;
  const seeded = useRef(false);
  useEffect(() => {
    if (!saved || seeded.current) return;
    seeded.current = true;
    setQty(saved.qty);
    setCost(saved.cost);
  }, [saved]);

  const picked = rows.filter((r) => Number(qty[r.key]) > 0);
  const payload = () => ({
    supplierId,
    // Every figure on this form is in shillings (audit reversals-stock-8: new orders were saved as USD). Only
    // on a new order: an edit leaves an older order's stored label as it is.
    currency: editing ? undefined : 'TZS',
    items: picked.map((r) => ({ productId: r.id, packagingUnitId: r.packagingUnitId, quantity: Number(qty[r.key]), unitCost: Number(lineCost(cost, r)) || 0 })),
    shippingCost: Number(costs.shippingCost) || 0,
    clearingCost: Number(costs.clearingCost) || 0,
    otherCost: Number(costs.otherCost) || 0,
    warehouseId: warehouseId || undefined,
    orderedAt: orderedAt || undefined,
    expectedArrival: expectedArrival || undefined,
    notes: notes || undefined,
  });

  const save = useMutation({
    mutationFn: () => (editing
      ? api.put(`/purchase-orders/${editing.id}`, payload())
      : api.post('/purchase-orders', payload())),
    onSuccess: () => {
      saveLastSupplier(supplierId);
      toast.success(editing ? 'Purchase order updated' : 'Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
    onSettled: () => { sending.current = false; },
  });

  // Same sums as before: boxes × cost per box, plus the extra costs.
  const boxes = pickedBoxes(rows, qty);
  const goods = picked.reduce((n, r) => n + Number(qty[r.key]) * (r.size || 1) * (Number(lineCost(cost, r)) || 0), 0);
  const extraSum = (Number(costs.shippingCost) || 0) + (Number(costs.clearingCost) || 0) + (Number(costs.otherCost) || 0);
  const total = goods + extraSum;

  const valid = !!supplierId && picked.length > 0 && !(editing && !seeded.current);
  const submit = () => {
    if (sending.current || save.isPending || !valid) return;
    sending.current = true;
    save.mutate();
  };
  const dirty = editing ? touched : picked.length > 0;
  const requestClose = () => {
    if (save.isPending) return;
    if (!dirty || confirmDiscard) onClose(); else setConfirmDiscard(true);
  };
  const touch = () => { setTouched(true); setConfirmDiscard(false); };
  const pick = (next) => { setQty(next); touch(); };
  const setRowCost = (key, v) => { setCost((c) => ({ ...c, [key]: v })); touch(); };
  // The toggle only shows or hides the costs: closing it never changes a figure, and the closed toggle shows their sum.
  const toggleExtras = () => setExtras((x) => !x);

  // A switched-off supplier still shows (an old order may name it), marked as such (audit money-flows-8).
  const supplierOptions = suppliers.map((s) => ({
    value: s.id, label: s.name,
    sub: [s.isActive === false ? 'switched off' : null, s.country].filter(Boolean).join(' · ') || undefined,
  }));
  // The primary is '' (named in no request) — except on an order saved into another warehouse: there, choosing
  // the primary must name it, or the server would keep the old warehouse while the window says the primary.
  const primaryValue = (id) => (primary && id === primary.id && !editing?.warehouseId ? '' : id);

  const today = eatISODate();
  const datesLabel = `${orderedAt ? (orderedAt === today ? 'Ordered today' : `Ordered ${formatDate(orderedAt)}`) : 'No order date (draft)'}`
    + `${expectedArrival ? ` · arriving ${formatDate(expectedArrival)}` : ''}`;

  return (
    <Modal open onClose={requestClose} size="lg" title={editing ? `Edit ${editing.poNumber}` : 'New purchase order (import)'}
      footer={confirmDiscard ? (
        <DiscardFooter what={editing ? 'change' : 'order'} detail={editing ? 'What you changed on this order will be lost.' : `${formatNumber(boxes)} ${boxWord(boxes)} picked will be lost.`}
          onDiscard={onClose} onKeep={() => setConfirmDiscard(false)} />
      ) : (
        <>
          <div className="mr-auto min-w-0 flex-1 basis-0 text-sm">
            {picked.length === 0 ? <span className="text-muted">Tap + on what you are ordering</span> : (
              <>
                <div className="truncate text-muted">
                  <span className="font-semibold tabular-nums text-foreground">{formatNumber(boxes)}</span> {boxWord(boxes)}
                  {supplier && <> from <span className="font-medium text-foreground">{supplier.name}</span></>}
                  {into && <> into <span className={clsx('font-medium', intoAway ? 'text-amber-300' : 'text-foreground')}>{buttonPlace(into.name)}</span></>}
                </div>
                {boxes > 0 && total > 0 && (
                  <div className="text-xs text-faint">
                    goods {formatCurrency(goods)}{extraSum > 0 && <> + costs {formatCurrency(extraSum)}</>} · {formatCurrency(total / boxes)} a box
                  </div>
                )}
              </>
            )}
          </div>
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={requestClose}>Cancel</Button>
          <Button data-picker-submit="" className="h-12 w-full text-base sm:h-auto sm:w-auto sm:text-sm" loading={save.isPending} disabled={!valid} onClick={submit}>
            {editing ? 'Save changes' : 'Create PO'}
            {picked.length > 0 && <span className="tabular-nums">· {formatCurrency(total)}</span>}
          </Button>
        </>
      )}>
      <div className="space-y-2.5 sm:space-y-4 max-sm:min-h-[calc(100dvh_-_17rem)]">
        {supplierId && !editSupplier ? (
          <PlaceLine
            parts={[
              { label: 'Supplier', kind: 'supplier', name: supplier?.name || '…', sub: supplier?.country },
              { label: 'Into', kind: 'warehouse', name: into ? shortPlace(into.name) : '…', sub: warehouseId ? into?.region : 'primary', title: into?.name, amber: intoAway },
            ]}
            open={false}
            onToggle={() => { setEditSupplier(true); setEditWh(true); }}
            note={intoAway && primary && (
              <Caution action={<button type="button" onClick={() => { setWhPick(primaryValue(primary.id)); touch(); }} className={changeBtn}>Use {shortPlace(primary.name)}</button>}>
                Not the usual warehouse.
              </Caution>
            )}
          />
        ) : (
          <div className="space-y-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.08]">
            <Chips label="Supplier" value={supplierId} onChange={(id) => { setSupplierPick(id); touch(); }} options={supplierOptions}
              empty={suppliersLoading ? 'Loading suppliers…' : 'No suppliers yet — add one under Suppliers.'} />
            {(editWh || editSupplier) && active.length > 0 && (
              <Chips label="Receive into" value={primaryValue(warehouseId)} onChange={(id) => { setWhPick(id); touch(); }}
                options={active.map((w) => ({ value: primaryValue(w.id), label: w.name, sub: primary && w.id === primary.id ? 'primary' : w.region }))} />
            )}
            {supplierId && (
              <div className="flex justify-end">
                <button type="button" onClick={() => { setEditSupplier(false); setEditWh(false); }} className={clsx(changeBtn, 'text-foreground')}>Done</button>
              </div>
            )}
          </div>
        )}

        <ProductPicker rows={rows} value={qty} onChange={pick} cost={cost} onCost={setRowCost}
          loading={productsLoading || (!!editing && !seeded.current)} emptyText="No products yet." />

        <div className="flex flex-col gap-1 [&>div]:mb-2">
          <MoreToggle open={showDates} onToggle={() => setShowDates((x) => !x)}>{datesLabel}</MoreToggle>
          {showDates && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted">Ordered
                <Input type="date" value={orderedAt} onChange={(e) => { setOrderedAt(e.target.value); touch(); }} className="mt-1" />
              </label>
              <label className="block text-xs text-muted">Expected arrival <span className="text-faint">(optional)</span>
                <Input type="date" min={orderedAt || undefined} value={expectedArrival} onChange={(e) => { setExpectedArrival(e.target.value); touch(); }} className="mt-1" />
              </label>
            </div>
          )}
          <MoreToggle open={extras} onToggle={toggleExtras}>
            Extra costs{!extras && extraSum > 0 ? ` · ${formatCurrency(extraSum)}` : ''}
          </MoreToggle>
          {extras && (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Shipping (TZS)"><NumberInput min="0" value={costs.shippingCost} onChange={(e) => { setCosts({ ...costs, shippingCost: e.target.value }); touch(); }} /></Field>
                <Field label="Clearing (TZS)"><NumberInput min="0" value={costs.clearingCost} onChange={(e) => { setCosts({ ...costs, clearingCost: e.target.value }); touch(); }} /></Field>
                <Field label="Other (TZS)"><NumberInput min="0" value={costs.otherCost} onChange={(e) => { setCosts({ ...costs, otherCost: e.target.value }); touch(); }} /></Field>
              </div>
              <p className="text-xs text-faint">Spread over the boxes as landed cost when the order is received.</p>
            </div>
          )}
        </div>

        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} placeholder="Optional" /></Field>
      </div>
    </Modal>
  );
}

function SupplierModal({ editing, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing || { name: '', country: 'China', brandId: '', contactName: '', phone: '', email: '' });
  // The brand, as on Finance's supplier form (audit money-flows-8: a supplier made here could never get one).
  const { data: brands = [] } = useBrands();
  // A blank brand is "no brand": cleared on an edit, left out on a new supplier.
  const body = () => ({ ...form, brandId: form.brandId || (editing ? null : undefined) });
  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/suppliers/${editing.id}`, body()) : api.post('/suppliers', body())),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={editing ? 'Edit supplier' : 'New supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Brand" hint="Payments to this supplier count against this brand's books">
          <Select value={form.brandId || ''} onChange={set('brandId')}>
            <option value="">General (no brand)</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country"><Input value={form.country || ''} onChange={set('country')} /></Field>
          <Field label="Contact"><Input value={form.contactName || ''} onChange={set('contactName')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone"><Input value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><Input value={form.email || ''} onChange={set('email')} /></Field>
        </div>
        {/* Switching a supplier off or back on (audit money-flows-8: one switched off could not come back). */}
        {editing && (
          <label className="flex min-h-[44px] w-fit cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-0">
            <input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded accent-zinc-300" /> Active
          </label>
        )}
      </div>
    </Modal>
  );
}

// Open any order and see what was in it. A received order is history and
// stays read-only — its boxes are on the shelf at a cost taken from these
// lines — but history you cannot look at is not much of a record.
function PODetailModal({ po, onClose, onEdit, onDelete, onReceive }) {
  const landed = po.status === 'RECEIVED';
  const boxes = (po.items || []).reduce((n, i) => n + (i.baseQuantity || 0), 0);
  const goods = (po.items || []).reduce((n, i) => n + Number(i.unitCost || 0) * (i.baseQuantity || 0), 0);
  const extras = Number(po.shippingCost || 0) + Number(po.clearingCost || 0) + Number(po.otherCost || 0);

  return (
    <Modal open onClose={onClose} size="xl" title={po.poNumber}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!landed && po.status !== 'CANCELLED' && (
            <>
              <Button variant="secondary" onClick={() => { onClose(); onDelete(po); }}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <Button variant="secondary" onClick={() => { onClose(); onEdit(po); }}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button onClick={() => { onClose(); onReceive(po); }}>
                <PackageCheck className="h-4 w-4" /> Receive into warehouse
              </Button>
            </>
          )}
        </>
      }>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/[0.08] bg-surface px-4 py-3">
          <Badge className={PO_STATUS_META[po.status]?.cls}>{PO_STATUS_META[po.status]?.label}</Badge>
          <span className="text-sm text-foreground">{po.supplier?.name}</span>
          {po.warehouse?.name && <span className="text-xs text-faint">into {po.warehouse.name}</span>}
          <span className="ml-auto text-xs text-faint">
            {po.orderedAt && <>Ordered {formatDate(po.orderedAt)}</>}
            {po.expectedArrival && <> · Expected {formatDate(po.expectedArrival)}</>}
            {po.actualArrival && <> · Arrived {formatDate(po.actualArrival)}</>}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Boxes', value: formatNumber(boxes), sub: landed ? 'on the shelf' : 'on the way' },
            { label: 'Goods', value: formatCurrency(goods), sub: 'before shipping' },
            { label: 'Shipping & clearing', value: formatCurrency(extras), sub: 'spread across the boxes' },
            { label: 'Total cost', value: formatCurrency(po.totalCost), sub: boxes > 0 ? `${formatCurrency(Number(po.totalCost) / boxes)} a box` : '\u2014' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{c.label}</p>
              <p className="mt-1 text-base font-bold tabular-nums text-foreground">{c.value}</p>
              <p className="text-[10px] text-faint">{c.sub}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-foreground">What was ordered</div>
          <Table stack>
            <THead>
              <TR><TH>Product</TH><TH>Ordered</TH><TH>Boxes</TH><TH className="text-right">Cost / box</TH><TH className="text-right">Line total</TH></TR>
            </THead>
            <TBody>
              {(po.items || []).map((i) => (
                <TR key={i.id}>
                  <TD className="stack-full font-medium text-foreground">
                    {i.product?.name}
                    {i.product?.sku && <span className="ml-1.5 text-[11px] text-faint">{i.product.sku}</span>}
                  </TD>
                  <TD>{formatNumber(i.quantity)} {i.quantity === 1 ? (i.packagingUnit?.name || 'unit') : pluralizeUnit(i.packagingUnit?.name || 'unit')}</TD>
                  <TD className="font-semibold tabular-nums text-foreground">{formatNumber(i.baseQuantity)}</TD>
                  <TD className="text-right tabular-nums">{formatCurrency(i.unitCost)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{formatCurrency(Number(i.unitCost || 0) * (i.baseQuantity || 0))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        {po.notes && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</p>
            <p className="mt-1 text-sm text-muted">{po.notes}</p>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-faint">
          {landed
            ? 'This order has been received — its boxes are in the warehouse and its cost is already counted, so it can no longer be changed.'
            : 'These boxes are not in Inventory yet. Receiving the order is what puts them on the shelf and spreads the shipping and clearing across them as landed cost.'}
        </p>
      </div>
    </Modal>
  );
}

function PurchaseOrders() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['purchase-orders', { page }], queryFn: async () => unwrap(await api.get('/purchase-orders', { params: { page, limit: 15 } })), placeholderData: keepOnPageTurn() });
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const askDelete = (po) => {
    if (confirm(`Delete ${po.poNumber}? The stock has not arrived, so nothing leaves your warehouse.`)) del.mutate(po.id);
  };
  const askReceive = (po) => {
    if (confirm(`Receive ${po.poNumber} into the warehouse?`)) receive.mutate(po.id);
  };
  const del = useMutation({
    mutationFn: (id) => api.delete(`/purchase-orders/${id}`),
    onSuccess: (r) => {
      toast.success(`${r.data?.data?.poNumber || 'Order'} deleted`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    // The server refuses a delete that would leave the supplier overpaid, and says by how much.
    onError: (e) => { toast.error(apiError(e), { duration: 9000 }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); },
  });

  const afterReceive = () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); };
  const receive = useMutation({
    mutationFn: (id) => api.post(`/purchase-orders/${id}/receive`, {}),
    onSuccess: () => { toast.success('Received into warehouse'); afterReceive(); },
    // 409: it was already received — a second press or a retry after a lost answer (audit reversals-stock-5).
    onError: (e) => {
      if (wentThrough(e)) { toast.success('Already received into the warehouse'); afterReceive(); return; }
      toast.error(apiError(e));
    },
  });
  const otw = data?.meta?.onTheWay;

  return (
    <div className="space-y-4">
      {/* Stock bought but not landed. It is paid for or owed for and it is
          coming, but it is not inventory yet — so until now it was invisible
          between ordering it and it arriving, which is exactly the window
          you need to plan around. */}
      {otw && (
        <div className="stat-glass p-5">
          <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-sky-500/15 p-1.5 text-sky-300 ring-1 ring-inset ring-white/10"><Ship className="h-3.5 w-3.5" /></span>
                <p className="text-xs font-medium text-muted">Stock on the way</p>
              </div>
              <p className={`mt-2 text-3xl font-bold leading-none tabular-nums ${otw.boxes > 0 ? 'text-sky-300' : 'text-foreground'}`}>
                {formatNumber(otw.boxes)} <span className="text-sm font-normal text-muted">boxes</span>
              </p>
              <p className="mt-1 text-[11px] text-faint">
                {otw.orders > 0
                  ? `${formatNumber(otw.orders)} order${otw.orders === 1 ? '' : 's'} ordered, not yet arrived`
                  : 'nothing ordered that has not arrived'}
              </p>
            </div>
            {otw.orders > 0 && (
              <>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Worth</p>
                  <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">{formatCurrency(otw.value)}</p>
                  <p className="text-[11px] text-faint">at landed cost</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Next arrival</p>
                  <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">
                    {otw.nextArrival ? formatDate(otw.nextArrival) : '—'}
                  </p>
                  <p className="text-[11px] text-faint">{otw.nextArrival ? 'expected' : 'no date set'}</p>
                </div>
              </>
            )}
            <p className="ml-auto max-w-xs text-[11px] leading-relaxed text-faint">
              These boxes are not in Inventory yet. They count the moment you press <b className="text-muted">Receive</b> on the order —
              that is what puts them on the shelf and starts their cost.
            </p>
          </div>
        </div>
      )}

    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <span className="text-sm font-semibold text-foreground">Purchase orders</span>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New PO</Button>
      </div>
      {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the purchase orders" onRetry={refetch} /> : !data?.data?.length ? <EmptyState title="No purchase orders" icon={Ship} /> : (
        <>
          <Table stack="wide">
            <THead><TR><TH>PO</TH><TH>Supplier</TH><TH>Boxes</TH><TH>Products</TH><TH>Total cost</TH><TH>Expected</TH><TH>Status</TH><TH /></TR></THead>
            <TBody>
              {data.data.map((po) => (
                <TR key={po.id} className="cursor-pointer" onClick={() => setViewing(po)}>
                  <TD className="font-medium text-foreground">{po.poNumber}</TD>
                  <TD>{po.supplier?.name}</TD>
                  {/* Boxes, not just how many product lines were on the form. */}
                  <TD className="font-semibold tabular-nums text-foreground">{formatNumber(po.boxes ?? 0)}</TD>
                  <TD className="text-muted">{po.items.length}</TD>
                  <TD>{formatCurrency(po.totalCost)}</TD>
                  <TD className="text-faint">{formatDate(po.expectedArrival)}</TD>
                  <TD><Badge className={PO_STATUS_META[po.status]?.cls}>{PO_STATUS_META[po.status]?.label}</Badge></TD>
                  {/* Edit and delete are offered only before the order lands.
                      Once received its boxes are on the shelf at a cost taken
                      from these lines, so changing or removing it would leave
                      stock with no origin — the server refuses it too. */}
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        title="Open this order"
                        onClick={(e) => { e.stopPropagation(); setViewing(po); }}
                        className="cursor-pointer text-faint transition hover:text-brand-600"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                        <>
                          <button
                            title="Edit this order"
                            onClick={(e) => { e.stopPropagation(); setEditing(po); }}
                            className="cursor-pointer text-faint transition hover:text-brand-600"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            title="Delete this order"
                            onClick={(e) => { e.stopPropagation(); askDelete(po); }}
                            className="cursor-pointer text-faint transition hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={(e) => { e.stopPropagation(); askReceive(po); }}><PackageCheck className="h-4 w-4" /> Receive</Button>
                        </>
                      )}
                      {po.status === 'RECEIVED' && (
                        <span className="text-[11px] text-faint">on the shelf</span>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
        </>
      )}
      {open && <POModal onClose={() => setOpen(false)} />}
      {editing && <POModal editing={editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <PODetailModal
          po={viewing}
          onClose={() => setViewing(null)}
          onEdit={setEditing}
          onDelete={askDelete}
          onReceive={askReceive}
        />
      )}
    </Card>
    </div>
  );
}

function Suppliers() {
  const [modal, setModal] = useState({ open: false, editing: null });
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['suppliers'], queryFn: async () => unwrap(await api.get('/suppliers', { params: { limit: 100 } })) });
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <span className="text-sm font-semibold text-foreground">Suppliers</span>
        <Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New supplier</Button>
      </div>
      {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the suppliers" onRetry={refetch} /> : !data?.data?.length ? <EmptyState title="No suppliers" /> : (
        <Table stack>
          <THead><TR><TH>Name</TH><TH>Country</TH><TH>Contact</TH><TH>Phone</TH><TH>POs</TH><TH /></TR></THead>
          <TBody>{data.data.map((s) => (
            <TR key={s.id}><TD className="font-medium">
              {s.name}
              {/* Switched off (a supplier with history is never deleted): said here, not hidden (money-flows-8). */}
              {s.isActive === false && <Badge className="ml-2 bg-white/[0.06] text-muted">Inactive</Badge>}
            </TD><TD>{s.country}</TD><TD>{s.contactName || '—'}</TD><TD>{s.phone || '—'}</TD><TD>{s._count?.purchaseOrders ?? 0}</TD>
              <TD><button className="btn-ghost px-2 py-1" onClick={() => setModal({ open: true, editing: s })}><Pencil className="h-4 w-4" /></button></TD></TR>
          ))}</TBody>
        </Table>
      )}
      {modal.open && <SupplierModal editing={modal.editing} onClose={() => setModal({ open: false, editing: null })} />}
    </Card>
  );
}

export default function Purchases() {
  const [tab, setTab] = useState('orders');
  return (
    <div>
      <PageHeader title="Imports & Purchase Orders" subtitle="Order stock from China, track costs, and receive into the warehouse." />
      <div className="mb-4 flex gap-2">
        {[['orders', 'Purchase orders'], ['suppliers', 'Suppliers']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k ? 'bg-brand-500 text-white ring-brand-500' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {tab === 'orders' ? <PurchaseOrders /> : <Suppliers />}
    </div>
  );
}
