import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Receipt, Download, Share2, Plus, Trash2, Search, ArrowLeft, Check, Package,
} from 'lucide-react';
import api, { unwrap } from '@/lib/api';
import { useProducts } from '@/lib/hooks';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Field, Input, NumberInput, EmptyState,
} from '@/components/ui';
import { INVOICE_COMPANY, INVOICE_PAYMENT, INVOICE_TERMS, INVOICE_FOOTER } from '@/lib/invoiceConfig';
import { invoiceBlob, invoiceFilename } from '@/lib/invoicePdf';

const tzs = (n) => `${Number(n || 0).toLocaleString('en-US')} TZS`;

// Per-device running invoice number, e.g. INV-2026-001. (Document tool — no
// server record, so numbering is local to this device/year.)
function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const key = `haostock.invoiceSeq.${year}`;
  const n = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
  localStorage.setItem(key, String(n));
  return `INV-${year}-${String(n).padStart(3, '0')}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ── On-screen "paper" invoice preview (mirrors the PDF) ──────────────────────
function InvoicePreview({ inv }) {
  return (
    <div id="invoice-paper" className="mx-auto max-w-[640px] rounded-2xl bg-white p-6 text-slate-900 shadow-card sm:p-8">
      {/* Header */}
      <div className="border-b-2 border-lime-500 pb-4 text-center">
        <h2 className="text-2xl font-black tracking-tight text-lime-700">{INVOICE_COMPANY.name}</h2>
        <p className="mt-1 text-xs text-slate-500">TIN: {INVOICE_COMPANY.tin}</p>
        <p className="text-xs text-slate-500">{INVOICE_COMPANY.location}</p>
      </div>

      {/* Bill to + meta */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Bill to</div>
          <div className="font-bold">{inv.customer.name}</div>
          {inv.customer.business && <div className="text-sm text-slate-600">{inv.customer.business}</div>}
          {inv.customer.phone && <div className="text-sm text-slate-600">Tel: {inv.customer.phone}</div>}
          {inv.customer.tin && <div className="text-sm text-slate-600">TIN: {inv.customer.tin}</div>}
          {inv.customer.location && <div className="text-sm text-slate-600">{inv.customer.location}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bold text-slate-900">{inv.number}</div>
          <div className="text-xs text-slate-500">{inv.date}</div>
        </div>
      </div>

      {/* Items */}
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-lime-500 text-left text-slate-900">
            <th className="rounded-l px-3 py-2 font-bold">Item</th>
            <th className="px-2 py-2 text-right font-bold">Qty</th>
            <th className="px-2 py-2 text-right font-bold">Unit Price</th>
            <th className="rounded-r px-3 py-2 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="px-3 py-2">{it.name}</td>
              <td className="px-2 py-2 text-right tabular-nums">{it.qty}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(it.unitPrice).toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{(it.qty * it.unitPrice).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Grand total */}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-lime-50 px-3 py-3">
        <span className="font-bold text-lime-800">GRAND TOTAL</span>
        <span className="text-lg font-black text-lime-800 tabular-nums">{tzs(inv.total)}</span>
      </div>

      {/* Payment details */}
      <div className="mt-5">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-700">{INVOICE_PAYMENT.title}</div>
        <div className="mt-1 space-y-0.5 text-sm text-slate-700">
          {INVOICE_PAYMENT.lines.map(([k, v]) => (
            <div key={k}><span className="text-slate-400">{k}:</span> <span className="font-medium">{v}</span></div>
          ))}
          <div><span className="text-slate-400">Name:</span> <span className="font-bold">{INVOICE_PAYMENT.accountName}</span></div>
        </div>
      </div>

      {/* Terms */}
      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-700">Terms &amp; Conditions</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
          {INVOICE_TERMS.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </div>

      <p className="mt-5 border-t border-slate-100 pt-3 text-center text-xs italic text-lime-700">{INVOICE_FOOTER}</p>
    </div>
  );
}

export default function InvoiceGenerator() {
  const { data: products = [] } = useProducts(); // canonical order + sellingPrice
  const { data: availableIds = [] } = useQuery({
    queryKey: ['stock-requests', 'available-products'],
    queryFn: async () => unwrap(await api.get('/stock-requests/available-products')).data,
  });

  const inStock = useMemo(() => {
    const ok = new Set(availableIds);
    return products.filter((p) => ok.has(p.id));
  }, [products, availableIds]);

  const [customer, setCustomer] = useState({ name: '', business: '', phone: '', tin: '', location: '' });
  const [cart, setCart] = useState([]); // [{ productId, name, unitPrice, qty }]
  const [search, setSearch] = useState('');
  const [invoice, setInvoice] = useState(null);

  const setField = (k) => (e) => setCustomer((c) => ({ ...c, [k]: e.target.value }));

  const inCart = useMemo(() => new Set(cart.map((c) => c.productId)), [cart]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inStock.filter((p) => !inCart.has(p.id) && (!q || p.name.toLowerCase().includes(q)));
  }, [inStock, search, inCart]);

  const addProduct = (p) => {
    setCart((c) => [...c, { productId: p.id, name: p.name, unitPrice: Number(p.sellingPrice) || 0, qty: 1 }]);
    setSearch('');
  };
  const setQty = (id, v) => setCart((c) => c.map((x) => (x.productId === id ? { ...x, qty: Math.max(1, Math.trunc(Number(v)) || 1) } : x)));
  const removeItem = (id) => setCart((c) => c.filter((x) => x.productId !== id));

  const grandTotal = cart.reduce((s, x) => s + x.qty * x.unitPrice, 0);
  const valid = customer.name.trim() && customer.phone.trim() && cart.length > 0;

  const generate = () => {
    if (!valid) return;
    setInvoice({
      number: nextInvoiceNumber(),
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      customer: {
        name: customer.name.trim(),
        business: customer.business.trim(),
        phone: customer.phone.trim(),
        tin: customer.tin.trim(),
        location: customer.location.trim(),
      },
      items: cart.map((x) => ({ name: x.name, qty: x.qty, unitPrice: x.unitPrice })),
      total: grandTotal,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const download = () => {
    triggerDownload(invoiceBlob(invoice), invoiceFilename(invoice));
    toast.success('Invoice downloaded');
  };

  const share = async () => {
    const blob = invoiceBlob(invoice);
    const file = new File([blob], invoiceFilename(invoice), { type: 'application/pdf' });
    const text = `Invoice ${invoice.number} — ${INVOICE_COMPANY.name}\nTotal: ${tzs(invoice.total)}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: invoice.number, text });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // user cancelled
      }
    }
    // Fallback (desktop / unsupported): download the file + open WhatsApp text.
    triggerDownload(blob, invoiceFilename(invoice));
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const startNew = () => {
    setInvoice(null);
    setCart([]);
    setCustomer({ name: '', business: '', phone: '', tin: '', location: '' });
  };

  // ── Generated view ──
  if (invoice) {
    return (
      <div>
        <PageHeader title="Invoice ready" subtitle={`${invoice.number} · ${tzs(invoice.total)}`}>
          <Button variant="secondary" onClick={startNew}><ArrowLeft className="h-4 w-4" /> New invoice</Button>
          <Button variant="secondary" onClick={download}><Download className="h-4 w-4" /> Download PDF</Button>
          <Button onClick={share}><Share2 className="h-4 w-4" /> Share</Button>
        </PageHeader>
        <InvoicePreview inv={invoice} />
        <div className="mx-auto mt-4 flex max-w-[640px] gap-2 sm:hidden">
          <Button className="flex-1" variant="secondary" onClick={download}><Download className="h-4 w-4" /> PDF</Button>
          <Button className="flex-1" onClick={share}><Share2 className="h-4 w-4" /> Share</Button>
        </div>
      </div>
    );
  }

  // ── Builder view ──
  return (
    <div>
      <PageHeader title="Generate Invoice" subtitle="Create a customer invoice in seconds — download or share. Does not affect stock." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Customer */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Customer details" />
            <CardBody className="space-y-3">
              <Field label="Customer name" required><Input value={customer.name} onChange={setField('name')} placeholder="e.g. John Mussa" /></Field>
              <Field label="Business name"><Input value={customer.business} onChange={setField('business')} placeholder="Optional" /></Field>
              <Field label="Phone number" required><Input value={customer.phone} onChange={setField('phone')} placeholder="07.." /></Field>
              <Field label="TIN number"><Input value={customer.tin} onChange={setField('tin')} placeholder="Optional" /></Field>
              <Field label="Location"><Input value={customer.location} onChange={setField('location')} placeholder="Optional" /></Field>
            </CardBody>
          </Card>
        </div>

        {/* Products */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader title="Products" subtitle="Only in-stock products. Prices auto-fill from the system." />
            <CardBody className="space-y-3">
              {/* Searchable picker */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products to add…" />
                {search && (
                  <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
                    {results.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-faint">No matching in-stock products</div>
                    ) : results.slice(0, 30).map((p) => (
                      <button key={p.id} onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-elevated">
                        <span className="min-w-0 truncate text-foreground">{p.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-faint">{tzs(p.sellingPrice)}</span>
                          <Plus className="h-4 w-4 text-brand-500" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart */}
              {cart.length === 0 ? (
                <EmptyState title="No products added" message="Search above to add products to the invoice." icon={Package} />
              ) : (
                <div className="space-y-2">
                  {cart.map((it) => (
                    <div key={it.productId} className="flex items-center gap-2 rounded-xl border border-border bg-elevated p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{it.name}</div>
                        <div className="text-xs text-faint">{tzs(it.unitPrice)} / unit · line {tzs(it.qty * it.unitPrice)}</div>
                      </div>
                      <NumberInput min="1" value={it.qty} onChange={(e) => setQty(it.productId, e.target.value)} className="w-16 text-center" />
                      <button onClick={() => removeItem(it.productId)} className="text-faint hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-xl bg-brand-500/10 px-3 py-2.5">
                    <span className="text-sm font-semibold text-foreground">Grand total</span>
                    <span className="text-lg font-bold text-brand-400 tabular-nums">{tzs(grandTotal)}</span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-faint">
              {valid ? <span className="inline-flex items-center gap-1 text-emerald-500"><Check className="h-3.5 w-3.5" /> Ready to generate</span>
                : 'Add customer name, phone and at least one product.'}
            </p>
            <Button onClick={generate} disabled={!valid}><Receipt className="h-4 w-4" /> Generate invoice</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
