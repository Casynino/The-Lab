'use strict';

// ── A rep's order cannot be settled by a direct sale (audit #32/#42, 11 Nov 2026) ─────────────────────
// POST /sales with a settlementId used to create a settlement-linked sale without the rep's submission
// or the owner's approval — minting commission and closing boxes. Pinned: refused before anything runs.

const test = require('node:test');
const assert = require('node:assert/strict');

test('POST /sales with a settlementId is refused and creates nothing', async () => {
  let created = 0;
  const stub = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('../src/config/prisma', new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { created += 1; return null; } }) }));
  stub('../src/services/sales.service', new Proxy({}, { get: () => async () => { created += 1; return {}; } }));
  delete require.cache[require.resolve('../src/controllers/sales.controller')];
  const ctrl = require('../src/controllers/sales.controller');

  const req = {
    body: { settlementId: 'ckorder000000000000000000', salesRepId: 'ckrep0000000000000000000', type: 'CASH', items: [{ productId: 'p', quantity: 1 }] },
    user: { id: 'staff1', role: 'WAREHOUSE_STAFF' },
  };
  let error = null;
  await ctrl.create(req, { status: () => ({ json: () => {} }) }, (e) => { error = e; });
  assert.ok(error, 'the request must fail');
  assert.equal(error.statusCode, 400);
  assert.equal(created, 0, 'nothing may be read or written');
});
