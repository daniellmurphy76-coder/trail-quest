/**
 * Ambient critters: butterflies near the ground, birds high overhead, fireflies at dusk spots.
 * Standalone, decoration only: nothing here blocks the player or reacts to them.
 *
 * API
 *
 *   const b = createButterflies({ count, area, avoid, seed, tier });
 *   const k = createBirds({ count, radius, height, seed, center, scale, tier });
 *   const f = createFireflies({ center, radius, count, seed, tier });
 *   zone.root.add(b.root, k.root, f.root);   // once each
 *   b.update(dt); k.update(dt); f.update(dt); // every fixed step, from the zone's update
 *   b.dispose();                              // frees geometry, materials and textures
 *
 * Every factory returns `Critters`: { root: THREE.Group; update(dt): void; dispose(): void;
 * setReducedMotion(reduced: boolean): void }. Every option is optional and has a default, so
 * `createButterflies()` works. All of them take `tier` (default getQuality()) and `reducedMotion`
 * (default: the system's prefers-reduced-motion, read once when built; `setReducedMotion` flips it
 * later). Same seed, same flight. `dt` is clamped to 0.1 s, so a stalled frame cannot fling anything.
 *
 *   createButterflies({ count = 10, area = {-15..15 on x and z}, avoid = [], seed = 1 })
 *     avoid: { x, z, r }[]. Butterflies steer round these discs and are never inside one.
 *     Two small wing quads per butterfly (one InstancedMesh, wings flap about the body line),
 *     wandering in gentle curves, 0.48 to 1.52 units up, always inside `area`. Five colors, darker
 *     toward the body. Wingspan about 0.36 at scale 1.
 *   createBirds({ count = 4, radius = 120, height = 26, center = {0, 0}, scale = 1.8, seed = 1 })
 *     V-shaped flapping silhouettes (a swept wing quad plus half a body per wing, one
 *     InstancedMesh) gliding in circles about `center`. Each circle has a radius of 70 to 90
 *     percent of `radius` (so a bird is never farther than `radius` from the center), at its own
 *     height within 18 percent of `height` (21 to 31 for 26), bobbing under 1 unit. They flap in
 *     bursts and glide between, banked into the turn. Wingspan about 2.3 at scale 1. Dark, no
 *     shadows, and NOT fogged (like the clouds: a dark shape on the sky, however far).
 *     Where they can be seen: the follow camera looks about 9 degrees down with a 50 degree field
 *     of view, so the sky on screen reaches only about 16 degrees above the horizon. A bird at
 *     height h shows only when it is farther than about 3.5 h from the camera (100 at 26). That is
 *     why the defaults are a radius of 120 and a scale of 1.8; a small radius puts the flock
 *     overhead and out of sight.
 *   createFireflies({ center = {0, 0, y: 0}, radius = 8, count = 14, seed = 1 })
 *     Warm glowing points drifting on slow looping paths within `radius` of the center (horizontal),
 *     0.5 to 2.4 units above center.y. Brightness pulses between a dim ember and a peak of about
 *     1.7 (channels above 1.0), so the bloom pass (threshold 1) catches the peaks; with bloom off
 *     they just clip bright. The material is not tone-mapped-off, so post.ts's applyGlow leaves it
 *     alone (that would double the lift). Fog off: they sit near the player.
 *
 * Tiers and motion
 *   - low: butterflies and birds return an empty group (no draw calls). Fireflies ignore the tier
 *     and still build (one Points object, a dozen points).
 *   - reduced motion: the root is hidden (nothing is drawn) and update does nothing.
 *
 * Draw calls: butterflies 1, birds 1, fireflies 1 (0 when empty or hidden).
 * Triangles: butterflies 4 per butterfly, birds 6 per bird, fireflies are points.
 */
import * as THREE from 'three';
import { getQuality, type QualityTier } from '../engine/quality';
import { mulberry32 } from '../engine/seed';

// ---- types ---------------------------------------------------------------------------------------

export interface Critters {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
  /** Show or hide the critters (and freeze them) without rebuilding. */
  setReducedMotion(reduced: boolean): void;
}

export interface CritterArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface AvoidDisc {
  x: number;
  z: number;
  r: number;
}

