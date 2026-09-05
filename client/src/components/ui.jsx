import { forwardRef, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2, X, ChevronLeft, ChevronRight, Search, Inbox } from 'lucide-react';

// --- Buttons ---------------------------------------------------------------
const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

export function Button({ variant = 'primary', loading, className, children, disabled, ...props }) {
  return (
    <button className={clsx(VARIANTS[variant], className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// --- Card -------------------------------------------------------------------
export function Card({ className, children }) {
  return <div className={clsx('card', className)}>{children}</div>;
}
export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 border-b border-border px-5 py-4', className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function CardBody({ className, children }) {
  return <div className={clsx('p-5', className)}>{children}</div>;
}

// --- Form controls ----------------------------------------------------------
export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={clsx('input', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={clsx('input', className)} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, error, required, children, hint }) {
  return (
    <div>
      {label && (
        <label className="label">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// --- Badge ------------------------------------------------------------------
export function Badge({ className, children }) {
  return <span className={clsx('badge', className)}>{children}</span>;
}

// ── Time left on a settlement contract ──────────────────────────────────────
// Lived in Settlements.jsx until the order screen needed it too. It cannot be
// exported from there: Settlements already imports OrderDetail, so the arrow
// would point both ways.

function hoursLabel(h) {
  if (h == null) return '—';
  // Rounding made the first hour either side of the deadline read as its
  // opposite: half an hour late came out "0h overdue", which looks like it is
  // not late, and the last minutes came out "0h left".
  if (h < 0) {
    const over = Math.abs(h);
    return over < 1 ? 'just overdue' : `${Math.round(over)}h overdue`;
  }
  if (h < 1) return 'due now';
  if (h < 24) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

// How much time is left, told by colour as well as by words. It used to be
// text-faint — the quietest style in the app — on the one figure in the row
// that decides whether you act today. The bands are the ones that matter to a
// 72-hour contract: past it, inside a day, inside the window, then the rest.
function remainingTone(h) {
  if (h == null) return 'text-muted';
  if (h <= 24) return 'text-rose-400';
  if (h <= 72) return 'text-amber-400';
  if (h <= 168) return 'text-sky-400';
  return 'text-muted';
}

// Colour and weight, and nothing else. A pill around it turned every row into
// a row of blobs and the shape competed with the words inside it; the colour
// alone carries the urgency and the text stays the thing you read.
export function Remaining({ hours, className = '' }) {
  return (
    <span className={`text-[13px] font-bold tabular-nums ${remainingTone(hours)} ${className}`}>
      {hoursLabel(hours)}
    </span>
  );
}

// A count that arrives rather than appears. `from` is where the story starts —
// the boxes that went out — and `to` is where it stands now, so 28 falling to
// 12 IS the settling: told once, in under a second, by the number itself.
//
// It resumes from what is ON SCREEN rather than from the last target. `shown`
// is written every frame, so an approval landing mid-count carries on from ~20
// down to 9 instead of snapping back to 12 first.
//
// countOnMount={false} paints the value on the first frame and moves only when
// it CHANGES — what the list cards use, so a background refetch every minute
// does not turn a page of orders into a row of slot machines. `still` goes
// further and never animates at all, on mount or after.
//
// It owns the noun as well as the digits. Read from the target instead, the
// label contradicts the number for the whole animation: an order ending on its
// last box would say "28 box left" until the count landed.
export function BoxCount({
  from, to, duration = 700, countOnMount = true, still = false,
  unitOne, unitMany, unitClassName = '', className = '',
}) {
  // motion v12 ships reducedMotion: "never", so the preference is honoured
  // here explicitly or not at all.
  const reduce = useReducedMotion();
  const frozen = still || reduce;
  // Under reduced motion the first painted frame must already be the truth —
  // seeding it with `from` and correcting it is the one hard content jump the
  // preference exists to suppress.
  const start = countOnMount && !frozen ? (from ?? to) : to;
  const shown = useRef(start);
  const [val, setVal] = useState(start);

  useEffect(() => {
    if (frozen) { shown.current = to; setVal(to); return undefined; }
    const a = shown.current;
    if (a === to) { setVal(to); return undefined; }
    let raf;
    let t0 = null;
    const tick = (now) => {
      if (t0 == null) t0 = now;
      const p = Math.min(1, (now - t0) / duration);
      // easeOutCubic: most of the distance early, so the figure is readable
      // well before it settles.
      const v = Math.round(a + (to - a) * (1 - (1 - p) ** 3));
      shown.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, frozen]);

  // The digits sit in a box as wide as the widest they have been, so crossing
  // a power of ten mid-count does not drag the word beside them sideways.
  const widest = useRef(1);
  widest.current = Math.max(widest.current, String(Math.abs(val)).length, String(Math.abs(Number(to) || 0)).length);

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={clsx('inline-block text-right tabular-nums', className)}
        style={{ minWidth: `${widest.current}ch` }}
      >
        {/* String, not formatNumber: a box count never needs a thousands
            separator in this range, and formatNumber builds a fresh
            Intl.NumberFormat on every one of the ~42 frames. */}
        {String(val)}
      </span>
      {unitMany && <span className={unitClassName}>{val === 1 ? unitOne : unitMany}</span>}
    </span>
  );
}


// --- Loading / empty --------------------------------------------------------
export function Spinner({ className }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageSpinner({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted">
      <Spinner className="h-8 w-8" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', message, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="rounded-full bg-elevated p-3">
        <Icon className="h-6 w-6 text-faint" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// --- Table ------------------------------------------------------------------
// The wrapper scrolls horizontally WITHIN its card on small screens, so a wide
// table never forces the whole page to scroll sideways. Touch momentum on iOS.
export function Table({ children, className }) {
  return (
    <div className={clsx('-mx-px overflow-x-auto [-webkit-overflow-scrolling:touch]', className)}>
      <table className="min-w-full divide-y divide-border">{children}</table>
    </div>
  );
}
export const THead = ({ children }) => <thead className="bg-elevated">{children}</thead>;
export const TBody = ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>;
export const TR = ({ children, className, ...props }) => (
  <tr className={clsx('hover:bg-elevated/60', className)} {...props}>
    {children}
  </tr>
);
export const TH = ({ children, className }) => <th className={clsx('th', className)}>{children}</th>;
export const TD = ({ children, className, ...props }) => <td className={clsx('td', className)} {...props}>{children}</td>;

// --- Pagination -------------------------------------------------------------
export function Pagination({ page, totalPages, total, onChange }) {
  if (!totalPages || totalPages <= 1) {
    return total != null ? (
      <div className="px-4 py-3 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</div>
    ) : null;
  }
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <span className="text-xs text-muted">
        Page {page} of {totalPages}
        {total != null ? ` · ${total} records` : ''}
      </span>
      <div className="flex gap-1">
        <button className="btn-secondary px-2 py-1" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="btn-secondary px-2 py-1" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// --- Search input -----------------------------------------------------------
export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        className="input pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

// --- Modal ------------------------------------------------------------------
// Caps to the viewport height (dvh handles mobile browser chrome); the body
// scrolls while the header and footer stay pinned, and the footer wraps so
// action buttons never clip off-screen on a phone.
const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 backdrop-blur-sm sm:p-6">
      <div className={clsx('card my-4 flex max-h-[calc(100dvh-2rem)] w-full flex-col sm:my-8', SIZES[size])} role="dialog" aria-modal="true">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-faint hover:bg-elevated hover:text-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// --- Page header ------------------------------------------------------------
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// --- Stat card --------------------------------------------------------------
const STAT_TONES = {
  brand: { badge: 'from-brand-500 to-brand-600', glow: 'rgba(163,230,53,0.22)', dark: true },
  emerald: { badge: 'from-emerald-500 to-teal-500', glow: 'rgba(16,185,129,0.18)' },
  amber: { badge: 'from-amber-500 to-orange-500', glow: 'rgba(245,158,11,0.18)' },
  rose: { badge: 'from-rose-500 to-pink-500', glow: 'rgba(244,63,94,0.18)' },
  violet: { badge: 'from-violet-500 to-fuchsia-500', glow: 'rgba(139,92,246,0.18)' },
  slate: { badge: 'from-slate-500 to-slate-700', glow: 'rgba(148,163,184,0.18)' },
};

export function StatCard({ label, value, icon: Icon, hint, tone = 'brand', onClick, compact = false }) {
  const t = STAT_TONES[tone] || STAT_TONES.brand;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
      whileHover={onClick ? { y: -4 } : { y: -2 }}
      onClick={onClick}
      className={clsx('card relative overflow-hidden', compact ? 'p-3.5' : 'p-5', onClick && 'cursor-pointer')}
    >
      {/* Soft corner glow in the tone colour. */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
        style={{ background: t.glow }}
        aria-hidden="true"
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className={clsx('font-medium text-muted', compact ? 'text-xs' : 'text-sm')}>{label}</span>
        {Icon && (
          <span className={clsx('rounded-lg bg-gradient-to-br shadow-md', compact ? 'p-1.5' : 'rounded-xl p-2.5', t.badge, t.dark ? 'text-slate-950' : 'text-white')}>
            <Icon className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
          </span>
        )}
      </div>
      <div className={clsx(
        'relative min-w-0 break-words font-bold leading-snug tracking-tight text-foreground',
        compact ? 'mt-1.5 text-base xl:text-lg' : 'mt-3 text-lg sm:text-xl xl:text-2xl',
      )}>{value}</div>
      {hint && <div className={clsx('relative text-faint', compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs')}>{hint}</div>}
    </motion.div>
  );
}
