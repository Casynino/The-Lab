import clsx from 'clsx';

// A numbered list of products, each with a small  −  [ 0 ]  +  to say how many.
// Used where a rep picks boxes from an order's own products — settling several at
// once, returning boxes — so they read the same and fit a phone: the name takes
// the width and wraps, a quiet line under it says how many are left, and the
// stepper is a fixed 108px at the right. The row lights up once a number is set.
//
//   items: [{ key, name, sub?, max, qty }]      onChange(key, nextQty)  — the caller clamps
export default function StepperLines({ items, onChange }) {
  const btn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-base font-bold text-foreground ring-1 ring-white/[0.08] transition active:scale-95 disabled:opacity-30';
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {items.map((it, i) => {
        const qty = it.qty || 0;
        const on = qty > 0;
        return (
          <li key={it.key} className={clsx('flex items-center gap-3 px-3 py-2.5 transition-colors', on && 'bg-brand-500/[0.06]')}>
            <span
              aria-hidden="true"
              className={clsx(
                'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold tabular-nums',
                on ? 'bg-brand-500/20 text-brand-600' : 'bg-elevated text-muted',
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={clsx('text-[13px] font-medium leading-snug', on ? 'text-foreground' : 'text-muted')}>{it.name}</div>
              {it.sub && <div className="mt-0.5 text-[11px] text-faint">{it.sub}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className={btn} onClick={() => onChange(it.key, qty - 1)} disabled={qty <= 0} aria-label={`One fewer ${it.name}`}>−</button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max={it.max}
                value={qty === 0 ? '' : qty}
                placeholder="0"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onChange(it.key, Number.isNaN(v) || v < 0 ? 0 : v);
                }}
                aria-label={`Boxes of ${it.name}`}
                className="h-8 w-10 min-w-0 rounded-lg bg-elevated text-center text-sm font-bold tabular-nums text-foreground ring-1 ring-white/[0.08] [appearance:textfield] focus:outline-none focus:ring-2 focus:ring-brand-500/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button type="button" className={clsx(btn, 'bg-brand-500 text-white ring-brand-500')} onClick={() => onChange(it.key, qty + 1)} disabled={qty >= it.max} aria-label={`One more ${it.name}`}>+</button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
