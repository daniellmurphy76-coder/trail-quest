/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { NATURE_PACKS, NATURE_TOTAL_BUDGET, isNatureModel } from '../../scripts/assets-budget.mjs';
import { parseManifest, type ModelEntry } from '../../src/engine/assets';
import { TREE_TRUNK_RADIUS } from '../../src/world/collide';

/**
 * The nature art is one kit: KayKit Forest Nature Pack (CC0) plus a few original gap fillers painted from the
 * same palette. These tests load the real GLBs (no texture, vertex colors only) and guard what went wrong with
 * the first kit: mint-teal leaves that clashed with the grass, models that could not be instanced, trees that
 * were the wrong size.
 */

const publicDir = path.resolve(__dirname, '../../public');
const repoDir = path.resolve(__dirname, '../..');
const manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(publicDir, 'assets', 'manifest.json'), 'utf8')));
const entries = Object.entries(manifest.models);

const KIT_PACKS = ['kaykit-forest-nature', 'trail-quest-original'];
const isKit = (e: ModelEntry): boolean => KIT_PACKS.includes(e.pack);
/** Ids of the models the new kit supplies (everything else in the nature packs is a Kenney leftover: tents, fences, bridge, path tiles). */
const kitEntries = entries.filter(([, e]) => isKit(e));
const kitIds = kitEntries.map(([id]) => id);

interface Loaded {
  scene: THREE.Group;
  meshes: THREE.Mesh[];
  /** Every vertex color as displayed (sRGB hue 0..360, saturation and lightness 0..1). */
  hsl: Array<{ h: number; s: number; l: number }>;
  /** Bounds in world units: scale and yOffset from the manifest applied, as the game does. */
  box: THREE.Box3;
}

