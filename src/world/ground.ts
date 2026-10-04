import * as THREE from 'three';
import { mulberry32 } from '../engine/seed';
import type { Terrain } from './terrain';
import type { Rng } from './props';

/**
 * Ground: a subdivided plane with per-vertex color, so the grass is never one flat value, and an
 * optional dirt clearing with a soft, uneven edge. The clearing stays dead flat; the rest gets a few
 * centimeters of random ripple so light and shadow have something to catch. On top of the
 * per-vertex noise sits a coarse patch field (`coarsePatch`, blobs 4 to 8 units across) that leans
 * the grass drier or lusher and the dirt lighter or darker, so a big lawn breaks up into soft areas
 * instead of one tone. The color math is pure and exported so tests can check it without a renderer.
 *
 * Two more things sit on top of that, both optional:
 *
 * - A tiling texture (`createGroundTexture`) with soft blade speckle for the grass, pebbles for
 *   the dirt and paving slabs for a plaza, multiplied over the vertex colors. It is generated in
 *   code from a seed (a plain typed array, so it also builds in node), mipmapped and repeat-wrapped,
 *   and sampled by world position so it lines up on every mesh that uses it (`applyGroundTexture`).
 * - Rolling land beyond the walkable square (`terrain`). Inside the square the ground stays at
 *   y = 0 within the ripple; outside it follows `Terrain.height`, the very function the ring of
 *   hills in horizon.ts is built from, so the two meet without a seam.
 */

export interface GroundPath {
  center: { x: number; z: number };
  /** Inside this distance the ground is solid dirt (and perfectly flat). */
  radius: number;
  /** Over this many more units the dirt fades out into grass. */
  feather: number;
  /**
   * How far (world units) the edge may wander outward from the circle, so a clearing is not a
   * perfect disc. Never inward: the solid dirt inside `radius` stays solid. Default 0 here;
   * `createGround` gives a dirt clearing `CLEARING_RAGGED` and a paved one 0.
   */
  ragged?: number;
}

export interface GroundOptions {
  /** Side length of the square plane, in world units. */
  size: number;
  /** Seeded random source; the same seed always gives the same ground. */
  rng: Rng;
  /** Grass color (hex). */
  grass: number;
  /** Dirt color (hex). */
  dirt: number;
  path?: GroundPath;
  /** Quads per side. Default 48. */
  segments?: number;
  /** Peak-to-peak height ripple outside the clearing, in world units. Default 0.06. */
  ripple?: number;
  /**
   * Rolling land beyond the walkable square (see terrain.ts). Without it the ground is as flat as
   * before. With it, the ripple and the color noise fade out toward the plane's edge, so the edge
   * matches the ring of hills that continues it.
   */
  terrain?: Terrain;
  /** Draw the texture's pebbles on the dirt clearing. Turn it off for paving. Default true. */
  pebbles?: boolean;
  /**
   * Seed of the coarse patch field (`coarsePatch`). Pass the same number to a path or a track laid
   * on this ground (`grassColorAt`, `dirtColorAt`) so its colors carry on into the ground's.
   * Default: one draw from `rng`. The seed used is kept in `mesh.userData.patchSeed`.
   */
  patchSeed?: number;
}

export type RGB = readonly [number, number, number];

const GRASS_VARIATION = 0.22;
const DIRT_VARIATION = 0.1;

/** Size of the coarse patch blobs: two layers of value noise, one lattice cell each, in world units. */
export const PATCH_CELL_SMALL = 3.5;
export const PATCH_CELL_LARGE = 5.5;
/** Value noise stays near the middle; this stretch (then a clamp) makes the patches a clear but gentle change. */
const PATCH_CONTRAST = 1.5;
/** How far the strongest patch leans the grass toward drier (yellower) or lusher (deeper green). */
const GRASS_PATCH_LEAN = 0.7;
/** How much the strongest patch lightens or darkens dirt, and the gentler figure for paving. */
const DIRT_PATCH_SHADE = 0.22;
const PAVED_PATCH_SHADE = 0.05;
/** Paving edge: the middle of its band goes this much darker, like the shaded foot of a kerb. */
const PAVED_RIM_SHADE = 0.1;
/** A dirt clearing's edge may wander this far out from its circle (see `GroundPath.ragged`). */
export const CLEARING_RAGGED = 1;
/** The edge wobble reads a different part of the patch field than the colors do. */
const RAGGED_SEED_SHIFT = 7919;

