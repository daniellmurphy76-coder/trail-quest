import * as THREE from 'three';
import type { Rng } from './props';

/**
 * Ground: a subdivided plane with per-vertex color, so the grass is never one flat value, and an
 * optional dirt clearing with a soft edge. The clearing stays dead flat; the rest gets a few
 * centimeters of random ripple so light and shadow have something to catch. The color math is
 * pure and exported so tests can check it without a renderer.
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
}

export type RGB = readonly [number, number, number];

const GRASS_VARIATION = 0.22;
const DIRT_VARIATION = 0.1;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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

/** A receive-only ground plane at y = 0 (the clearing is exactly 0; elsewhere within half the ripple). 1 draw call. */
export function createGround(opts: GroundOptions): THREE.Mesh {
  const segments = opts.segments ?? 48;
  const ripple = opts.ripple ?? 0.06;
  const geometry = new THREE.PlaneGeometry(opts.size, opts.size, segments, segments).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);

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
    const [r, gr, b] = groundColor(grass, dirt, dirtAmount, 0.55 * grassPatch(x, z) + 0.45 * noiseColor);
    colors[i * 3] = r;
    colors[i * 3 + 1] = gr;
    colors[i * 3 + 2] = b;
    position.setY(i, noiseHeight * ripple * (1 - dirtAmount));
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
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
