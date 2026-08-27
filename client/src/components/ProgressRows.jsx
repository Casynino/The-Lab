import clsx from 'clsx';
import { formatCurrency } from '@/lib/format';

// A rep is running at two things at once — a withdrawal minimum and a bonus
// tier — and both are the same shape of question: how far along, how much left,
// what it unlocks. One row type answers it for both, so they read as a pair
// rather than two unrelated widgets competing for the same screen.
function Row({ label, value, pct, hint, ready, readyLabel }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="px-4 py-2.5">
      {/* Label and figure share a line — a separate line for the number cost
          more height than it bought in clarity. */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className={clsx('text-base font-bold tabular-nums', ready ? 'text-emerald-300' : 'text-foreground')}>
            {formatCurrency(value)}
          </span>
          {ready ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              {readyLabel}
            </span>
          ) : (
            <span className="w-8 text-right text-[11px] tabular-nums text-faint">{Math.round(width)}%</span>
          )}
        </div>
      </div>

      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-700',
            ready ? 'bg-emerald-400' : 'bg-gradient-to-r from-brand-600 to-brand-400',
          )}
          style={{ width: `${width}%` }}
        />
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</p>
    </div>
  );
}

// Commission and bonus, stacked in one card with a hairline between them.
export default function ProgressRows({ commission, bonus }) {
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
        ready={ready}
        readyLabel="ready to withdraw"
        hint={ready
          ? `Above the ${formatCurrency(min)} minimum — you can request a payout.`
          : `${formatCurrency(min - avail)} more to reach the ${formatCurrency(min)} minimum.`}
      />,
    );
  }

  if (bonus?.configured && bonus.tiers?.length) {
    const aim = bonus.next || bonus.tiers[bonus.tiers.length - 1];
    const claimable = bonus.claimable;
    rows.push(
      <Row
        key="bonus"
        label="Sales bonus"
        value={bonus.sales}
        pct={aim.progress}
        ready={Boolean(claimable)}
        readyLabel={`${formatCurrency(claimable?.bonusAmount || 0)} ready`}
        hint={claimable
          ? `Take it, or reach ${formatCurrency(aim.target)} for ${formatCurrency(aim.bonusAmount)}. Taking one restarts your count.`
          : `${formatCurrency(aim.remaining)} more for ${formatCurrency(aim.bonusAmount)}.`}
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