async function load(entry: ModelEntry): Promise<Loaded> {
  const bytes = fs.readFileSync(path.join(publicDir, entry.path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.scale.setScalar(entry.scale);
  gltf.scene.position.y = entry.yOffset;
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const hsl: Loaded['hsl'] = [];
  const color = new THREE.Color();
  const out = { h: 0, s: 0, l: 0 };
  for (const mesh of meshes) {
    const attr = mesh.geometry.getAttribute('color');
    if (!attr) continue;
    for (let i = 0; i < attr.count; i++) {
      color.setRGB(attr.getX(i), attr.getY(i), attr.getZ(i), THREE.LinearSRGBColorSpace);
      color.getHSL(out, THREE.SRGBColorSpace);
      hsl.push({ h: out.h * 360, s: out.s, l: out.l });
    }
  }
  return { scene: gltf.scene, meshes, hsl, box: new THREE.Box3().setFromObject(gltf.scene) };
}

const loaded = new Map<string, Loaded>();
async function modelFor(id: string): Promise<Loaded> {
  const have = loaded.get(id);
  if (have) return have;
  const entry = manifest.models[id];
  if (!entry) throw new Error(`no manifest entry for ${id}`);
  const model = await load(entry);
  loaded.set(id, model);
  return model;
}

const size = (box: THREE.Box3): { x: number; y: number; z: number; wide: number } => {
  const v = box.getSize(new THREE.Vector3());
  return { x: v.x, y: v.y, z: v.z, wide: Math.max(v.x, v.z) };
};
const between = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;

describe('nature kit: what is shipped', () => {
  it('uses the KayKit Forest Nature Pack and our own gap fillers for every tree, rock, plant, stump, log and path stone', () => {
    const natureIds = entries
      .map(([id]) => id)
      .filter((id) => /^(tree|rock|plant|log)\./.test(id) || id === 'stump' || id === 'path.stone');
    expect(natureIds.length).toBeGreaterThanOrEqual(24);
    for (const id of natureIds) expect(KIT_PACKS, `${id} comes from ${manifest.models[id]!.pack}`).toContain(manifest.models[id]!.pack);
  });

  it('keeps an id for everything the zones place (a missing id would leave the primitive stand-in on screen)', () => {
    const zoneDir = path.join(repoDir, 'src', 'world');
    const bare = ['stump', 'bridge', 'tent', 'campfire', 'cabin', 'signpost'];
    const used = new Set<string>();
    for (const file of fs.readdirSync(zoneDir).filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(zoneDir, file), 'utf8');
      for (const m of source.matchAll(/'((?:tree|rock|plant|path|fence|log|tent|building|street|animal|pickup|signpost)\.[a-z0-9.-]+)'/g)) used.add(m[1]!);
      for (const id of bare) if (new RegExp(`'${id}'`).test(source)) used.add(id);
    }
    expect(used.size).toBeGreaterThan(30);
    for (const id of used) expect(manifest.models[id], `${id} is used by a zone and must be in the manifest`).toBeDefined();
  });

  it('keeps every nature model under 300 KB and all of them together under 4 MB', () => {
    expect(NATURE_PACKS).toEqual(expect.arrayContaining(KIT_PACKS));
    let total = 0;
    for (const [id, entry] of entries) {
      if (!isNatureModel(entry)) continue;
      const bytes = fs.statSync(path.join(publicDir, entry.path)).size;
      expect(bytes, `${id} is ${bytes} bytes`).toBeLessThanOrEqual(300 * 1024);
      total += bytes;
    }
    expect(total).toBeLessThanOrEqual(NATURE_TOTAL_BUDGET);
    expect(NATURE_TOTAL_BUDGET).toBe(4 * 1024 * 1024);
  });

  it('ships no leftovers of the old Kenney trees, rocks, plants, stumps or logs', () => {
    const dir = path.join(publicDir, 'assets', 'models', 'kenney-nature-kit');
    const files = fs.readdirSync(dir);
    for (const f of files) expect(f, `${f} should have been replaced`).not.toMatch(/^(tree_|stone_|plant_|grass|flower_|mushroom|stump|log|path_stone)/);
    // what is left of the pack: tents, fences, the bridge, and the trail path pieces
    expect(files.some((f) => f.startsWith('tent_'))).toBe(true);
    expect(files.some((f) => f.startsWith('fence_'))).toBe(true);
  });
});

describe('nature kit: models', () => {
  it('loads each kit model as one mesh with one vertex-colored material and no texture, so it can be instanced', async () => {
    for (const [id] of kitEntries) {
      const m = await modelFor(id);
      expect(m.meshes, `${id} is a single mesh`).toHaveLength(1);
      const mesh = m.meshes[0]!;
      expect(Array.isArray(mesh.material), `${id} has one material`).toBe(false);
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.vertexColors, `${id} is painted with vertex colors`).toBe(true);
      expect(material.map, `${id} has no texture`).toBeNull();
      expect(mesh.geometry.getAttribute('uv'), `${id} carries no UVs`).toBeUndefined();
      expect(m.hsl.length).toBeGreaterThan(20);
    }
  });

  it('keeps the tents instanceable too (base camp and the nature trail draw them in one call)', async () => {
    for (const id of ['tent', 'tent.small', 'tent.open']) {
      const m = await modelFor(id);
      expect(m.meshes, `${id} is a single mesh`).toHaveLength(1);
    }
  });

  it('makes trees 4 to 6 units tall, rooted at the ground line', async () => {
    const trees = kitIds.filter((id) => id.startsWith('tree.'));
    expect(trees).toEqual(expect.arrayContaining(['tree.pine', 'tree.pine.tall', 'tree.pine.round', 'tree.round', 'tree.oak', 'tree.fall']));
    for (const id of trees) {
      const { box } = await modelFor(id);
      expect(box.max.y, `${id} is ${box.max.y.toFixed(2)} tall`).toBeGreaterThanOrEqual(4);
      expect(box.max.y, `${id} is ${box.max.y.toFixed(2)} tall`).toBeLessThanOrEqual(6.05);
      expect(box.min.y, `${id} roots`).toBeGreaterThan(-0.5); // sunk a little, never floating
      expect(box.min.y, `${id} roots`).toBeLessThanOrEqual(0);
    }
  });

  it('keeps trunks no fatter than the circle the zones block (TREE_TRUNK_RADIUS) so walking stays fair', async () => {
    for (const id of kitIds.filter((i) => i.startsWith('tree.'))) {
      const { meshes } = await modelFor(id);
      // slice the mesh 0.5 above the ground: only the trunk is there
      const mesh = meshes[0]!;
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index!;
      const v = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      const hits: Array<[number, number]> = [];
      for (let t = 0; t < index.count; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = v[index.getX(t + k)]!;
          const b = v[index.getX(t + ((k + 1) % 3))]!;
          if ((a.y - 0.5) * (b.y - 0.5) < 0) {
            const f = (0.5 - a.y) / (b.y - a.y);
            hits.push([a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f]);
          }
        }
      }
      expect(hits.length, `${id} has a trunk at 0.5`).toBeGreaterThan(2);
      const cx = hits.reduce((s, h) => s + h[0], 0) / hits.length;
      const cz = hits.reduce((s, h) => s + h[1], 0) / hits.length;
      const radius = Math.max(...hits.map((h) => Math.hypot(h[0] - cx, h[1] - cz)));
      expect(radius, `${id} trunk radius ${radius.toFixed(2)}`).toBeLessThanOrEqual(TREE_TRUNK_RADIUS);
    }
  });

  it('sizes rocks, plants, logs and stones close to the models the zones were laid out for', async () => {
    const bands: Record<string, { wide?: [number, number]; h?: [number, number]; z?: [number, number]; x?: [number, number] }> = {
      'plant.bush': { wide: [1.4, 2.1], h: [0.8, 1.3] },
      'plant.bush.large': { wide: [2.4, 3.3], h: [1, 1.9] },
      'plant.grass': { wide: [0.8, 1.4], h: [0.5, 1.0] },
      'plant.grass.large': { wide: [1.3, 2.1], h: [0.9, 1.4] },
      'plant.flower.red': { wide: [0.6, 0.95], h: [0.5, 0.85] },
      'plant.flower.yellow': { wide: [0.6, 0.95], h: [0.5, 0.85] },
      'plant.flower.purple': { wide: [0.6, 0.95], h: [0.5, 0.85] },
      'plant.mushroom': { wide: [0.6, 1.0], h: [0.4, 0.7] },
      stump: { wide: [1.2, 1.7], h: [0.7, 1.0] }, // was 1.4 by 1.62; the zones block 0.6 to 0.7 around it
      'log.single': { x: [0.5, 0.8], z: [2, 2.4], h: [0.5, 0.7] }, // a bench along z
      'log.large': { x: [2.4, 3], h: [0.9, 1.3] },
      'log.stack': { x: [1.2, 1.7], z: [1.9, 2.5], h: [1, 1.4] },
      'path.stone': { x: [3.8, 4.2], z: [2.1, 2.5], h: [0.15, 0.35] }, // two side by side make the lookout floor
    };
    for (const [id, band] of Object.entries(bands)) {
      const s = size((await modelFor(id)).box);
      if (band.wide) expect(between(s.wide, ...band.wide), `${id} is ${s.wide.toFixed(2)} wide`).toBe(true);
      if (band.x) expect(between(s.x, ...band.x), `${id} is ${s.x.toFixed(2)} along x`).toBe(true);
      if (band.z) expect(between(s.z, ...band.z), `${id} is ${s.z.toFixed(2)} along z`).toBe(true);
      if (band.h) expect(between(s.y, ...band.h), `${id} is ${s.y.toFixed(2)} tall`).toBe(true);
    }
  });

  it('keeps the rocks the size the zones were laid out for: bird perch, colliders, and the stones around the fire', async () => {
    // nature-trail.ts: ROCK_SIZE (large 2.16 x 0.72 x 2.8, tall 2.37 x 2.4 x 1.65, small 1.1 x 0.58 x 1.1), ROCK_HEIGHT puts the
    // bird at 0.8 of the top of the large rock, ROCK_RADIUS (1.35, 1.2, 0.6) blocks the player. campfire-circle.ts: rock.flat is 1.4 by 1.21.
    const expectations: Record<string, { top: [number, number]; wide: [number, number] }> = {
      'rock.large': { top: [0.66, 0.78], wide: [2.3, 2.9] },
      'rock.tall': { top: [2.3, 2.5], wide: [2.2, 2.6] },
      'rock.small': { top: [0.52, 0.64], wide: [1, 1.2] },
      'rock.flat': { top: [0.18, 0.3], wide: [1.3, 1.5] },
    };
    for (const [id, want] of Object.entries(expectations)) {
      const { box } = await modelFor(id);
      expect(between(box.max.y, ...want.top), `${id} stands ${box.max.y.toFixed(2)} above the ground`).toBe(true);
      expect(between(size(box).wide, ...want.wide), `${id} is ${size(box).wide.toFixed(2)} wide`).toBe(true);
      expect(box.min.y, `${id} is sunk a little`).toBeLessThan(0);
      expect(box.min.y, `${id} is not buried`).toBeGreaterThan(-0.4);
    }
    const flat = size((await modelFor('rock.flat')).box);
    expect(flat.x).toBeGreaterThan(1.2);
    expect(flat.z).toBeGreaterThan(1.1);
    expect(flat.z).toBeLessThan(1.45);
    for (const id of kitIds.filter((i) => i.startsWith('rock.'))) {
      expect(size((await modelFor(id)).box).wide, `${id} fits inside the rock colliders`).toBeLessThanOrEqual(3);
    }
  });

  it('keeps flat things flat: the path stone and flat rock sit on the ground, not above it', async () => {
    const stone = (await modelFor('path.stone')).box;
    expect(stone.max.y).toBeLessThan(0.12);
    expect(stone.min.y).toBeLessThan(0); // sunk, so the edges never float
    const flat = (await modelFor('rock.flat')).box;
    expect(flat.max.y).toBeLessThan(0.35);
  });
});

