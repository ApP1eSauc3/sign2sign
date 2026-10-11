// Runs every *.test.mjs in this folder in its own process (each builds a
// fresh database) and fails if any fails.   npm run test:migrations
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n── ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n✗ ${failed} of ${files.length} migration test files failed` : `\n✓ ${files.length} migration test files passed`);
process.exit(failed ? 1 : 0);
