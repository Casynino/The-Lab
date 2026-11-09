import test from 'node:test';
import assert from 'node:assert/strict';
import { repRegions, shortRegion, sayRegions } from './repRegions.js';

test('repRegions: the list wins, main region first', () => {
  assert.deepEqual(repRegions({ region: 'Arusha', regions: ['Arusha', 'Mwanza'] }), ['Arusha', 'Mwanza']);
});

test('repRegions: a rep from before the list reads as [region]', () => {
  assert.deepEqual(repRegions({ region: 'Dodoma', regions: [] }), ['Dodoma']);
  assert.deepEqual(repRegions({ region: 'Dodoma' }), ['Dodoma']);
  assert.deepEqual(repRegions({ region: null, regions: [] }), []);
  assert.deepEqual(repRegions(null), []);
  assert.deepEqual(repRegions(undefined), []);
});

test('shortRegion drops the bracket on the Zanzibar names only', () => {
  assert.equal(shortRegion('Kaskazini Pemba (Pemba North)'), 'Kaskazini Pemba');
  assert.equal(shortRegion('Mjini Magharibi (Urban West)'), 'Mjini Magharibi');
  assert.equal(shortRegion('Dar es Salaam'), 'Dar es Salaam');
  assert.equal(shortRegion(null), '');
});

test('sayRegions reads like a sentence', () => {
  assert.equal(sayRegions([]), '');
  assert.equal(sayRegions(undefined), '');
  assert.equal(sayRegions(['Arusha']), 'Arusha');
  assert.equal(sayRegions(['Arusha', 'Mwanza']), 'Arusha and Mwanza');
  assert.equal(sayRegions(['Arusha', 'Mwanza', 'Dodoma']), 'Arusha, Mwanza and Dodoma');
  assert.equal(sayRegions(['Kusini Unguja (Unguja South)', 'Mbeya']), 'Kusini Unguja and Mbeya');
});
