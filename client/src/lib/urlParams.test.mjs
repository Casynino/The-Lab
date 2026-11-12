import test from 'node:test';
import assert from 'node:assert/strict';
import { pickParam, pageParam, withParams } from './urlParams.js';

const P = (s) => new URLSearchParams(s);

test('a chip or tab is read from the address only when it is one of the known ones', () => {
  const chips = ['OPEN', 'PARTIAL', 'OVERDUE', 'SETTLED'];
  assert.equal(pickParam(P('status=OVERDUE'), 'status', chips), 'OVERDUE');
  assert.equal(pickParam(P('status=overdue'), 'status', chips), '');
  assert.equal(pickParam(P(''), 'status', chips), '');
  assert.equal(pickParam(P('tab=fines'), 'tab', ['overview', 'fines'], 'overview'), 'fines');
  assert.equal(pickParam(P('tab=<script>'), 'tab', ['overview', 'fines'], 'overview'), 'overview');
});

test('the page number is a whole number from 1 up; anything else is page 1', () => {
  assert.equal(pageParam(P('page=3')), 3);
  assert.equal(pageParam(P('page=0')), 1);
  assert.equal(pageParam(P('page=-2')), 1);
  assert.equal(pageParam(P('page=2.5')), 1);
  assert.equal(pageParam(P('page=abc')), 1);
  assert.equal(pageParam(P('')), 1);
});

test('a chip change drops the page; the other parts of the address stay', () => {
  const next = withParams(P('status=OPEN&page=3&tab=x'), { status: 'SETTLED', page: null });
  assert.equal(next.toString(), 'status=SETTLED&tab=x');
  assert.equal(withParams(P('status=OPEN'), { status: '' }).toString(), '');
  assert.equal(withParams(P('page=4'), { page: 1 }).toString(), '');
  assert.equal(withParams(P(''), { page: 2 }).toString(), 'page=2');
  // the original is not changed
  const before = P('a=1');
  withParams(before, { a: null });
  assert.equal(before.toString(), 'a=1');
});
