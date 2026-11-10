import clsx from 'clsx';
import { Trophy, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { RED } from '@/lib/brand';
import { Ring } from '@/components/RepCharts';

// The sales bonus, said once (Nino, 11 Nov 2026: "the information feels too much", then "the pie chart
// should be there"). It used to show the same progress as a ring, a percentage, a second percentage on
// each bar and a "to go" on each row. Now: the ring with its one percentage and how much is left to
// sell, then every bonus level once as a quiet list (the one being worked towards is the bright one).
// The old footnote ("Bonus is separate from what you earn on boxes") went with the extra words; the
// bonus is still paid on its own, as before.
export default function BonusProgress({ p }) {
  if (!p?.configured || !p.tiers?.length) return null;

  const claimable = p.claimable;
  const next = p.next;
  const pct = next && next.target > 0 ? Math.max(0, Math.min(100, Math.round((p.sales / next.target) * 100))) : 100;
  const done = !next;

  return (
    <div className={clsx(
      'rounded-2xl border p-5',
      claimable ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-border bg-surface',
    )}>
      <div className="flex items-center gap-5">
        <Ring size={96} stroke={9} total={Math.max(1, next ? next.target : 1)} segments={[{ value: next ? Math.min(p.sales, next.target) : 1, color: done ? '#34d399' : RED }]}>
          <span className="text-[22px] font-bold leading-none tabular-nums text-foreground">{pct}%</span>
        </Ring>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted">Sales bonus</p>
          {next ? (
            <>
              <p className="mt-1.5 text-[26px] font-bold leading-none tabular-nums text-foreground">{formatCurrency(next.remaining)}</p>
              <p className="mt-2 text-[13px] text-muted">to the next bonus</p>
            </>
          ) : (
            <p className="mt-1.5 text-lg font-bold text-emerald-300">Every bonus reached</p>
          )}
        </div>
      </div>

      {claimable && (
        <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
          <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatCurrency(claimable.bonusAmount)} is ready to take
        </p>
      )}

      <ul className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06] text-[13px]">
        {p.tiers.map((t) => {
          const current = next && t.ruleId === next.ruleId;
          return (
            <li key={t.ruleId} className="flex items-center justify-between gap-3 py-2.5">
              <span className={clsx('flex min-w-0 items-center gap-2', t.reached ? 'text-emerald-300' : current ? 'font-medium text-foreground' : 'text-muted')}>
                {t.reached && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                Sell {formatCurrency(t.target)}
              </span>
              <span className={clsx('shrink-0 font-semibold tabular-nums', t.reached ? 'text-emerald-300' : current ? 'text-foreground' : 'text-muted')}>
                {formatCurrency(t.bonusAmount)}
              </span>
            </li>
          );
        })}
      </ul>

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
