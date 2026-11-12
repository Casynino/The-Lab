'use strict';

// Public PDF links (final audit, 12 Nov 2026): the signature was padded or cut to 32 characters before it
// was compared, so a valid signature followed by any text, or sent twice, still opened the PDF, and a
// non-ASCII one made timingSafeEqual throw, answering 500 instead of 403. Only the exact signature opens.

const test = require('node:test');
const assert = require('node:assert/strict');
const { signatureMatches } = require('../src/routes/public.routes');

const GOOD = '0123456789abcdef0123456789abcdef';

test('only the exact 32-character signature matches', () => {
  assert.equal(signatureMatches(GOOD, GOOD), true);
  assert.equal(signatureMatches('f'.repeat(32), GOOD), false);
  assert.equal(signatureMatches(`${GOOD}abc`, GOOD), false); // extra characters after a valid one
  assert.equal(signatureMatches(`${GOOD} hello world`, GOOD), false);
  assert.equal(signatureMatches(GOOD.slice(0, 31), GOOD), false);
  assert.equal(signatureMatches(GOOD.toUpperCase(), GOOD), false);
  assert.equal(signatureMatches([GOOD, GOOD], GOOD), false); // ?sig=..&sig=.. arrives as an array
  assert.equal(signatureMatches(undefined, GOOD), false);
  assert.equal(signatureMatches('', GOOD), false);
});

test('a non-ASCII signature is refused, never thrown', () => {
  assert.doesNotThrow(() => signatureMatches('ééé', GOOD));
  assert.equal(signatureMatches('ééé', GOOD), false);
  assert.equal(signatureMatches(`${GOOD.slice(0, 31)}é`, GOOD), false); // 32 characters, 33 bytes
  assert.equal(signatureMatches('€'.repeat(32), GOOD), false);
});
