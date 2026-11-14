import clsx from 'clsx';
import { formatCurrency, formatDate } from '@/lib/format';
import { RED } from '@/lib/brand';
import { Ring } from '@/components/Ring';

// The sales bonuses as small rings, one for each (Nino, 11 Nov 2026: "there are two bonuses, so the pie
// chart should be nice and small, but show all the percentages"). Each ring has its own percentage in the
// middle, the bonus it pays under it and the sales it needs. One quiet line says how much is left for the
// next one. The old extras — a big ring, bars, repeated percentages, a footnote — are gone.
// Since 14 Nov 2026 a reached bonus goes INTO HIS WALLET (owner's rule): the amounts under the rings are
// each tier's total for the cycle (500,000 at 10M, 1,000,000 in all at 15M), and the money words come from
// the server's `wallet`, never from the rings.
const GREEN = '#34d399';

// Past bonus cycles (audit money-flows-10): every bonus withdrawal paid from the wallet, and the bonuses
// paid by hand before the wallet existed. Each one ended a cycle and started the count again at 0%.
// Plain rows on the page, like "My withdrawals".
export function PaidBonuses({ items, history }) {
  const rows = [
    ...(history || []).filter((h) => h.status === 'PAID').map((h) => ({
      id: h.id,
      amount: h.amount,
      paidAt: h.paidAt || h.decidedAt || h.requestedAt,
      target: (h.credits || []).reduce((m, c) => Math.max(m, Number(c.target) || 0), 0),
    })),
    ...(items || []),
  ].sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  if (!rows.length) return null;
  return (
    <section className="mt-9 px-1">
      <h3 className="text-sm font-semibold text-foreground">Paid to you</h3>
      <p className="mt-0.5 text-xs text-muted">Each bonus paid started your bonus count again from zero.</p>
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {rows.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[13px] text-foreground">Paid {formatDate(a.paidAt)}</span>
              {a.target > 0 && <span className="block text-[11px] text-faint">For selling {formatCurrency(a.target)}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[14px] font-semibold tabular-nums text-emerald-300">{formatCurrency(a.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Where his bonus money is: in the wallet, waiting for payment, withdrawn — three small figures, the way the
// wallet card shows its own, and one plain sentence about what he can do. Nothing to show, nothing drawn.
function BonusWallet({ p }) {
  const w = p.wallet || {};
  const inWallet = Number(w.available) || 0;
  const pending = Number(w.pending) || 0;
  const paid = Number(w.paid) || 0;
  if (!(inWallet > 0 || pending > 0 || paid > 0)) return null;
  const next = p.next;
  const figs = [
    { label: 'In your wallet', value: inWallet, tone: inWallet > 0 ? 'text-emerald-300' : 'text-foreground/85' },
    { label: 'Waiting for payment', value: pending, tone: pending > 0 ? 'text-amber-300' : 'text-foreground/85' },
    { label: 'Withdrawn', value: paid, tone: 'text-foreground/85' },
  ];
  return (
    <>
      <dl className="mt-7 grid grid-cols-3 gap-x-3 text-center">
        {figs.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10px] leading-tight text-faint">{f.label}</dt>
            <dd className={clsx('mt-1 whitespace-nowrap text-[13px] font-semibold tabular-nums', f.tone)}>{formatCurrency(f.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-center text-xs leading-snug text-muted [text-wrap:pretty]">
        {inWallet > 0
          ? (next && !p.frozen
            ? <>Withdraw it now, or keep selling to {formatCurrency(next.target)} for {formatCurrency(next.bonusAmount)} in total. Withdrawing starts your bonus count again from zero.</>
            : <>Withdraw it from your wallet whenever you are ready. Withdrawing starts your bonus count again from zero.</>)
          : pending > 0
            ? <>Your bonus withdrawal is waiting for payment. Your count started again from zero when you asked for it{p.claimable ? '; a bonus reached since then goes into your wallet once it is paid' : ''}.</>
            : null}
      </p>
    </>
  );
}

const RED_LATER = 'rgba(238, 49, 36, 0.5)';

export default function BonusProgress({ p }) {
  // A tier switched off after a bonus was credited: no rings to draw, but the money is still his.
  if (!p?.configured || !p.tiers?.length) return p?.wallet ? <div className="px-1 pt-2"><BonusWallet p={p} /></div> : null;

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
              {/* Reached in this cycle: credited into his wallet (nothing to ask for), or, while a bonus
                  withdrawal waits, added once that one is paid. */}
              {t.reached && (t.credited || p.frozen) && (
                <p className={clsx('mt-0.5 text-[11px] font-medium', t.credited ? 'text-emerald-300' : 'text-faint')}>
                  {t.credited ? 'In your wallet' : 'Added once paid'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-7 text-center text-[13px] text-muted">
        {next
          ? <><span className="font-medium text-foreground">{formatCurrency(next.remaining)}</span> to go for the next bonus</>
          : <span className="font-medium text-emerald-300">Every bonus reached</span>}
      </p>

      <BonusWallet p={p} />
    </div>
  );
}
