/*
  The number boxes' reading of keystrokes and pastes, checked without a browser.
  Several of these cases were real bugs found in review — each one a figure the
  box would have shown or saved wrong. Run with: npm test (in client/).
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCommas, meaning, sameNumber, toPlain, readTyped, readPaste, stepPlain, rangeMessage, caretAfter } from './typedNumber.js';
const t = test;
const typed = (s, o = {}) => readTyped(s, o);
const paste = (s, o = {}) => readPaste(s, o);
const P = (s, o) => { const r = paste(s, o); return r.ok ? r.plain : 'REFUSED'; };

t('commas', () => {
  assert.equal(withCommas('500000'), '500,000');
  assert.equal(withCommas('1234567.5'), '1,234,567.5');
  assert.equal(withCommas('12.'), '12.');
  assert.equal(withCommas('-25000'), '-25,000');
  assert.equal(withCommas('000000'), '000,000');
  assert.equal(withCommas('1.500.000'), '1.500.000');
});
const D = { decimals: true };
t('typing', () => {
  assert.deepEqual(typed('500000'), { ok: true, plain: '500000' });
  assert.deepEqual(typed('12,3,45'), { ok: true, plain: '12345' });
  assert.deepEqual(typed(',000,000'), { ok: true, plain: '000000' });
  assert.equal(typed('12a3').ok, false);
  assert.equal(typed('-5').ok, false);
  assert.equal(typed('TSh5').ok, false);
  assert.deepEqual(typed('-25000', { negative: true }), { ok: true, plain: '-25000' });
  assert.equal(typed('5-', { negative: true }).ok, false);
});
t('a point only where the box takes decimals (finding: 1.500.000 typed became 1.5, or empty)', () => {
  assert.equal(typed('12.').ok, false);             // shillings and counts: the point is not taken
  assert.equal(typed('.').ok, false);
  assert.equal(typed('1.500').ok, false);
  assert.deepEqual(typed('12.', D), { ok: true, plain: '12.' });
  assert.deepEqual(typed('.5', D), { ok: true, plain: '.5' });
  assert.equal(typed('12.5.', D).ok, false);        // a second point is refused, never guessed
});
t('meaning', () => {
  for (const x of ['.', '-', '-.', '', '1.2.3', '--5']) assert.equal(meaning(x), '', x);
  assert.equal(meaning('12.'), '12.');
  assert.equal(meaning('000000'), '000000');
  assert.equal(meaning('-.5'), '-.5');
});
t('pastes that are one figure', () => {
  assert.equal(P('Tsh. 500,000/='), '500000');
  assert.equal(P('TSh. 1,776,000.00'), '1776000');   // .00 on a shilling box is nothing
  assert.equal(P('TSh. 1,776,000.00', D), '1776000.00');
  assert.equal(P('Tshs. 1,500,000/='), '1500000');
  assert.equal(P('TZS 50,000'), '50000');
  assert.equal(P('50,000 TZS'), '50000');
  assert.equal(P('1.500.000'), '1500000');
  assert.equal(P('1 250 000'), '1250000');
  assert.equal(P('12.50', D), '12.50');
  assert.equal(P('.5', D), '.5');
  assert.equal(P('Tsh12,500.00.'), '12500');
  assert.equal(P('12,500.00 .'), '12500');
  assert.equal(P('. 500,000'), '500000');
  assert.equal(P('10.00'), '10');                    // a count copied from a sheet (finding)
  assert.equal(P('2.9'), 'REFUSED');                 // not a count
  assert.equal(P('Balance: 1,000.00.'), 'REFUSED');
});
t('pastes with a sign keep it, or are refused (finding: -TSh 2,000 saved as +2,000)', () => {
  const neg = { negative: true };
  assert.equal(P('-TSh 2,000', neg), '-2000');
  assert.equal(P('-TSh 2,000', neg), '-2000');
  assert.equal(P('TZS -2,000', neg), '-2000');
  assert.equal(P('−2,000', neg), '-2000');
  assert.equal(P('(2,000)', neg), '-2000');
  assert.equal(P('(-2,000)', neg), 'REFUSED');       // minus twice (finding)
  assert.equal(P('(-2,000)'), 'REFUSED');
  assert.equal(P('(TSh -2,000)', neg), 'REFUSED');
  assert.equal(P('-5,000'), 'REFUSED');
  assert.equal(P('(2,000)'), 'REFUSED');
});
t('round 4: receipts end in /- as often as /=; mixed separators are not guessed', () => {
  assert.equal(P('Tshs 5,000/-'), '5000');
  assert.equal(P('12,500/-'), '12500');
  assert.equal(P('Tsh 50,000/=.'), '50000');
  assert.equal(P('Tsh 2,500.000/='), 'REFUSED');
  assert.equal(P('1,500.000'), 'REFUSED');
  assert.equal(P('1,500.000', D), '1500.000');       // a box that takes decimals: commas mark thousands, the point is decimal
});
t('pastes that are not one figure are refused (finding: 25,000 2 boxes became 250,002)', () => {
  for (const x of ['Tsh 25,000 2 boxes', '1,500 12/03/2024', 'TSh 1,500\t21 Sep 2026', '1,500\n12', '25,000 boxes',
                   '500.000', '1.500', 'abc', '', '1,50,000', '12,5000', 'TSh', '-', '2,000 3,000']) assert.equal(P(x), 'REFUSED', JSON.stringify(x));
});
t('the page and the box agree on the same figure', () => {
  assert.ok(sameNumber('000000', '0'));
  assert.ok(sameNumber('12.', '12'));
  assert.ok(sameNumber('.', ''));
  assert.ok(!sameNumber('0', '1'));
  assert.ok(!sameNumber('2.5', '2'));
});
t('values the page sets are shown as they are', () => {
  assert.equal(toPlain(-300), '-300');
  assert.equal(toPlain(1e21), '1000000000000000000000');
  assert.equal(toPlain(5e-7), '0.0000005');
  assert.equal(toPlain('1,250,000'), '1250000');
  assert.equal(toPlain(undefined), '');
});
t('arrow keys step exactly and stay inside a max with cents (finding)', () => {
  assert.equal(stepPlain('1000000000000', { dir: 1 }), '1000000000001');
  assert.equal(stepPlain('12.34', { step: '0.01', dir: 1 }), '12.35');
  assert.equal(stepPlain('0.1', { step: '0.2', dir: 1 }), '0.3');
  assert.equal(stepPlain('12345', { dir: 1, max: 12345.67 }), '12345.67');
  assert.equal(stepPlain('85000', { dir: 1, max: 85000.5 }), '85000.5');
  assert.equal(stepPlain('1', { dir: -1, min: 1 }), '1');
  assert.equal(stepPlain('', { dir: 1 }), '1');
});
t('range messages', () => {
  assert.equal(rangeMessage('6000', { max: 5000 }), 'Must be no more than 5,000');
  assert.equal(rangeMessage('0', { min: 1 }), 'Must be at least 1');
  assert.equal(rangeMessage('', { min: 1 }), '');
  assert.equal(rangeMessage('-', {}), '');
});
t('caret', () => {
  assert.equal(caretAfter('5,009,000', 4), 5);
  assert.equal(caretAfter('000,000', 0), 0);
  assert.equal(caretAfter('12', Infinity), 2);
});
