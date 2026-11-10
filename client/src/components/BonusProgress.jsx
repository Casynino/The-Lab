import clsx from 'clsx';
import { Trophy, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

// The sales bonus, said once (Nino, 11 Nov 2026: "the information feels too much"). It used to show the
// same progress as a ring, a percentage, a second percentage on each bar and a "to go" on each row.
// Now: the bonus being worked towards, one bar, what has been sold and what is left — and the other
// levels as a quiet list, no bars. The old footnote ("Bonus is separate from what you earn on boxes")
// is gone with the rest of the extra words; the bonus is still paid on its own, as before.
export default function BonusProgress({ p }) {
  if (!p?.configured || !p.tiers?.length) return null;

  const claimable = p.claimable;
  const next = p.next;
  const pct = next && next.target > 0 ? Math.max(0, Math.min(100, (p.sales / next.target) * 100)) : 100;
  // The other levels: every one except the one being worked towards.
  const others = p.tiers.filter((t) => !next || t.ruleId !== next.ruleId);

  return (
    <div className={clsx(
      'rounded-2xl border p-5',
      claimable ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-border bg-surface',
    )}>
      <p className="text-xs font-medium text-muted">Sales bonus</p>

      {next ? (
        <>
          <p className="mt-2 text-[28px] font-bold leading-none tabular-nums text-foreground">{formatCurrency(next.bonusAmount)}</p>
          <p className="mt-1.5 text-[13px] text-muted">when you sell {formatCurrency(next.target)}</p>

          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/[0.09]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted">
            <span>{formatCurrency(p.sales)} sold</span>
            <span className="font-medium text-foreground">{formatCurrency(next.remaining)} to go</span>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-xl font-bold text-emerald-300">Every bonus reached</p>
          <p className="mt-1.5 text-[13px] text-muted">{formatCurrency(p.sales)} sold</p>
        </>
      )}

      {claimable && (
        <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
          <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatCurrency(claimable.bonusAmount)} is ready to take
        </p>
      )}

      {others.length > 0 && (
        <ul className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06] text-[13px]">
          {others.map((t) => (
            <li key={t.ruleId} className="flex items-center justify-between gap-3 py-2.5">
              <span className={clsx('flex min-w-0 items-center gap-2', t.reached ? 'text-emerald-300' : 'text-muted')}>
                {t.reached && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                Sell {formatCurrency(t.target)}
              </span>
              <span className={clsx('shrink-0 font-semibold tabular-nums', t.reached ? 'text-emerald-300' : 'text-foreground')}>
                {formatCurrency(t.bonusAmount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {claimable && (
        <p className="mt-1 text-xs leading-snug text-muted">
          {next
            ? <>You can take it now, or keep selling for the next one. Taking a bonus starts your count again from zero.</>
            : <>Taking it starts your count again from zero.</>}
        </p>
      )}
    </div>
  );
}
