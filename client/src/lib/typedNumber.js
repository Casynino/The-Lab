/*
  WHAT A NUMBER BOX HOLDS, APART FROM HOW IT LOOKS.

  The box on screen shows 500,000; the page is handed "500000". Everything that
  decides what a keystroke or a paste means lives here, as plain functions, so
  it can be checked without a browser — a wrong answer here is a wrong figure in
  somebody's books.

  "plain" is the number as the page receives it: digits, a "." only in a box
  that takes decimals, and a leading "-" where the field allows one. It may be
  unfinished while typing — "12.", "000000" after the first digit was deleted —
  and it is kept exactly as typed, because stripping those zeros turned a
  retyped 2,000,000 into 20.

  THE BOX NEVER SHOWS WHAT THE PAGE DOES NOT HOLD. Three review rounds found
  the same bug in different clothes: whenever the box showed something the page
  was told was "nothing", a page that reads nothing as "the full amount" saved
  a different figure from the one on screen. So a keystroke that would not make
  a figure is refused outright — including a "." in a shilling amount or a box
  count, which is how "1.500.000" typed becomes the 1,500,000 that was meant.
*/

export const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The plain number with its thousands marked, for the eye only. */
export function withCommas(plain) {
  if (plain === '' || plain == null) return '';
  const s = String(plain);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot); // a trailing "." survives while "12." is typed
  return (neg ? '-' : '') + groupThousands(whole) + rest;
}

const WELL_FORMED = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * What the page is told: the figure, or '' when there is none yet — a box
 * holding only "-" or "." while it is being typed, as the old number box
 * reported. The pages that take a negative treat '' as "not ready".
 */
export function meaning(plain) {
  const s = String(plain ?? '');
  return WELL_FORMED.test(s) && /\d/.test(s) ? s : '';
}

/** Two plain numbers the page would treat as the same figure. */
export function sameNumber(a, b) {
  const x = meaning(a);
  const y = meaning(b);
  return x === y || (x !== '' && y !== '' && Number(x) === Number(y));
}

/** A value the page set, as plain text. The page is not second-guessed: its sign stays. */
export function toPlain(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    // No exponent: 1e21 is a figure of twenty-two digits, not "1e+21".
    return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(value).replace(/[,\s]/g, '');
}

/**
 * Read the box after a keystroke. { ok: false } refuses it and the box keeps
 * what it had: a letter, a minus where the field takes none, a "." in a box
 * that takes no decimals, a second "." in one that does.
 */
export function readTyped(text, { negative = false, decimals = false } = {}) {
  const s = String(text ?? '');
  const first = s.search(/\d/);
  if (first === -1) {
    const t = s.replace(/[\s,]/g, '');
    if (t === '') return { ok: true, plain: '' };
    if (decimals && t === '.') return { ok: true, plain: t };
    if (negative && (t === '-' || (decimals && t === '-.'))) return { ok: true, plain: t };
    return { ok: false };
  }
  // Only a sign or a point may stand before the first digit. Commas count for
  // nothing there: deleting the 1 of "1,000,000" leaves ",000,000".
  const prefix = s.slice(0, first).replace(/[\s,]/g, '');
  if (!['', '-', '.', '-.'].includes(prefix)) return { ok: false };
  if (prefix.startsWith('-') && !negative) return { ok: false };
  const body = s.slice(first);
  if (!/^[\d,.\s]*$/.test(body)) return { ok: false }; // a letter typed into the figure
  const plain = prefix + body.replace(/[\s,]/g, '');
  const points = (plain.match(/\./g) || []).length;
  if (points > (decimals ? 1 : 0)) return { ok: false };
  return { ok: true, plain };
}

const CURRENCY = '(?:tshs?|tzs|shs?)\\.?';

