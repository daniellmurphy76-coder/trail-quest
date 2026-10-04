import * as THREE from 'three';
import { mulberry32 } from '../engine/seed';
import type { Terrain } from './terrain';
import type { Rng } from './props';

/**
 * Ground: a subdivided plane with per-vertex color, so the grass is never one flat value, and an
 * optional dirt clearing with a soft edge. The clearing stays dead flat; the rest gets a few
 * centimeters of random ripple so light and shadow have something to catch. The color math is
 * pure and exported so tests can check it without a renderer.
 *
 * Two more things sit on top of that, both optional:
 *
 * - A tiling texture (`createGroundTexture`) with soft blade speckle for the grass and pebbles for
 *   the dirt, multiplied over the vertex colors. It is generated in code from a seed (a plain typed
 *   array, so it also builds in node), mipmapped and repeat-wrapped, and sampled by world position
 *   so it lines up on every mesh that uses it (`applyGroundTexture`).
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
}

export type RGB = readonly [number, number, number];

const GRASS_VARIATION = 0.22;
const DIRT_VARIATION = 0.1;

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
 * easing to grass over `feather` units. Always in [0, 1].
 */
export function dirtWeight(x: number, z: number, path: GroundPath): number {
  const d = Math.hypot(x - path.center.x, z - path.center.z);
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

/**
 * Final color of one ground vertex: grass and dirt each get their own variation, then they blend
 * by `dirt` (see `dirtWeight`). `variation` is in [-1, 1].
 */
export function groundColor(grass: RGB, dirt: RGB, dirtAmount: number, variation: number): RGB {
  return mixRGB(shadeRGB(grass, variation, GRASS_VARIATION), shadeRGB(dirt, variation, DIRT_VARIATION), dirtAmount);
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
    const dirtAmount = opts.path ? dirtWeight(x, z, opts.path) : 0;
    // 0 on the zone's own ground, rising to 1 at the plane's edge, where the hills take over.
    const edge = terrain ? smoothstep(terrain.half + EDGE_FADE_FROM, edgeHalf, Math.max(Math.abs(x), Math.abs(z))) : 0;
    const variation = (0.55 * grassPatch(x, z) + 0.45 * noiseColor * (1 - edge)) * (1 - (1 - EDGE_VARIATION_KEPT) * edge);
    const [r, gr, b] = groundColor(grass, dirt, dirtAmount, variation);
    colors[i * 3] = r;
    colors[i * 3 + 1] = gr;
    colors[i * 3 + 2] = b;
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
  applyGroundTexture(material, createGroundTexture(), opts.pebbles === false ? 'paved' : 'blend');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
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
 * while the blades and pebbles still have both lighter and darker marks.
 */
export const GROUND_TEXTURE_GAIN = 1.1;
export const GROUND_TEXTURE_MEAN = 1 / GROUND_TEXTURE_GAIN;
const GROUND_TEXTURE_SEED = 1977;

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
 * RGBA texels (row 0 first) of the tiling ground texture. Three layers share one image, so one
 * texture serves the grass, the dirt and the tint:
 *
 * - R: grass. Soft blade speckle (short strokes, lighter and darker) over a gentle, broad variation.
 * - G: pebbles. Small round stones with a darker rim and a lit side, over a fine grain.
 * - B: tint. 0.5 means no change; above leans warm (sun-bleached), below leans cool.
 * - A: always 255.
 *
 * Everything wraps (the noise is periodic and strokes and stones are drawn modulo the size), so it
 * tiles with no seam. Pure and seeded: the same `size` and `seed` always give the same texels.
 * R and G are scaled to an average of `GROUND_TEXTURE_MEAN`.
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
  for (let i = 0; i < count; i++) {
    grass[i] = 0.9 + 0.1 * (0.5 * low[i]! + 0.3 * mid[i]! + 0.2 * fine[i]! - 0.5);
    pebble[i] = 0.88 + 0.07 * (fine[i]! - 0.5) + (rng() - 0.5) * 0.06;
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
          grass[at] = grass[at]! + amount * taper * falloff * 0.4;
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
    const value = 0.64 + rng() * 0.36;
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
          pebble[at] = pebble[at]! * (1 - 0.16 * (1 - (d - 1) / 0.45));
        }
      }
    }
  }

  // Bring the average of the grass and pebble layers to the same value, never above 1.
  const scaleTo = (layer: Float32Array): void => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += clamp01(layer[i]!);
    const k = GROUND_TEXTURE_MEAN / (sum / count);
    for (let i = 0; i < count; i++) layer[i] = clamp01(clamp01(layer[i]!) * k);
  };
  scaleTo(grass);
  scaleTo(pebble);

  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = Math.round(grass[i]! * 255);
    data[i * 4 + 1] = Math.round(pebble[i]! * 255);
    data[i * 4 + 2] = Math.round(clamp01(tint[i]!) * 255);
    data[i * 4 + 3] = 255;
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
 * - `paved`: like `blend`, but the dirt part gets no speckle (a paved plaza).
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
      speckle = 'mix( vec3( grassMod ) * tint, vec3( 1.0 ), vDirt )';
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
