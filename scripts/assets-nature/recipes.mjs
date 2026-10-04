// What goes into each manifest id. Every recipe returns a BufferGeometry in source units plus the manifest scale
// that brings it to its in-game size (and a yOffset, usually 0 because the origin is the ground line).
import * as THREE from 'three';
import { PAL, kaykit, bounds } from './lib.mjs';
import * as P from './proc.mjs';

const round4 = (v) => Math.round(v * 10000) / 10000;

/** Scale that gives `target` for the chosen extent: 'h' height above the ground line, 'w' widest of x and z, 'd' full height. */
function scaleFor(g, mode, target) {
  const b = bounds(g);
  const extent = mode === 'h' ? b.max.y : mode === 'd' ? b.max.y - b.min.y : Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  return round4(target / extent);
}

/** Squash/stretch in place (non-uniform bake) and re-sit the model: `sink` is the fraction of its height below the ground line. */
function reseat(g, { stretch = [1, 1, 1], sink = null, center = true } = {}) {
  g.applyMatrix4(new THREE.Matrix4().makeScale(...stretch));
  let b = bounds(g);
  const dx = center ? -(b.min.x + b.max.x) / 2 : 0;
  const dz = center ? -(b.min.z + b.max.z) / 2 : 0;
  g.translate(dx, 0, dz);
  if (sink !== null) {
    b = bounds(g);
    g.translate(0, -b.min.y - sink * (b.max.y - b.min.y), 0);
  }
  return g;
}

/**
 * Bake a rock to its final size in world units: `wide` across the longer of x and z, `visible` above the ground line,
 * with `sink` (a fraction of its total height) buried. The zones place rocks by those numbers (the bird perch on the
 * nature trail, the colliders, the stones around the campfire), so they match the Kenney rocks they replace.
 */
function solid(g, { wide, visible, sink }) {
  const b = bounds(g);
  const sxz = wide / Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  const sy = visible / (1 - sink) / (b.max.y - b.min.y);
  g.applyMatrix4(new THREE.Matrix4().makeScale(sxz, sy, sxz));
  const c = bounds(g);
  g.translate(-(c.min.x + c.max.x) / 2, -c.min.y - sink * (c.max.y - c.min.y), -(c.min.z + c.max.z) / 2);
  return g;
}

const withGreen = (green, bark = PAL.bark) => [green, bark, PAL.stone];

/** The list of models to build. `dir` is KayKit's Assets/gltf folder. */
export function recipes(dir) {
  const kk = (name, fam) => kaykit(dir, `${name}_Color1`, fam);
  const def = (id, pack, build) => ({ id, pack, build });
  const KAY = 'kaykit-forest-nature';
  const ORIG = 'trail-quest-original';
  return [
    // ---- trees (4 to 6 units tall) ----
    def('tree.pine', KAY, async () => {
      const g = await kk('Tree_4_A');
      return { g, scale: scaleFor(g, 'h', 5.0), from: 'Tree_4_A' };
    }),
    def('tree.pine.tall', KAY, async () => {
      const g = await kk('Tree_4_B');
      return { g, scale: scaleFor(g, 'h', 6.0), from: 'Tree_4_B' };
    }),
    def('tree.pine.round', KAY, async () => {
      const g = await kk('Tree_4_A');
      reseat(g, { stretch: [1.4, 1, 1.4], center: false });
      return { g, scale: scaleFor(g, 'h', 5.0), from: 'Tree_4_A, 1.4x wider' };
    }),
    def('tree.round', KAY, async () => {
      const g = await kk('Tree_1_B');
      return { g, scale: scaleFor(g, 'h', 4.4), from: 'Tree_1_B' };
    }),
    def('tree.oak', KAY, async () => {
      const g = await kk('Tree_1_C');
      return { g, scale: scaleFor(g, 'h', 4.9), from: 'Tree_1_C' };
    }),
    def('tree.fall', KAY, async () => {
      const g = await kk('Tree_2_E', withGreen(PAL.autumn, PAL.barkDark));
      return { g, scale: scaleFor(g, 'h', 4.9), from: 'Tree_2_E, autumn leaves' };
    }),
    def('tree.birch', KAY, async () => {
      const g = await kk('Tree_2_B', withGreen(PAL.greenLight, PAL.birch));
      return { g, scale: scaleFor(g, 'h', 5.3), from: 'Tree_2_B, white trunk' };
    }),
    // ---- rocks ----
    def('rock.large', KAY, async () => {
      const g = await kk('Rock_3_Q');
      solid(g, { wide: 2.6, visible: 0.72, sink: 0.22 }); // the Kenney rock was 2.16 by 2.8 and 0.72 tall
      return { g, scale: 1, from: 'Rock_3_Q, squashed' };
    }),
    def('rock.tall', KAY, async () => {
      const g = await kk('Rock_1_G');
      solid(g, { wide: 2.4, visible: 2.4, sink: 0.07 }); // was 2.37 by 2.4 by 1.65; sunk a little, a flat base would show a gap on a slope
      return { g, scale: 1, from: 'Rock_1_G' };
    }),
    def('rock.small', KAY, async () => {
      const g = await kk('Rock_3_E');
      solid(g, { wide: 1.1, visible: 0.58, sink: 0.28 }); // was 1.1 by 0.58 by 1.1
      return { g, scale: 1, from: 'Rock_3_E' };
    }),
    def('rock.flat', KAY, async () => {
      const g = await kk('Rock_3_H');
      solid(g, { wide: 1.4, visible: 0.24, sink: 0.2 }); // was 1.4 by 0.18 by 1.21; the campfire circle seats on it
      return { g, scale: 1, from: 'Rock_3_H, flattened' };
    }),
    // ---- plants ----
    def('plant.bush', KAY, async () => {
      const g = await kk('Bush_1_D');
      return { g, scale: scaleFor(g, 'w', 1.7), from: 'Bush_1_D' };
    }),
    def('plant.bush.large', KAY, async () => {
      const g = await kk('Bush_1_F');
      return { g, scale: scaleFor(g, 'w', 3.0), from: 'Bush_1_F' };
    }),
    def('plant.grass', KAY, async () => {
      const g = await kk('Grass_1_C');
      return { g, scale: scaleFor(g, 'w', 1.15), from: 'Grass_1_C' };
    }),
    def('plant.grass.large', KAY, async () => {
      const g = await kk('Grass_2_D');
      return { g, scale: scaleFor(g, 'w', 1.8), from: 'Grass_2_D' };
    }),
    // ---- original gap fillers ----
    def('plant.flower.red', ORIG, async () => ({ g: P.flower(PAL.petalRed, 101), scale: 1, from: 'procedural' })),
    def('plant.flower.yellow', ORIG, async () => ({ g: P.flower(PAL.petalYellow, 202), scale: 1, from: 'procedural' })),
    def('plant.flower.purple', ORIG, async () => ({ g: P.flower(PAL.petalPurple, 303), scale: 1, from: 'procedural' })),
    def('plant.mushroom', ORIG, async () => ({ g: P.mushrooms(), scale: 1, from: 'procedural' })),
    def('stump', ORIG, async () => ({ g: P.stump(), scale: 1, from: 'procedural' })),
    def('log.single', ORIG, async () => ({ g: P.logSingle(), scale: 1, from: 'procedural' })),
    def('log.large', ORIG, async () => ({ g: P.logLarge(), scale: 1, from: 'procedural' })),
    def('log.stack', ORIG, async () => ({ g: P.logStack(), scale: 1, from: 'procedural' })),
    def('path.stone', ORIG, async () => ({ g: P.pathStone(), scale: 1, from: 'procedural' })),
  ];
}
