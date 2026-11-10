import clsx from 'clsx';

// A numbered list of product lines — 1, 2, 3… — for every place a request, a
// return or an order lists its products (Nino, 10 Nov 2026: "the products
// should be numbered, not just shown"). The same numbering the WhatsApp
// notice uses ("1-OHIS Pepa Ndogo …"), so what a rep reads on the phone is
// what they see in the app.
//
// One row per product, built to read on a 390px phone: the product name takes
// the whole width and wraps (names run to ~40 characters, so it is never cut),
// the quantity and price sit under it, and the money is on the right. A
// five-column table did none of that — it scrolled the figures off the edge.
//
//   items: [{ key, name, detail?, value?, extra? }]
export default function NumberedLines({ items, className }) {
  if (!items?.length) return null;
  return (
    <ol className={clsx('divide-y divide-border overflow-hidden rounded-xl border border-border', className)}>
      {items.map((it, i) => (
        <li key={it.key ?? i} className="flex items-start gap-3 px-3 py-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-elevated px-1 text-[11px] font-bold tabular-nums text-muted"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug text-foreground">{it.name}</div>
            {it.detail && <div className="mt-0.5 text-xs text-faint">{it.detail}</div>}
            {it.extra}
          </div>
          {it.value != null && <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{it.value}</div>}
        </li>
      ))}
    </ol>
  );
}