/** With terrain, color noise near the plane's edge shrinks to this fraction, so the hills can match it. */
const EDGE_VARIATION_KEPT = 0.15;
/** The ground starts to hand over to the hills this far beyond the walkable square (square distance). */
const EDGE_FADE_FROM = 3;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * How much dirt (1) versus grass (0) at the ground point (x, z): solid dirt inside `radius`,
 * easing to grass over `feather` units. Always in [0, 1]. With `path.ragged` the edge wanders
 * outward by up to that many units, following the patch field of `patchSeed`.
 */
export function dirtWeight(x: number, z: number, path: GroundPath, patchSeed = 0): number {
  let d = Math.hypot(x - path.center.x, z - path.center.z);
  if (path.ragged) d -= path.ragged * (0.5 + 0.5 * coarsePatch(x, z, patchSeed + RAGGED_SEED_SHIFT));
  if (d <= path.radius) return 1;
  if (!(path.feather > 0)) return 0;
  const t = clamp01((d - path.radius) / path.feather);
  return 1 - t * t * (3 - 2 * t);
}

/** Linear blend of two colors; `t` is clamped to [0, 1]. */
export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * Lighten or darken a color by `variation` in [-1, 1] times `amount`. Lighter patches also lean
 * a little warm and darker ones a little cool, which reads as sun-bleached versus shaded grass.
 * Channels stay in [0, 1].
 */
export function shadeRGB(color: RGB, variation: number, amount: number): RGB {
  const k = Math.min(1, Math.max(-1, variation)) * amount;
  return [clamp01(color[0] * (1 + 0.9 * k)), clamp01(color[1] * (1 + k)), clamp01(color[2] * (1 + 0.5 * k))];
}

/** Low-frequency patchiness in [-1, 1], so the grass has broad lighter and darker areas. */
export function grassPatch(x: number, z: number): number {
  return 0.5 * Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19) + 0.5 * Math.sin((x + z) * 0.11 + 0.4);
}

/** A repeatable random value in [-1, 1] for the lattice point (ix, iz): the same inputs always give the same number. */
function latticeValue(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** Smooth value noise in [-1, 1] with one lattice point every `cell` units. */
function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const u = x / cell;
  const v = z / cell;
  const ix = Math.floor(u);
  const iz = Math.floor(v);
  const tx = smoothstep(0, 1, u - ix);
  const tz = smoothstep(0, 1, v - iz);
  const top = latticeValue(ix, iz, seed) * (1 - tx) + latticeValue(ix + 1, iz, seed) * tx;
  const bottom = latticeValue(ix, iz + 1, seed) * (1 - tx) + latticeValue(ix + 1, iz + 1, seed) * tx;
  return top * (1 - tz) + bottom * tz;
}

/**
 * Coarse patchiness in [-1, 1]: soft blobs about `PATCH_CELL_SMALL` to `PATCH_CELL_LARGE` units
 * across (4 to 8 is the aim), so a big lawn breaks up into drier and lusher areas and a clearing
 * into lighter and darker ones. Smooth, pure, and the same for the same `seed` everywhere, so a path
 * laid on the ground can read the very same field.
 */
export function coarsePatch(x: number, z: number, seed = 0): number {
  const v = 0.6 * valueNoise(x, z, PATCH_CELL_SMALL, seed) + 0.4 * valueNoise(x + 17.3, z - 9.1, PATCH_CELL_LARGE, seed + 1);
  return Math.min(1, Math.max(-1, v * PATCH_CONTRAST));
}

/**
 * Lean a grass color toward drier (`patch` > 0: yellower, a touch lighter) or lusher (`patch` < 0:
 * deeper, cooler green) by `patch` in [-1, 1] times `amount`. Channels stay in [0, 1].
 */
