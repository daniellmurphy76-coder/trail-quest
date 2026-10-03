// Prints every entry in public/assets/manifest.json with its file size, then totals by pack.
// Exits 1 if a file is missing or over its budget. Usage: node scripts/assets-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOTAL_BUDGET, budgetFor } from './assets-budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'assets', 'manifest.json'), 'utf8'));

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const rows = [];
const perPack = new Map();
let total = 0;
let problems = 0;

for (const [id, entry] of Object.entries(manifest.models)) {
  const file = path.join(publicDir, entry.path);
  const exists = fs.existsSync(file);
  const size = exists ? fs.statSync(file).size : 0;
  const over = size > budgetFor(id);
  if (!exists || over) problems++;
  total += size;
  const pack = perPack.get(entry.pack) ?? { count: 0, bytes: 0 };
  pack.count++;
  pack.bytes += size;
  perPack.set(entry.pack, pack);
  const clips = entry.animations ? ` clips: ${Object.keys(entry.animations).join(',')}` : '';
  rows.push({
    id,
    line: `${exists ? kb(size).padStart(10) : '   MISSING'}  ${entry.pack}  scale ${entry.scale}  y ${entry.yOffset}${clips}${over ? '  OVER BUDGET' : ''}`,
  });
}

const width = Math.max(...rows.map((r) => r.id.length));
for (const r of rows) console.log(`${r.id.padEnd(width)}  ${r.line}`);

console.log('\nBy pack');
for (const [pack, p] of [...perPack].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${pack.padEnd(28)} ${String(p.count).padStart(3)} models  ${kb(p.bytes).padStart(10)}`);
}

console.log(`\nTotal: ${rows.length} models, ${kb(total)} (${(total / 1024 / 1024).toFixed(2)} MB of ${TOTAL_BUDGET / 1024 / 1024} MB budget)`);
if (total > TOTAL_BUDGET) problems++;
if (problems > 0) {
  console.error(`${problems} problem(s): missing file, model over budget, or total over budget`);
  process.exit(1);
}
