// Small words and figures the screens print, kept here (plain JS, no Vite) so they are tested.

// Time left before an order's deadline, as a rep reads it. Always rounded DOWN: the deadline is when
// fines start, so "4d left" for 3 days 15 hours promised half a day that was not there (audit,
// 12 Nov 2026). Under a day it is told in hours, and the last hour is "due now".
// Late is rounded down too ("1h overdue" at 1 h 40 min), and its first hour is "just overdue", so
// half an hour late never reads as "0h overdue".
export function timeLeftLabel(hours, empty = '—') {
  if (hours == null || !Number.isFinite(Number(hours))) return empty;
  const h = Number(hours);
  if (h < 0) {
    const over = Math.abs(h);
    return over < 1 ? 'just overdue' : `${Math.floor(over)}h overdue`;
  }
  if (h < 1) return 'due now';
  if (h < 24) return `${Math.floor(h)}h left`;
  return `${Math.floor(h / 24)}d left`;
}

// Time left on ZELab's 24 h decision over a rep's return. The clock runs on ZELab, not on the rep, so it
// never reads "due now" (that told the rep something was due from him): the last hour, and the moments
// after the window ends before the expiry job runs, read "under 1h left". Rounded down like the rest.
export function approvalLeftLabel(hours, empty = '—') {
  if (hours == null || !Number.isFinite(Number(hours))) return empty;
  const h = Number(hours);
  return h < 1 ? 'under 1h left' : `${Math.floor(h)}h left`;
}

// A unit's name for more than one ("Box" -> "Boxes", "Carton" -> "Cartons").
export function pluralizeUnit(unit = 'unit') {
  if (!unit) return 'units';
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

// "1 Box", "2 Boxes" — the unit's own name, singular only for exactly one (never "Box(s)").
export function unitWord(n, unit = 'box') {
  return Math.abs(Number(n)) === 1 ? unit : pluralizeUnit(unit);
}

// The rep's Sales bonus track on Home. The headline % is the way to the NEXT tier, but the notches
// The fill on a bonus bar (Home and the admin rep card): the run's sales on the top tier's scale, held
// just short of the lowest notch not reached. Each tier counts from its own start (audit money-flows-1),
// so a tier added later can be unreached while the whole run is past its notch; the bar must never
// show it as passed. With one shared start this is the plain sales / top.
export function bonusFillPct(sales, tiers, top) {
  if (!(top > 0)) return 0;
  const raw = (Math.max(0, Number(sales) || 0) / top) * 100;
  const caps = (tiers || []).filter((t) => !t.reached).map((t) => ((Number(t.target) || 0) / top) * 100 - 1);
  return Math.max(0, Math.min(100, raw, ...caps));
}

// The rep's Sales bonus track on Home. The headline % is the way to the NEXT tier, but the notches
// stand on the scale of the TOP tier, so the fill has to use that scale too — a bar drawn at 94% of
// the way to 10M ran past the 10M notch (at 67% of 15M) that had not been reached (audit, 12 Nov 2026).
export function bonusTrack(bonus) {
  if (!bonus?.configured || !bonus.tiers?.length) return null;
  const tiers = bonus.tiers;
  const aim = bonus.next || tiers[tiers.length - 1];
  const top = Number(tiers[tiers.length - 1].target) || 0;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  return {
    aim,
    pct: clamp(Number(aim.progress) || 0),
    barPct: top > 0 ? bonusFillPct(bonus.sales, tiers, top) : clamp(Number(aim.progress) || 0),
    markers: top > 0 ? tiers.map((t) => ({ at: clamp(((Number(t.target) || 0) / top) * 100), passed: Boolean(t.reached) })) : [],
  };
}
