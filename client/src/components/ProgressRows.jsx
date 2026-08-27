import clsx from 'clsx';
import { formatCurrency } from '@/lib/format';

// A rep is running at two things at once — a withdrawal minimum and a bonus
// tier — and both ask the same question: how far along, how much is left, what
// it unlocks. One row type answers it for both, so they read as a pair rather
// than two unrelated widgets competing for the same screen.
function Row({ label, pct, hint, reward, ready, readyLabel, markers = [], onClick }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'block w-full px-4 py-2.5 text-left transition',
        onClick && 'hover:bg-white/[0.02] active:bg-white/[0.04]',
      )}
    >
      {/* The share of the way there is the headline, not the money. A long
          currency string set large dominates the screen and reads as a wall;
          a percentage is one glance, and the amounts stay legible below it. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
        <span className={clsx(
          'text-xl font-bold leading-none tabular-nums',
          ready ? 'text-emerald-400' : 'text-brand-400',
        )}>
          {Math.round(width)}<span className="text-xs font-semibold text-faint">%</span>
        </span>
      </div>

      <div className="relative mt-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-700 ease-out',
              ready
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
                : 'bg-gradient-to-r from-brand-600 to-brand-400',
            )}
            style={{ width: `${width}%` }}
          />
        </div>
        {/* A notch per bonus tier, so the next milestone is visible on the track
            rather than buried on another page. */}
        {markers.map((m) => (
          <span
            key={m.at}
            className={clsx(
              'absolute top-1/2 h-2 w-[2px] -translate-y-1/2 rounded-full',
              m.passed ? 'bg-emerald-200/80' : 'bg-white/25',
            )}
            style={{ left: `calc(${Math.min(100, m.at)}% - 1px)` }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <p className="truncate text-[11px] leading-none text-muted">
          {ready ? <span className="font-semibold text-emerald-400">{readyLabel}</span> : hint}
        </p>
        {reward != null && (
          <span className="shrink-0 text-[11px] font-semibold leading-none tabular-nums text-emerald-400">
            {formatCurrency(reward)}
          </span>
        )}
      </div>
    </Tag>
  );
}

// Commission and bonus, stacked in one card with a hairline between them.
export default function ProgressRows({ commission, bonus, onOpenCommission }) {
  const rows = [];

  if (commission && commission.minWithdrawal > 0) {
    const avail = Math.max(0, commission.available || 0);
    const min = commission.minWithdrawal;
    const ready = avail >= min;
    rows.push(
      <Row
        key="commission"
        label="Commission"
        pct={(avail / min) * 100}
        reward={min}
        ready={ready}
        readyLabel="Ready to withdraw"
        hint={avail / min >= 0.9
          ? `Almost there — only ${formatCurrency(min - avail)} to go`
          : `${formatCurrency(avail)} of ${formatCurrency(min)}`}
        onClick={onOpenCommission}
      />,
    );
  }

  // Naming the shortfall only helps once it is small. Far out it reads as a
  // mountain — "6,329,500 more" is discouraging where "3,670,500 of 10,000,000"
  // is the same fact told as ground covered — so the gap appears near the line,
  // which is exactly where it becomes the encouraging number.
  if (bonus?.configured && bonus.tiers?.length) {
    const aim = bonus.next || bonus.tiers[bonus.tiers.length - 1];
    const top = bonus.tiers[bonus.tiers.length - 1].target;
    const claimable = bonus.claimable;
    rows.push(
      <Row
        key="bonus"
        label="Sales bonus"
        pct={aim.progress}
        reward={aim.bonusAmount}
        ready={Boolean(claimable)}
        readyLabel={claimable ? `${formatCurrency(claimable.bonusAmount)} ready — or push on` : ''}
        hint={aim.progress >= 90
          ? `Almost there — only ${formatCurrency(aim.remaining)} to go`
          : `${formatCurrency(bonus.sales)} of ${formatCurrency(aim.target)}`}
        markers={top > 0 ? bonus.tiers.map((t) => ({ at: (t.target / top) * 100, passed: t.reached })) : []}
        onClick={onOpenCommission}
      />,
    );
  }

  if (!rows.length) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      {rows.map((row, i) => (
        <div key={row.key} className={clsx(i > 0 && 'border-t border-border')}>{row}</div>
      ))}
    </div>
  );
}
