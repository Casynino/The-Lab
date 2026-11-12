import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  withCommas, meaning, sameNumber, toPlain, readTyped, readPaste, stepPlain, rangeMessage, countsForCaret, caretAfter,
} from '@/lib/typedNumber';
import { timeLeftLabel } from '@/lib/labels';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2, X, ChevronLeft, ChevronRight, Search, Inbox, AlertTriangle } from 'lucide-react';
import { useBackToClose } from '@/lib/useBackToClose';

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

/*
  A NUMBER BOX THAT SHOWS ITS COMMAS WHILE YOU TYPE.

  A bare 500000 in a payment box is one zero away from 50000 or 5000000, and
  here that zero is shillings in somebody's books. So the box reads 500,000 as
  it is typed and hands the page exactly what a number input handed it:
  e.target.value is the plain "500000", and "" for a box holding only "." or
  "-". Every form that read the old box reads this one unchanged.

  What a keystroke or a paste means is decided in lib/typedNumber, where it is
  tested; this component only keeps the box, the caret and the page in step.
  Two rules it keeps that the old box kept for free:
  - the box always shows what the page holds. A page that refuses a keystroke
    (a quantity clamped back to 1) gets its own figure back on screen;
  - a minus only where the field has no minimum of zero or more — the
    commission adjustment takes a negative, a payment never does.
*/
export const NumberInput = forwardRef(function NumberInput(
  { value, defaultValue, onChange, onKeyDown, min, max, step, decimals: decimalsProp, inputMode, className, placeholder, type: _type, ...props },
  ref
) {
  const negative = min == null || min === '' || Number(min) < 0;
  // A "." only where a field asks for decimals with a fractional step — none
  // does today: shillings have no cents here and boxes are counted whole, and
  // in a whole box "1.500.000" typed is the 1,500,000 that was meant, not 1.5.
  const decimals = decimalsProp ?? (step != null && (String(step) === 'any' || String(step).includes('.')));
  const rules = { negative, decimals };
  // Once the page has driven the box, a later undefined means empty, not "let go".
  const driven = useRef(value !== undefined);
  if (value !== undefined) driven.current = true;
  const controlled = driven.current;
  const [plain, setPlain] = useState(() => toPlain(controlled ? value : defaultValue));
  const text = withCommas(plain);
  // A figure the page brought with a fraction (a stored 12,345.67) stays
  // editable: its point may be kept or deleted, just not a new one added.
  const typing = { negative, decimals: decimals || plain.includes('.') };
  const box = useRef(null);
  const caret = useRef(null); // a count of digits to sit after, or 'all'
  useImperativeHandle(ref, () => box.current);

  const placeCaret = () => {
    const el = box.current;
    if (caret.current == null || !el) return;
    if (document.activeElement === el) {
      if (caret.current === 'all') el.select();
      else {
        const at = caretAfter(el.value, caret.current);
        el.setSelectionRange(at, at);
      }
    }
    caret.current = null;
  };

  // The box always shows the page's figure. Checked after every change of the
  // page's value AND of what was typed: a page that clamps a keystroke leaves
  // its own value unchanged, so watching the value alone let the box keep a 0
  // the invoice was billing as 1. When the page overrules what was typed, its
  // figure is selected, so the next digit replaces it — clearing a quantity the
  // page puts back to 1, then typing 2, gives 2, not 12.
  useLayoutEffect(() => {
    if (!controlled) return;
    const held = toPlain(value);
    if (!sameNumber(plain, held)) {
      const focused = box.current && document.activeElement === box.current;
      setPlain(held);
      if (focused) queueMicrotask(() => { caret.current = 'all'; placeCaret(); });
    }
  }, [controlled, value, plain]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(placeCaret);

  // A number input refused to submit a value outside its min/max; keep that.
  useEffect(() => {
    box.current?.setCustomValidity(rangeMessage(plain, { min, max }));
  }, [plain, min, max]);

  const accept = (next, count, event) => {
    caret.current = count;
    setPlain(next);
    const said = meaning(next);
    onChange?.({
      type: 'change',
      target: { name: props.name, value: said },
      currentTarget: { name: props.name, value: said },
      nativeEvent: event?.nativeEvent,
      preventDefault: () => event?.preventDefault?.(),
      stopPropagation: () => event?.stopPropagation?.(),
    });
    // When nothing visible changes (a comma typed into "12,345"), React puts
    // the old text back after this handler and throws the caret to the end.
    queueMicrotask(placeCaret);
  };

  const refuse = (count) => {
    caret.current = count;
    queueMicrotask(placeCaret);
  };

  const digitsIn = (str) => [...str].filter(countsForCaret).length;

  /*
    A pasted figure is read on its own, then put where the selection was.
    Reading the whole box after the paste glued "500.000" onto a default "0"
    as 0500.000 — five hundred — where on its own it is refused.
  */
  const insertFigure = (before, pasted, after, event) => {
    const read = readPaste(pasted, rules);
    if (!read.ok) return refuse(digitsIn(before));
    // Judged on what the whole box held, not on what the selection left: a
    // box that held "10" with its 1 selected is not a box holding its
    // starting 0. And a minus the user typed first is theirs — pasting 25,000
    // after it is minus 25,000; a signed paste simply replaces it.
    let head = before;
    let tail = after;
    if (plain === '' || plain === '0') { head = ''; tail = ''; }
    if (plain === '-') { head = read.plain.startsWith('-') ? '' : '-'; tail = ''; }
    const next = readTyped(head + read.plain + tail, typing);
    if (!next.ok) return refuse(digitsIn(before));
    accept(next.plain, digitsIn(head + read.plain), event);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const el = e.currentTarget;
    const s = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? s;
    insertFigure(text.slice(0, s), e.clipboardData?.getData('text') ?? '', text.slice(end), e);
  };

  const handleChange = (e) => {
    const el = e.target;
    const kind = e.nativeEvent?.inputType || '';
    const data = e.nativeEvent?.data;
    const caretNow = el.selectionStart ?? el.value.length;
    // A phone keyboard's clipboard or suggestion inserts a whole string as
    // "typing". It is read as the paste it is.
    if ((kind === 'insertText' || kind === 'insertReplacementText') && data && data.length > 1) {
      const at = Math.max(0, caretNow - data.length);
      return insertFigure(el.value.slice(0, at), data, el.value.slice(caretNow), e);
    }
    // A paste or drop that got past the paste handler is not guessed at.
    if (/^insertFrom(Paste|Drop)/.test(kind)) return refuse(Infinity);
    const before = el.value.slice(0, caretNow);
    const read = readTyped(el.value, typing);
    if (!read.ok) {
      // Refused: the box keeps what it had, and the caret goes back to where
      // the keystroke was made instead of jumping to the end.
      return refuse(digitsIn(before) - (countsForCaret(before.slice(-1)) ? 1 : 0));
    }
    accept(read.plain, digitsIn(before), e);
  };

  const handleKeyDown = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const { selectionStart: s, selectionEnd: end } = e.currentTarget;
    const plainKey = !e.altKey && !e.ctrlKey && !e.metaKey; // Cmd/Alt+Backspace keep their own meaning
    // Backspace just after a comma, or Delete just before one, would remove
    // the comma and put it straight back, and the key would seem dead. Take
    // the digit on the far side of the comma instead. Done here rather than by
    // moving the caret: the browser deletes at the caret it had on key-down.
    const edit = (next, caretText) => {
      e.preventDefault();
      const read = readTyped(next, typing);
      if (read.ok) accept(read.plain, digitsIn(caretText), e);
    };
    if (plainKey && s === end && e.key === 'Backspace' && s > 1 && text[s - 1] === ',') {
      const next = text.slice(0, s - 2) + text.slice(s - 1);
      return edit(next, next.slice(0, s - 2));
    }
    if (plainKey && s === end && e.key === 'Delete' && text[s] === ',' && s + 1 < text.length) {
      const next = text.slice(0, s + 1) + text.slice(s + 2);
      return edit(next, next.slice(0, s + 1));
    }
    // Up and down still count, as they did on the old box.
    if (plainKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      accept(stepPlain(plain, { step, dir: e.key === 'ArrowUp' ? 1 : -1, min, max }), Infinity, e);
    }
  };

  return (
    <input
      ref={box}
      type="text"
      inputMode={inputMode ?? (negative ? undefined : decimals ? 'decimal' : 'numeric')}
      autoComplete="off"
      className={clsx('input tabular-nums', className)}
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDrop={(e) => e.preventDefault()}
      // A figure used as a hint — "the bill is 1776000" — gets its commas too.
      placeholder={/^-?\d+(\.\d+)?$/.test(String(placeholder ?? '')) ? withCommas(String(placeholder)) : placeholder}
      {...props}
    />
  );
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

// The words themselves are lib/labels.js timeLeftLabel (rounded down, so the time before a fine is
// never overstated; tested there).

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
      {timeLeftLabel(hours)}
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
  unitOne, unitMany, suffix, unitClassName = '', className = '',
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
      {/* The noun and the word after it are one text node, so "boxes left"
          is spaced like the sentence it is rather than by a flex gap that
          makes the two halves look like separate labels. */}
      {unitMany && (
        <span className={unitClassName}>
          {val === 1 ? unitOne : unitMany}{suffix ? ` ${suffix}` : ''}
        </span>
      )}
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

// A list whose request failed is not an empty list: "No sales yet" over a request that never came back
// told the owner something false about the books (audit, 11 Nov 2026). Same look as the Dashboard's
// "Couldn't load" state, with a way to try again.
export function LoadError({ what = 'this list', onRetry }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={`Couldn't load ${what}`}
      message="The request did not come back, so nothing is shown rather than a wrong figure. Check the connection and try again."
      action={onRetry ? <Button variant="secondary" onClick={() => onRetry()}>Try again</Button> : null}
    />
  );
}

// --- Table ------------------------------------------------------------------
// The wrapper scrolls horizontally WITHIN its card on small screens, so a wide
// table never forces the whole page to scroll sideways. Touch momentum on iOS.
//
// `stack`: when the table's own box is narrower than 40rem (a phone, a window on a
// phone, a narrow column), each row becomes a small card of labelled figures instead
// of a row whose money columns sit behind a sideways swipe (audit, 12 Nov 2026: the
// statement's In/Out/Balance, the ledger's Amount, a sale's Total started past the
// edge of a 390 px screen). stack="wide" does it under 48rem, for a long list that
// does not fit a tablet either. index.css `.table-stack` does the layout with a container
// query; the labels are the header's own words, copied onto each cell here. A header
// cell may give a shorter label with data-label; a cell with class `stack-full` takes
// the whole width of the card.
function labelCells(table) {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const names = [];
  for (const th of head.cells) {
    const name = th.dataset.label ?? th.textContent.trim();
    for (let k = 0; k < (th.colSpan || 1); k += 1) names.push(k === 0 ? name : '');
  }
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let col = 0;
      for (const cell of row.cells) {
        const span = cell.colSpan || 1;
        const name = span === 1 ? (names[col] || '') : '';
        if (cell.getAttribute('data-label') !== name) cell.setAttribute('data-label', name);
        col += span;
      }
    }
  }
}
export function Table({ children, className, stack = false }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!stack || !table) return undefined;
    labelCells(table);
    // Rows come and go (a page, a filter, a refetch) without this component rendering again.
    const watch = new MutationObserver(() => labelCells(table));
    watch.observe(table, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [stack]);
  return (
    <div className={clsx('-mx-px overflow-x-auto [-webkit-overflow-scrolling:touch]', stack && (stack === 'wide' ? 'table-stack-wide' : 'table-stack'), className)}>
      <table ref={ref} className="min-w-full divide-y divide-border">{children}</table>
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
export const TH = ({ children, className, ...props }) => <th className={clsx('th', className)} {...props}>{children}</th>;
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
      <div className="flex gap-2 sm:gap-1">
        <button className="btn-secondary min-h-11 min-w-11 px-2 py-1 sm:min-h-0 sm:min-w-0" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button className="btn-secondary min-h-11 min-w-11 px-2 py-1 sm:min-h-0 sm:min-w-0" aria-label="Next page" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
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
//
// In the installed app the page runs under the clock, the camera and the home
// bar (viewport-fit=cover), so a window pinned to the top had its title and its
// close button UNDER the opaque status strip, and its buttons on the home bar.
// `modal-safe` / `modal-panel` (index.css) keep the window inside what the phone
// leaves visible; on a screen with no notch they are the old 0.75rem / 1.5rem.
const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
// Escape closes the window, like its X. With one window open over another (a "Reject?" step over an
// order) only the top one closes: the open windows are kept in the order they opened.
// Phone/browser Back closes it too (lib/backToClose.js). While a save started from it is on its way it
// cannot be closed at all: X, Escape, Back and the footer's buttons wait for the answer (audit rep-app-10).
const openModals = [];
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busy = useBackToClose(open, onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The title names the window for a screen reader.
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const me = {};
    openModals.push(me);
    const onKey = (e) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === me && !busyRef.current) closeRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = openModals.indexOf(me);
      if (at >= 0) openModals.splice(at, 1);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-safe fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 backdrop-blur-md">
      <div className={clsx('modal-panel modal-glass my-4 flex w-full flex-col sm:my-8', SIZES[size])} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <h3 id={titleId} className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-elevated hover:text-muted disabled:cursor-not-allowed disabled:opacity-40 sm:m-0 sm:h-auto sm:w-auto sm:p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {/* A fieldset, so while a save is on its way every button in the footer (Cancel too) is disabled. */}
        {footer && <fieldset disabled={busy} className="m-0 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-4">{footer}</fieldset>}
      </div>
    </div>
  );
}

