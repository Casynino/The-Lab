'use strict';

// ── Audit log search finds people, emails and the words on the screen (audit 11 Nov 2026, admin-system-6) ─
// "Nino", an email, "signed in" or "refused" found nothing: only the raw codes and ids were searched.
// The search now also matches the person's name and email, the email typed on a refused sign-in, and the
// action/object codes the page says the words mean (searchActions / searchEntities).
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stub@localhost:1/none';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only';

const seen = [];
const install = (path, exports) => {
  const filename = require.resolve(path);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
install('../src/config/prisma', {
  auditLog: {
    findMany: async ({ where }) => { seen.push(where); return []; },
    count: async () => 0,
  },
});

const { list, searchWhere } = require('../src/controllers/auditLogs.controller');
const { auditQuery } = require('../src/validators/misc.validator');

test('a name or an email is looked for in the person who acted and in a refused sign-in', () => {
  const or = searchWhere('Nino');
  assert.ok(or.some((c) => c.user?.is?.name?.contains === 'Nino' && c.user.is.name.mode === 'insensitive'));
  assert.ok(or.some((c) => c.user?.is?.email?.contains === 'Nino'));
  const byEmail = searchWhere('Owner@ZELab.site');
  assert.ok(byEmail.some((c) => c.newValues?.string_contains === 'owner@zelab.site' && c.newValues.path[0] === 'email'));
  // the codes and ids are still searched as before
  assert.ok(or.some((c) => c.action?.contains === 'Nino'));
  assert.ok(or.some((c) => c.entityId?.contains === 'Nino'));
});

test('the codes the page sends for the words are matched too; anything that is not a code is dropped', () => {
  const or = searchWhere('signed in', { searchActions: 'LOGIN,LOGOUT', searchEntities: 'User' });
  assert.ok(or.some((c) => JSON.stringify(c.action?.in) === '["LOGIN","LOGOUT"]'));
  assert.ok(or.some((c) => JSON.stringify(c.entityType?.in) === '["User"]'));
  const junk = searchWhere('x', { searchActions: "LOGIN'; DROP TABLE,,  ,LOG-IN" });
  assert.ok(!junk.some((c) => c.action?.in), 'no valid code, no code filter');
  assert.equal(searchWhere('   '), null);
  assert.equal(searchWhere(''), null);
});

test('GET /audit-logs passes the search through, and the query check keeps the new fields', async () => {
  const parsed = auditQuery.query.parse({ search: 'suspended', searchActions: 'DEACTIVATE' });
  assert.equal(parsed.searchActions, 'DEACTIVATE');
  seen.length = 0;
  await new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve };
    list({ query: {}, validatedQuery: parsed }, res, (e) => (e ? reject(e) : resolve()));
  });
  assert.ok(seen[0].OR.some((c) => JSON.stringify(c.action?.in) === '["DEACTIVATE"]'));
});