export function leanGrassRGB(color: RGB, patch: number, amount: number): RGB {
  const k = Math.min(1, Math.max(-1, patch)) * amount;
  return [clamp01(color[0] * (1 + 0.7 * k)), clamp01(color[1] * (1 + 0.12 * k)), clamp01(color[2] * (1 - 0.5 * k))];
}

/**
 * Final color of one ground vertex: grass and dirt each get their own variation, then they blend
 * by `dirt` (see `dirtWeight`). `variation` is in [-1, 1]. `patch` (see `coarsePatch`) adds the
 * coarse drier/lusher lean to the grass and the lighter/darker shade to the dirt; `dirtPatchShade`
 * is how strongly the dirt takes it (paving takes it gently).
 */
export function groundColor(
  grass: RGB,
  dirt: RGB,
  dirtAmount: number,
  variation: number,
  patch = 0,
  dirtPatchShade = DIRT_PATCH_SHADE,
): RGB {
  const grassSide = leanGrassRGB(shadeRGB(grass, variation, GRASS_VARIATION), patch, GRASS_PATCH_LEAN);
  const dirtSide = shadeRGB(shadeRGB(dirt, variation, DIRT_VARIATION), patch, dirtPatchShade);
  return mixRGB(grassSide, dirtSide, dirtAmount);
}

/**
 * The color the ground itself shows at (x, z) on plain grass, before the per-vertex noise: the broad
 * patchiness and the coarse patch. A path or track fades its edge to exactly this, so it meets the
 * lawn with no seam. Pass the ground's `patchSeed`.
 */
export function grassColorAt(grass: RGB, x: number, z: number, patchSeed: number): RGB {
  return groundColor(grass, grass, 0, 0.55 * grassPatch(x, z), coarsePatch(x, z, patchSeed));
}

/** Like `grassColorAt`, for solid dirt: what a clearing shows at (x, z) before the per-vertex noise. */
export function dirtColorAt(dirt: RGB, x: number, z: number, patchSeed: number): RGB {
  return groundColor(dirt, dirt, 1, 0.55 * grassPatch(x, z), coarsePatch(x, z, patchSeed));
}

/** Width of the soft band where a path's or pad's edge blends into the grass, in world units. */
export const PATH_EDGE_BAND = 0.5;
/** The path's last stretch before the band is packed down a little darker, by this fraction: a worn rim. */
export const PATH_RIM_SHADE = 0.08;
/** How far a path's edge band sinks by its outer end, in world units: a rounded bank, not a cliff. */
export const PATH_EDGE_SINK = 0.008;

/**
 * Color across a path's edge band. `t` is 0 at the path's edge and 1 at the outer end of the band
 * (`PATH_EDGE_BAND` units out). At 0 it is the path color a touch darker (the rim, so the path reads
 * as a surface with an edge); at 1 it is exactly `grass`; between, it eases from one to the other.
 */
export function pathEdgeColor(path: RGB, grass: RGB, t: number): RGB {
  const rim = shadeRGB(path, -1, PATH_RIM_SHADE);
  return mixRGB(rim, grass, smoothstep(0, 1, t));
}

/**
 * The `dirt` vertex weight across a path's edge band, for the `blend` texture: 1 at the rim (all
 * pebbles), 0 at the outer end (all blades, just like the ground beside it). Goes with `pathEdgeColor`.
 */
export function pathEdgeDirt(t: number): number {
  return 1 - smoothstep(0, 1, t);
}

/**
 * The grass color at the very edge of a ground that has `terrain`: only the broad patchiness is
 * left (no per-vertex noise), so the ring of hills can start from exactly this color.
 */
export function edgeGrassColor(grass: RGB, x: number, z: number): RGB {
  return groundColor(grass, grass, 0, 0.55 * grassPatch(x, z) * EDGE_VARIATION_KEPT);
}

