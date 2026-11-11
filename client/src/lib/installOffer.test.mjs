import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallOffer } from './installOffer.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const blocked = () => { throw new Error('storage blocked'); };

test('nothing is offered before anyone signs in', () => {
  const o = createInstallOffer({ session: () => memory(), local: () => memory() });
  assert.equal(o.pending(), false);
});

test('a sign-in sets the offer, showing it spends it', () => {
  const s = memory();
  const o = createInstallOffer({ session: () => s, local: () => memory() });
  o.offerAfterSignIn();
  assert.equal(o.pending(), true);
  o.spend();
  assert.equal(o.pending(), false, 'a reload or another page does not offer it again');
});

test('closing it is remembered on the phone, across tabs and later sign-ins', () => {
  const local = memory();
  const first = createInstallOffer({ session: () => memory(), local: () => local });
  assert.equal(first.dismissed(), false);
  first.dismiss();
  assert.equal(first.dismissed(), true);
  // A new browser session (new session storage) on the same phone: still dismissed.
  const later = createInstallOffer({ session: () => memory(), local: () => local });
  assert.equal(later.dismissed(), true);
});

test('with local storage blocked, closing it still holds for this visit', () => {
  const s = memory();
  const o = createInstallOffer({ session: () => s, local: blocked });
  o.dismiss();
  assert.equal(o.dismissed(), true);
});

test('with all storage blocked nothing throws and nothing is offered by itself', () => {
  const o = createInstallOffer({ session: blocked, local: blocked });
  assert.doesNotThrow(() => { o.offerAfterSignIn(); o.spend(); o.dismiss(); });
  assert.equal(o.pending(), false);
  assert.equal(o.dismissed(), false);
});
