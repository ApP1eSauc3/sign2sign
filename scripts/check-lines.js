#!/usr/bin/env node
// Enforces the ~300-line cap on production files under src/.
//
// Why a script and not ESLint's max-lines: this repo has no linter at all
// (open-work #27), and wiring one up is a larger decision than this check.
// When ESLint does land, replace this with `max-lines` and delete the file.
//
// Test files are exempt on purpose — see the 2026-09-06 handover section. A
// test file is navigated by `describe` name, not read top to bottom, and
// splitting one means copying its `jest.mock` preamble into every new suite.
const { readdirSync, statSync, readFileSync } = require('fs');
const { join } = require('path');

const LIMIT = 300;
const ROOT = join(__dirname, '..', 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const over = walk(ROOT)
  .map((f) => [f, readFileSync(f, 'utf8').split('\n').length])
  .filter(([, n]) => n > LIMIT)
  .sort((a, b) => b[1] - a[1]);

if (over.length === 0) {
  console.log(`✓ every production file under src/ is within ${LIMIT} lines`);
  process.exit(0);
}

console.error(`✗ ${over.length} file(s) over the ${LIMIT}-line cap:\n`);
for (const [f, n] of over) console.error(`  ${String(n).padStart(4)}  ${f}`);
console.error(
  '\nSplit the internals into a lowercase sibling folder named after the file,' +
  '\nkeeping the original as a facade. See the "Splitting a service" / "Splitting' +
  '\na store" sections in the layer CLAUDE.md files.'
);
process.exit(1);
