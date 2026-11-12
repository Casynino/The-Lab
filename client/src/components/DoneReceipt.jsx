import { formatNumber } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';

/**
 * What a window turns into once the rep has sent something for approval — a settlement or a withdrawal.
 *
 * Nino, 11 Nov 2026, over four rounds: the first one (a big green disc with a halo, a yellow pill, a red
 * slab of a Done) was "too much"; a receipt card was "not cool"; he wanted the first one back "but better,
 * premium", saying "Deposited" and "Withdrawal successful", then "small — not too much, not too many words;
 * reps get the approval on WhatsApp, just say that". So: centred and small — a small emerald ring with the
 * tick drawing itself, the title, one amber line saying the approval comes on WhatsApp, the amount with a
 * small "TSh", one detail line, and a small quiet Done.
 */
// The WhatsApp promise only for a rep whose alerts can arrive (number and key set by the admin). A rep added
// without them was told "You'll get a WhatsApp" and none came (audit, 12 Nov 2026).
export default function DoneReceipt({ title, status, amount, detail, onClose }) {
  const { user } = useAuth();
  const line = status ?? (user?.salesRep?.whatsappOn
    ? "You'll get a WhatsApp once it's approved."
    : "You'll see it in ZELab once it's approved.");
  return (
    <div className="relative flex flex-col items-center px-1 pt-1 text-center">
      {/* A soft emerald light behind the mark — the only decoration. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-24 w-40 -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(52,211,153,.11), transparent)' }} />

      <span className="animate-pop relative flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-emerald-400/45"
        style={{ background: 'radial-gradient(circle at 50% 35%, rgba(52,211,153,.2), rgba(52,211,153,.05) 70%)' }}>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
          <path d="M5.5 12.5l4.2 4.2L18.5 8" stroke="#34d399" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="animate-tick" />
        </svg>
      </span>

      <h3 className="animate-rise mt-3 text-[16px] font-semibold tracking-tight text-foreground" style={{ animationDelay: '0.2s' }}>{title}</h3>

      <p className="animate-rise mt-3 flex items-baseline gap-1 tabular-nums" style={{ animationDelay: '0.28s' }}>
        <span className="text-[12px] font-semibold text-white/50">TSh</span>
        <span className="text-[22px] font-bold leading-none tracking-tight text-white">{formatNumber(amount)}</span>
      </p>
      {detail && (
        <p className="animate-rise mt-1 max-w-full truncate text-[12px] text-white/45" style={{ animationDelay: '0.32s' }}>{detail}</p>
      )}

      {line && (
        <p className="animate-rise mt-3 flex items-center gap-1.5 text-[12px] text-amber-200/90" style={{ animationDelay: '0.38s' }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          {line}
        </p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="animate-rise mt-4 h-8 cursor-pointer rounded-full bg-white/[0.08] px-6 text-[12.5px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.1] transition hover:bg-white/[0.12] active:scale-[0.97]"
        style={{ animationDelay: '0.44s' }}
      >
        Done
      </button>
    </div>
  );
}
