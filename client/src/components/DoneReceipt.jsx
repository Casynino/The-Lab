import { Check } from 'lucide-react';

/**
 * What a window turns into once the rep has sent something for approval — a settlement or a withdrawal.
 *
 * Nino, 11 Nov 2026: the old one (a big green disc with a halo, a yellow pill, a big red Done) was "too
 * much". Now it is one receipt card in the wallet card's finish: what it is and a small tick on one line,
 * the amount as the one big figure, where it came from or goes, and a quiet amber line for where it stands.
 * Under the card, one short sentence for what happens next; Done is a soft pill, not a red slab.
 */
export default function DoneReceipt({ label, amount, details = [], status = 'Waiting for ZELab', note, onClose }) {
  return (
    <div className="space-y-4">
      <div className="premium-card animate-rise p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] font-medium text-white/70">{label}</p>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300" aria-hidden="true">
            <Check className="h-4 w-4" strokeWidth={2.6} />
          </span>
        </div>
        <p className="mt-2 text-[30px] font-bold leading-none tabular-nums text-white">{amount}</p>
        {details.some(Boolean) && (
          <div className="mt-2.5 space-y-0.5">
            {details.filter(Boolean).map((d) => <p key={d} className="truncate text-[13px] text-white/50">{d}</p>)}
          </div>
        )}
        <p className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3.5 text-[13px] text-amber-200/90">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          {status}
        </p>
      </div>

      {note && <p className="px-1 text-[13px] leading-relaxed text-muted">{note}</p>}

      <button
        type="button"
        onClick={onClose}
        className="h-11 w-full cursor-pointer rounded-full bg-white/[0.07] text-[14px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.1] active:scale-[0.99]"
      >
        Done
      </button>
    </div>
  );
}
