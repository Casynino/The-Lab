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
