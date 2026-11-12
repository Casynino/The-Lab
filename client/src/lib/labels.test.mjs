import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLeftLabel, approvalLeftLabel, pluralizeUnit, unitWord, bonusTrack, bonusFillPct } from './labels.js';

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
  const done = bonusTrack({ ...MREMA, sales: 20000000, next: null, tiers: MREMA.tiers.map((t) => ({ ...t, reached: true })) });
  assert.equal(done.barPct, 100);
});

// audit money-flows-1: each tier counts from its own start, so a tier added later can be unreached while
// the whole run is far past its notch. Mrema: 9.72M this run; 1M added today (0 sold since), 9M reached,
// 10M and 15M not reached.
test('the fill never passes a notch that has not been reached', () => {
  const tiers = [
    { target: 1000000, progress: 0, reached: false },
    { target: 9000000, progress: 100, reached: true },
    { target: 10000000, progress: 97, reached: false },
    { target: 15000000, progress: 65, reached: false },
  ];
  const t = bonusTrack({ configured: true, sales: 9722500, next: tiers[2], tiers });
  t.markers.filter((m) => !m.passed).forEach((m) => assert.ok(t.barPct < m.at, `fill ${t.barPct} runs past the notch at ${m.at}`));
  // The admin card uses the same fill.
  assert.equal(bonusFillPct(9722500, tiers, 15000000), t.barPct);
  // With one shared start nothing changes: the plain sales / top.
  assert.equal(Math.round(bonusFillPct(9722500, tiers.slice(1), 15000000)), 65);
  assert.equal(bonusFillPct(5, tiers, 0), 0);
});

test('no tiers, no track', () => {
  assert.equal(bonusTrack(null), null);
  assert.equal(bonusTrack({ configured: false, tiers: [] }), null);
  const zeroTop = bonusTrack({ configured: true, sales: 5, tiers: [{ target: 0, progress: 40 }] });
  assert.equal(zeroTop.barPct, 40);
  assert.deepEqual(zeroTop.markers, []);
});

test("a return's 24 h decision never reads 'due now' to the rep (the clock runs on ZELab)", () => {
  assert.equal(approvalLeftLabel(24), '24h left');
  assert.equal(approvalLeftLabel(5.9), '5h left'); // rounded down
  assert.equal(approvalLeftLabel(1), '1h left');
  assert.equal(approvalLeftLabel(0.6), 'under 1h left');
  assert.equal(approvalLeftLabel(0), 'under 1h left'); // window over, expiry job not run yet
  assert.equal(approvalLeftLabel(null), '—');
});
