import clsx from 'clsx';
import { Trophy, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { RED } from '@/lib/brand';
import { Ring } from '@/components/RepCharts';

// The sales bonus as a journey, not a list of numbers (Nino, 10 Nov 2026): a ring that fills towards
// the NEXT bonus with the percentage in the middle, what is left to sell for it, and a ladder of every
// bonus with how far along each one is. Bonus is separate from the commission on boxes.
export default function BonusProgress({ p }) {
  if (!p?.configured || !p.tiers?.length) return null;

  const top = p.tiers[p.tiers.length - 1].target;
  const claimable = p.claimable;
  const aim = p.next || p.tiers[p.tiers.length - 1];
  const aimPct = aim.target > 0 ? Math.min(100, Math.round((p.sales / aim.target) * 100)) : 0;
  const ringColor = claimable && !p.next ? '#34d399' : RED;

  return (
    <div className={clsx(
      'rounded-2xl border p-4',
      claimable ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : 'border-border bg-surface',
    )}>
      <div className="flex items-center gap-5">
        <Ring total={Math.max(1, aim.target)} segments={[{ value: Math.min(p.sales, aim.target), color: ringColor }]}>
          <span className="text-2xl font-black leading-none tabular-nums text-foreground">{aimPct}%</span>
          <span className="mt-1 max-w-[4.5rem] text-[10px] font-semibold uppercase leading-tight tracking-wide text-faint">
            {p.next ? 'to next bonus' : 'top bonus'}
          </span>
        </Ring>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Sales bonus</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{formatCurrency(p.sales)}</p>
          <p className="text-xs text-faint">sold this run</p>
          {p.next ? (
            <p className="mt-2 text-xs leading-snug text-muted">
              <span className="font-semibold text-foreground">{formatCurrency(p.next.remaining)}</span> more to earn{' '}
              <span className="font-semibold text-emerald-400">{formatCurrency(p.next.bonusAmount)}</span>
            </p>
          ) : (
            <p className="mt-2 text-xs font-semibold text-emerald-400">Every bonus reached</p>
          )}
        </div>
      </div>

      {claimable && (
        <div className="mt-4 flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-2">
          <Trophy className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-emerald-400">{formatCurrency(claimable.bonusAmount)} is ready to take</span>
        </div>
      )}

      {/* The ladder: every bonus, how far along it is. */}
      <ol className="mt-4 space-y-3.5">
        {p.tiers.map((t) => (
          <li key={t.ruleId}>
            <div className="flex items-center gap-2.5">
              <span className={clsx(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                t.reached ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.07] text-faint',
              )}>
                {t.reached ? <Check className="h-3 w-3" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className="text-[13px] text-muted">Sell {formatCurrency(t.target)}</span>
              <span className={clsx('ml-auto text-[15px] font-bold tabular-nums', t.reached ? 'text-emerald-300' : 'text-foreground')}>
                {formatCurrency(t.bonusAmount)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 pl-[30px]">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className={clsx('h-full rounded-full transition-all duration-700', t.reached ? 'bg-emerald-400' : 'bg-brand-500')}
                  style={{ width: `${t.progress}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-faint">
                {t.reached ? 'reached' : `${t.progress}% · ${formatCurrency(t.remaining)} to go`}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-xs leading-snug text-muted">
        {claimable && p.next
          ? <>You can take <span className="font-semibold text-emerald-400">{formatCurrency(claimable.bonusAmount)}</span> now, or reach {formatCurrency(p.next.target)} for <span className="font-semibold text-emerald-400">{formatCurrency(p.next.bonusAmount)}</span>. Taking a bonus starts your count again from zero.</>
          : claimable
            ? <>Taking it starts your count again from zero.</>
            : <>Bonus is separate from your commission on boxes.</>}
        {' '}<span className="sr-only">Top target {formatCurrency(top)}.</span>
      </p>
    </div>
  );
}
