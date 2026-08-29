import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const CURRENCY = import.meta.env.VITE_CURRENCY || 'TZS';
const LOCALE = import.meta.env.VITE_LOCALE || 'en-TZ';

export function formatCurrency(value, { compact = false } = {}) {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY,
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    }).format(n);
  } catch {
    return `${CURRENCY} ${n.toLocaleString()}`;
  }
}

export function formatNumber(value, { compact = false } = {}) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(n);
}

export function formatPercent(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

export function formatDate(value) {
  if (!value) return '—';
  return dayjs(value).format('DD MMM YYYY');
}

export function formatDateTime(value) {
  if (!value) return '—';
  return dayjs(value).format('DD MMM YYYY, HH:mm');
}

export function fromNow(value) {
  if (!value) return '';
  return dayjs(value).fromNow();
}

// Pluralize a unit name for display ("Box" -> "Boxes", "Carton" -> "Cartons").
export function pluralizeUnit(unit = 'unit') {
  if (!unit) return 'units';
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// Whole percentages of a total that ADD UP TO 100. Rounding each share on its
// own is the obvious way and it is wrong: 3 of 8 and 5 of 8 round to 38% and
// 63%, and a reader who adds them gets 101 and is right to distrust the page.
// Largest-remainder: floor everything, then hand the leftover points to the
// shares that lost the most in the rounding.
export function sharePercents(values, total) {
  const n = values.length;
  if (!total || total <= 0) return new Array(n).fill(0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, x) => a + x, 0);
  const byRemainder = raw
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
