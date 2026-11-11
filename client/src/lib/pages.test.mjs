import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, pageFor, warmList, roleFromToken } from './pages.js';

const ADMIN = 'ADMIN';
const STAFF = 'WAREHOUSE_STAFF';
const REP = 'SALES_REP';

test('home is the rep dashboard for a rep and the command centre for everyone else', () => {
  assert.equal(pageFor('/', REP), 'RepDashboard');
  assert.equal(pageFor('/', ADMIN), 'Dashboard');
  assert.equal(pageFor('/', STAFF), 'Dashboard');
});

test('signed out, every app address lands on the sign-in page', () => {
  assert.equal(pageFor('/', null), 'Login');
  assert.equal(pageFor('/finance', undefined), 'Login');
  assert.equal(pageFor('/login', null), 'Login');
  assert.equal(pageFor('/nino', null), 'Nino', 'the public page stays itself');
});

test('old addresses resolve to the page they now open inside', () => {
  for (const p of ['/purchases', '/transfers', '/reorder', '/inventory']) assert.equal(pageFor(p, STAFF), 'Inventory');
  for (const p of ['/reports', '/profit', '/finance']) assert.equal(pageFor(p, ADMIN), 'Finance');
  assert.equal(pageFor('/label', ADMIN), 'Products');
  assert.equal(pageFor('/invoice-generator', REP), 'InvoiceGenerator');
  assert.equal(pageFor('/invoice-generator', STAFF), 'Sales');
  // the owner's tools are inside his profile; staff open them as pages
  assert.equal(pageFor('/daily-reports', ADMIN), 'Profile');
  assert.equal(pageFor('/daily-reports', REP), 'DailyReports');
  assert.equal(pageFor('/activity', ADMIN), 'Profile');
  assert.equal(pageFor('/activity', STAFF), 'Activity');
  for (const p of ['/audit', '/users', '/settings']) assert.equal(pageFor(p, ADMIN), 'Profile');
});

test('a rep profile, a trailing slash, and an unknown address', () => {
  assert.equal(pageFor('/reps/abc-123', ADMIN), 'SalesRepProfile');
  assert.equal(pageFor('/reps', ADMIN), 'SalesReps');
  assert.equal(pageFor('/stock-requests/', REP), 'StockRequests');
  assert.equal(pageFor('/no-such-page', ADMIN), 'NotFound');
  assert.equal(pageFor('', ADMIN), 'Dashboard');
});

test('every page name used anywhere has a file to load', () => {
  const names = new Set();
  for (const role of [null, ADMIN, STAFF, REP]) {
    for (const n of warmList(role)) names.add(n);
    for (const p of ['/', '/login', '/nino', '/products', '/label', '/inventory', '/purchases', '/stock-requests', '/settlements',
      '/commissions', '/daily-reports', '/invoice-generator', '/activity', '/sales', '/customers', '/returns', '/reps', '/reps/x',
      '/reports', '/profit', '/finance', '/notifications', '/profile', '/audit', '/users', '/settings', '/zzz']) names.add(pageFor(p, role));
  }
  for (const n of names) assert.equal(typeof CHUNKS[n], 'function', `no loader for ${n}`);
});

test('fetch-ahead lists: a rep gets only rep pages; nobody gets the PDF or label tools', () => {
  const rep = warmList(REP);
  assert.equal(rep[0], 'RepDashboard');
  for (const staffOnly of ['Dashboard', 'Finance', 'Sales', 'Products', 'Inventory', 'SalesReps', 'Customers']) {
    assert.ok(!rep.includes(staffOnly), `${staffOnly} is not a rep page`);
  }
  for (const role of [null, ADMIN, STAFF, REP]) {
    assert.ok(!warmList(role).includes('InvoiceGenerator'));
    assert.ok(!warmList(role).includes('ProductLabel'));
  }
  assert.equal(warmList(ADMIN)[0], 'Dashboard');
  assert.ok(warmList(STAFF).includes('Activity'));
  assert.ok(!warmList(ADMIN).includes('Activity'), 'the owner opens Activity inside his profile');
  assert.deepEqual(warmList(null), ['RepDashboard', 'Dashboard']);
});

const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `h.${b64url(JSON.stringify(payload))}.sig`;

test('roleFromToken reads the role claim and nothing breaks on junk', () => {
  assert.equal(roleFromToken(jwt({ sub: 'u1', role: 'SALES_REP', sv: 2 })), 'SALES_REP');
  assert.equal(roleFromToken(jwt({ sub: 'u1', role: 'ADMIN', name: 'Ñino ✓' })), 'ADMIN');
  assert.equal(roleFromToken(jwt({ sub: 'u1' })), null);
  assert.equal(roleFromToken(jwt({ role: 7 })), null);
  assert.equal(roleFromToken(null), null);
  assert.equal(roleFromToken(''), null);
  assert.equal(roleFromToken('not-a-token'), null);
  assert.equal(roleFromToken('a.%%%.c'), null);
});