// --- Page header ------------------------------------------------------------
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold text-foreground sm:text-2xl">{title}</h1>
        {/* The subtitle is a sentence explaining the page to somebody seeing it
            for the first time. On a phone it is three lines of something the
            owner already knows, above the thing he opened the page for. */}
        {subtitle && <p className="mt-1 hidden text-sm text-muted sm:block">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// --- Stat card --------------------------------------------------------------
// The owner's premium finish (Nino, 11 Nov 2026: "the cards should match the profile now"): every stat
// card is the red-lit premium card, and its icon sits in a soft round chip tinted by the tone — no more
// bright gradient squares. Labels, values, hints and clicks are unchanged.
const STAT_TONES = {
  brand: { chip: 'bg-brand-500/15 text-brand-400 ring-brand-500/30', glow: '0 0 14px rgba(238,49,36,.3)' },
  emerald: { chip: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', glow: '0 0 14px rgba(16,185,129,.25)' },
  amber: { chip: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', glow: '0 0 14px rgba(245,158,11,.25)' },
  rose: { chip: 'bg-rose-500/15 text-rose-300 ring-rose-500/30', glow: '0 0 14px rgba(244,63,94,.25)' },
  violet: { chip: 'bg-violet-500/15 text-violet-300 ring-violet-500/30', glow: '0 0 14px rgba(139,92,246,.25)' },
  sky: { chip: 'bg-sky-500/15 text-sky-300 ring-sky-500/30', glow: '0 0 14px rgba(14,165,233,.25)' },
  slate: { chip: 'bg-white/[0.06] text-white/60 ring-white/10', glow: undefined },
};

export function StatCard({ label, value, icon: Icon, hint, tone = 'brand', onClick, compact = false }) {
  // An unknown tone is neutral, never a silent red (a 'sky' or 'default' used to turn into brand red).
  const t = STAT_TONES[tone] || STAT_TONES.slate;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
      whileHover={onClick ? { y: -4 } : { y: -2 }}
      onClick={onClick}
      className={clsx('stat-glass', compact ? 'p-3' : 'p-3.5 sm:p-5', onClick && 'cursor-pointer')}
    >
      <div className="relative flex items-start justify-between gap-3">
        <span className={clsx('font-medium text-white/60', compact ? 'text-xs' : 'text-sm')}>{label}</span>
        {Icon && (
          <span
            className={clsx('flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset', compact ? 'h-7 w-7' : 'h-8 w-8 sm:h-10 sm:w-10', t.chip)}
            style={t.glow ? { boxShadow: t.glow } : undefined}
          >
            <Icon className={clsx(compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-[18px] sm:w-[18px]')} />
          </span>
        )}
      </div>
      <div className={clsx(
        'relative min-w-0 break-words font-bold leading-snug tracking-tight text-foreground',
        compact ? 'mt-1.5 text-base xl:text-lg' : 'mt-2 text-base sm:mt-3 sm:text-xl xl:text-2xl',
      )}>{value}</div>
      {hint && <div className={clsx('relative text-faint', compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs')}>{hint}</div>}
    </motion.div>
  );
}
