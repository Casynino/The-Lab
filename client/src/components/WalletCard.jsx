import { useState } from 'react';
import clsx from 'clsx';
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';

// The rep's balance as a small digital wallet card (Nino, 10 Nov 2026: "a nice
// digital card, like a wallet, well designed, premium look, small — show the
// balance but not take too much space"). One card holds everything the top of the
// Commissions page used to spread over a box and three tiles: the balance, the
// Withdraw action, how far to the minimum, and the three supporting figures.
//
// The eye hides every amount on the card, so a rep can open the page with
// people around. The choice is remembered on this phone only (a convenience —
// nothing depends on it, and a blocked storage just means it starts shown).

const KEY = 'zelab:hideBalance';
const readHidden = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const saveHidden = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private window: fine */ } };

const DOTS = '••••••';

export default function WalletCard({
  balance,            // formatted, e.g. "TSh 245,500"
  negative,           // balance below zero (overdue fines)
  canWithdraw,
  pct,                // 0–100, progress to the withdrawal minimum
  note,               // one short line, only for the rare state that needs it (an open withdrawal window)
  stats,              // [{ label, value (formatted), tone? }] — three of them
  onWithdraw,
}) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => setHidden((h) => { saveHidden(!h); return !h; });
  const mask = (s) => (hidden ? '•••' : s);

  return (
    <section
      className={clsx(
        'relative isolate overflow-hidden rounded-[22px] p-4 text-white ring-1 ring-inset',
        negative ? 'ring-rose-400/25' : 'ring-white/[0.09]',
      )}
      style={{
        background: negative
          ? 'linear-gradient(140deg,#2a0f16 0%,#160b0e 55%,#0e0e10 100%)'
          : 'linear-gradient(140deg,#2c0e0c 0%,#170a0a 52%,#0e0e10 100%)',
        boxShadow: '0 14px 32px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07)',
      }}
    >
      {/* Soft red light from the corner and two hair-thin arcs — the card's only
          decoration. They sit behind everything and never carry information. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-20 -z-10 h-56 w-56 rounded-full"
        style={{ background: `radial-gradient(closest-side, ${negative ? 'rgba(244,63,94,.28)' : 'rgba(238,49,36,.34)'}, transparent)` }}
      />
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" viewBox="0 0 360 180" preserveAspectRatio="none">
        <path d="M-10 150 C 100 70, 240 40, 380 96" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
        <path d="M-10 178 C 120 100, 250 78, 380 128" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1" />
      </svg>

      {/* Label, the eye, and the house mark where a bank card keeps its logo. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-medium tracking-wide text-white/60">Available balance</span>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={hidden}
            aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
            className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:text-white active:scale-95"
          >
            {hidden ? <EyeOff className="h-[15px] w-[15px]" /> : <Eye className="h-[15px] w-[15px]" />}
          </button>
        </div>
        <img src="/brand/zelab-dark.svg" alt="ZELab" className="h-[15px] w-auto shrink-0 opacity-90" />
      </div>

      {/* The balance, and the one action beside it. They wrap onto two lines only
          when a very long figure meets a very narrow phone. */}
      <div className="-mt-0.5 flex flex-wrap items-center justify-between gap-x-3">
        <p
          className={clsx(
            'min-w-0 text-[27px] font-bold leading-none tabular-nums',
            negative ? 'text-rose-300' : 'text-white',
            hidden && 'tracking-[0.18em]',
          )}
        >
          {hidden ? DOTS : balance}
        </p>
        {/* A word, not a pill: bold white and an arrow, no fill, no outline. The
            height is only for the thumb — nothing of it shows. */}
        <button
          type="button"
          onClick={onWithdraw}
          disabled={!canWithdraw}
          className={clsx(
            'flex h-11 shrink-0 items-center gap-1 text-[15px] font-semibold transition active:opacity-70',
            canWithdraw ? 'text-white' : 'cursor-not-allowed text-white/45',
          )}
        >
          Withdraw
          <ArrowUpRight className="h-[17px] w-[17px]" strokeWidth={2.4} />
        </button>
      </div>

      {/* Nothing is written under the balance in the ordinary case (Nino, 11 Nov
          2026: "no word, no anything"). Below the minimum a thin line shows how far
          there is to go, and the greyed Withdraw says why it cannot be pressed;
          once the minimum is reached the line goes and Withdraw lights up. Only the
          two rare states that need explaining get one short line. */}
      {negative ? (
        <p className="mt-2.5 text-[11px] leading-snug text-rose-300">Negative from overdue fines — settle your orders to clear it.</p>
      ) : (
        <>
          {!canWithdraw && (
            <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.09]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {note && <p className="mt-2 text-[11px] leading-snug text-amber-300">{note}</p>}
        </>
      )}

      {/* The three supporting figures: small, plain, no lines or boxes around them. */}
      <div className="mt-3.5 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="truncate text-[10px] text-white/40">{s.label}</p>
            <p className={clsx('mt-px truncate text-[12.5px] font-medium tabular-nums', s.tone === 'rose' ? 'text-rose-300' : 'text-white/85')}>
              {mask(s.value)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
