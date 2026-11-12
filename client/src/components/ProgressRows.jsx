import clsx from 'clsx';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { bonusRow, walletRow } from '@/lib/labels';

// A rep is running at two things at once — a withdrawal minimum and a bonus
// tier — and both ask the same question: how far along, how much is left, what
// it unlocks. One row type answers it for both, so they read as a pair rather
// than two unrelated widgets competing for the same screen.
// `pct` is the headline; `barPct` (when given) is the fill, for a track whose notches use another scale.
function Row({ label, pct, barPct, hint, reward, ready, readyLabel, markers = [], onClick }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  const fill = barPct == null ? width : Math.max(0, Math.min(100, barPct));
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx('active-card active-card--compact block', !onClick && 'pointer-events-none')}
    >
      {/* The share of the way there is the headline, not the money. A long
          currency string set large dominates the screen and reads as a wall;
          a percentage is one glance, and the amounts stay legible below it. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={clsx(
          'text-xl font-bold leading-none tabular-nums',
          ready ? 'text-emerald-400' : 'text-brand-600',
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
            style={{ width: `${fill}%` }}
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
        {/* It may carry a figure ("TSh 150,000 ready — or push on"), so it wraps rather than cutting it. */}
        <p className="min-w-0 text-[11px] leading-tight text-muted">
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

// The wallet and the bonus, one soft card each.
// `forStaff`: the admin reading a rep's profile, who is the one that pays a reached bonus.
export default function ProgressRows({ commission, bonus, onOpenCommission, forStaff = false }) {
  const rows = [];

  const w = commission ? walletRow(commission) : null;
  if (w) {
    // A withdrawal waiting to be paid is already out of the balance (the Wallet card calls it Pending),
    // so it is named here too, or a rep who just asked for his money reads "TSh 0" (audit, 12 Nov 2026).
    const pending = w.pending > 0
      ? <span className="font-medium text-amber-300"> · {formatCurrency(w.pending)} pending</span>
      : null;
    rows.push(
      <Row
        key="commission"
        label="Wallet"
        pct={w.pct}
        // Ready: his balance, the money he can take out. Below the line: the minimum he is working towards.
        // Showing the minimum next to "Ready to withdraw" read as "I can withdraw TSh 250,000" (audit rep-app-4).
        reward={w.ready ? w.avail : w.min}
        ready={w.ready}
        // A window the owner opened lets him withdraw under the minimum, until a set time (as the Wallet says).
        readyLabel={<>{w.windowUntil ? `Withdrawal open until ${formatDateTime(w.windowUntil)}` : 'Ready to withdraw'}{pending}</>}
        // Below zero (fines above earnings) the real balance, in rose, as on the Wallet — never "TSh 0".
        hint={w.negative
          ? <><span className="font-medium text-rose-300">{formatCurrency(w.balance)} · {w.fromFines ? 'overdue fines' : 'paid off by new commission'}</span>{pending}</>
          : <>{w.avail / w.min >= 0.9
            ? `Almost there — only ${formatCurrency(w.min - w.avail)} to go`
            : `${formatCurrency(w.avail)} of ${formatCurrency(w.min)}`}{pending}</>}
        onClick={onOpenCommission}
      />,
    );
  }

  // Naming the shortfall only helps once it is small. Far out it reads as a
  // mountain — "6,329,500 more" is discouraging where "3,670,500 of 10,000,000"
  // is the same fact told as ground covered — so the gap appears near the line,
  // which is exactly where it becomes the encouraging number.
  // A reached bonus is shown as that bonus, whole (its amount, 100%), not the next tier's percentage and
  // amount beside it; a rep cannot take it himself, so the line says who pays it (audit, 12 Nov 2026).
  const b = bonusRow(bonus);
  if (b) {
    const { aim } = b;
    rows.push(
      <Row
        key="bonus"
        label="Sales bonus"
        pct={b.pct}
        barPct={b.barPct}
        reward={b.reward}
        ready={b.ready}
        readyLabel={forStaff ? 'Reached — ready to pay' : 'Reached — ask ZELab to pay it, or push on'}
        hint={aim.progress >= 90
          ? `Almost there — only ${formatCurrency(aim.remaining)} to go`
          : `${formatCurrency(bonus.sales)} of ${formatCurrency(aim.target)}`}
        markers={b.markers}
        onClick={onOpenCommission}
      />,
    );
  }

  if (!rows.length) return null;

  return (
    // One soft card per goal (the same look as the active orders), not one box with a line through it.
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>{row}</div>
      ))}
    </div>
  );
}
