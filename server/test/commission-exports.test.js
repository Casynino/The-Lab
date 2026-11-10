'use strict';

// Every function the app calls on the commission service must be one it exports. The rep's Profile page
// said "Could not load activity data" for months because `boxesSettledByRep` had dropped out of the export
// list (1 Aug 2026), so `commission.boxesSettledByRep(...)` threw "not a function" — and nothing noticed.
// This reads the real source of every controller and service, finds each `x.fn(` call made on the commission
// service, and checks the service really has it. Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require.cache[require.resolve('../src/config/prisma')] = { id: 'p', filename: 'p', loaded: true, exports: {} };
const commission = require('../src/services/commission.service');

const SRC = path.join(__dirname, '..', 'src');
const files = ['controllers', 'services', 'routes', 'jobs', 'utils']
  .map((d) => path.join(SRC, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)))
  .filter((f) => !f.endsWith('commission.service.js'));

test('every commission-service function used elsewhere is exported', () => {
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"][^'"]*commission\.service['"]\s*\)/g)) {
      const name = m[1];
      for (const call of src.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\(`, 'g'))) {
        if (typeof commission[call[1]] !== 'function') missing.push(`${path.relative(SRC, file)}: ${name}.${call[1]}()`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('boxesSettledByRep is exported (the Profile activity summary uses it)', () => {
  assert.equal(typeof commission.boxesSettledByRep, 'function');
});
