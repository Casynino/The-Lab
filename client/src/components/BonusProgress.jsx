import clsx from 'clsx';
import { Trophy, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

// One track, a marker per tier. A single bar with the targets sitting on it
// reads as one journey with milestones, which is what it is — rather than two
// separate bars racing each other. The track is scaled to the highest tier so
// the distance between 10m and 15m is honest.
export default function BonusProgress({ p, compact = false }) {
  if (!p?.configured || !p.tiers?.length) return null;

  const top = p.tiers[p.tiers.length - 1].target;
  const pct = top > 0 ? Math.min(100, (p.sales / top) * 100) : 0;
  const claimable = p.claimable;
  const aim = p.next || p.tiers[p.tiers.length - 1];

  // The dashboard is for getting to work, so the bonus gets one strip there and
  // nothing more: where you are, how far to the next tier, what it pays. The
  // full breakdown lives on the earnings page, which is where someone goes when
  // they actually want to study it.
  if (compact) {
    return (
      <div className={clsx(
        'rounded-2xl border px-4 py-3',
        claimable ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : 'border-border bg-surface',
      )}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Sales bonus</p>
          {claimable ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <Trophy className="h-3.5 w-3.5" />
              {formatCurrency(claimable.bonusAmount)} ready
            </span>
          ) : (
            <span className="text-xs text-faint">{aim.progress}%</span>
          )}
        </div>

        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', claimable ? 'bg-emerald-400' : 'bg-brand-500')}
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-2 text-xs text-muted">
          <span className="font-semibold text-foreground">{formatCurrency(p.sales)}</span>
          {claimable
            ? <> sold · take it or push to {formatCurrency(aim.target)} for {formatCurrency(aim.bonusAmount)}</>
            : <> of {formatCurrency(aim.target)} · earns {formatCurrency(aim.bonusAmount)}</>}
        </p>
      </div>
    );
  }

  return (
    <div className={clsx(
      'rounded-2xl border p-4',
      claimable ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : 'border-border bg-surface',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Sales bonus</p>
          <p className="mt-0.5 text-2xl font-bold text-foreground">{formatCurrency(p.sales)}</p>
          <p className="text-xs text-faint">sold this run</p>
        </div>
        {claimable && (
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1">
            <Trophy className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">{formatCurrency(claimable.bonusAmount)} ready</span>
          </div>
        )}
      </div>

      {/* Track */}
      <div className="relative mt-4">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', claimable ? 'bg-emerald-400' : 'bg-brand-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* A notch on the track wherever a tier sits. */}
        {p.tiers.map((t) => {
          const at = top > 0 ? Math.min(100, (t.target / top) * 100) : 0;
          return (
            <div
              key={t.ruleId}
              className={clsx(
                'absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full',
                t.reached ? 'bg-emerald-300' : 'bg-white/25',
              )}
              style={{ left: `calc(${at}% - 1.5px)` }}
              title={`${formatCurrency(t.target)} → ${formatCurrency(t.bonusAmount)}`}
            />
          );
        })}
      </div>

      {/* Tiers */}
      <div className={clsx('mt-4 grid gap-2', p.tiers.length > 1 ? 'sm:grid-cols-2' : '')}>
        {p.tiers.map((t) => (
          <div
            key={t.ruleId}
            className={clsx(
              'rounded-xl border px-3 py-2.5',
              t.reached ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-border bg-elevated',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{formatCurrency(t.target)}</span>
              {t.reached
                ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                : <span className="text-[11px] text-faint">{t.progress}%</span>}
            </div>
            <p className={clsx('mt-0.5 text-base font-bold', t.reached ? 'text-emerald-300' : 'text-foreground')}>
              {formatCurrency(t.bonusAmount)}
            </p>
            {!t.reached && (
              <p className="text-[11px] text-faint">{formatCurrency(t.remaining)} to go</p>
            )}
          </div>
        ))}
      </div>

      {!compact && (
        <p className="mt-3 text-xs text-muted">
          {claimable && p.next
            ? <>You can take <span className="font-semibold text-emerald-400">{formatCurrency(claimable.bonusAmount)}</span> now, or reach {formatCurrency(p.next.target)} for <span className="font-semibold text-emerald-400">{formatCurrency(p.next.bonusAmount)}</span>. Taking a bonus starts your count again from zero.</>
            : claimable
              ? <>You can take <span className="font-semibold text-emerald-400">{formatCurrency(claimable.bonusAmount)}</span>. Taking it starts your count again from zero.</>
              : <>Reach {formatCurrency(p.next?.target ?? top)} to earn {formatCurrency(p.next?.bonusAmount ?? 0)}. Bonus is separate from your box commission.</>}
        </p>
      )}
    </div>
  );
}
