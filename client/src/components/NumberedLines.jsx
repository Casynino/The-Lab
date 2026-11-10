import clsx from 'clsx';

// A numbered list of product lines — 1, 2, 3… — for every place a request, a
// return or an order lists its products (Nino, 10 Nov 2026: "the products
// should be numbered, not just shown"). The same numbering the WhatsApp
// notice uses ("1-OHIS Pepa Ndogo …"), so what a rep reads on the phone is
// what they see in the app.
//
// One row per product, built to read on a 390px phone: the product name has a line
// to itself and stays on ONE line (names run to ~40 characters), the quantity and
// price sit under it on the left and the money on the right. A
// five-column table did none of that — it scrolled the figures off the edge.
//
//   items: [{ key, name, detail?, value?, extra? }]
export default function NumberedLines({ items, className }) {
  if (!items?.length) return null;
  return (
    <ol className={clsx('divide-y divide-white/[0.07]', className)}>
      {items.map((it, i) => (
        <li key={it.key ?? i} className="py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-elevated px-1 text-[11px] font-bold tabular-nums text-muted"
            >
              {i + 1}
            </span>
            {/* One line, always: the name is cut with … only if it cannot fit at all. */}
            <div title={it.name} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{it.name}</div>
          </div>
          {(it.detail || it.value != null || it.extra) && (
            <div className="mt-1 pl-8">
              {(it.detail || it.value != null) && (
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1 text-xs text-faint">{it.detail}</div>
                  {it.value != null && <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{it.value}</div>}
                </div>
              )}
              {it.extra}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
