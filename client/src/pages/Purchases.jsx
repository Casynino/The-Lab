import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Ship, PackageCheck, X, Pencil, Trash2, Eye } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useProducts, useWarehouses } from '@/lib/hooks';
import { PO_STATUS_META } from '@/lib/constants';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Select, Textarea,
  Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function POModal({ onClose, editing }) {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'opts'], queryFn: async () => unwrap(await api.get('/suppliers', { params: { limit: 200 } })).data });

  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const [supplierId, setSupplierId] = useState(editing?.supplierId || '');
  const [rows, setRows] = useState(
    editing?.items?.length
      ? editing.items.map((i) => ({
          productId: i.productId,
          packagingUnitId: i.packagingUnitId,
          quantity: i.quantity,
          unitCost: Number(i.unitCost) || 0,
        }))
      : [{ productId: '', packagingUnitId: '', quantity: 1, unitCost: 0 }],
  );
  const [costs, setCosts] = useState({
    shippingCost: Number(editing?.shippingCost) || 0,
    clearingCost: Number(editing?.clearingCost) || 0,
    otherCost: Number(editing?.otherCost) || 0,
  });
  const [expectedArrival, setExpectedArrival] = useState(day(editing?.expectedArrival));
  const [orderedAt, setOrderedAt] = useState(day(editing?.orderedAt));
  const [warehouseId, setWarehouseId] = useState(editing?.warehouseId || '');
  const [notes, setNotes] = useState(editing?.notes || '');

  const setRow = (i, p) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const onProduct = (i, productId) => {
    const product = products.find((p) => p.id === productId);
    const base = product?.packagings?.find((k) => k.isBaseUnit) || product?.packagings?.[0];
    // The buying price is already on the product — typing it again on every
    // order is work the system can do, and a chance to fat-finger a cost that
    // becomes COGS. Still editable, because a supplier's price does move.
    setRow(i, {
      productId,
      packagingUnitId: base?.packagingUnitId || '',
      unitCost: Number(product?.purchasePrice) || 0,
    });
  };

  const payload = () => ({
    supplierId,
    items: rows.filter((r) => r.productId && r.quantity > 0).map((r) => ({ productId: r.productId, packagingUnitId: r.packagingUnitId, quantity: Number(r.quantity), unitCost: Number(r.unitCost) || 0 })),
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
      toast.success(editing ? 'Purchase order updated' : 'Purchase order created');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const valid = supplierId && rows.some((r) => r.productId && r.quantity > 0);

  return (
    <Modal open onClose={onClose} size="lg" title={editing ? `Edit ${editing.poNumber}` : 'New purchase order (import)'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create PO'}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Receive into warehouse"><Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Primary warehouse</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="label mb-0">Items (cost per base unit)</span>
            <button type="button" onClick={() => setRows([...rows, { productId: '', packagingUnitId: '', quantity: 1, unitCost: 0 }])} className="text-xs font-medium text-brand-600 hover:underline">+ Add</button>
          </div>
          {rows.map((r, i) => {
            const product = products.find((p) => p.id === r.productId);
            const pkgs = (product?.packagings || []).slice().sort((a, b) => a.baseQuantity - b.baseQuantity);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                <Select value={r.productId} onChange={(e) => onProduct(i, e.target.value)} className="min-w-[160px] flex-1"><option value="">Product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                <Select value={r.packagingUnitId} onChange={(e) => setRow(i, { packagingUnitId: e.target.value })} className="w-32" disabled={!product}>{pkgs.map((pk) => <option key={pk.id} value={pk.packagingUnitId}>{pk.packagingUnit.name} (×{pk.baseQuantity})</option>)}</Select>
                <Input type="number" min="1" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className="w-20" placeholder="Qty" />
                <Input type="number" min="0" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: e.target.value })} className="w-28" placeholder="Cost/box" />
                {(() => {
                  const pk = pkgs.find((k) => k.packagingUnitId === r.packagingUnitId);
                  const boxes = (Number(r.quantity) || 0) * (pk?.baseQuantity || 1);
                  const line = boxes * (Number(r.unitCost) || 0);
                  return line > 0 ? (
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                      {formatNumber(boxes)} boxes · <b className="text-foreground">{formatCurrency(line)}</b>
                    </span>
                  ) : null;
                })()}
                <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="ml-auto text-faint hover:text-rose-400"><X className="h-4 w-4" /></button>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Shipping cost (TZS)"><Input type="number" min="0" value={costs.shippingCost} onChange={(e) => setCosts({ ...costs, shippingCost: e.target.value })} /></Field>
          <Field label="Clearing cost (TZS)"><Input type="number" min="0" value={costs.clearingCost} onChange={(e) => setCosts({ ...costs, clearingCost: e.target.value })} /></Field>
          <Field label="Other cost (TZS)"><Input type="number" min="0" value={costs.otherCost} onChange={(e) => setCosts({ ...costs, otherCost: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ordered date"><Input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} /></Field>
          <Field label="Expected arrival"><Input type="date" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {(() => {
          const goods = rows.reduce((n, r) => {
            const product = products.find((p) => p.id === r.productId);
            const pk = (product?.packagings || []).find((k) => k.packagingUnitId === r.packagingUnitId);
            return n + (Number(r.quantity) || 0) * (pk?.baseQuantity || 1) * (Number(r.unitCost) || 0);
          }, 0);
          const extras = (Number(costs.shippingCost) || 0) + (Number(costs.clearingCost) || 0) + (Number(costs.otherCost) || 0);
          const boxes = rows.reduce((n, r) => {
            const product = products.find((p) => p.id === r.productId);
            const pk = (product?.packagings || []).find((k) => k.packagingUnitId === r.packagingUnitId);
            return n + (Number(r.quantity) || 0) * (pk?.baseQuantity || 1);
          }, 0);
          if (!goods && !extras) return null;
          return (
            <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <span className="text-xs text-muted">
                {formatNumber(boxes)} box{boxes === 1 ? '' : 'es'} · goods {formatCurrency(goods)}
                {extras > 0 && <> · shipping &amp; costs {formatCurrency(extras)}</>}
              </span>
              <span className="text-sm font-bold tabular-nums text-foreground">
                {formatCurrency(goods + extras)}
                {boxes > 0 && <span className="ml-2 text-[11px] font-normal text-faint">{formatCurrency((goods + extras) / boxes)} a box</span>}
              </span>
            </div>
          );
        })()}
        <p className="text-xs text-faint">Cost per box is filled in from the product's buying price — change it if this supplier charged something else. Shipping, clearing and other costs are spread across the boxes as landed cost when you receive the order.</p>
      </div>
    </Modal>
  );
}

function SupplierModal({ editing, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing || { name: '', country: 'China', contactName: '', phone: '', email: '' });
  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/suppliers/${editing.id}`, form) : api.post('/suppliers', form)),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={editing ? 'Edit supplier' : 'New supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={form.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country"><Input value={form.country || ''} onChange={set('country')} /></Field>
          <Field label="Contact"><Input value={form.contactName || ''} onChange={set('contactName')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone"><Input value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><Input value={form.email || ''} onChange={set('email')} /></Field>
        </div>
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
          <Table>
            <THead>
              <TR><TH>Product</TH><TH>Ordered</TH><TH>Boxes</TH><TH className="text-right">Cost / box</TH><TH className="text-right">Line total</TH></TR>
            </THead>
            <TBody>
              {(po.items || []).map((i) => (
                <TR key={i.id}>
                  <TD className="font-medium text-foreground">
                    {i.product?.name}
                    {i.product?.sku && <span className="ml-1.5 text-[11px] text-faint">{i.product.sku}</span>}
                  </TD>
                  <TD>{formatNumber(i.quantity)} {i.packagingUnit?.name || 'unit'}{i.quantity === 1 ? '' : 's'}</TD>
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
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders', { page }], queryFn: async () => unwrap(await api.get('/purchase-orders', { params: { page, limit: 15 } })) });
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
    onError: (e) => toast.error(apiError(e)),
  });

  const receive = useMutation({
    mutationFn: (id) => api.post(`/purchase-orders/${id}/receive`, {}),
    onSuccess: () => { toast.success('Received into warehouse'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const otw = data?.meta?.onTheWay;

  return (
    <div className="space-y-4">
      {/* Stock bought but not landed. It is paid for or owed for and it is
          coming, but it is not inventory yet — so until now it was invisible
          between ordering it and it arriving, which is exactly the window
          you need to plan around. */}
      {otw && (
        <div className={`relative overflow-hidden rounded-2xl bg-surface p-5 ring-1 ${otw.boxes > 0 ? 'ring-sky-500/25' : 'ring-white/[0.07]'}`}>
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${otw.boxes > 0 ? 'from-sky-500/[0.12]' : 'from-white/[0.02]'} to-transparent`} aria-hidden="true" />
          <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-sky-500/15 p-1.5 text-sky-300"><Ship className="h-3.5 w-3.5" /></span>
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
      {isLoading ? <PageSpinner /> : !data?.data?.length ? <EmptyState title="No purchase orders" icon={Ship} /> : (
        <>
          <Table>
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
                        className="cursor-pointer text-faint transition hover:text-brand-400"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                        <>
                          <button
                            title="Edit this order"
                            onClick={(e) => { e.stopPropagation(); setEditing(po); }}
                            className="cursor-pointer text-faint transition hover:text-brand-400"
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
  const { data, isLoading } = useQuery({ queryKey: ['suppliers'], queryFn: async () => unwrap(await api.get('/suppliers', { params: { limit: 100 } })) });
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border p-4">
        <span className="text-sm font-semibold text-foreground">Suppliers</span>
        <Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New supplier</Button>
      </div>
      {isLoading ? <PageSpinner /> : !data?.data?.length ? <EmptyState title="No suppliers" /> : (
        <Table>
          <THead><TR><TH>Name</TH><TH>Country</TH><TH>Contact</TH><TH>Phone</TH><TH>POs</TH><TH /></TR></THead>
          <TBody>{data.data.map((s) => (
            <TR key={s.id}><TD className="font-medium">{s.name}</TD><TD>{s.country}</TD><TD>{s.contactName || '—'}</TD><TD>{s.phone || '—'}</TD><TD>{s._count?.purchaseOrders ?? 0}</TD>
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
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === k ? 'bg-brand-600 text-slate-950' : 'bg-surface text-muted hover:bg-elevated'}`}>{label}</button>
        ))}
      </div>
      {tab === 'orders' ? <PurchaseOrders /> : <Suppliers />}
    </div>
  );
}
