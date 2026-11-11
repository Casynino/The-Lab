import test from 'node:test';
import assert from 'node:assert/strict';
import { eatISODate } from './tz.js';

// A finance date field shows and sends the day Tanzania is on (audit #62). toISOString() gave the UTC
// day, which is still yesterday from 00:00 to 03:00 EAT.
test('eatISODate is the Tanzanian day of an instant, not the UTC day', () => {
  assert.equal(eatISODate('2026-11-11T20:59:59.999Z'), '2026-11-11'); // 23:59 EAT
  assert.equal(eatISODate('2026-11-11T21:00:00.000Z'), '2026-11-12'); // midnight EAT
  assert.equal(eatISODate('2026-11-11T22:30:00.000Z'), '2026-11-12'); // 01:30 EAT, the UTC day is the 11th
  assert.equal(eatISODate(new Date('2026-12-31T21:30:00.000Z')), '2027-01-01');
  assert.match(eatISODate(), /^\d{4}-\d{2}-\d{2}$/);
});
