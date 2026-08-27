import clsx from 'clsx';
import { formatCurrency } from '@/lib/format';

// A rep is running at two things at once — a withdrawal minimum and a bonus
// tier — and both are the same shape of question: how far along, how much left,
// what it unlocks. One row type answers it for both, so they read as a pair
// rather than two unrelated widgets competing for the same screen.
function Row({ label, value, pct, hint, target, reward, ready, readyLabel, markers = [], onClick }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'block w-full px-4 py-3 text-left transition',
        onClick && 'hover:bg-white/[0.02] active:bg-white/[0.04]',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* A dot rather than an icon: it carries the state without adding weight. */}
          <span className={clsx('h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-400' : 'bg-brand-500')} />
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
        </div>
        <span className={clsx('text-base font-bold tabular-nums', ready ? 'text-emerald-300' : 'text-foreground')}>
          {formatCurrency(value)}
        </span>
      </div>

      {/* Track. The fill carries a soft glow so it reads as lit rather than
          painted, and tier markers sit on top of it where they exist. */}
      <div className="relative mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.03]">
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-700 ease-out',
              ready
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-300 shadow-[0_0_12px_-2px_rgba(52,211,153,0.75)]'
                : 'bg-gradient-to-r from-brand-600 to-brand-400 shadow-[0_0_12px_-3px_rgba(163,230,53,0.6)]',
            )}
            style={{ width: `${width}%` }}
          />
        </div>
        {markers.map((m) => (
          <span
            key={m.at}
            className={clsx(
              'absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 rounded-full',
              m.passed ? 'bg-emerald-200/80' : 'bg-white/20',
            )}
            style={{ left: `calc(${Math.min(100, m.at)}% - 1px)` }}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <p className="text-[11px] leading-snug text-muted">
          {ready ? <span className="font-semibold text-emerald-400">{readyLabel}</span> : hint}
        </p>
        {reward != null ? (
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-emerald-400">{formatCurrency(reward)}</span>
        ) : target != null ? (
          <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatCurrency(target)}</span>
        ) : null}
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
        value={commission.available || 0}
        pct={(avail / min) * 100}
        target={min}
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
        value={bonus.sales}
        pct={aim.progress}
        reward={aim.bonusAmount}
        ready={Boolean(claimable)}
        readyLabel={claimable ? `${formatCurrency(claimable.bonusAmount)} ready — or push to ${formatCurrency(aim.target)}` : ''}
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
