// Builds every nature model and re-applies the Kenney palette pass. Run through scripts/assets-build-nature.mjs (see the notes there).
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { recipes } from './recipes.mjs';
import { bounds } from './lib.mjs';
import { remapGlb, tuneCityGlb } from './kenney.mjs';
import { remapKey } from './tune.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const kaykitDir = args.kaykit;
const publicDir = args.public;
const dry = args.dry;
const kenneyDir = args.kenney;
if (!kaykitDir || !publicDir) throw new Error('usage: --kaykit <gltf dir> --public <public dir> [--kenney <originals dir>] [--dry <dir>]');

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);

async function toGlb(geometry, name) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const col = geometry.getAttribute('color');
  const idx = geometry.index;
  const material = doc.createMaterial('nature').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm.array)).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col.array)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx.array)).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  doc.createScene('Scene').addChild(doc.createNode(name).setMesh(mesh));
  await doc.transform(
    weld({ tolerance: 1e-4, toleranceNormal: 0.02 }),
    dedup(),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }),
    prune(),
  );
  return io.writeBinary(doc);
}

const entries = {};
const report = [];
for (const r of recipes(kaykitDir)) {
  const { g, scale, from } = await r.build();
  const file = `${r.id.replace(/\./g, '-')}.glb`;
  const dir = path.join(dry ?? path.join(publicDir, 'assets', 'models'), r.pack);
  fs.mkdirSync(dir, { recursive: true });
  const bytes = await toGlb(g, r.id);
  fs.writeFileSync(path.join(dir, file), bytes);
  const b = bounds(g);
  entries[r.id] = { path: `assets/models/${r.pack}/${file}`, pack: r.pack, scale, yOffset: 0 };
  report.push(`${r.id.padEnd(20)} ${String(bytes.length).padStart(6)} B  scale ${scale}  (${from})  h ${((b.max.y - b.min.y) * scale).toFixed(2)}`);
}
console.log(report.join('\n'));

if (!dry) {
  const manifestPath = path.join(publicDir, 'assets', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // Kenney nature kit models that the new kit replaces are deleted (the originals stay in the backup folder).
  for (const [id, entry] of Object.entries(manifest.models)) {
    if (entries[id] && entry.pack === 'kenney-nature-kit') fs.rmSync(path.join(publicDir, entry.path), { force: true });
  }
  if (kenneyDir) {
    const modelsOut = path.join(publicDir, 'assets', 'models');
    for (const [id, entry] of Object.entries(manifest.models)) {
      if (entries[id]) continue;
      const from = path.join(kenneyDir, path.relative(path.join(publicDir, 'assets', 'models'), path.join(publicDir, entry.path)));
      if (!fs.existsSync(from)) continue;
      const to = path.join(modelsOut, path.relative(path.join(publicDir, 'assets', 'models'), path.join(publicDir, entry.path)));
      if (entry.pack === 'kenney-city-kit-commercial' || entry.pack === 'kenney-city-kit-suburban') {
        await tuneCityGlb(from, to);
        console.log('city palette tuned:', id);
      } else if (entry.pack === 'kenney-nature-kit' && remapKey(path.basename(from))) {
        const r = await remapGlb(from, to);
        console.log('nature kit remapped:', id, r.changed + '/' + r.total, 'vertices');
      }
    }
  }
  const models = {};
  const placed = new Set();
  for (const [id, entry] of Object.entries(manifest.models)) {
    if (entries[id]) {
      models[id] = entries[id];
      placed.add(id);
    } else {
      models[id] = entry;
    }
    // new ids go right after the id they are a sibling of
    if (id === 'tree.fall' && entries['tree.birch'] && !manifest.models['tree.birch']) {
      models['tree.birch'] = entries['tree.birch'];
      placed.add('tree.birch');
    }
  }
  for (const id of Object.keys(entries)) if (!placed.has(id)) models[id] = entries[id];
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: manifest.version, models }, null, 2)}\n`);
  console.log(`manifest updated: ${Object.keys(entries).length} entries`);
}