/** A receive-only ground plane at y = 0 (the clearing is exactly 0; elsewhere within half the ripple). 1 draw call. */
export function createGround(opts: GroundOptions): THREE.Mesh {
  const segments = opts.segments ?? 48;
  const ripple = opts.ripple ?? 0.06;
  const terrain = opts.terrain;
  const geometry = new THREE.PlaneGeometry(opts.size, opts.size, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const dirtWeights = new Float32Array(position.count);
  const edgeHalf = opts.size / 2;
  const paved = opts.pebbles === false;
  // One draw settles the patch field. A dirt clearing gets an uneven edge; a plaza keeps its round one.
  const patchSeed = opts.patchSeed ?? Math.floor(opts.rng() * 0x7fffffff);
  const path = opts.path ? { ...opts.path, ragged: opts.path.ragged ?? (paved ? 0 : CLEARING_RAGGED) } : undefined;

  // THREE.Color keeps linear values, which is what vertex colors are read as in the shader.
  const g = new THREE.Color(opts.grass);
  const d = new THREE.Color(opts.dirt);
  const grass: RGB = [g.r, g.g, g.b];
  const dirt: RGB = [d.r, d.g, d.b];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    // Two draws per vertex whether or not there is a clearing, so the pattern never shifts.
    const noiseColor = opts.rng() * 2 - 1;
    const noiseHeight = opts.rng() - 0.5;
    const dirtAmount = path ? dirtWeight(x, z, path, patchSeed) : 0;
    // 0 on the zone's own ground, rising to 1 at the plane's edge, where the hills take over.
    const edge = terrain ? smoothstep(terrain.half + EDGE_FADE_FROM, edgeHalf, Math.max(Math.abs(x), Math.abs(z))) : 0;
    const variation = (0.55 * grassPatch(x, z) + 0.45 * noiseColor * (1 - edge)) * (1 - (1 - EDGE_VARIATION_KEPT) * edge);
    // The coarse patches die out at the plane's edge too, so the hills can start from the very same color.
    const color = groundColor(
      grass,
      dirt,
      dirtAmount,
      variation,
      coarsePatch(x, z, patchSeed) * (1 - edge),
      paved ? PAVED_PATCH_SHADE : DIRT_PATCH_SHADE,
    );
    // A paved edge goes a little darker in the middle of its band, like the shaded foot of a kerb.
    const rim = paved ? 1 - PAVED_RIM_SHADE * 4 * dirtAmount * (1 - dirtAmount) : 1;
    colors[i * 3] = color[0] * rim;
    colors[i * 3 + 1] = color[1] * rim;
    colors[i * 3 + 2] = color[2] * rim;
    dirtWeights[i] = dirtAmount;
    position.setY(i, noiseHeight * ripple * (1 - dirtAmount) * (1 - edge) + (terrain ? terrain.height(x, z) : 0));
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('dirt', new THREE.BufferAttribute(dirtWeights, 1));
  geometry.computeVertexNormals();

  if (terrain) {
    // From the geometry's own normals (ripple included) to the terrain's smooth ones at the edge, so
    // the lighting continues into the hills with no line.
    const normal = geometry.getAttribute('normal');
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const edge = smoothstep(terrain.half + EDGE_FADE_FROM, edgeHalf, Math.max(Math.abs(x), Math.abs(z)));
      if (edge <= 0) continue;
      const [tx, ty, tz] = terrain.normal(x, z);
      n.set(normal.getX(i), normal.getY(i), normal.getZ(i)).lerp(new THREE.Vector3(tx, ty, tz), edge).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyGroundTexture(material, createGroundTexture(), paved ? 'paved' : 'blend');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  mesh.userData.patchSeed = patchSeed;
  return mesh;
}

/**
 * A huge flat plane just under the ground, in the grass color. It carries the grass out to the fog
 * so the world has no visible edge. Pass the same grass color given to `createGround`. 1 draw call.
 */
export function createGroundApron(grass: number, size = 800): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: grass }),
  );
  mesh.name = 'ground-apron';
  mesh.position.y = -0.06;
  return mesh;
}

// ---- the ground texture ---------------------------------------------------------------------------

/** Texels per side of the tiling texture. */
export const GROUND_TEXTURE_SIZE = 256;
/** World units one copy of the texture covers (about 32 texels per unit). */
export const GROUND_TEXTURE_TILE = 8;
/**
 * The shader brightens what the texture adds by this much, and the texture is made with an average
 * of `1 / GROUND_TEXTURE_GAIN`, so on average the ground keeps the brightness of its vertex colors
 * while the blades, pebbles and slabs still have both lighter and darker marks. The gain is the
 * headroom for the lighter ones (a quarter above the average), so it limits how strong they can be.
 */
