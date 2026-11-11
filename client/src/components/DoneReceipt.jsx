import { formatNumber } from '@/lib/format';

/**
 * What a window turns into once the rep has sent something for approval — a settlement or a withdrawal.
 *
 * Nino, 11 Nov 2026: the first one (a big green disc with a halo, a yellow pill, a red slab of a Done) was
 * "too much"; a receipt card was "not cool" — he wanted the first one back "but better, in a premium way",
 * saying "Deposited" and "Withdrawal successful", then "not too much and big — Done small, and it fits".
 * So: centred and compact — a small emerald ring with the tick drawing itself, the title, the status as one
 * small amber line (no pill; the money only moves once ZELab approves, and that must stay said), the amount
 * with a small "TSh", where it came from or goes, one short sentence, and a small quiet Done.
 */
export default function DoneReceipt({ title, status = 'Waiting for approval', amount, details = [], note, onClose }) {
  return (
    <div className="relative flex flex-col items-center px-1 pt-2 text-center">
      {/* A soft emerald light behind the mark — the only decoration. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-28 w-48 -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(52,211,153,.12), transparent)' }} />

      <span className="animate-pop relative flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-emerald-400/45"
        style={{ background: 'radial-gradient(circle at 50% 35%, rgba(52,211,153,.2), rgba(52,211,153,.05) 70%)' }}>
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
          <path d="M5.5 12.5l4.2 4.2L18.5 8" stroke="#34d399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="animate-tick" />
        </svg>
      </span>

      <h3 className="animate-rise mt-3.5 text-[17px] font-semibold tracking-tight text-foreground" style={{ animationDelay: '0.2s' }}>{title}</h3>
      {status && (
        <p className="animate-rise mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-amber-300/90" style={{ animationDelay: '0.26s' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
          {status}
        </p>
      )}

      <p className="animate-rise mt-4 flex items-baseline gap-1 tabular-nums" style={{ animationDelay: '0.32s' }}>
        <span className="text-[13px] font-semibold text-white/50">TSh</span>
        <span className="text-[26px] font-bold leading-none tracking-tight text-white">{formatNumber(amount)}</span>
      </p>
      {details.some(Boolean) && (
        <div className="animate-rise mt-1.5 max-w-full space-y-0.5" style={{ animationDelay: '0.36s' }}>
          {details.filter(Boolean).map((d) => <p key={d} className="truncate text-[12.5px] text-white/45">{d}</p>)}
        </div>
      )}

      {note && (
        <p className="animate-rise mt-4 text-[12.5px] leading-relaxed text-muted" style={{ animationDelay: '0.42s' }}>{note}</p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="animate-rise mt-4 h-9 cursor-pointer rounded-full bg-white/[0.08] px-8 text-[13px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.1] transition hover:bg-white/[0.12] active:scale-[0.97]"
        style={{ animationDelay: '0.48s' }}
      >
        Done
      </button>
    </div>
  );
}
