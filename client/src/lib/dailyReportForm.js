/*
  THE REP'S DAILY REPORT FORM (audit 11 Nov 2026, rep-app-3).

  One opening and one closing report a day. Opening the form again the same day opens the report already
  sent, filled in with what was saved, as "Update today's ... report"; saving sends every field (a cleared
  one as null) and says which report it changes (`replaces`). Before, the form always started blank and a
  second send was merged into the first in silence. The server refuses a second report that does not say
  which one it changes.
*/
export const REPORT_FIELDS = {
  OPENING: ['cashOnHand', 'customersToVisit', 'openingNote'],
  CLOSING: ['salesAmount', 'cashCollected', 'debtsCreated', 'debtsCollected', 'closingNote'],
};
const TEXT_FIELDS = new Set(['openingNote', 'closingNote']);

/** The form's starting values: blank, or what the saved report holds (figures as numbers). */
export function formFromReport(report, type) {
  const form = {};
  if (!report) return form;
  for (const k of REPORT_FIELDS[type] || []) {
    const v = report[k];
    if (v == null || v === '') continue;
    if (TEXT_FIELDS.has(k)) form[k] = String(v);
    else if (Number.isFinite(Number(v))) form[k] = Number(v);
  }
  return form;
}

const blank = (k, v) => v === undefined || v === null || (TEXT_FIELDS.has(k) ? String(v).trim() === '' : Number.isNaN(v));

/** Is at least one figure or a note filled in? (An empty report is refused.) */
export function reportFilled(form, type) {
  return (REPORT_FIELDS[type] || []).some((k) => !blank(k, form[k]));
}

/**
 * What is sent. A new report: only what was filled in. A change to the report sent earlier today: its id
 * and every field of that kind, null for a cleared one, so the saved report is exactly what is on screen.
 */
export function reportPayload(type, form, existing) {
  const body = { type };
  if (existing) body.replaces = existing.id;
  for (const k of REPORT_FIELDS[type] || []) {
    const v = form[k];
    if (blank(k, v)) {
      if (existing) body[k] = null;
    } else {
      body[k] = TEXT_FIELDS.has(k) ? String(v).trim() : v;
    }
  }
  return body;
}
