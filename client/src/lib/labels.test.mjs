import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLeftLabel, approvalLeftLabel, pluralizeUnit, unitWord, bonusTrack, bonusRow, walletRow } from './labels.js';

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

test("a return's 24 h decision never reads 'due now' to the rep (the clock runs on ZELab)", () => {
  assert.equal(approvalLeftLabel(24), '24h left');
  assert.equal(approvalLeftLabel(5.9), '5h left'); // rounded down
  assert.equal(approvalLeftLabel(1), '1h left');
  assert.equal(approvalLeftLabel(0.6), 'under 1h left');
  assert.equal(approvalLeftLabel(0), 'under 1h left'); // window over, expiry job not run yet
  assert.equal(approvalLeftLabel(null), '—');
});

// ── The two rows on the rep's Home (audit, 12 Nov 2026) ──────────────────────────────────────────────
test('a reached bonus shows as that bonus, whole, not the next tier', () => {
  const nyoya = {
    configured: true,
    sales: 1300000,
    claimable: { target: 1000000, bonusAmount: 50000, reached: true },
    next: { target: 10000000, bonusAmount: 500000, progress: 13, reached: false },
    tiers: [
      { target: 1000000, bonusAmount: 50000, progress: 100, reached: true },
      { target: 10000000, bonusAmount: 500000, progress: 13, reached: false },
    ],
  };
  const r = bonusRow(nyoya);
  assert.equal(r.ready, true);
  assert.equal(r.reward, 50000); // not the next tier's 500,000
  assert.equal(r.pct, 100);
  assert.equal(r.barPct, 100);
  assert.deepEqual(r.markers, []);
  // Nothing reached yet: the way to the next tier, as before.
  const chasing = bonusRow(MREMA);
  assert.equal(chasing.ready, false);
  assert.equal(chasing.pct, 94);
  assert.equal(bonusRow(null), null);
});

test('the wallet row keeps a negative balance and blames the fines only when they explain it', () => {
  const r = walletRow({ minWithdrawal: 250000, available: -6500, penalties: 20000, eligible: false, pendingRequests: 0 });
  assert.equal(r.balance, -6500);
  assert.equal(r.avail, 0);
  assert.equal(r.pct, 0); // the bar never goes below zero
  assert.equal(r.negative, true);
  assert.equal(r.fromFines, true);
  assert.equal(r.ready, false);
  // A claw-back took it below zero, not the fines.
  assert.equal(walletRow({ minWithdrawal: 250000, available: -30000, penalties: 10000 }).fromFines, false);
});

test('an open withdrawal window makes the wallet ready below the minimum and says until when', () => {
  const until = '2026-11-13T23:48:00.000Z';
  const r = walletRow({ minWithdrawal: 250000, available: 22500, eligible: true, emergency: { open: true, until } });
  assert.equal(r.ready, true);
  assert.equal(r.windowUntil, until);
  // A window open but under the floor: not ready, no date.
  assert.equal(walletRow({ minWithdrawal: 250000, available: 5000, eligible: false, emergency: { open: true, until } }).windowUntil, null);
  // Over the minimum the window changes nothing.
  assert.equal(walletRow({ minWithdrawal: 250000, available: 300000, eligible: true, emergency: { open: true, until } }).windowUntil, null);
  // A withdrawal waiting to be paid is reported, and no minimum means no row.
  assert.equal(walletRow({ minWithdrawal: 250000, available: 0, pendingRequests: 30000 }).pending, 30000);
  assert.equal(walletRow({ minWithdrawal: 0, available: 10 }), null);
});
