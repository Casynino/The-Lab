'use strict';

// ── Settings: a value is checked before it is saved (audit 11 Nov 2026, admin-system-4) ──────────────
// "abc" as the reorder cover, "-5" as the order window, "0" or "250,000" as the withdrawal minimum were all
// saved with a "Saved" toast. Now each is refused with a sentence (figures typed with commas are stored as
// digits), and the withdrawal minimum the server reads is never 0 or below whatever is stored.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

let rows = [];
let saved = [];
const prismaStub = {
  setting: {
    findMany: async () => rows,
    findUnique: async ({ where }) => rows.find((r) => r.key === where.key) || null,
    upsert: async ({ where, update }) => { saved.push({ key: where.key, value: update.value }); return { key: where.key, ...update }; },
  },
};
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', prismaStub);
install('../src/services/audit.service', { record: async () => {} });

const { checkSetting } = require('../src/utils/settingRules');
const ctrl = require('../src/controllers/settings.controller');
const commission = require('../src/services/commission.service');

const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });
const check = (key, value, type) => checkSetting(key, value, type, bad);

test('figures: a word, a minus, a fraction or a value out of range is refused with a sentence', () => {
  assert.throws(() => check('reorder.coverDays', 'abc', 'NUMBER'), /must be a number/);
  assert.throws(() => check('settlement.windowHours', '-5', 'NUMBER'), /from 1 to 720/);
  assert.throws(() => check('commission.amountPerThreshold', '0', 'NUMBER'), /withdrawal minimum must be from 1/);
  assert.throws(() => check('commission.amountPerThreshold', '-250000', 'NUMBER'), /from 1/);
  assert.throws(() => check('reorder.lookbackDays', '400', 'NUMBER'), /from 1 to 365/);
  assert.throws(() => check('credit.defaultTermDays', '7.5', 'NUMBER'), /whole number/);
  assert.throws(() => check('reorder.coverDays', '', 'NUMBER'), /must be a number/);
});

test('the "must be a number" sentence gives an example that fits the setting, not 30 for money', () => {
  assert.throws(() => check('commission.amountPerThreshold', 'abc', 'NUMBER'), { message: 'The withdrawal minimum must be a number, for example 250,000.' });
  assert.throws(() => check('commission.amountPerThreshold', '1e6', 'NUMBER'), /for example 250,000\./);
  assert.throws(() => check('settlement.windowHours', 'three days', 'NUMBER'), { message: 'The order window must be a number, for example 72.' });
  assert.throws(() => check('reorder.coverDays', 'abc', 'NUMBER'), /for example 30\./);
  // A NUMBER setting with no rule of its own gets no made-up example.
  assert.throws(() => check('some.newNumber', 'ten', 'NUMBER'), { message: 'This setting must be a number.' });
  // The example itself, as typed, is accepted.
  assert.equal(check('commission.amountPerThreshold', '250,000', 'NUMBER'), '250000');
});

test('figures typed with commas or spaces are stored as plain digits', () => {
  assert.equal(check('commission.amountPerThreshold', '250,000', 'NUMBER'), '250000');
  assert.equal(check('commission.amountPerThreshold', ' 300 000 ', 'NUMBER'), '300000');
  assert.equal(check('reorder.coverDays', '31', 'NUMBER'), '31');
  assert.equal(check('credit.defaultTermDays', '0', 'NUMBER'), '0');
});

test('any other NUMBER setting must still be a figure; text settings are left as typed', () => {
  assert.throws(() => check('some.newNumber', 'ten', 'NUMBER'), /must be a number/);
  assert.equal(check('some.newNumber', '10', 'NUMBER'), '10');
  assert.equal(check('whatsapp.phone', '+255 700 000 000', 'STRING'), '+255 700 000 000');
  assert.equal(check('business.name', 'ZELab', 'STRING'), 'ZELab');
});

test('quiet hours are an hour of the day or Off; an alert switch is 0 or 1', () => {
  assert.equal(check('whatsapp.quietFrom', '', undefined), '');
  assert.equal(check('whatsapp.quietTo', '7', undefined), '7');
  assert.throws(() => check('whatsapp.quietFrom', '24', undefined), /0 to 23/);
  assert.throws(() => check('whatsapp.quietFrom', 'night', undefined), /0 to 23/);
  assert.equal(check('whatsapp.notify.STOCK_REQUEST', '0', 'STRING'), '0');
  assert.throws(() => check('whatsapp.notify.STOCK_REQUEST', 'yes', 'STRING'), /on \(1\) or off \(0\)/);
});

const put = (key, body) => new Promise((resolve, reject) => {
  const res = { status: () => res, json: (payload) => resolve(payload) };
  ctrl.upsert({ params: { key }, body, user: { id: 'owner' } }, res, (err) => (err ? reject(err) : resolve(null)));
});

test('PUT /settings/:key refuses a bad value and saves nothing; the type comes from the stored row when not sent', async () => {
  rows = [{ key: 'reorder.coverDays', type: 'NUMBER', value: '30' }];
  saved = [];
  await assert.rejects(put('reorder.coverDays', { value: 'abc' }), (e) => e.statusCode === 400 && /must be a number/.test(e.message));
  assert.equal(saved.length, 0);
  await put('reorder.coverDays', { value: '31', type: 'NUMBER' });
  assert.deepEqual(saved, [{ key: 'reorder.coverDays', value: '31' }]);
  // the frozen one is still refused with its own reason
  await assert.rejects(put('commission.v1PerBox', { value: '6000', type: 'NUMBER' }), /before 1 Aug 2026/);
});

test('the withdrawal minimum the server reads is never 0, negative or garbage, whatever is stored', async () => {
  for (const [stored, expected] of [['250000', 250000], ['300000', 300000], ['0', 250000], ['-5', 250000], ['250,000', 250000], ['', 250000]]) {
    rows = [{ key: 'commission.amountPerThreshold', value: stored }, { key: 'commission.v1PerBox', value: '5000' }];
    const rule = await commission.getRule();
    assert.equal(rule.amountPerThreshold, expected, `stored ${JSON.stringify(stored)}`);
    assert.equal(rule.perBox, 5000);
  }
});