export const GROUND_TEXTURE_GAIN = 1.25;
export const GROUND_TEXTURE_MEAN = 1 / GROUND_TEXTURE_GAIN;
const GROUND_TEXTURE_SEED = 1977;
/** The paving slabs are one world unit square: this many across one copy of the texture. */
const SLABS_PER_TILE = GROUND_TEXTURE_TILE;
/** How strongly one blade marks the grass layer (it was 0.4 before the speckle was made stronger). */
const BLADE_STRENGTH = 1.2;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1] over a `size` by `size` grid that wraps on both axes, `cells` lattice points per side. */
function periodicNoise(size: number, cells: number, rng: Rng): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const ya = y0 % cells;
    const yb = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const top = lattice[ya * cells + xa]! * (1 - tx) + lattice[ya * cells + xb]! * tx;
      const bottom = lattice[yb * cells + xa]! * (1 - tx) + lattice[yb * cells + xb]! * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/**
 * RGBA texels (row 0 first) of the tiling ground texture. Four layers share one image, so one
 * texture serves the grass, the dirt, the paving and the tint:
 *
 * - R: grass. Soft blade speckle (short strokes, lighter and darker, about 10 percent either way)
 *   over a gentle, broad variation.
 * - G: pebbles. Small round stones with a darker rim and a lit side, over a grain.
 * - B: tint. 0.5 means no change; above leans warm (sun-bleached), below leans cool.
 * - A: paving. One-unit slabs with thin dark joints, each slab a little lighter or darker than its
 *   neighbors, and a lit and a shaded edge. Used by the plaza only (`paved` mode); it is sampled
 *   at one scale, not blended with a second look-up, so the joints stay straight.
 *
 * Everything wraps (the noise is periodic and strokes and stones are drawn modulo the size), so it
 * tiles with no seam. Pure and seeded: the same `size` and `seed` always give the same texels.
 * R, G and A are scaled to an average of `GROUND_TEXTURE_MEAN`.
 */