describe('nature kit: palette', () => {
  const isTealOrMint = (c: { h: number; s: number; l: number }): boolean => between(c.h, 158, 215) && c.s > 0.15 && c.l > 0.12;

  it('has no mint or teal vertex color anywhere in the new kit (the first kit was all mint, and clashed with the grass)', async () => {
    for (const [id] of kitEntries) {
      const { hsl } = await modelFor(id);
      const bad = hsl.filter(isTealOrMint).length;
      expect(bad, `${id} has ${bad} teal vertices`).toBe(0);
    }
  });

  it('paints foliage in leaf greens close to the ground (hue 85 to 135, grass is about 100)', async () => {
    for (const id of ['plant.grass', 'plant.grass.large', 'plant.bush', 'plant.bush.large', 'tree.round', 'tree.oak', 'tree.pine', 'tree.pine.tall', 'tree.pine.round']) {
      const { hsl } = await modelFor(id);
      const greens = hsl.filter((c) => c.s > 0.3 && between(c.h, 60, 170));
      expect(greens.length / hsl.length, `${id} has a real share of leaf green (trunks are the rest)`).toBeGreaterThan(0.25);
      const meanHue = greens.reduce((s, c) => s + c.h, 0) / greens.length;
      expect(meanHue, `${id} mean leaf hue ${meanHue.toFixed(0)}`).toBeGreaterThan(85);
      expect(meanHue, `${id} mean leaf hue ${meanHue.toFixed(0)}`).toBeLessThan(135);
    }
  });

  it('turns the fall tree orange and the birch white, so the zones have variety in the same palette', async () => {
    const fall = (await modelFor('tree.fall')).hsl;
    const warm = fall.filter((c) => c.s > 0.4 && between(c.h, 10, 55)).length;
    expect(warm / fall.length, 'fall leaves are orange and gold').toBeGreaterThan(0.6);
    const birch = (await modelFor('tree.birch')).hsl;
    const pale = birch.filter((c) => c.l > 0.6 && c.s < 0.25).length;
    expect(pale, 'birch has a pale trunk').toBeGreaterThan(8);
  });

  it('paints flowers in their own colors over green stems, and mushrooms red over cream', async () => {
    const petals = async (id: string, from: number, to: number): Promise<number> =>
      (await modelFor(id)).hsl.filter((c) => c.s > 0.4 && c.l > 0.35 && (from <= to ? between(c.h, from, to) : c.h >= from || c.h <= to)).length;
    expect(await petals('plant.flower.red', 345, 12), 'red petals').toBeGreaterThan(40);
    expect(await petals('plant.flower.yellow', 38, 55), 'yellow petals').toBeGreaterThan(40);
    expect(await petals('plant.flower.purple', 250, 285), 'purple petals').toBeGreaterThan(40);
    for (const id of ['plant.flower.red', 'plant.flower.yellow', 'plant.flower.purple']) {
      const { hsl } = await modelFor(id);
      expect(hsl.filter((c) => c.s > 0.3 && between(c.h, 85, 150)).length, `${id} has green stems`).toBeGreaterThan(20);
    }
    const shroom = (await modelFor('plant.mushroom')).hsl;
    expect(shroom.filter((c) => c.s > 0.5 && (c.h < 15 || c.h > 345)).length, 'red caps').toBeGreaterThan(20);
    expect(shroom.filter((c) => c.l > 0.7).length, 'cream stalks and spots').toBeGreaterThan(20);
  });

  it('warms the leftover Kenney tents and wood: no salmon pink and no pastel peach left', async () => {
    for (const id of ['tent', 'tent.small', 'tent.open']) {
      const { hsl } = await modelFor(id);
      for (const c of hsl) {
        if (c.s < 0.1) continue; // the white flag and trim
        expect(between(c.h, 10, 50), `${id} hue ${c.h.toFixed(0)} is terracotta or canvas, not salmon`).toBe(true);
      }
    }
    for (const id of ['fence.simple', 'fence.planks', 'fence.corner', 'bridge']) {
      const { hsl } = await modelFor(id);
      const pastel = hsl.filter((c) => c.l > 0.8 && c.s > 0.5).length; // the old #ffc5a7 peach was lightness 0.82, saturation 1
      expect(pastel, `${id} is weathered wood, not pastel peach`).toBe(0);
    }
  });
});
