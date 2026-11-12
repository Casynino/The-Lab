'use strict';

// What a business setting may hold (audit 11 Nov 2026, admin-system-4: Settings saved "abc" as the reorder
// cover, "-5" as the order window and "0" or "250,000" as the withdrawal minimum, all with a "Saved" toast).
// A value outside its rule is refused with a sentence before anything is written. Figures may be typed with
// thousands commas or spaces; they are stored as plain digits, the form the server reads.
//
// Some of these keys are not read by the app yet (the Settings page says so and shows them read-only); they
// still get a sensible rule, so the stored value is a real figure when one is wired in.
const RULES = {
  // Money: the least a rep can withdraw. It is the one figure here that moves money, so never 0 or below.
  // `example` is the figure shown when something else is typed: the usual value, so it reads right.
  'commission.amountPerThreshold': { integer: true, min: 1, max: 100_000_000, what: 'The withdrawal minimum', example: '250,000' },
  'settlement.windowHours': { integer: true, min: 1, max: 720, what: 'The order window', example: '72' },
  'credit.defaultTermDays': { integer: true, min: 0, max: 365, what: 'The credit term', example: '30' },
  'reorder.coverDays': { integer: true, min: 1, max: 365, what: 'The days of stock to cover', example: '30' },
  'reorder.lookbackDays': { integer: true, min: 1, max: 365, what: 'The days of sales to look back at', example: '30' },
};
// Quiet hours: an hour of the day, or blank for off.
const HOUR_KEYS = new Set(['whatsapp.quietFrom', 'whatsapp.quietTo']);

const FIGURE = /^-?\d+(\.\d+)?$/;

/**
 * Check a setting's new value. Returns the value to store, or throws `badRequest(message)`.
 * `type` is the row's type (the one sent, else the stored one): any NUMBER setting must be a figure.
 */
function checkSetting(key, value, type, badRequest) {
  const raw = String(value ?? '');

  if (HOUR_KEYS.has(key)) {
    if (raw === '') return raw;
    const h = Number(raw);
    if (!/^\d{1,2}$/.test(raw) || h > 23) throw badRequest('Quiet hours take an hour from 0 to 23, or Off.');
    return String(h);
  }
  if (key.startsWith('whatsapp.notify.')) {
    if (raw !== '0' && raw !== '1') throw badRequest('An alert is either on (1) or off (0).');
    return raw;
  }

  const rule = RULES[key];
  if (!rule && type !== 'NUMBER') return raw;

  const plain = raw.replace(/[\s,]/g, '');
  const what = rule?.what || 'This setting';
  if (!FIGURE.test(plain) || !Number.isFinite(Number(plain))) {
    throw badRequest(rule?.example ? `${what} must be a number, for example ${rule.example}.` : `${what} must be a number.`);
  }
  const n = Number(plain);
  if (rule) {
    if (rule.integer && !Number.isInteger(n)) throw badRequest(`${what} must be a whole number.`);
    if (n < rule.min || n > rule.max) {
      throw badRequest(`${what} must be from ${rule.min.toLocaleString('en-US')} to ${rule.max.toLocaleString('en-US')}.`);
    }
  }
  return String(n);
}

module.exports = { checkSetting, SETTING_RULES: RULES };
