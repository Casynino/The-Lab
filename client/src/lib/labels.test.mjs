import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLeftLabel, pluralizeUnit, unitWord, bonusTrack } from './labels.js';

test('time left is rounded down, never up to a day that is not there', () => {
  assert.equal(timeLeftLabel(86.87), '3d left'); // 3 days 14.9 h — it used to read "4d left"
  assert.equal(timeLeftLabel(92.94), '3d left');
  assert.equal(timeLeftLabel(36), '1d left'); // used to read "2d left"
  assert.equal(timeLeftLabel(60), '2d left'); // used to read "3d left"
  assert.equal(timeLeftLabel(48), '2d left');
  assert.equal(timeLeftLabel(153.05), '6d left');
});

test('under a day it is told in hours, rounded down; the last hour is due now', () => {
  assert.equal(timeLeftLabel(23.9), '23h left'); // not "24h left"
  assert.equal(timeLeftLabel(24), '1d left');
  assert.equal(timeLeftLabel(1.5), '1h left');
  assert.equal(timeLeftLabel(0.99), 'due now');
  assert.equal(timeLeftLabel(0), 'due now');
});

test('late: the first hour is "just overdue", then whole hours late', () => {
  assert.equal(timeLeftLabel(-0.5), 'just overdue');
  assert.equal(timeLeftLabel(-1.7), '1h overdue');
  assert.equal(timeLeftLabel(-49.2), '49h overdue');
});

test('no figure gives the placeholder', () => {
  assert.equal(timeLeftLabel(null), '—');
  assert.equal(timeLeftLabel(undefined, ''), '');
  assert.equal(timeLeftLabel('x'), '—');
});

test('unit names: singular for exactly one, the plural otherwise', () => {
  assert.equal(unitWord(1, 'Box'), 'Box');
  assert.equal(unitWord(2, 'Box'), 'Boxes');
  assert.equal(unitWord(0, 'Box'), 'Boxes');
  assert.equal(unitWord(-1, 'Box'), 'Box');
  assert.equal(unitWord(3), 'boxes');
  assert.equal(unitWord(1), 'box');
  assert.equal(unitWord(5, 'Carton'), 'Cartons');
  assert.equal(pluralizeUnit('Battery'), 'Batteries');
  assert.equal(pluralizeUnit(''), 'units');
});

// Mrema on the audit copy: 9,407,500 sold, tiers at 10M (94%, not reached) and 15M (63%).
const MREMA = {
  configured: true,
  sales: 9407500,
  next: { target: 10000000, progress: 94, reached: false },
  tiers: [
    { target: 10000000, progress: 94, reached: false },
    { target: 15000000, progress: 63, reached: false },
  ],
};

test('the bonus bar is filled on the same scale as its notches', () => {
  const t = bonusTrack(MREMA);
  assert.equal(t.pct, 94); // the headline: the way to the next tier
  assert.equal(Math.round(t.barPct), 63); // the fill: 9.4M of the 15M track
  assert.deepEqual(t.markers.map((m) => Math.round(m.at)), [67, 100]);
  // the fill stops short of the 10M notch it has not reached
  assert.ok(t.barPct < t.markers[0].at);
});

test('a reached tier sits under the fill; past the top the bar is full', () => {
  const t = bonusTrack({ ...MREMA, sales: 12000000, next: MREMA.tiers[1], tiers: [{ ...MREMA.tiers[0], reached: true }, MREMA.tiers[1]] });
  assert.ok(t.barPct >= t.markers[0].at);
  assert.equal(t.markers[0].passed, true);
  const done = bonusTrack({ ...MREMA, sales: 20000000, next: null });
  assert.equal(done.barPct, 100);
});

test('no tiers, no track', () => {
  assert.equal(bonusTrack(null), null);
  assert.equal(bonusTrack({ configured: false, tiers: [] }), null);
  const zeroTop = bonusTrack({ configured: true, sales: 5, tiers: [{ target: 0, progress: 40 }] });
  assert.equal(zeroTop.barPct, 40);
  assert.deepEqual(zeroTop.markers, []);
});
