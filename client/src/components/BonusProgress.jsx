import clsx from 'clsx';
import { Trophy } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { RED } from '@/lib/brand';
import { Ring } from '@/components/Ring';

// The sales bonuses as small rings, one for each (Nino, 11 Nov 2026: "there are two bonuses, so the pie
// chart should be nice and small, but show all the percentages"). Each ring has its own percentage in the
// middle, the bonus it pays under it and the sales it needs. One quiet line says how much is left for the
// next one. The old extras — a big ring, bars, repeated percentages, a footnote — are gone; the bonus is
// still paid on its own, as before.
const GREEN = '#34d399';
const RED_LATER = 'rgba(238, 49, 36, 0.5)';

export default function BonusProgress({ p }) {
  if (!p?.configured || !p.tiers?.length) return null;

  const claimable = p.claimable;
  const next = p.next;
  const cols = Math.min(p.tiers.length, 3);

  return (
    // No card round it (Nino, 11 Nov 2026: "I don't like the big shape" — he likes the galaxy behind):
    // the rings sit straight on the background, each with a soft glow in its own colour.
    <div className="px-1 pt-2">
      <p className="text-xs font-medium text-muted">Sales bonus</p>

      <div className="mt-6 grid gap-x-3 gap-y-8" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {p.tiers.map((t) => {
          const current = next && t.ruleId === next.ruleId;
          const pct = t.reached
            ? 100
            : Math.max(0, Math.min(100, Math.round(Number.isFinite(t.progress) ? t.progress : (p.sales / Math.max(1, t.target)) * 100)));
          const color = t.reached ? GREEN : current ? RED : RED_LATER;
          return (
            <div key={t.ruleId} className="flex min-w-0 flex-col items-center text-center">
              <div style={{ filter: `drop-shadow(0 0 7px ${t.reached ? 'rgba(52,211,153,0.35)' : current ? 'rgba(238,49,36,0.42)' : 'rgba(238,49,36,0.16)'})` }}>
                <Ring size={84} stroke={7} total={100} segments={[{ value: pct, color }]}>
                  <span className={clsx('text-base font-bold leading-none tabular-nums', t.reached ? 'text-emerald-300' : 'text-foreground')}>{pct}%</span>
                </Ring>
              </div>
              <p className={clsx('mt-2.5 text-[15px] font-semibold tabular-nums', t.reached ? 'text-emerald-300' : 'text-foreground')}>
                {formatCurrency(t.bonusAmount)}
              </p>
              <p className="text-[11px] tabular-nums text-muted">Sell {formatCurrency(t.target)}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-7 text-center text-[13px] text-muted">
        {next
          ? <><span className="font-medium text-foreground">{formatCurrency(next.remaining)}</span> to go for the next bonus</>
          : <span className="font-medium text-emerald-300">Every bonus reached</span>}
      </p>

      {claimable && (
        <>
          <p className="mt-4 flex items-center justify-center gap-2 text-[13px] font-semibold text-emerald-300">
            <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatCurrency(claimable.bonusAmount)} is yours
          </p>
          {/* There is nothing for him to tap: ZELab pays a bonus (audit, 12 Nov 2026 — "You can take it
              now" sent him looking for a button). */}
          <p className="mt-1 text-center text-xs leading-snug text-muted">
            {next
              ? <>Ask ZELab to pay it, or keep selling for the next one. Once a bonus is paid your count starts again from zero.</>
              : <>Ask ZELab to pay it. Once it is paid your count starts again from zero.</>}
          </p>
        </>
      )}
    </div>
  );
}
