'use strict';

// ── Whether a rep's WhatsApp alerts can arrive (audit, 12 Nov 2026) ─────────────────────────────────
// A rep added with "+ New rep" has a phone but no CallMeBot number or key, so no WhatsApp can reach him,
// yet his Settle and Withdraw receipts said "You'll get a WhatsApp once it's approved". The signed-in
// user now carries `whatsappOn` (number AND key set) and still never the key itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicUser } = require('../src/services/auth.service');

const rep = (salesRep) => publicUser({ id: 'u1', name: 'Juma', role: { name: 'SALES_REP', permissions: [] }, salesRep });

test('whatsappOn is true only with both the number and the key, and the key is never sent', () => {
  const on = rep({ id: 'r1', whatsappPhone: '+255700000088', whatsappApiKey: 'secret-key' });
  assert.equal(on.salesRep.whatsappOn, true);
  assert.equal(on.salesRep.whatsappApiKey, undefined);
  assert.ok(!JSON.stringify(on).includes('secret-key'));

  assert.equal(rep({ id: 'r1', whatsappPhone: '+255700000088', whatsappApiKey: null }).salesRep.whatsappOn, false);
  assert.equal(rep({ id: 'r1', whatsappPhone: null, whatsappApiKey: 'k' }).salesRep.whatsappOn, false);
  // A new rep: only his ordinary phone.
  assert.equal(rep({ id: 'r1', phone: '0700 000 088', whatsappPhone: null, whatsappApiKey: null }).salesRep.whatsappOn, false);
  assert.equal(publicUser({ id: 'a', role: { name: 'ADMIN', permissions: [] }, salesRep: null }).salesRep, null);
});

// The owner's switch Settings > WhatsApp > "Sales rep alerts" off: nothing is sent to any rep, so even a rep
// with his number and key must not be promised a WhatsApp (review, 12 Nov 2026).
test('whatsappOn is false when rep alerts are switched off, even with the number and the key', () => {
  const salesRep = { id: 'r1', whatsappPhone: '+255700000088', whatsappApiKey: 'secret-key' };
  const user = { id: 'u1', name: 'Juma', role: { name: 'SALES_REP', permissions: [] }, salesRep };
  assert.equal(publicUser(user, { repAlertsOn: false }).salesRep.whatsappOn, false);
  assert.equal(publicUser(user, { repAlertsOn: true }).salesRep.whatsappOn, true);
  assert.equal(publicUser(user, { repAlertsOn: false }).salesRep.whatsappApiKey, undefined);
});

test('the rep-alerts switch is the REP_ALERT setting the WhatsApp queue obeys', () => {
  const wn = require('../src/services/whatsappNotify.service');
  assert.equal(typeof wn.isEnabled, 'function');
  assert.ok(wn.TYPES.REP_ALERT, 'REP_ALERT is a toggle in Settings > WhatsApp');
});