export interface ButterflyOptions {
  count?: number;
  area?: CritterArea;
  avoid?: readonly AvoidDisc[];
  seed?: number;
  tier?: QualityTier;
  reducedMotion?: boolean;
}

export interface BirdOptions {
  count?: number;
  /** Farthest a bird gets from `center`, horizontally. */
  radius?: number;
  height?: number;
  center?: { x: number; z: number };
  /** Size multiplier. Wingspan is about 2.3 at 1. Default 1.8. */
  scale?: number;
  seed?: number;
  tier?: QualityTier;
  reducedMotion?: boolean;
}

export interface FireflyOptions {
  /** `y` is the ground height under the swarm. Default 0. */
  center?: { x: number; z: number; y?: number };
  radius?: number;
  count?: number;
  seed?: number;
  tier?: QualityTier;
  reducedMotion?: boolean;
}

// ---- tuning --------------------------------------------------------------------------------------

export const MAX_BUTTERFLIES = 60;
export const MAX_BIRDS = 24;
export const MAX_FIREFLIES = 80;
/** Largest step one update takes (seconds). */
const MAX_STEP = 0.1;
const TAU = Math.PI * 2;

const DEFAULT_AREA: CritterArea = { minX: -15, maxX: 15, minZ: -15, maxZ: 15 };

/** Butterfly flight height: HEIGHT_MID plus or minus HEIGHT_SWING, plus a 0.04 flap bob. */
const BUTTERFLY_MID = 1.0;
const BUTTERFLY_SWING = 0.48;
const BUTTERFLY_BOB = 0.04;
/** How close to an edge or an avoid disc a butterfly starts to turn away. */
const STEER_MARGIN = 1.2;
const MAX_TURN = 3; // radians per second, when steering
const BUTTERFLY_COLORS = [0xf28a2b, 0xffd23f, 0x5ab0f0, 0xf6f1e4, 0xf17fb0] as const;

const BIRD_COLORS = [0x2a2d36, 0x3a3f4b, 0x1f2229] as const;
/** A bird's orbit is this share of `radius` (plus or minus a 5 percent breathing). */
const BIRD_ORBIT: readonly [number, number] = [0.7, 0.9];
/** Each bird's height is the nominal one plus or minus this fraction of it. */
const BIRD_HEIGHT_SPREAD = 0.18;
const BIRD_BOB = 0.8;
const BIRD_DIHEDRAL = 0.22; // wings rest a little above flat: the V seen head on

const FIREFLY_PEAK = 1.7;
const FIREFLY_COLOR: readonly [number, number, number] = [1.0, 0.85, 0.32];

// ---- helpers -------------------------------------------------------------------------------------

type Rng = () => number;

const between = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a: number): number => a - TAU * Math.round(a / TAU);
/** A usable time step: finite, never negative, never more than MAX_STEP. */
const safeStep = (dt: number): number => (Number.isFinite(dt) ? clamp(dt, 0, MAX_STEP) : 0);

