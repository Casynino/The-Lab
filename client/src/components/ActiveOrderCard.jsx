import clsx from 'clsx';
import { formatCurrency } from '@/lib/format';
import { Remaining, BoxCount } from '@/components/ui';

// ── Rep-facing card for an ACTIVE order ─────────────────────────────────────

export default function ActiveOrderCard({ s, onClick, compact = false }) {
  const overdue = s.status === 'OVERDUE';
  const approaching = s.approaching;

  // A soft card for each active order so several of them stay apart (see .active-card in index.css); the
  // finished ones below are plain rows. A late or nearly-late order says so in the colour of its amount and
  // of the time left, and in the tint of its card.
  const accentText = overdue ? 'text-rose-400' : approaching ? 'text-amber-400' : 'text-brand-600';

  const b = s.boxes || {};
  const issued = b.issued || 0;
  // Boxes the rep has already handed over and is waiting on ZELab for: a submission or a return.
  const withOffice = (b.pendingSubmitted || 0) + (b.pendingReturned || 0);
  const pct = (n) => `${issued > 0 ? Math.max(0, Math.min(100, (n / issued) * 100)) : 0}%`;
  // "Missing" is an accusation, and it is the wrong one when the rep has already handed the boxes
  // over and is waiting on The Doctor. A late order whose whole outstanding count is sitting in a
  // submission or a return says so instead.
  const waiting = b.remaining > 0 && withOffice >= b.remaining;

  return (
    <button
      onClick={onClick}
      className={clsx('active-card block', compact && 'active-card--compact')}
      data-tone={overdue ? 'late' : approaching ? 'near' : undefined}
    >
      {/* The order, and how long is left — red words ("52h overdue") when it is late. There is no
          "Partial" / "Open" badge: nobody needs to be told an order they are working on is not
          finished, and the bar below already shows how far it is. */}
      <div className="flex items-center justify-between gap-3">
        <span className={clsx(compact ? 'text-[13px] font-semibold text-muted' : 'text-sm font-semibold text-foreground')}>{s.settlementNumber}</span>
        <Remaining hours={s.hoursRemaining} />
      </div>

      {/* What is still owed, and the boxes that stand for it. */}
      <div className={clsx('flex items-end justify-between gap-3', compact ? 'mt-1.5' : 'mt-2')}>
        <div className={clsx('min-w-0 font-bold leading-none tabular-nums', compact ? 'text-lg' : 'text-[22px]', accentText)}>{formatCurrency(s.balance)}</div>
        {/* An order with no linked transfer has issued 0, and "0 boxes left" on a live order would be
            a lie about a finished one. */}
        {issued > 0 && (
          <span className="shrink-0 text-right text-[12px] font-semibold text-muted">
            <BoxCount
              to={b.remaining}
              countOnMount={false}
              duration={450}
              unitOne="box"
              unitMany="boxes"
              suffix={waiting ? 'awaiting approval' : overdue ? 'missing' : 'left'}
              unitClassName="text-[12px] font-semibold text-muted"
              className={clsx('text-[15px] font-black', waiting ? 'text-amber-400' : overdue ? 'text-rose-400' : 'text-foreground')}
            />
          </span>
        )}
      </div>

      {/* How far along: settled, returned, and waiting for approval, as one thin bar. */}
      {issued > 0 && (
        <div className={clsx('flex overflow-hidden rounded-full bg-white/[0.08]', compact ? 'mt-2.5 h-[3px]' : 'mt-3 h-1')}>
          <div className="bg-emerald-400" style={{ width: pct(b.settled) }} />
          <div className="bg-sky-400" style={{ width: pct(b.returned) }} />
          <div className="bg-amber-400" style={{ width: pct(withOffice) }} />
        </div>
      )}
    </button>
  );
}
