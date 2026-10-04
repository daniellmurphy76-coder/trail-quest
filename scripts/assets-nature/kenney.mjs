// Palette pass over the Kenney models that stay in the game. Always reads the untouched originals and writes the
// result, so running it twice gives the same files.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PNG } from 'pngjs';
import { KENNEY_REMAP, hexToS, remapKey, tuneCity } from './tune.mjs';
import { l2s, s2l } from './lib.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** City kit buildings: nudge every swatch of the 512 px color map. */
export async function tuneCityGlb(from, to) {
  const doc = await io.read(from);
  let touched = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex || tex.getMimeType() !== 'image/png') continue;
    const png = PNG.sync.read(Buffer.from(tex.getImage()));
    for (let i = 0; i < png.data.length; i += 4) {
      const out = tuneCity([png.data[i] / 255, png.data[i + 1] / 255, png.data[i + 2] / 255]);
      png.data[i] = Math.round(out[0] * 255);
      png.data[i + 1] = Math.round(out[1] * 255);
      png.data[i + 2] = Math.round(out[2] * 255);
    }
    tex.setImage(new Uint8Array(PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9, deflateStrategy: 0, filterType: 0 })));
    touched++;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, await io.writeBinary(doc));
  return touched;
}

/** Nature kit leftovers (tents, fences, bridge, path pieces): swap each pastel vertex color for its new one. */
export async function remapGlb(from, to) {
  const key = remapKey(path.basename(from));
  if (!key) throw new Error(`no remap for ${from}`);
  const map = Object.entries(KENNEY_REMAP[key]).map(([hex, to2]) => ({
    src: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
    dst: hexToS(to2).map(s2l),
  }));
  const doc = await io.read(from);
  let changed = 0;
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const color = prim.getAttribute('COLOR_0');
      if (!color) continue;
      const v = [0, 0, 0, 1];
      for (let i = 0; i < color.getCount(); i++) {
        color.getElement(i, v);
        const s = [l2s(v[0]), l2s(v[1]), l2s(v[2])];
        const hit = map.find((m) => Math.abs(m.src[0] - s[0]) < 0.012 && Math.abs(m.src[1] - s[1]) < 0.012 && Math.abs(m.src[2] - s[2]) < 0.012);
        total++;
        if (!hit) continue;
        color.setElement(i, [hit.dst[0], hit.dst[1], hit.dst[2], ...(color.getElementSize() === 4 ? [v[3]] : [])].slice(0, color.getElementSize()));
        changed++;
      }
    }
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, await io.writeBinary(doc));
  return { changed, total };
}