/**
 * Read a pasted string on its own. It is taken only if it is one figure,
 * written one of the ways money is written here: "Tsh. 500,000/=",
 * "TZS 1,250,000", "1 250 000", "1.500.000", "-TSh 2,000" (as this app prints
 * a negative), "(2,000)", a full stop from the sentence it was copied out of.
 * Anything else — a second number, a date, a word, "(-2,000)" marked negative
 * twice, a "500.000" that could be five hundred or half a million — is refused.
 * Guessing is what turned "Tsh 25,000 2 boxes" into 250,002.
 */
export function readPaste(text, { negative = false, decimals = false } = {}) {
  let s = String(text ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[−‒–—]/g, '-')
    .trim()
    .replace(/^\.\s+/, '') // the full stop that ended the sentence before it
    .replace(/([\d=-])\s*\.$/, '$1') // and the one that ends its own
    .replace(/\s*\/[=-]$/, ''); // "/=" and "/-": whole shillings, as receipts write them
  let brackets = false;
  if (/^\(.*\)$/.test(s)) { brackets = true; s = s.slice(1, -1).trim(); }
  s = s
    .replace(new RegExp(`^(-?)\\s*${CURRENCY}\\s*`, 'i'), '$1')
    .replace(/\s*\/[=-]$/, '')
    .replace(new RegExp(`\\s*${CURRENCY}$`, 'i'), '')
    .trim();
  const signed = s.match(/^-\s*(.*)$/);
  if (signed && brackets) return { ok: false }; // two ways of saying minus: which did they mean?
  if (signed) s = signed[1];
  const neg = brackets || !!signed;
  if (neg && !negative) return { ok: false }; // never drop a sign the paste carried
  let digits = null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) digits = s.replace(/,/g, '');
  else if (/^\d{1,3}( \d{3})+(\.\d+)?$/.test(s)) digits = s.replace(/ /g, '');
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) digits = s.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) return { ok: false }; // 500.000: which one?
  else if (/^(\d+(\.\d+)?|\.\d+)$/.test(s)) digits = s;
  if (digits == null) return { ok: false };
  if (!decimals && digits.includes('.')) {
    // "10.00" copied from a sheet is ten; "2.9" boxes is not a count; and
    // "2,500.000" — three places after the point — may be two and a half
    // thousand or two and a half million, so it is not guessed at.
    if (!/\.0{1,2}$/.test(digits)) return { ok: false };
    digits = digits.replace(/\.0*$/, '');
  }
  return { ok: true, plain: (neg ? '-' : '') + digits };
}

const places = (s) => {
  const t = String(s ?? '');
  const i = t.indexOf('.');
  return i === -1 ? 0 : t.length - i - 1;
};

/** Up or down by the field's step, in exact decimal steps rather than float drift. */
export function stepPlain(plain, { step, dir, min, max }) {
  const current = meaning(plain);
  const by = Number(step) > 0 ? String(step) : '1';
  const dp = Math.max(places(current), places(by), places(min), places(max));
  const scale = 10 ** dp;
  let n = (Math.round((Number(current) || 0) * scale) + dir * Math.round(Number(by) * scale)) / scale;
  if (min != null && min !== '') n = Math.max(Number(min), n);
  if (max != null && max !== '') n = Math.min(Number(max), n);
  return dp > 0 ? n.toFixed(dp) : toPlain(Math.round(n));
}

/** Out of the field's range, as the old box would have refused it on submit. */
export function rangeMessage(plain, { min, max }) {
  const m = meaning(plain);
  if (m === '') return '';
  const n = Number(m);
  if (min != null && min !== '' && n < Number(min)) return `Must be at least ${withCommas(toPlain(Number(min)))}`;
  if (max != null && max !== '' && n > Number(max)) return `Must be no more than ${withCommas(toPlain(Number(max)))}`;
  return '';
}

export const countsForCaret = (ch) => /[\d.-]/.test(ch);

/** Where the caret goes after `count` digits (and signs/points) of the shown text. */
export function caretAfter(text, count) {
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (seen === count) return i;
    if (countsForCaret(text[i])) seen += 1;
  }
  return text.length;
}