export function groundTexturePixels(size = GROUND_TEXTURE_SIZE, seed = GROUND_TEXTURE_SEED): Uint8Array {
  const rng = mulberry32(seed);
  const count = size * size;
  const unit = size / 256; // a smaller test texture keeps the same look, just coarser
  const wrap = (v: number): number => ((v % size) + size) % size;

  const low = periodicNoise(size, 4, rng);
  const mid = periodicNoise(size, 8, rng);
  const fine = periodicNoise(size, 16, rng);
  const tone = periodicNoise(size, 5, rng);
  const grass = new Float32Array(count);
  const pebble = new Float32Array(count);
  const tint = new Float32Array(count);
  // The layers are drawn around 1 and scaled to the mean at the end, so a light mark has room to be as
  // strong as a dark one (the shader's gain is that room).
  for (let i = 0; i < count; i++) {
    grass[i] = 1 + 0.26 * (0.5 * low[i]! + 0.3 * mid[i]! + 0.2 * fine[i]! - 0.5);
    pebble[i] = 1 + 0.24 * (fine[i]! - 0.5) + (rng() - 0.5) * 0.3;
    tint[i] = 0.5 + 0.4 * (tone[i]! - 0.5);
  }

  // Blades: short soft strokes in any direction, a few more dark than light.
  const bladeCount = Math.round(1500 * unit * unit);
  for (let b = 0; b < bladeCount; b++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const angle = rng() * Math.PI;
    const length = (3.5 + rng() * 5.5) * unit;
    const light = rng() < 0.42;
    const amount = (light ? 1 : -1) * (0.05 + rng() * 0.11);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const steps = Math.max(2, Math.ceil(length * 2));
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps - 0.5) * length;
      const taper = Math.max(0.1, 1 - ((2 * t) / length) ** 2);
      const px = cx + dx * t;
      const py = cy + dy * t;
      const ix = Math.round(px);
      const iy = Math.round(py);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const falloff = Math.exp(-((ix + ox - px) ** 2 + (iy + oy - py) ** 2) / (2 * 0.6 * 0.6));
          const at = wrap(iy + oy) * size + wrap(ix + ox);
          grass[at] = grass[at]! + amount * taper * falloff * BLADE_STRENGTH;
          tint[at] = tint[at]! + (amount > 0 ? 1 : -1) * Math.abs(amount) * taper * falloff * 0.5;
        }
      }
    }
  }

  // Pebbles: little ovals, each a little lighter or darker than the dirt, ringed by a soft shadow.
  const pebbleCount = Math.round(1100 * unit * unit);
  for (let p = 0; p < pebbleCount; p++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const radius = (1.2 + rng() * rng() * 2.2) * unit;
    const squash = 0.65 + rng() * 0.3;
    const turn = rng() * Math.PI;
    const value = 0.5 + rng() * 0.8;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const reach = Math.ceil(radius * 1.5) + 1;
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const ix = Math.round(cx) + ox;
        const iy = Math.round(cy) + oy;
        const rx = ix - cx;
        const ry = iy - cy;
        const u = (rx * cos + ry * sin) / radius;
        const v = (-rx * sin + ry * cos) / (radius * squash);
        const d = Math.hypot(u, v);
        if (d >= 1.45) continue;
        const at = wrap(iy) * size + wrap(ix);
        if (d < 1) {
          const body = value * (0.93 + 0.1 * (1 - d * d)) - 0.05 * (u + v) * 0.7;
          const cover = smooth(clamp01((1 - d) / 0.22));
          pebble[at] = pebble[at]! * (1 - cover) + body * cover;
        } else {
          pebble[at] = pebble[at]! * (1 - 0.3 * (1 - (d - 1) / 0.45));
        }
      }
    }
  }

  // Overlapping dark blades can pile up; keep the darkest mark a believable shade, not black.
  for (let i = 0; i < count; i++) grass[i] = Math.max(0.6, grass[i]!);

  // Paving: one-unit slabs with thin dark joints. Each slab has its own tone, and the top-left edge is
  // a touch lit and the bottom-right a touch shaded, so a slab reads as a stone with a little thickness.
  const slabPx = size / SLABS_PER_TILE;
  const jointPx = Math.max(1, Math.round(slabPx / 16)); // 2 texels (about 0.06 unit) on the full texture
  const slabTone = Array.from({ length: SLABS_PER_TILE * SLABS_PER_TILE }, () => rng() * 2 - 1);
  const paving = new Float32Array(count);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor(y / slabPx);
    const ly = y - sy * slabPx;
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / slabPx);
      const lx = x - sx * slabPx;
      const i = y * size + x;
      let v = 1 + 0.07 * slabTone[sy * SLABS_PER_TILE + sx]! + 0.1 * (fine[i]! - 0.5) + (rng() - 0.5) * 0.05;
      if (lx < jointPx || ly < jointPx) v = 0.58;
      else if (lx < jointPx + 1 || ly < jointPx + 1) v *= 1.06;
      else if (lx >= slabPx - 1 || ly >= slabPx - 1) v *= 0.95;
      paving[i] = v;
    }
  }

  // Bring the average of the grass, pebble and paving layers to the same value, never above 1. They are
  // drawn around 1, so a light mark can be as strong as a dark one, up to the gain's headroom.
  const scaleTo = (layer: Float32Array): void => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += Math.max(0, layer[i]!);
    const k = GROUND_TEXTURE_MEAN / (sum / count);
    for (let i = 0; i < count; i++) layer[i] = clamp01(Math.max(0, layer[i]!) * k);
  };
  scaleTo(grass);
  scaleTo(pebble);
  scaleTo(paving);

  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = Math.round(grass[i]! * 255);
    data[i * 4 + 1] = Math.round(pebble[i]! * 255);
    data[i * 4 + 2] = Math.round(clamp01(tint[i]!) * 255);
    data[i * 4 + 3] = Math.round(paving[i]! * 255);
  }
  return data;
}

let sharedTexture: THREE.DataTexture | null = null;

/**
 * The tiling ground texture as a Three.js texture: repeat-wrapped, with mipmaps (so the speckle
 * melts into an even color with distance instead of shimmering), a little anisotropic filtering for
 * the low view angle, and no color space (it is a multiplier, read as plain numbers). One copy is
 * shared by every zone.
 */
