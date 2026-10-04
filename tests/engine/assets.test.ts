/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOTAL_BUDGET, budgetFor } from '../../scripts/assets-budget.mjs';
import { parseManifest } from '../../src/engine/assets';

const publicDir = path.resolve(__dirname, '../../public');
const manifestPath = path.join(publicDir, 'assets', 'manifest.json');
const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
const entries = Object.entries(manifest.models);

/** Id families other agents rely on. A family matches its bare name or any `name.*` id. */
const FAMILIES = [
  'tree',
  'rock',
  'plant',
  'path',
  'bridge',
  'fence',
  'stump',
  'tent',
  'campfire',
  'log',
  'cabin',
  'signpost',
  'building',
  'street',
  'animal',
  'pickup',
];

/** Ids that must exist exactly. The tree, rock, plant, log and path ids are the ones the zones place from the nature kit. */
const REQUIRED = [
  'tree.pine',
  'tree.pine.tall',
  'tree.pine.round',
  'tree.round',
  'tree.oak',
  'tree.fall',
  'rock.large',
  'rock.tall',
  'rock.small',
  'rock.flat',
  'plant.bush',
  'plant.bush.large',
  'plant.grass',
  'plant.grass.large',
  'plant.flower.red',
  'plant.flower.yellow',
  'plant.flower.purple',
  'plant.mushroom',
  'log.single',
  'log.large',
  'log.stack',
  'path.stone',
  'fence.simple',
  'fence.gate',
  'bridge',
  'stump',
  'tent',
  'campfire',
  'cabin',
  'signpost',
  'building.library',
  'building.school',
  'building.firestation',
  'building.store',
  'animal.bird',
  'animal.squirrel',
  'animal.rabbit',
  'animal.frog',
];

/** Families that need at least one member (`name.*`). */
const REQUIRED_PREFIXES = ['tree.', 'rock.', 'plant.', 'path.', 'fence.', 'log.', 'building.house.', 'street.', 'pickup.'];

/** Read the JSON chunk of a GLB without loading it into Three.js. */
function readGlbJson(file: string): { animations?: { name?: string }[] } {
  const buf = fs.readFileSync(file);
  expect(buf.toString('ascii', 0, 4), `${file} is a GLB`).toBe('glTF');
  const jsonLength = buf.readUInt32LE(12);
  expect(buf.toString('ascii', 16, 20)).toBe('JSON');
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
}

describe('asset manifest', () => {
  it('parses and has models', () => {
    expect(manifest.version).toBe(1);
    expect(entries.length).toBeGreaterThan(20);
  });

  it('points every path at a real GLB under public/', () => {
    for (const [id, entry] of entries) {
      const file = path.join(publicDir, entry.path);
      expect(fs.existsSync(file), `${id}: ${entry.path} exists`).toBe(true);
      expect(entry.path.endsWith('.glb'), `${id} is a .glb`).toBe(true);
      expect(entry.path.startsWith(`assets/models/${entry.pack}/`), `${id} sits in its pack folder`).toBe(true);
    }
  });

  it('uses only the agreed id families', () => {
    for (const [id] of entries) {
      const family = id.split('.')[0]!;
      expect(FAMILIES, `${id} is in a known family`).toContain(family);
      expect(id, `${id} is lower-case dotted`).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)*$/);
    }
  });

  it('has every id other agents rely on', () => {
    const ids = Object.keys(manifest.models);
    for (const id of REQUIRED) expect(ids, id).toContain(id);
    for (const prefix of REQUIRED_PREFIXES) {
      expect(
        ids.some((id) => id.startsWith(prefix)),
        `a ${prefix}* model`,
      ).toBe(true);
    }
  });

  it('keeps every file inside its budget and the total under 12 MB', () => {
    let total = 0;
    for (const [id, entry] of entries) {
      const size = fs.statSync(path.join(publicDir, entry.path)).size;
      expect(size, `${id} is ${size} bytes`).toBeLessThanOrEqual(budgetFor(id));
      total += size;
    }
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET);
  });

  it('keeps scale and yOffset sane', () => {
    for (const [id, entry] of entries) {
      expect(entry.scale, `${id} scale`).toBeGreaterThan(0.05);
      expect(entry.scale, `${id} scale`).toBeLessThan(20);
      expect(Math.abs(entry.yOffset), `${id} yOffset`).toBeLessThan(5);
    }
  });

  it('names real, non-empty animation clips for every animated model', () => {
    for (const [id, entry] of entries) {
      if (!entry.animations) continue;
      const clips = (readGlbJson(path.join(publicDir, entry.path)).animations ?? []).map((a) => a.name);
      expect(Object.keys(entry.animations), `${id} has idle`).toContain('idle');
      for (const [role, name] of Object.entries(entry.animations)) {
        expect(name, `${id} ${role} clip name`).not.toBe('');
        expect(clips, `${id} ${role}: clip "${name}" is in the file`).toContain(name);
      }
    }
  });

  it('ships no character models: the player and the Den Chief are built in code', () => {
    expect(entries.filter(([id]) => id.startsWith('character.')).map(([id]) => id)).toEqual([]);
    expect(fs.readdirSync(path.join(publicDir, 'assets', 'models', 'kenney-mini-characters'))).toEqual([
      'aid-sunglasses.glb',
    ]);
  });

  it('lists every pack in CREDITS.md', () => {
    const credits = fs.readFileSync(path.resolve(__dirname, '../../CREDITS.md'), 'utf8');
    for (const pack of new Set(entries.map(([, e]) => e.pack))) {
      expect(credits, `CREDITS.md mentions ${pack}`).toContain(`public/assets/models/${pack}/`);
    }
    expect(credits).toContain('CC0 1.0');
  });

  it('credits the KayKit Forest Nature Pack with its source page, license, and the date it was fetched', () => {
    const credits = fs.readFileSync(path.resolve(__dirname, '../../CREDITS.md'), 'utf8');
    const row = credits.split('\n').find((line) => line.includes('public/assets/models/kaykit-forest-nature/'));
    expect(row, 'a CREDITS row for the KayKit pack').toBeDefined();
    expect(row).toContain('https://kaylousberg.itch.io/kaykit-forest');
    expect(row).toContain('CC0 1.0');
    expect(row).toContain('2026-10-03');
    const own = credits.split('\n').find((line) => line.includes('public/assets/models/trail-quest-original/'));
    expect(own, 'a CREDITS row for the original gap fillers').toBeDefined();
    expect(own).toContain('CC0 1.0');
  });

  it('does not list the Kenney Nature Kit trees, rocks, or plants as shipped any more', () => {
    const credits = fs.readFileSync(path.resolve(__dirname, '../../CREDITS.md'), 'utf8');
    const row = credits.split('\n').find((line) => line.includes('public/assets/models/kenney-nature-kit/'));
    expect(row, 'the Kenney Nature Kit row is kept for the tents, fences, and bridge').toBeDefined();
    for (const gone of ['tree_default', 'stone_largeA', 'plant_bush', 'flower_redA', 'mushroom_redGroup', 'stump_round']) {
      expect(row, gone + ' is no longer shipped').not.toContain(gone);
    }
  });
});
