// All time-based UI logic must use Tanzania time (Africa/Dar_es_Salaam = UTC+3).
const TZ = 'Africa/Dar_es_Salaam';

export function tzHour() {
  return parseInt(
    new Intl.DateTimeFormat('en', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  );
}

// 05:00–11:59 morning · 12:00–17:59 afternoon · 18:00–04:59 evening
export function tzGreeting() {
  const h = tzHour();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function tzDateLabel(opts = {}) {
  return new Date().toLocaleDateString('en', { timeZone: TZ, ...opts });
}

// A given date as Tanzania sees it — "21 Sep" by default. Used for the week's
// own dates, which the server works out in EAT and sends as timestamps.
export function eatDay(value, opts = { day: 'numeric', month: 'short' }) {
  return new Date(value).toLocaleDateString('en-GB', { timeZone: TZ, ...opts });
}

// An instant's day as Tanzania sees it, as 'YYYY-MM-DD' — the value a date field shows and sends. The
// finance forms used toISOString(), which is the UTC day: from 00:00 to 03:00 EAT it offered yesterday,
// and a correction opened on a row from those hours showed the day before the one in the list.
export function eatISODate(value = new Date()) {
  return new Date(new Date(value).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}
