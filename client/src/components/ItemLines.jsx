import { Plus, X } from 'lucide-react';
import { Select, Input, NumberInput } from '@/components/ui';
import { formatCurrency } from '@/lib/format';

// Reusable editor for product line items (product → packaging → quantity, with
// optional price and condition). `value` is an array of line objects; the
// parent owns the state and computes any totals.
export default function ItemLines({ products = [], value, onChange, showPrice = false, priceReadOnly = false, showCondition = false }) {
  const blank = { productId: '', packagingUnitId: '', quantity: 1, unitPrice: '', condition: 'GOOD' };

  const addLine = () => onChange([...value, { ...blank }]);
  const removeLine = (i) => onChange(value.filter((_, idx) => idx !== i));

  const patch = (i, p) => onChange(value.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  const onProduct = (i, productId) => {
    const product = products.find((p) => p.id === productId);
    const base = product?.packagings?.find((pk) => pk.isBaseUnit) || product?.packagings?.[0];
    patch(i, {
      productId,
      packagingUnitId: base?.packagingUnitId || '',
      unitPrice: showPrice ? suggestPrice(product, base) : '',
    });
  };

  const onPackaging = (i, line, packagingUnitId) => {
    const product = products.find((p) => p.id === line.productId);
    const pk = product?.packagings?.find((x) => x.packagingUnitId === packagingUnitId);
    patch(i, { packagingUnitId, unitPrice: showPrice ? suggestPrice(product, pk) : line.unitPrice });
  };

  function suggestPrice(product, pk) {
    if (!product || !pk) return '';
    if (pk.unitPrice != null) return Number(pk.unitPrice);
    return Number(product.sellingPrice) * pk.baseQuantity;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Items</span>
        <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add item
        </button>
      </div>

      {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-sm text-faint">No items added yet</p>}

      {value.map((line, i) => {
        const product = products.find((p) => p.id === line.productId);
        const packagings = (product?.packagings || []).slice().sort((a, b) => a.baseQuantity - b.baseQuantity);
        return (
          <div key={i} className="rounded-lg border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={line.productId} onChange={(e) => onProduct(i, e.target.value)} className="min-w-[180px] flex-1">
                <option value="">Select product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select value={line.packagingUnitId} onChange={(e) => onPackaging(i, line, e.target.value)} className="w-32" disabled={!product}>
                {packagings.map((pk) => <option key={pk.id} value={pk.packagingUnitId}>{pk.packagingUnit.name} (×{pk.baseQuantity})</option>)}
              </Select>
              <NumberInput min="1" value={line.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} className="w-20" placeholder="Qty" />
              {showPrice && (priceReadOnly ? (
                <div className="flex h-[38px] w-28 items-center justify-end rounded-lg bg-elevated px-3 text-sm font-medium text-muted" title="Price per unit">
                  {line.unitPrice !== '' && line.unitPrice != null ? formatCurrency(line.unitPrice) : '—'}
                </div>
              ) : (
                <NumberInput min="0" value={line.unitPrice} onChange={(e) => patch(i, { unitPrice: e.target.value })} className="w-28" placeholder="Unit price" />
              ))}
              {showCondition && (
                <Select value={line.condition} onChange={(e) => patch(i, { condition: e.target.value })} className="w-28">
                  <option value="GOOD">Good</option>
                  <option value="DAMAGED">Damaged</option>
                </Select>
              )}
              <button type="button" onClick={() => removeLine(i)} className="text-faint hover:text-rose-600"><X className="h-4 w-4" /></button>
            </div>
            {showPrice && line.unitPrice !== '' && line.quantity > 0 && (
              <div className="mt-1 text-right text-xs text-muted">Line: {formatCurrency(Number(line.unitPrice) * line.quantity)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