export function createGroundTexture(): THREE.DataTexture {
  if (sharedTexture) return sharedTexture;
  const texture = new THREE.DataTexture(
    groundTexturePixels(),
    GROUND_TEXTURE_SIZE,
    GROUND_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'ground-texture';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  sharedTexture = texture;
  return texture;
}

/**
 * Which layer of the texture a material shows:
 * - `grass`: the blade speckle (the ring of hills uses this).
 * - `pebbles`: the pebbles only (a path or a track that is all dirt).
 * - `blend`: grass and pebbles, mixed by the mesh's `dirt` vertex attribute (the ground).
 * - `paved`: like `blend`, but the dirt part shows the paving slabs instead of pebbles (a paved plaza).
 */
export type GroundTextureMode = 'grass' | 'pebbles' | 'blend' | 'paved';

/** How much the tint layer shifts the color (warm or cool), at its extremes. */
const TINT_STRENGTH = 0.4;

/**
 * Multiply a vertex-colored Lambert material by the ground texture. The texture is looked up by
 * the vertex's object-space x and z (`GROUND_TEXTURE_TILE` units per copy), so no UVs are needed,
 * and the ground, the hills and a path laid over them all show the same marks in the same places.
 * The mesh must sit at the origin with no turn (every zone's ground does). The material is patched
 * in `onBeforeCompile`, so nothing changes until a renderer compiles it.
 */
export function applyGroundTexture(
  material: THREE.MeshLambertMaterial,
  texture: THREE.Texture,
  mode: GroundTextureMode,
): THREE.MeshLambertMaterial {
  const key = `ground-texture:${mode}`;
  const needsDirt = mode === 'blend' || mode === 'paved';
  const tile = (1 / GROUND_TEXTURE_TILE).toFixed(6);

  let speckle: string;
  switch (mode) {
    case 'grass':
      speckle = 'vec3( grassMod ) * tint';
      break;
    case 'pebbles':
      speckle = 'vec3( pebbleMod )';
      break;
    case 'blend':
      speckle = 'mix( vec3( grassMod ) * tint, vec3( pebbleMod ), vDirt )';
      break;
    case 'paved':
      speckle = 'mix( vec3( grassMod ) * tint, vec3( pavingMod ), vDirt )';
      break;
  }

  material.userData.groundTexture = { mode, texture };
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vGroundUv;\n${needsDirt ? 'attribute float dirt;\nvarying float vDirt;\n' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvGroundUv = transformed.xz * ${tile};\n${needsDirt ? 'vDirt = dirt;\n' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform sampler2D groundMap;\nvarying vec2 vGroundUv;\n${needsDirt ? 'varying float vDirt;\n' : ''}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec4 groundA = texture2D( groundMap, vGroundUv );
  vec4 groundB = texture2D( groundMap, vGroundUv * 0.37 + vec2( 0.31, 0.17 ) );
  float grassMod = 0.5 * ( groundA.r + groundB.r );
  float pebbleMod = 0.5 * ( groundA.g + groundB.g );
  float pavingMod = groundA.a;
  float warm = ( 0.5 * ( groundA.b + groundB.b ) - 0.5 ) * ${TINT_STRENGTH.toFixed(2)};
  vec3 tint = vec3( 1.0 + 0.9 * warm, 1.0, 1.0 - 0.7 * warm );
  diffuseColor.rgb *= ( ${speckle} ) * ${GROUND_TEXTURE_GAIN.toFixed(2)};
}`,
      );
  };
  return material;
}

/**
 * The shader source `applyGroundTexture` produces for a mode, applied to the stock Lambert shaders.
 * Exported so a test can check that every piece landed (a missing marker would mean the patch did
 * nothing, and a typo here only shows up in a browser).
 */
export function patchedGroundShaders(
  mode: GroundTextureMode,
  vertexShader: string,
  fragmentShader: string,
): { vertexShader: string; fragmentShader: string } {
  const material = applyGroundTexture(new THREE.MeshLambertMaterial(), createGroundTexture(), mode);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader, fragmentShader };
  (material.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, undefined);
  return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
}
