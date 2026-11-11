import { useState, useEffect, useMemo, useRef, useId, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { useForm, Controller } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Package, X, TrendingDown, Boxes, Wallet, Check, ChevronDown } from 'lucide-react';
import api, { apiError } from '@/lib/api';
import { pageQueries, keepOnPageTurn } from '@/lib/pageQueries';
import { useBrands, useCategories, usePackagingUnits, useProducts, useDebounce } from '@/lib/hooks';
import { formatCurrency, formatNumber, pluralizeUnit } from '@/lib/format';
import { brandInName, closestProduct, setupFrom, usualCategory, setupParts, sameNameAs, otherKind, unitPlural } from '@/lib/productDefaults';
import {
  PageHeader, Card, PageSpinner, EmptyState, Badge, Button, Modal, Field, Input, NumberInput, Select, Textarea,
  SearchInput, Pagination, LoadError, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';

function PackagingEditor({ rows, setRows, units, unitWord, unitsWord }) {
  const update = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setBase = (i) => setRows(rows.map((r, idx) => ({ ...r, isBaseUnit: idx === i, baseQuantity: idx === i ? 1 : r.baseQuantity })));
  const addRow = () => setRows([...rows, { packagingUnitId: units[0]?.id || '', baseQuantity: 1, unitPrice: '', isBaseUnit: false }]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Packaging levels</span>
        {/* A thumb-sized target on a phone; the same small link from sm: up. */}
        <button type="button" onClick={addRow} className="-mr-2 inline-flex min-h-[44px] cursor-pointer items-center px-2 text-xs font-medium text-muted transition hover:text-foreground sm:mr-0 sm:min-h-0 sm:px-0">+ Add level</button>
      </div>
      <p className="text-xs text-faint">Pick the base unit (factor 1). Larger units store how many base units they contain (e.g. Carton = 50). A blank price is the selling price times that number.</p>
      <div className="space-y-2">
        {/* On a phone the unit, base and remove share the first line, and the count and the price get half
            the second line each, so "50 boxes" and a carton price are never cut off. One line from sm: up. */}
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 sm:flex-nowrap">
            <Select aria-label="Packaging unit" value={r.packagingUnitId} onChange={(e) => update(i, { packagingUnitId: e.target.value })} className="order-1 min-w-0 flex-1 basis-40 sm:order-none sm:basis-0">
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            {/* The count says what it counts: "50 boxes", not a bare 50. */}
            <div className="relative order-4 w-[calc(50%-0.25rem)] sm:order-none sm:w-32 sm:flex-none">
              <NumberInput aria-label={`How many ${unitsWord} this level holds`} min="1" value={r.baseQuantity} disabled={r.isBaseUnit}
                onChange={(e) => update(i, { baseQuantity: Number(e.target.value) })} className="pr-12" placeholder="Qty" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-faint">
                {Number(r.baseQuantity) === 1 ? unitWord : unitsWord}
              </span>
            </div>
            <NumberInput aria-label="Price for this level (optional)" min="0" value={r.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} className="order-5 w-[calc(50%-0.25rem)] min-w-0 sm:order-none sm:w-28 sm:flex-none" placeholder="Price" />
            <label className="order-2 flex min-h-[44px] cursor-pointer items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted sm:order-none sm:min-h-0">
              <input type="radio" name="baseUnit" checked={r.isBaseUnit} onChange={() => setBase(i)} className="h-4 w-4 accent-zinc-300" /> base
            </label>
            <button type="button" aria-label="Remove level" onClick={() => removeRow(i)}
              className="order-3 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-faint hover:text-rose-600 sm:order-none sm:h-auto sm:w-auto sm:p-1"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

const levelsOk = (rows) => rows.every((r) => Number.isInteger(Number(r.baseQuantity)) && Number(r.baseQuantity) >= 1);
const LEVELS_MSG = 'Enter how many base units each packaging level holds (e.g. Carton = 50), or remove the empty level.';
// The four things asked up front, in the order Enter walks through them.
const REQUIRED = ['name', 'brandId', 'purchasePrice', 'sellingPrice'];
const blank = (v) => v == null || String(v).trim() === '';
const TAKEN = {
  sku: 'Another product already has this SKU. Clear it and one is made for you.',
  barcode: 'Another product already has this barcode.',
};
const BAD = 'border-rose-500/60';

/*
  NEW PRODUCT IN FOUR THINGS (Nino, 11 Nov 2026: "adding a product should not be hard ... the SKU must fill
  itself ... the other things should be automatic"). Up front: the name, the brand, what a box costs and what
  it sells for. The rest is filled in from the product most like it (lib/productDefaults) and shown as one
  quiet line that opens every field as before. The SKU is left blank, so the server makes it and checks no
  product has it; the toast shows the one the server gave.
  Refused here, before anything is sent: a name another product already has (nobody could tell the two
  apart in a list), and a save while the usual packaging has not loaded (it would go up as a bare box with
  no carton and no stock levels). A SKU or barcode the server says is taken is pinned to its own box.
  Editing shows the same window with every field open and filled; nothing is copied over an edit.
  The body sent is the same as before: same fields, a blank SKU left out.
*/
function ProductModal({ open, onClose, editing, brands, categories, units }) {
  const qc = useQueryClient();
  const isEdit = !!editing;
  const formId = useId();
  const moreId = useId();
  const { data: products = [], isSuccess: productsReady, isError: productsFailed } = useProducts();
  // Nothing typed yet: the setup most products share.
  const [start] = useState(() => (isEdit ? null : closestProduct(products, { brandId: brands.length === 1 ? brands[0].id : '' })));
  const startSetup = start ? setupFrom(start) : null;

  const { register, control, handleSubmit, watch, setValue, getValues, reset, setFocus, setError, clearErrors, trigger, formState: { errors } } = useForm({
    defaultValues: editing
      ? {
          name: editing.name, sku: editing.sku, barcode: editing.barcode || '', brandId: editing.brandId, categoryId: editing.categoryId,
          purchasePrice: Number(editing.purchasePrice), sellingPrice: Number(editing.sellingPrice),
          minStockLevel: editing.minStockLevel, reorderQuantity: editing.reorderQuantity, baseUnitName: editing.baseUnitName,
          description: editing.description || '', imageUrl: editing.imageUrl || '', isActive: editing.isActive,
        }
      : {
          // No brand until one is tapped or the name says it: the brand decides which account a box is paid to.
          name: '', sku: '', barcode: '', brandId: brands.length === 1 ? brands[0].id : '', categoryId: usualCategory(products, categories),
          purchasePrice: '', sellingPrice: '',
          // Before the list loads, the base unit is named after the base level below, not a 'Pack' that is not there.
          minStockLevel: startSetup?.minStockLevel ?? 0, reorderQuantity: startSetup?.reorderQuantity ?? 0,
          baseUnitName: startSetup?.baseUnitName || units[0]?.name || 'Pack',
          description: '', imageUrl: '', isActive: true,
        },
  });

  const fallbackRows = [{ packagingUnitId: units[0]?.id || '', baseQuantity: 1, isBaseUnit: true, unitPrice: '' }];
  const initialRows = editing
    ? editing.packagings.map((p) => ({ packagingUnitId: p.packagingUnitId, baseQuantity: p.baseQuantity, unitPrice: p.unitPrice ?? '', isBaseUnit: p.isBaseUnit }))
    : startSetup?.rows || fallbackRows;
  const [rows, setRowsState] = useState(initialRows.length ? initialRows : fallbackRows);
  // `auto`: the packaging, base unit and stock levels follow the closest product until changed by hand.
  const [auto, setAuto] = useState(!isEdit);
  const [copiedFrom, setCopiedFrom] = useState(start?.name || null);
  const [showMore, setShowMore] = useState(isEdit);
  const [levelsError, setLevelsError] = useState('');
  const [lastAdded, setLastAdded] = useState(null);
  // Products saved from this window, so a twin is refused before the product list has reloaded.
  const added = useRef([]);
  const busy = useRef(false);

  const byHand = () => { if (auto) { setAuto(false); setCopiedFrom(null); } };
  const setRows = (next) => { setRowsState(next); setLevelsError(''); byHand(); };

  const [name, brandId, sku, categoryId, baseUnitName, minStockLevel, reorderQuantity, purchasePrice, sellingPrice] =
    watch(['name', 'brandId', 'sku', 'categoryId', 'baseUnitName', 'minStockLevel', 'reorderQuantity', 'purchasePrice', 'sellingPrice']);

  // The brand the name spells out ("OHIS Ndogo ...") is picked for you. Only when what the name says
  // changes, so a brand tapped after that stays tapped.
  const named = isEdit ? null : brandInName(name, brands);
  useEffect(() => {
    if (named) { setValue('brandId', named); clearErrors('brandId'); }
  }, [named]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Save & add another" keeps the prices for the next product of the same brand. The other brand sells at
  // its own prices (an OHIS box is about half a Civlily one), so prices still carried over are cleared.
  useEffect(() => {
    if (!lastAdded || !brandId || brandId === lastAdded.brandId) return;
    const [buy, sell] = getValues(['purchasePrice', 'sellingPrice']);
    if (String(buy) === String(lastAdded.purchasePrice) && String(sell) === String(lastAdded.sellingPrice)) {
      setValue('purchasePrice', '');
      setValue('sellingPrice', '');
    }
  }, [brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = useMemo(() => (isEdit ? null : closestProduct(products, { brandId, name })), [isEdit, products, brandId, name]);
  useEffect(() => {
    if (!auto || !source) return;
    const s = setupFrom(source);
    setRowsState(s.rows);
    setValue('baseUnitName', s.baseUnitName);
    setValue('minStockLevel', s.minStockLevel);
    setValue('reorderQuantity', s.reorderQuantity);
    setCopiedFrom(source.name);
    setLevelsError('');
  }, [auto, source?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The products may arrive after the window opened.
  useEffect(() => {
    if (isEdit || getValues('categoryId')) return;
    const c = usualCategory(products, categories);
    if (c) setValue('categoryId', c);
  }, [isEdit, products, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async ({ values }) => {
      // A level left blank went up as 0 and came back only as "Validation failed".
      if (!levelsOk(rows)) throw new Error(LEVELS_MSG);
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
        // Spaces alone are no barcode: two products with "  " would clash on the unique barcode.
        barcode: String(values.barcode || '').trim() || null,
        imageUrl: values.imageUrl || null,
        description: values.description || null,
      };
      if (isEdit) {
        const { sku, ...rest } = scalar;
        await api.put(`/products/${editing.id}`, rest);
        await api.put(`/products/${editing.id}/packagings`, { packagings });
        return true;
      }
      // A SKU of spaces is no SKU: left out, so the server makes one, as the summary line promises.
      const typedSku = String(values.sku || '').trim();
      if (typedSku) scalar.sku = typedSku;
      else delete scalar.sku;
      return api.post('/products', { ...scalar, packagings });
    },
    onSuccess: (res, { addAnother }) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      if (isEdit) { toast.success('Product updated'); onClose(); return; }
      // The SKU the server gave is the one that counts.
      const made = res?.data?.data;
      if (made?.id) added.current.push({ id: made.id, name: made.name });
      if (!addAnother) {
        toast.success(made?.sku ? `Product created · SKU ${made.sku}` : 'Product created');
        onClose();
        return;
      }
      // Said once, in the window (no toast on top of it). Keep the brand, prices, category and packaging;
      // clear what belongs to one product only.
      const [buy, sell, brand] = getValues(['purchasePrice', 'sellingPrice', 'brandId']);
      setLastAdded({ name: made?.name || getValues('name'), sku: made?.sku, brandId: brand, purchasePrice: buy, sellingPrice: sell });
      reset({ ...getValues(), name: '', sku: '', barcode: '', description: '', imageUrl: '' });
      setTimeout(() => setFocus('name'), 0);
    },
    onError: (e) => {
      const msg = apiError(e);
      // A taken SKU or barcode is said on its own box, opened, not only in a toast.
      const field = e?.response?.status === 409 ? (/barcode/i.test(msg) ? 'barcode' : /sku/i.test(msg) ? 'sku' : null) : null;
      if (!field) { toast.error(msg); return; }
      setShowMore(true);
      setError(field, { type: 'taken', message: TAKEN[field] });
      toast.error(TAKEN[field]);
      setTimeout(() => setFocus(field), 50);
    },
    onSettled: () => { busy.current = false; },
  });

  const submit = (addAnother) => handleSubmit(
    (values) => {
      if (busy.current) return; // a second Enter while saving must not make a second product
      // Two products with one name cannot be told apart in any list. An edit that keeps the product's own
      // name still saves, so an old twin never locks its own editing.
      const dupe = sameNameAs([...products, ...added.current], values.name, editing?.id);
      const renamed = !isEdit || !sameNameAs([editing], values.name);
      if (dupe && renamed) {
        setError('name', { type: 'duplicate', message: `There is already a product called ${dupe.name}. Give this one its own name.` });
        setFocus('name');
        return;
      }
      // Nothing to copy the packaging from yet: never save the bare fallback without it being seen.
      if (!isEdit && auto && !source) {
        if (!productsReady && !productsFailed) { setLevelsError('Still loading the usual packaging. Try again in a moment.'); return; }
        if (!showMore) {
          setShowMore(true);
          setLevelsError(productsFailed
            ? 'Could not load the usual packaging. Check the levels below, then save again.'
            : 'No product like this one to copy from. Check the levels below, then save again.');
          return;
        }
      }
      if (!levelsOk(rows)) { setLevelsError(LEVELS_MSG); setShowMore(true); return; }
      busy.current = true;
      save.mutate({ values, addAnother });
    },
    (errs) => { if (errs.categoryId || errs.sku || errs.barcode || errs.baseUnitName) setShowMore(true); },
  )();

  // Enter in the name or the buying price goes on to the next of the four still empty; once all four are
  // filled (or from the selling price, the last one) it saves. Half a form no longer saves into three errors.
  const nextBlank = (at, v) => [...REQUIRED.slice(at + 1), ...REQUIRED.slice(0, at)].find((k) => blank(v[k]));
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return;
    const at = REQUIRED.indexOf(e.target?.name);
    if (at < 0 || at === REQUIRED.length - 1) return;
    const v = getValues();
    if (blank(v[REQUIRED[at]])) { e.preventDefault(); trigger(REQUIRED[at]); return; }
    const next = nextBlank(at, v);
    if (!next) return;
    e.preventDefault();
    setFocus(next);
  };
  const shown = { name, brandId, purchasePrice, sellingPrice };
  const keyHint = (at) => (nextBlank(at, shown) ? 'next' : 'done');

  const unitWord = String(baseUnitName || '').trim().toLowerCase() || 'box';
  const unitsWord = unitPlural(unitWord);
  const parts = setupParts({ rows, units, baseUnitName, minStockLevel, reorderQuantity });
  if (categories.length > 1) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) parts.unshift(cat.name);
  }
  const typedSku = String(sku || '').trim();
  const skuShown = isEdit ? editing.sku : typedSku || 'automatic';
  const setupNote = isEdit ? 'Barcode, category, packaging, stock levels, description'
    : !auto ? 'Set by you'
    : copiedFrom ? (!String(name || '').trim() && !brandId ? 'Same setup as most products' : `Same packaging as ${copiedFrom}`)
    : productsFailed ? 'Could not load the usual packaging. Check it under Change'
    : !productsReady ? 'Loading the usual packaging…'
    : 'No product like it yet. Check the packaging under Change';
  const twin = sameNameAs([...products, ...added.current], name, editing?.id);
  const twinBlocks = twin && (!isEdit || !sameNameAs([editing], name));
  // The prices kept from the last product, still untouched: said under them, louder when the size or the
  // filter differs (a Kubwa or a Na Filter box sells for more).
  const keptPrices = !isEdit && lastAdded && !blank(purchasePrice)
    && String(purchasePrice) === String(lastAdded.purchasePrice) && String(sellingPrice) === String(lastAdded.sellingPrice);
  const checkPrices = keptPrices && otherKind(name, lastAdded.name);
  const sellsAtLoss = !blank(purchasePrice) && !blank(sellingPrice) && Number(sellingPrice) <= Number(purchasePrice);
  const pending = save.isPending;
  const pendingAgain = pending && save.variables?.addAnother;
  // A phone gets two thumb-sized buttons sharing the row, Save last; the X above closes the window.
  const footBtn = 'min-h-[44px] flex-1 sm:min-h-0 sm:flex-none';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit product' : 'New product'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="hidden sm:inline-flex">Cancel</Button>
          {!isEdit && (
            <Button type="button" variant="secondary" disabled={pending} loading={pendingAgain} onClick={() => submit(true)} className={footBtn}>Save &amp; add another</Button>
          )}
          <Button type="submit" form={formId} disabled={pending} loading={pending && !pendingAgain} className={footBtn}>{isEdit ? 'Save changes' : 'Save'}</Button>
        </>
      }
    >
      {/* A real form, so Enter saves. Checks are the ones below, not the browser's. */}
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); submit(false); }} onKeyDown={onKeyDown} className="space-y-4">
        {lastAdded && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-xs leading-5 text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
            <Check className="mt-1 h-3.5 w-3.5 shrink-0" />
            <span><span className="font-semibold">{lastAdded.name}</span> added{lastAdded.sku ? ` · SKU ${lastAdded.sku}` : ''}. Type the next one.</span>
          </p>
        )}

        <Field label="Product name" required error={errors.name?.message}>
          <Input maxLength={200} autoFocus={!isEdit} autoComplete="off" aria-invalid={!!errors.name} enterKeyHint={keyHint(0)}
            className={errors.name ? BAD : undefined}
            placeholder={isEdit ? undefined : 'e.g. Civlily Kubwa (Mix) - Bila Filter'}
            {...register('name', { validate: (v) => String(v || '').trim() !== '' || 'Enter the product name' })} />
          {twin && !errors.name && (
            <p className="mt-1 text-xs text-amber-300">There is already a product called {twin.name}.{twinBlocks ? ' Give this one its own name.' : ''}</p>
          )}
        </Field>

        {/* Two brands is a choice, not a dropdown. */}
        <Field label="Brand" required error={errors.brandId?.message}>
          <Controller name="brandId" control={control} rules={{ required: 'Pick the brand' }} render={({ field }) => (
            <div role="radiogroup" aria-label="Brand" aria-invalid={!!errors.brandId} className="flex flex-wrap gap-2">
              {brands.map((b, i) => {
                const on = field.value === b.id;
                return (
                  <button key={b.id} ref={i === 0 ? field.ref : undefined} type="button" role="radio" aria-checked={on} onClick={() => field.onChange(b.id)}
                    className={`inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold ring-1 ring-inset transition duration-150 sm:min-h-[40px] sm:min-w-[8.5rem] sm:flex-none ${on
                      ? 'bg-white/[0.10] text-foreground ring-white/30'
                      : `bg-transparent text-muted hover:bg-white/[0.05] hover:text-foreground ${errors.brandId ? 'ring-rose-500/60' : 'ring-white/10'}`}`}>
                    {on && <Check className="h-4 w-4" />}{b.name}
                  </button>
                );
              })}
            </div>
          )} />
        </Field>

        {/* Controlled, not register(): register writes the saved price straight
            into the DOM, and the box would open showing 12500 instead of 12,500. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label={`Buying price / ${unitWord}`} required error={errors.purchasePrice?.message}>
            <Controller name="purchasePrice" control={control} rules={{ required: 'Enter the buying price' }}
              render={({ field }) => <NumberInput min="0" aria-invalid={!!errors.purchasePrice} enterKeyHint={keyHint(2)}
                className={errors.purchasePrice ? BAD : undefined} {...field} />} />
          </Field>
          <Field label={`Selling price / ${unitWord}`} required error={errors.sellingPrice?.message}>
            <Controller name="sellingPrice" control={control} rules={{ required: 'Enter the selling price' }}
              render={({ field }) => <NumberInput min="0" aria-invalid={!!errors.sellingPrice} enterKeyHint="done"
                className={errors.sellingPrice ? BAD : undefined} {...field} />} />
          </Field>
        </div>
        {/* A warning, not a block: the server's price rules are unchanged. */}
        {sellsAtLoss ? (
          <p className="-mt-2 text-xs text-amber-300">The selling price is not above the buying price. Check both before saving.</p>
        ) : keptPrices ? (
          <p className={`-mt-2 text-xs ${checkPrices ? 'text-amber-300' : 'text-faint'}`}>
            Same prices as {lastAdded.name}.{checkPrices ? ' This one is a different size or filter: check them.' : ' Change them if this one sells for a different price.'}
          </p>
        ) : null}

        {/* Everything else, filled in: one line, and every field under it when opened. */}
        <div>
          <button type="button" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore} aria-controls={moreId}
            className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl bg-white/[0.03] px-3.5 py-3 text-left ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.05]">
            <span className="min-w-0 text-xs leading-5">
              <span className="block text-muted">
                <span className="text-foreground">SKU {skuShown}</span>
                {parts.map((p, i) => <span key={i}> · {p}</span>)}
              </span>
              <span className="block text-faint">{setupNote}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold text-foreground">
              {showMore ? 'Hide' : 'Change'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {levelsError && !showMore && <p role="alert" className="mt-2 text-xs text-rose-400">{levelsError}</p>}

          {showMore && (
            <div id={moreId} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="SKU" error={errors.sku?.message} hint={isEdit ? 'SKU cannot be changed' : 'Made when you save. Never repeats.'}>
                  <Input {...register('sku')} disabled={isEdit} autoComplete="off" maxLength={60} aria-invalid={!!errors.sku}
                    className={errors.sku ? BAD : undefined} placeholder={isEdit ? undefined : 'Automatic – leave blank'} />
                </Field>
                <Field label="Barcode" error={errors.barcode?.message} hint={isEdit ? undefined : 'Optional'}>
                  <Input {...register('barcode')} autoComplete="off" maxLength={60} aria-invalid={!!errors.barcode}
                    className={errors.barcode ? BAD : undefined} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Category" required error={errors.categoryId?.message}>
                  <Select {...register('categoryId', { required: 'Pick the category' })}>
                    {!categoryId && <option value="">Pick…</option>}
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Base unit"><Input {...register('baseUnitName', { onChange: byHand })} placeholder="Box" /></Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Min stock">
                  <Controller name="minStockLevel" control={control}
                    render={({ field }) => <NumberInput min="0" {...field} onChange={(e) => { field.onChange(e); byHand(); }} />} />
                </Field>
                <Field label="Reorder quantity (base units)">
                  <Controller name="reorderQuantity" control={control}
                    render={({ field }) => <NumberInput min="0" {...field} onChange={(e) => { field.onChange(e); byHand(); }} />} />
                </Field>
              </div>

              {!isEdit && !auto && source && (
                <p className="text-xs text-faint">
                  Set by you.{' '}
                  <button type="button" onClick={() => setAuto(true)} className="cursor-pointer font-semibold text-foreground underline-offset-2 hover:underline">
                    Use the same as {source.name}
                  </button>
                </p>
              )}
              <PackagingEditor rows={rows} setRows={setRows} units={units} unitWord={unitWord} unitsWord={unitsWord} />
              {levelsError && <p role="alert" className="text-xs text-rose-400">{levelsError}</p>}

              <Field label="Description"><Textarea rows={2} {...register('description')} /></Field>
              <label className="flex min-h-[44px] w-fit cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-0">
                <input type="checkbox" {...register('isActive')} className="h-4 w-4 rounded accent-zinc-300" /> Active
              </label>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}


// The Pepa product label — the page a carton's QR code opens — belongs with the products (Nino, 11 Nov
// 2026: "the Label should go inside the Products page"). Loaded only when its tab is opened.
const ProductLabel = lazy(() => import('@/pages/ProductLabel'));
const PRODUCT_TABS = [['catalogue', 'Products'], ['label', 'Label']];

export default function Products() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const isOwner = role === ROLES.ADMIN;
  const tab = isOwner && params.get('tab') === 'label' ? 'label' : 'catalogue';
  if (!isOwner) return <ProductsCatalogue />;
  return (
    <div>
      {/* The same pill tabs as Finance. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PRODUCT_TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setParams(k === 'catalogue' ? {} : { tab: k }, { replace: true })}
            aria-current={tab === k ? 'page' : undefined}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold ring-1 transition duration-200 ${tab === k
              ? 'bg-brand-500 text-white ring-brand-500'
              : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {tab === 'label' ? <Suspense fallback={<PageSpinner />}><ProductLabel /></Suspense> : <ProductsCatalogue />}
    </div>
  );
}

function ProductsCatalogue() {
  const qc = useQueryClient();
  // Creating, editing and removing products is the owner's (the server refuses staff); staff see the list.
  const isOwner = useAuth().role === ROLES.ADMIN;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [modal, setModal] = useState({ open: false, editing: null });
  const debounced = useDebounce(search);

  const { data: brands = [] } = useBrands();
  const { data: categories = [] } = useCategories();
  const { data: units = [] } = usePackagingUnits();

  const { data, isLoading, isError, refetch } = useQuery({
    ...pageQueries.products({ page, search: debounced, brandId, categoryId }),
    placeholderData: keepOnPageTurn({ brandId, categoryId }),
  });

  const del = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`),
    onSuccess: () => { toast.success('Product removed'); qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div>
      <PageHeader title="Products" subtitle="Catalog, pricing and multi-level packaging.">
        {isOwner && <Button onClick={() => setModal({ open: true, editing: null })} disabled={!units.length}><Plus className="h-4 w-4" /> New product</Button>}
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
            ring: 'ring-brand-500/25', glow: 'from-brand-500/[0.12]', chip: 'bg-brand-500/15 text-brand-600', num: 'text-brand-600' },
          { label: 'Boxes on hand', value: formatNumber(onHand), icon: Boxes, sub: 'across these products',
            ring: 'ring-violet-500/25', glow: 'from-violet-500/[0.14]', chip: 'bg-violet-500/15 text-violet-300', num: 'text-violet-300' },
          { label: 'Worth at selling price', value: formatCurrency(value), icon: Wallet, sub: 'if every box sold',
            ring: 'ring-emerald-500/25', glow: 'from-emerald-500/[0.12]', chip: 'bg-emerald-500/15 text-emerald-300', num: 'text-emerald-300' },
          { label: 'Running low', value: formatNumber(lowCount), icon: TrendingDown, sub: lowCount ? 'reorder before they run out' : 'nothing needs reordering',
            ring: lowCount ? 'ring-amber-500/30' : 'ring-white/[0.07]', glow: lowCount ? 'from-amber-500/[0.16]' : 'from-white/[0.02]',
            chip: 'bg-amber-500/15 text-amber-400', num: lowCount ? 'text-amber-300' : 'text-foreground' },
        ];
        // A failed load shows dashes, not a catalogue of zero (kept apart from the tiles above).
        if (isError && !data) cards.forEach((c) => { c.value = '—'; c.sub = "couldn't load"; });
        return (
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="stat-glass p-4">
                <div className="relative flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-muted">{c.label}</p>
                  <span className={`rounded-full p-1.5 ring-1 ring-inset ring-white/10 ${c.chip}`}><c.icon className="h-3.5 w-3.5" /></span>
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
                  brandId === b.id ? 'bg-brand-500/15 text-brand-600 ring-brand-500/30' : 'bg-transparent text-muted ring-white/10 hover:bg-white/[0.05] hover:text-foreground'}`}>
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

        {isLoading ? <PageSpinner /> : isError && !data ? <LoadError what="the products" onRetry={refetch} /> : !data?.data?.length ? (
          debounced || brandId || categoryId ? (
            <EmptyState title="No products match" message="Nothing matches this search or filter. Try another, or clear it." icon={Package} />
          ) : (
            <EmptyState title="No products" message="Create your first product to start tracking stock." icon={Package}
              action={isOwner && <Button onClick={() => setModal({ open: true, editing: null })}><Plus className="h-4 w-4" /> New product</Button>} />
          )
        ) : (
          <>
            <Table>
              <THead><TR><TH>Product</TH><TH>Brand</TH><TH>Packaging</TH><TH>Pack price</TH><TH>On hand</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {data.data.map((p) => (
                  <TR key={p.id}>
                    <TD className="min-w-[12rem] whitespace-normal">
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
                      {/* Low is the warehouse against its minimum; the count above includes the reps' boxes. */}
                      {p.onHandBase > 0 && p.lowStock && p.warehouseBase !== p.onHandBase && (
                        <div className="text-[11px] text-faint">{formatNumber(p.warehouseBase)} in the warehouse</div>
                      )}
                    </TD>
                    <TD><Badge className={p.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-muted'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></TD>
                    <TD>
                      <div className="flex justify-end gap-1">{isOwner && <>
                        <button title="Edit" className="cursor-pointer px-2 py-1 text-faint transition hover:text-brand-600" onClick={() => setModal({ open: true, editing: p })}><Pencil className="h-4 w-4" /></button>
                        <button title="Remove" className="cursor-pointer px-2 py-1 text-faint transition hover:text-rose-400" onClick={() => { if (confirm(`Remove ${p.name}?`)) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></button>
                      </>}</div>
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
