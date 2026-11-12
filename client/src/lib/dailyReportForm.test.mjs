import test from 'node:test';
import assert from 'node:assert/strict';
import { formFromReport, reportFilled, reportPayload } from './dailyReportForm.js';

// What GET /daily-reports gives back for a saved opening report (Prisma decimals come as strings).
const saved = {
  id: 'dr1', type: 'OPENING', cashOnHand: '70000', customersToVisit: 4, openingNote: 'Kariakoo',
  salesAmount: null, closingNote: null,
};

test('the form opens with what was saved (figures as numbers), or blank when nothing was sent yet', () => {
  assert.deepEqual(formFromReport(saved, 'OPENING'), { cashOnHand: 70000, customersToVisit: 4, openingNote: 'Kariakoo' });
  assert.deepEqual(formFromReport(null, 'OPENING'), {});
  assert.deepEqual(formFromReport({ id: 'x', cashOnHand: null, openingNote: '' }, 'OPENING'), {});
  // a zero is a figure
  assert.deepEqual(formFromReport({ id: 'x', cashOnHand: '0' }, 'OPENING'), { cashOnHand: 0 });
});

test('a new report sends only what was filled in', () => {
  assert.deepEqual(reportPayload('OPENING', { cashOnHand: 70000, openingNote: '  ' }, null), { type: 'OPENING', cashOnHand: 70000 });
  assert.deepEqual(reportPayload('CLOSING', { salesAmount: 0 }, null), { type: 'CLOSING', salesAmount: 0 });
});

test('a change to today\'s report says which one and sends every field, null for a cleared one', () => {
  const form = { ...formFromReport(saved, 'OPENING'), cashOnHand: 65000, customersToVisit: undefined, openingNote: ' Kariakoo, then Mbezi ' };
  assert.deepEqual(reportPayload('OPENING', form, saved), {
    type: 'OPENING', replaces: 'dr1', cashOnHand: 65000, customersToVisit: null, openingNote: 'Kariakoo, then Mbezi',
  });
  // nothing of the other kind of report is touched
  assert.equal('salesAmount' in reportPayload('OPENING', form, saved), false);
});

test('there is something to send only when one figure or a note is filled in', () => {
  assert.equal(reportFilled({}, 'OPENING'), false);
  assert.equal(reportFilled({ openingNote: '   ', cashOnHand: Number.NaN }, 'OPENING'), false);
  assert.equal(reportFilled({ cashOnHand: 0 }, 'OPENING'), true);
  assert.equal(reportFilled({ closingNote: 'done' }, 'CLOSING'), true);
  assert.equal(reportFilled({ cashOnHand: 5 }, 'CLOSING'), false);
});
