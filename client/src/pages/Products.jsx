import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Package, X, TrendingDown, Boxes, Wallet } from 'lucide-react';
import api, { unwrap, apiError } from '@/lib/api';
import { useBrands, useCategories, usePackagingUnits, useDebounce } from '@/lib/hooks';
import { formatCurrency, formatNumber, pluralizeUnit } from '@/lib/format';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, Select, Textarea,
  SearchInput, Pagination, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function PackagingEditor({ rows, setRows, units }) {
  const update = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setBase = (i) => setRows(rows.map((r, idx) => ({ ...r, isBaseUnit: idx === i, baseQuantity: idx === i ? 1 : r.baseQuantity })));
  const addRow = () => setRows([...rows, { packagingUnitId: units[0]?.id || '', baseQuantity: 1, unitPrice: '', isBaseUnit: false }]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Packaging levels</span>
        <button type="button" onClick={addRow} className="text-xs font-medium text-brand-600 hover:underline">+ Add level</button>
      </div>
      <p className="text-xs text-faint">Pick the base unit (factor 1). Larger units store how many base units they contain (e.g. Box = 50).</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <Select value={r.packagingUnitId} onChange={(e) => update(i, { packagingUnitId: e.target.value })} className="flex-1">
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Input type="number" min="1" value={r.baseQuantity} disabled={r.isBaseUnit}
              onChange={(e) => update(i, { baseQuantity: Number(e.target.value) })} className="w-24" placeholder="Base qty" />
            <Input type="number" min="0" value={r.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} className="w-28" placeholder="Price (opt)" />
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-muted">
              <input type="radio" name="baseUnit" checked={r.isBaseUnit} onChange={() => setBase(i)} /> base
            </label>
            <button type="button" onClick={() => removeRow(i)} className="text-faint hover:text-rose-600"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductModal({ open, onClose, editing, brands, categories, units }) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: editing
      ? {
          name: editing.name, sku: editing.sku, barcode: editing.barcode || '', brandId: editing.brandId, categoryId: editing.categoryId,
          purchasePrice: Number(editing.purchasePrice), sellingPrice: Number(editing.sellingPrice),
          minStockLevel: editing.minStockLevel, reorderQuantity: editing.reorderQuantity, baseUnitName: editing.baseUnitName,
          description: editing.description || '', imageUrl: editing.imageUrl || '', isActive: editing.isActive,
        }
      : {
          name: '', sku: '', barcode: '', brandId: brands[0]?.id || '', categoryId: categories[0]?.id || '',
          purchasePrice: 0, sellingPrice: 0, minStockLevel: 0, reorderQuantity: 0, baseUnitName: 'Pack',
          description: '', imageUrl: '', isActive: true,
        },
  });

  const initialRows = editing
    ? editing.packagings.map((p) => ({ packagingUnitId: p.packagingUnitId, baseQuantity: p.baseQuantity, unitPrice: p.unitPrice ?? '', isBaseUnit: p.isBaseUnit }))
    : units.slice(0, 3).map((u, idx) => ({ packagingUnitId: u.id, baseQuantity: idx === 0 ? 1 : '', isBaseUnit: idx === 0 }));
  const [rows, setRows] = useState(initialRows.length ? initialRows : [{ packagingUnitId: units[0]?.id || '', baseQuantity: 1, isBaseUnit: true, unitPrice: '' }]);

  const save = useMutation({
    mutationFn: async (values) => {
      const packagings = rows.map((r) => ({
        packagingUnitId: r.packagingUnitId,
        baseQuantity: Number(r.baseQuantity),
        unitPrice: r.unitPrice === '' || r.unitPrice == null ? null : Number(r.unitPrice),
        isBaseUnit: !!r.isBaseUnit,
      }));
      const scalar = {
        ...values,
        purchasePrice: Number(values.purchasePrice),
        sellingPrice: Number(values.sellingPrice),
        minStockLevel: Number(values.minStockLevel),
        reorderQuantity: Number(values.reorderQuantity),
        barcode: values.barcode || null,
        imageUrl: values.imageUrl || null,
        description: values.description || null,
      };
      if (isEdit) {
        const { sku, ...rest } = scalar;
        await api.put(`/products/${editing.id}`, rest);
        await api.put(`/products/${editing.id}/packagings`, { packagings });
        return true;
      }
      if (!scalar.sku) delete scalar.sku;
      return api.post('/products', { ...scalar, packagings });
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Product updated' : 'Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit product' : 'New product'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>{isEdit ? 'Save changes' : 'Create product'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Product name" required error={errors.name?.message}>
          <Input {...register('name', { required: 'Name is required' })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SKU" hint={isEdit ? 'SKU cannot be changed' : 'Auto-generated if blank'}>
            <Input {...register('sku')} disabled={isEdit} />
          </Field>
          <Field label="Barcode"><Input {...register('barcode')} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Brand" required><Select {...register('brandId', { required: true })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Category" required><Select {...register('categoryId', { required: true })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Base unit"><Input {...register('baseUnitName')} placeholder="Pack" /></Field>
          <Field label="Purchase price" required><Input type="number" step="0.01" {...register('purchasePrice', { required: true })} /></Field>
          <Field label="Selling price" required><Input type="number" step="0.01" {...register('sellingPrice', { required: true })} /></Field>
          <Field label="Min stock"><Input type="number" {...register('minStockLevel')} /></Field>
        </div>
        <Field label="Reorder quantity (base units)"><Input type="number" {...register('reorderQuantity')} /></Field>

        <PackagingEditor rows={rows} setRows={setRows} units={units} />

        <Field label="Description"><Textarea rows={2} {...register('description')} /></Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" {...register('isActive')} className="h-4 w-4 rounded border-slate-300" /> Active
        </label>
      </div>
    </Modal>
  );
}

export default function Products() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [modal, setModal] = useState({ open: false, editing: null });
  const debounced = useDebounce(search);

  const { data: brands = [] } = useBrands();
  const { data: categories = [] } = useCategories();
  const { data: units = [] } = usePackagingUnits();

  const { data, isLoading } = useQuery({
    queryKey: ['products', { page, search: debounced, brandId, categoryId }],
    queryFn: async () => unwrap(await api.get('/products', { params: { page, limit: 15, search: debounced, brandId: brandId || undefined, categoryId: categoryId || undefined } })),
  });

  const del = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`),
    onSuccess: () => { toast.success('Product removed'); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div>
      <PageHeader title="Products" subtitle="Catalog, pricing and multi-level packaging.">
        <Button onClick={() => setModal({ open: true, editing: null })} disabled={!units.length}><Plus className="h-4 w-4" /> New product</Button>
      </PageHeader>

      {/* What the catalogue holds, before the list of it. Counted over the
          rows on screen, and the low-stock card only lights up when there is
          something to act on. */}
      {(() => {
        const rows = data?.data || [];
        const onHand = rows.reduce((n, p) => n + (p.onHandBase || 0), 0);
        const lowCount = rows.filter((p) => p.lowStock).length;
        const value = rows.reduce((n, p) => n + (p.onHandBase || 0) * Number(p.sellingPrice || 0), 0);
        const cards = [
          { label: 'Products', value: formatNumber(data?.meta?.total ?? rows.length), icon: Package, sub: 'in the catalogue',
            ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-300', num: 'text-brand-300' },
          { label: 'Boxes on hand', value: formatNumber(onHand), icon: Boxes, sub: 'across these products',
            ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
          { label: 'Worth at selling price', value: formatCurrency(value), icon: Wallet, sub: 'if every box sold',
            ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
          { label: 'Running low', value: formatNumber(lowCount), icon: TrendingDown, sub: lowCount ? 'reorder before they run out' : 'nothing needs reordering',
            ring: lowCount ? 'ring-rose-500/30' : 'ring-white/[0.07]', glow: lowCount ? 'from-rose-500/[0.14]' : 'from-white/[0.02]',
            chip: 'bg-rose-500/15 text-rose-300', num: lowCount ? 'text-rose-300' : 'text-foreground' },
        ];
        return (
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
        );
      })()}

      <Card>
        <div className="space-y-3 border-b border-border p-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, SKU, barcode…" />
          <div className="flex flex-wrap items-center gap-2">
            {/* Two brands is a choice, not a dropdown. */}
            {[{ id: '', name: 'All brands' }, ...brands].map((b) => (
              <button key={b.id || 'all'} type="button" onClick={() => { setBrandId(b.id); setPage(1); }}
                className={`cursor-pointer rounded-full px-3.5 py-2 text-sm font-medium ring-1 transition duration-200 ${
                  brandId === b.id ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
                {b.name}
              </button>
            ))}
            {categories.length > 0 && (
              <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="ml-auto sm:w-44">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </div>
        </div>

        {isLoading ? <PageSpinner /> : !data?.data?.length ? (
          <EmptyState title="No products" message="Create your first product to start tracking stock." icon={Package}
            action={<Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New product</Button>} />
        ) : (
          <>
            <Table>
              <THead><TR><TH>Product</TH><TH>Brand</TH><TH>Packaging</TH><TH>Pack price</TH><TH>On hand</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {data.data.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="font-medium text-foreground">{p.name}</div>
                      <div className="text-xs text-faint">{p.sku}</div>
                    </TD>
                    <TD>{p.brand?.name}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {p.packagings.sort((a, b) => a.baseQuantity - b.baseQuantity).map((pk) => (
                          <Badge key={pk.id} className="bg-white/[0.06] text-muted ring-1 ring-inset ring-white/[0.08]">{pk.packagingUnit.name}×{pk.baseQuantity}</Badge>
                        ))}
                      </div>
                    </TD>
                    <TD>{formatCurrency(p.sellingPrice)}</TD>
                    <TD>
                      <span className={`font-semibold tabular-nums ${p.onHandBase <= 0 ? 'text-rose-400' : p.lowStock ? 'text-amber-400' : 'text-foreground'}`}>
                        {formatNumber(p.onHandBase)}
                      </span> <span className="text-muted">{pluralizeUnit(p.baseUnitName)}</span>
                      {p.onHandBase <= 0
                        ? <Badge className="ml-2 bg-rose-500/15 text-rose-300">Out</Badge>
                        : p.lowStock && <Badge className="ml-2 bg-amber-500/15 text-amber-300">Low</Badge>}
                    </TD>
                    <TD><Badge className={p.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-muted'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <button title="Edit" className="cursor-pointer px-2 py-1 text-faint transition hover:text-brand-400" onClick={() => setModal({ open: true, editing: p })}><Pencil className="h-4 w-4" /></button>
                        <button title="Remove" className="cursor-pointer px-2 py-1 text-faint transition hover:text-rose-400" onClick={() => { if (confirm(`Remove ${p.name}?`)) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} totalPages={data.meta?.totalPages} total={data.meta?.total} onChange={setPage} />
          </>
        )}
      </Card>

      {modal.open && (
        <ProductModal open={modal.open} editing={modal.editing} brands={brands} categories={categories} units={units}
          onClose={() => setModal({ open: false, editing: null })} />
      )}
    </div>
  );
}
