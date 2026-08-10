// Fail the build when a component is rendered but never imported or defined.
//
// Vite bundles this without a word: rollup treats the unknown name as a global,
// so `npm run build` succeeds and the page throws "X is not defined" the moment
// that component renders. That is how a broken Deduct-commission modal reached
// production — the build was green and nothing ran the modal.
//
// Deliberately a text scan rather than a parser. It has to catch the one
// mistake, never block a real build, and need no toolchain of its own.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the project path contains a space, which
// .pathname hands back percent-encoded and readdir cannot open.
const ROOT = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.jsx') ? [p] : [];
  });
}

// Every name the file could legitimately have in scope.
function boundNames(src) {
  const names = new Set();
  const add = (re, group = 1) => {
    for (const m of src.matchAll(re)) names.add(m[group]);
  };
  // import X, { Y as Z }, * as N from '...'
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s/g)) {
    for (const id of m[1].match(/[A-Za-z0-9_$]+/g) || []) names.add(id);
  }
  add(/(?:function|class)\s+([A-Za-z0-9_$]+)/g);
  add(/(?:const|let|var)\s+([A-Za-z0-9_$]+)/g);
  // Destructuring renames, which is how icon components arrive: { icon: Icon }
  add(/[{,]\s*[A-Za-z0-9_$]+\s*:\s*([A-Za-z0-9_$]+)/g);
  // Plain destructured bindings and parameters: ({ Foo, Bar })
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    for (const id of m[1].match(/[A-Za-z0-9_$]+/g) || []) names.add(id);
  }
  return names;
}

const problems = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const bound = boundNames(src);
  const seen = new Set();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_$]*)\b/g)) {
    const name = m[1];
    if (seen.has(name) || bound.has(name)) continue;
    seen.add(name);
    const line = src.slice(0, m.index).split('\n').length;
    problems.push({ file: relative(ROOT, file), name, line });
  }
}

if (problems.length) {
  console.error('\n  Components rendered but never imported or defined:\n');
  for (const p of problems) console.error(`    src/${p.file}:${p.line}  <${p.name}>`);
  console.error('\n  These build cleanly and throw "is not defined" at render time.\n');
  process.exit(1);
}
console.log(`✓ jsx imports: every rendered component is in scope`);
