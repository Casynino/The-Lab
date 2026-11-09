'use strict';

// ── A rep can work more than one region; blank means Dar es Salaam ───────────
// The owner (10 Nov 2026): reps get one or two (or more) regions when they are
// added; "Unassigned" sales belong to Dar es Salaam, where the warehouse is.
// What is pinned here is the part that could quietly misfile money by region:
// the main region is always the first of the list, a rep from before the list
// existed reads as [region] without anything being rewritten, an edit that does
// not mention regions leaves them alone, and the Dar es Salaam filter also
// finds the sales that have no region.

const test = require('node:test');
const assert = require('node:assert');

const { DEFAULT_REGION, cleanRegions, repRegions, regionWrite, regionWhere } = require('../src/constants/regions');

test('Dar es Salaam is the default region', () => {
  assert.strictEqual(DEFAULT_REGION, 'Dar es Salaam');
});

test('cleanRegions: official spelling, repeats and strangers dropped, order kept', () => {
  assert.deepStrictEqual(cleanRegions(['arusha', 'MWANZA', 'Arusha', 'nowhere', '', null]), ['Arusha', 'Mwanza']);
  assert.deepStrictEqual(cleanRegions(['dsm']), ['Dar es Salaam']);
  assert.deepStrictEqual(cleanRegions(undefined), []);
  assert.deepStrictEqual(cleanRegions('Arusha'), [], 'a bare string is not a list');
});

test('repRegions: the list wins, main region first', () => {
  assert.deepStrictEqual(repRegions({ region: 'Arusha', regions: ['Mwanza', 'Arusha'] }), ['Mwanza', 'Arusha']);
});

test('repRegions: a rep from before the list reads as [region], nothing rewritten', () => {
  const old = { region: 'Dodoma', regions: [] };
  assert.deepStrictEqual(repRegions(old), ['Dodoma']);
  assert.deepStrictEqual(old, { region: 'Dodoma', regions: [] }, 'the record is untouched');
  assert.deepStrictEqual(repRegions({ region: null, regions: [] }), []);
  assert.deepStrictEqual(repRegions(null), []);
});

test('regionWrite: the main region is always the first of the list', () => {
  assert.deepStrictEqual(regionWrite({ regions: ['mwanza', 'Arusha'] }), { regions: ['Mwanza', 'Arusha'], region: 'Mwanza' });
  assert.deepStrictEqual(regionWrite({ regions: [] }), { regions: [], region: null }, 'clearing is allowed');
});

test('regionWrite: an older screen sending only `region` still works', () => {
  assert.deepStrictEqual(regionWrite({ region: 'Tabora' }), { regions: ['Tabora'], region: 'Tabora' });
  assert.deepStrictEqual(regionWrite({ region: null }), { regions: [], region: null });
});

test('regionWrite: `regions` wins when both are sent', () => {
  assert.deepStrictEqual(regionWrite({ region: 'Tabora', regions: ['Mbeya', 'Tabora'] }), { regions: ['Mbeya', 'Tabora'], region: 'Mbeya' });
});

test('regionWrite: an edit that does not mention regions writes nothing', () => {
  assert.deepStrictEqual(regionWrite({ phone: '0712' }), {});
  assert.deepStrictEqual(regionWrite({ regions: undefined, region: undefined }), {});
  assert.deepStrictEqual(regionWrite(undefined), {});
});

test('regionWhere: Dar es Salaam also finds sales with no region; others do not', () => {
  assert.deepStrictEqual(regionWhere('Dar es Salaam'), { OR: [{ region: 'Dar es Salaam' }, { region: null }] });
  assert.deepStrictEqual(regionWhere('Arusha'), { region: 'Arusha' });
  assert.strictEqual(regionWhere(undefined), null);
  assert.strictEqual(regionWhere(''), null);
});

// ── "Unassigned" is Dar es Salaam ────────────────────────────────────────────
const { mergeRegionRevenue } = require('../src/constants/regions');

test('mergeRegionRevenue: blank-region sales and Dar es Salaam sales are ONE slice', () => {
  const slices = mergeRegionRevenue([
    { region: null, total: 100000 },
    { region: 'Dar es Salaam', total: 50000 },
    { region: 'Arusha', total: 70000 },
  ]);
  assert.deepStrictEqual(slices, [
    { name: 'Dar es Salaam', value: 150000 },
    { name: 'Arusha', value: 70000 },
  ]);
  assert.ok(!slices.some((s) => /unassigned|unspecified/i.test(s.name)), 'no Unassigned slice');
});

test('mergeRegionRevenue: only blanks → one Dar es Salaam slice; nothing at all → nothing', () => {
  assert.deepStrictEqual(mergeRegionRevenue([{ region: null, total: 1200.5 }, { region: '', total: 300.25 }]), [{ name: 'Dar es Salaam', value: 1500.75 }]);
  assert.deepStrictEqual(mergeRegionRevenue([]), []);
  assert.deepStrictEqual(mergeRegionRevenue(undefined), []);
});

test('mergeRegionRevenue: zero-revenue regions are dropped, biggest first', () => {
  assert.deepStrictEqual(
    mergeRegionRevenue([{ region: 'Mbeya', total: 0 }, { region: 'Dodoma', total: 10 }, { region: 'Tanga', total: 30 }]),
    [{ name: 'Tanga', value: 30 }, { name: 'Dodoma', value: 10 }],
  );
});