function systemPrefersReducedMotion(): boolean {
  // Same check as wind.ts, kept local so this module stands alone.
  const mm = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return mm.call(globalThis, '(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
  return clamp(n, 0, max);
}

function emptyCritters(root: THREE.Group): Critters {
  return { root, update: () => {}, dispose: () => {}, setReducedMotion: () => {} };
}

/** Free the GPU memory of every mesh and point cloud under `root`, then empty it. */
function disposeAll(root: THREE.Group): void {
  root.traverse((o) => {
    const x = o as THREE.Mesh & THREE.Points & THREE.InstancedMesh;
    if (!x.isMesh && !x.isPoints) return;
    x.geometry.dispose();
    const materials = Array.isArray(x.material) ? x.material : [x.material];
    for (const m of materials) {
      (m as THREE.PointsMaterial).map?.dispose();
      m.dispose();
    }
    if (x.isInstancedMesh) x.dispose();
  });
  root.clear();
}

// Scratch objects for the wing matrices (nothing allocates per frame).
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const qYaw = new THREE.Quaternion();
const qRoll = new THREE.Quaternion();
const qWing = new THREE.Quaternion();
const vPos = new THREE.Vector3();
const vScale = new THREE.Vector3();
const mWing = new THREE.Matrix4();

/**
 * Set the two wings of body `i` of a wings-only InstancedMesh (instance 2i is the wing that
 * extends along +x, 2i + 1 its mirror image). The body turns by `yaw` about the vertical, rolls by
 * `roll` about its own forward axis (+z), and each wing lifts by `flap` from flat.
 */
function setWings(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  roll: number,
  flap: number,
  scale: number,
): void {
  qYaw.setFromAxisAngle(Y_AXIS, yaw);
  vPos.set(x, y, z);

  qRoll.setFromAxisAngle(Z_AXIS, roll + flap);
  qWing.copy(qYaw).multiply(qRoll);
  mesh.setMatrixAt(2 * i, mWing.compose(vPos, qWing, vScale.set(scale, scale, scale)));

  // The mirrored wing is flipped across x first, so it lifts the other way about z.
  qRoll.setFromAxisAngle(Z_AXIS, roll - flap);
  qWing.copy(qYaw).multiply(qRoll);
  mesh.setMatrixAt(2 * i + 1, mWing.compose(vPos, qWing, vScale.set(-scale, scale, scale)));
}

/** A wings-only InstancedMesh: `bodies` bodies, two instances each, moving every frame. */
function wingMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  bodies: number,
  colors: readonly number[],
  rng: Rng,
  vertexColors: boolean,
  fog: boolean,
): THREE.InstancedMesh {
  const material = new THREE.MeshBasicMaterial({ vertexColors, side: THREE.DoubleSide, fog });
  const mesh = new THREE.InstancedMesh(geometry, material, bodies * 2);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // the instances move every frame, so the starting bounds would be wrong
  const color = new THREE.Color();
  for (let i = 0; i < bodies; i++) {
    color.setHex(colors[Math.floor(rng() * colors.length)]!);
    mesh.setColorAt(2 * i, color);
    mesh.setColorAt(2 * i + 1, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---- butterflies ---------------------------------------------------------------------------------

interface Butterfly {
  x: number;
  z: number;
  heading: number;
  speed: number;
  size: number;
  /** Two slow sines that turn it (rate, amplitude, phase), so the path curves and never repeats soon. */
  turnK: number;
  w1: number;
  p1: number;
  w2: number;
  p2: number;
  /** Height swing. */
  wy: number;
  py: number;
  flap: number;
  flapRate: number;
  flapDepth: number;
}

/** Two wing quads' worth of geometry: one wing (hinge along z at x = 0, out to x = 0.17), darker at the hinge. */
function butterflyWing(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, -0.07, // hinge, back
        0, 0, 0.09, // hinge, front
        0.17, 0, 0.11, // tip, front
        0.15, 0, -0.14, // tip, back
      ],
      3,
    ),
  );
  const shade = [0.5, 0.5, 1, 0.9];
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((v) => [v, v, v]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function createButterflies(options: ButterflyOptions = {}): Critters {
  const root = new THREE.Group();
  root.name = 'butterflies';
  const tier = options.tier ?? getQuality();
  const count = clampCount(options.count, 10, MAX_BUTTERFLIES);
  if (tier === 'low' || count === 0) return emptyCritters(root);

  const rng = mulberry32(options.seed ?? 1);
  const given = options.area ?? DEFAULT_AREA;
  const area: CritterArea = {
    minX: Math.min(given.minX, given.maxX),
    maxX: Math.max(given.minX, given.maxX),
    minZ: Math.min(given.minZ, given.maxZ),
    maxZ: Math.max(given.minZ, given.maxZ),
  };
  const avoid = (options.avoid ?? []).filter((d) => d.r > 0);
  const edgeMargin = Math.max(1e-3, Math.min(STEER_MARGIN * 1.5, (area.maxX - area.minX) * 0.25, (area.maxZ - area.minZ) * 0.25));

  const insideAvoid = (x: number, z: number, pad: number): boolean =>
    avoid.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + pad);

  const bugs: Butterfly[] = [];
  for (let i = 0; i < count; i++) {
    let x = between(rng, area.minX, area.maxX);
    let z = between(rng, area.minZ, area.maxZ);
    for (let tries = 0; tries < 40 && insideAvoid(x, z, 0.3); tries++) {
      x = between(rng, area.minX, area.maxX);
      z = between(rng, area.minZ, area.maxZ);
    }
    bugs.push({
      x,
      z,
      heading: rng() * TAU,
      speed: between(rng, 0.6, 1.1),
      size: between(rng, 0.8, 1.2),
      turnK: between(rng, 0.45, 0.95),
      w1: between(rng, 0.35, 0.7),
      p1: rng() * TAU,
      w2: between(rng, 0.9, 1.5),
      p2: rng() * TAU,
      wy: between(rng, 0.25, 0.6),
      py: rng() * TAU,
      flap: rng() * TAU,
      flapRate: between(rng, 5, 8) * TAU,
      flapDepth: between(rng, 0.75, 0.95),
    });
  }

  const mesh = wingMesh('butterfly-wings', butterflyWing(), count, BUTTERFLY_COLORS, rng, true, true);
  root.add(mesh);

  let time = 0;
  let reduced = options.reducedMotion ?? systemPrefersReducedMotion();
  let disposed = false;

  const place = (): void => {
    bugs.forEach((b, i) => {
      const y = BUTTERFLY_MID + BUTTERFLY_SWING * Math.sin(time * b.wy * TAU + b.py) + BUTTERFLY_BOB * Math.sin(b.flap);
      const roll = 0.12 * Math.sin(time * 1.3 + b.p1);
      const flap = 0.25 + b.flapDepth * Math.sin(b.flap);
      setWings(mesh, i, b.x, y, b.z, b.heading, roll, flap, b.size);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place();

  const syncMotion = (): void => {
    root.visible = !reduced;
  };
  syncMotion();

  return {
    root,
    update(dt: number): void {
      if (disposed || reduced) return;
      const step = safeStep(dt);
      time += step;
      for (const b of bugs) {
        const wander = b.turnK * (Math.sin(time * b.w1 + b.p1) + 0.6 * Math.sin(time * b.w2 + b.p2));

        // Steering: away from the edges and the avoid discs, stronger the closer it gets.
        let sx = 0;
        let sz = 0;
        if (b.x < area.minX + edgeMargin) sx += (area.minX + edgeMargin - b.x) / edgeMargin;
        if (b.x > area.maxX - edgeMargin) sx -= (b.x - (area.maxX - edgeMargin)) / edgeMargin;
        if (b.z < area.minZ + edgeMargin) sz += (area.minZ + edgeMargin - b.z) / edgeMargin;
        if (b.z > area.maxZ - edgeMargin) sz -= (b.z - (area.maxZ - edgeMargin)) / edgeMargin;
        for (const d of avoid) {
          const dx = b.x - d.x;
          const dz = b.z - d.z;
          const dist = Math.hypot(dx, dz) || 1e-6;
          const reach = d.r + STEER_MARGIN;
          if (dist < reach) {
            const push = (reach - dist) / STEER_MARGIN;
            sx += (dx / dist) * push * 1.5;
            sz += (dz / dist) * push * 1.5;
          }
        }
        const urge = Math.min(1, Math.hypot(sx, sz));
        let turn = wander * (1 - urge);
        if (urge > 0) {
          const want = wrapAngle(Math.atan2(sx, sz) - b.heading);
          turn += clamp(want / Math.max(step, 1e-6), -MAX_TURN, MAX_TURN) * urge;
        }
        b.heading = wrapAngle(b.heading + turn * step);
        b.x += Math.sin(b.heading) * b.speed * step;
        b.z += Math.cos(b.heading) * b.speed * step;

        // A hard stop, so the promise holds however a step lands: back inside the area and out of the discs.
        // The area wins if a disc and an edge ever disagree, so the clamp comes last.
        for (let pass = 0; pass < 3; pass++) {
          let moved = false;
          for (const d of avoid) {
            const dx = b.x - d.x;
            const dz = b.z - d.z;
            const dist = Math.hypot(dx, dz);
            if (dist < d.r + 0.01) {
              b.x = dist > 1e-6 ? d.x + (dx / dist) * (d.r + 0.02) : d.x + d.r + 0.02;
              b.z = dist > 1e-6 ? d.z + (dz / dist) * (d.r + 0.02) : d.z;
              moved = true;
            }
          }
          b.x = clamp(b.x, area.minX, area.maxX);
          b.z = clamp(b.z, area.minZ, area.maxZ);
          if (!moved) break;
        }
        b.flap += b.flapRate * step;
      }
      place();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeAll(root);
    },
    setReducedMotion(next: boolean): void {
      reduced = next;
      syncMotion();
    },
  };
}

// ---- birds ---------------------------------------------------------------------------------------

interface Bird {
  angle: number;
  /** +1 or -1: which way round the circle. */
  dir: number;
  orbit: number;
  omega: number;
  baseY: number;
  bobRate: number;
  bobPhase: number;
  wobblePhase: number;
  flap: number;
  flapRate: number;
  glideRate: number;
  glidePhase: number;
  bank: number;
}

/** One wing, swept back, with a sliver of the body at the root: the mirror instance completes both. */
function birdWing(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0.3, // root, leading edge
        0, 0, -0.24, // root, trailing edge
        1.15, 0, -0.52, // tip, trailing
        1.0, 0, -0.1, // tip, leading
        0, 0, 0.5, // nose
        0, 0, -0.55, // tail
        0.09, 0, -0.05, // body, side
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  return geometry;
}

export function createBirds(options: BirdOptions = {}): Critters {
  const root = new THREE.Group();
  root.name = 'birds';
  const tier = options.tier ?? getQuality();
  const count = clampCount(options.count, 4, MAX_BIRDS);
  if (tier === 'low' || count === 0) return emptyCritters(root);

  const rng = mulberry32(options.seed ?? 1);
  const radius = Math.max(0, options.radius ?? 120);
  const height = Math.max(0, options.height ?? 26);
  const cx = options.center?.x ?? 0;
  const cz = options.center?.z ?? 0;
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 1.8;

  const flock: Bird[] = [];
  for (let i = 0; i < count; i++) {
    const orbit = radius * between(rng, BIRD_ORBIT[0], BIRD_ORBIT[1]);
    const speed = between(rng, 3.5, 5);
    flock.push({
      angle: rng() * TAU,
      dir: rng() < 0.75 ? 1 : -1,
      orbit,
      omega: speed / Math.max(orbit, 1),
      baseY: height * (1 + (rng() * 2 - 1) * BIRD_HEIGHT_SPREAD),
      bobRate: between(rng, 0.3, 0.7),
      bobPhase: rng() * TAU,
      wobblePhase: rng() * TAU,
      flap: rng() * TAU,
      flapRate: between(rng, 1.6, 2.4) * TAU,
      glideRate: between(rng, 0.12, 0.22),
      glidePhase: rng() * TAU,
      bank: between(rng, 0.18, 0.3),
    });
  }

  const mesh = wingMesh('bird-wings', birdWing(), count, BIRD_COLORS, rng, false, false);
  root.add(mesh);

  let time = 0;
  let reduced = options.reducedMotion ?? systemPrefersReducedMotion();
  let disposed = false;

  const place = (): void => {
    flock.forEach((b, i) => {
      // The orbit breathes a little, never past `radius`: an orbit is at most 0.9 of it, and 5 percent more is 0.945.
      const r = b.orbit * (1 + 0.05 * Math.sin(time * 0.17 + b.wobblePhase));
      const x = cx + Math.cos(b.angle) * r;
      const z = cz + Math.sin(b.angle) * r;
      const y = b.baseY + BIRD_BOB * Math.sin(time * b.bobRate + b.bobPhase);
      // Forward is the tangent of the circle: (-sin, cos) going one way, the opposite the other.
      const yaw = Math.atan2(-Math.sin(b.angle) * b.dir, Math.cos(b.angle) * b.dir);
      // Flap in bursts: the burst envelope rises from 0 (gliding, wings held) to 1.
      const burst = clamp((Math.sin(time * b.glideRate * TAU + b.glidePhase) + 0.2) / 0.8, 0, 1);
      const flap = BIRD_DIHEDRAL + burst * 0.7 * Math.sin(b.flap) - (1 - burst) * 0.05;
      setWings(mesh, i, x, y, z, yaw, b.dir * b.bank, flap, scale);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place();

  const syncMotion = (): void => {
    root.visible = !reduced;
  };
  syncMotion();

  return {
    root,
    update(dt: number): void {
      if (disposed || reduced) return;
      const step = safeStep(dt);
      time += step;
      for (const b of flock) {
        b.angle = (b.angle + b.dir * b.omega * step) % TAU;
        b.flap += b.flapRate * step;
      }
      place();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeAll(root);
    },
    setReducedMotion(next: boolean): void {
      reduced = next;
      syncMotion();
    },
  };
}

// ---- fireflies -----------------------------------------------------------------------------------

interface Firefly {
  /** Where its loop is centered, relative to the swarm center. */
  hx: number;
  hz: number;
  hy: number;
  /** How far the loop reaches on each axis. */
  ax: number;
  az: number;
  ay: number;
  /** Radians per second on each axis, a second slower harmonic, and where in the cycle it starts. */
  wx: number;
  wy: number;
  wz: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qz: number;
  /** Blink rate in cycles per second and the starting phase. */
  blink: number;
  blinkPhase: number;
}

/** A 16 by 16 soft white dot, from raw pixels so it needs no canvas (the tests run in node). */
function glowDotTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = Math.hypot((px + 0.5) / size - 0.5, (py + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const i = (py * size + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createFireflies(options: FireflyOptions = {}): Critters {
  const root = new THREE.Group();
  root.name = 'fireflies';
  const count = clampCount(options.count, 14, MAX_FIREFLIES);
  if (count === 0) return emptyCritters(root);

  const rng = mulberry32(options.seed ?? 1);
  const radius = Math.max(0, options.radius ?? 8);
  const cx = options.center?.x ?? 0;
  const cz = options.center?.z ?? 0;
  const cy = options.center?.y ?? 0;

  // A loop's center is within 0.7 of the radius, and the loop reaches at most 0.2 of it on each
  // axis (0.28 on a diagonal), so a firefly is never farther than 0.98 of the radius from the center.
  const bugs: Firefly[] = Array.from({ length: count }, () => {
    const angle = rng() * TAU;
    const home = radius * 0.7 * Math.sqrt(rng());
    return {
      hx: Math.cos(angle) * home,
      hz: Math.sin(angle) * home,
      hy: between(rng, 0.9, 2.0),
      ax: radius * between(rng, 0.08, 0.2),
      az: radius * between(rng, 0.08, 0.2),
      ay: between(rng, 0.15, 0.4),
      wx: between(rng, 0.12, 0.3),
      wy: between(rng, 0.2, 0.5),
      wz: between(rng, 0.12, 0.3),
      px: rng() * TAU,
      py: rng() * TAU,
      pz: rng() * TAU,
      qx: rng() * TAU,
      qz: rng() * TAU,
      blink: between(rng, 0.2, 0.5),
      blinkPhase: rng() * TAU,
    };
  });

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.2,
    map: glowDotTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'fireflies-points';
  points.frustumCulled = false; // they drift every frame, so the starting bounds would be wrong
  root.add(points);

  let time = 0;
  let reduced = options.reducedMotion ?? systemPrefersReducedMotion();
  let disposed = false;

  const place = (): void => {
    bugs.forEach((b, i) => {
      // A main loop plus a quieter second harmonic: still within `a` on each axis, but not a plain ellipse.
      positions[i * 3] = cx + b.hx + b.ax * (0.75 * Math.sin(time * b.wx + b.px) + 0.25 * Math.sin(time * b.wx * 2.3 + b.qx));
      positions[i * 3 + 1] = cy + b.hy + b.ay * Math.sin(time * b.wy + b.py);
      positions[i * 3 + 2] = cz + b.hz + b.az * (0.75 * Math.sin(time * b.wz + b.pz) + 0.25 * Math.sin(time * b.wz * 1.9 + b.qz));
      const pulse = 0.5 + 0.5 * Math.sin(time * b.blink * TAU + b.blinkPhase);
      const glow = (0.08 + 0.92 * pulse * pulse) * FIREFLY_PEAK;
      colors[i * 3] = FIREFLY_COLOR[0] * glow;
      colors[i * 3 + 1] = FIREFLY_COLOR[1] * glow;
      colors[i * 3 + 2] = FIREFLY_COLOR[2] * glow;
    });
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  };
  place();

  const syncMotion = (): void => {
    root.visible = !reduced;
  };
  syncMotion();

  return {
    root,
    update(dt: number): void {
      if (disposed || reduced) return;
      time += safeStep(dt);
      place();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeAll(root);
    },
    setReducedMotion(next: boolean): void {
      reduced = next;
      syncMotion();
    },
  };
}
