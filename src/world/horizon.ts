import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ZoneId } from '../activities/types';
import { getQuality, type QualityTier } from '../engine/quality';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint } from './bounds';
import { applyGroundTexture, createGroundTexture, edgeGrassColor, type RGB } from './ground';
import { TERRAIN_OUTER, zoneTerrain, type Terrain } from './terrain';

/**
 * The horizon: what a Scout sees past the edge of the zone, so the world does not end at a wall of
 * trees and a flat green plane. Everything here sits beyond the walkable square and is built once,
 * with no per-frame cost.
 *
 *   hills      one displaced, vertex-colored ring from the ground's edge out to `TERRAIN_OUTER` (70)
 *              units. It continues the ground plane (same height function, same edge color), green
 *              near and blue-green far.
 *   tree line  one InstancedMesh of cheap, dark, slightly blue conifer silhouettes, 45 to 90 units out.
 *   peaks      (outdoor zones) a few far mountains, 100 to 190 units out, blue-grey with pale caps.
 *   rooftops   (town zones) one InstancedMesh of distant houses and church towers, 50 to 95 units
 *              out, instead of the mountains.
 *
 * Every material uses the scene's fog, so it all fades into the sky. The fog ends at 115 units, so
 * for things beyond 85 the fog is capped (`capFog`): a mountain keeps some of its own blue-grey
 * instead of vanishing into a flat horizon color, which is what makes it read as far away.
 *
 * Budget per zone: at most `HORIZON_MAX_DRAW_CALLS` (6) draw calls and `HORIZON_MAX_TRIANGLES`
 * (30 000) triangles. In practice 3 draw calls and under 15 000 triangles.
 *
 * Quality (see engine/quality.ts): the low tier skips the peaks and keeps half the distant trees.
 * Instances are laid out so any first half is spread evenly all the way around.
 */

export const HORIZON_MAX_DRAW_CALLS = 6;
export const HORIZON_MAX_TRIANGLES = 30_000;

/** The tree line stands between these distances from the zone center (world units). */
export const HORIZON_TREE_RANGE: readonly [number, number] = [45, 90];
/** Mountain summits stand between these distances from the zone center. */
export const HORIZON_PEAK_RANGE: readonly [number, number] = [100, 190];
/** Distant houses stand between these distances from the zone center. */
export const HORIZON_ROOF_RANGE: readonly [number, number] = [50, 95];
/** The ground plane ends this far beyond the walkable square unless a zone says otherwise. */
export const HORIZON_DEFAULT_GROUND_MARGIN = 7;

export type HorizonKind = 'outdoor' | 'town';

export interface HorizonOptions {
  zoneId: ZoneId;
  /** Half-size of the walkable square (the zone's bounds). Nothing here comes closer than this. */
  half: number;
  /** Seed for every random choice; the same seed always builds the same horizon. */
  seed: number;
  /** `outdoor` gets far mountains, `town` gets distant rooftops instead. */
  kind: HorizonKind;
  /** The zone's grass color (hex), so the hills start from the same green. Default 0x5f9e45. */
  grass?: number;
  /** Half the side of the zone's ground plane: where the hills start. Default `half + 7`. */
  groundHalf?: number;
  /** Quads per side of the zone's ground plane (the hills' inner edge matches it). Default 48. */
  groundSegments?: number;
  /** The land the zone's ground uses. Default `zoneTerrain(zoneId, half, seed)`, which is what zones pass to `createGround`. */
  terrain?: Terrain;
  /** Defaults to `getQuality()`. */
  quality?: QualityTier;
}

export interface Horizon {
  /** The group holding every horizon mesh, named `horizon`. Already added to the root. */
  readonly group: THREE.Group;
  /** Apply a quality tier: `low` hides the peaks and keeps half the distant trees. */
  setQuality(tier: QualityTier): void;
}

/** Draw calls and triangles of what is visible under `root` (instances counted). */
export function horizonStats(root: THREE.Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0;
  let triangles = 0;
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    drawCalls++;
    const geometry = mesh.geometry;
    const perInstance = (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    triangles += perInstance * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  });
  return { drawCalls, triangles };
}

/** Apply a quality tier to the horizon under `root` (a zone root), if it has one. */
export function setHorizonQuality(root: THREE.Object3D, tier: QualityTier): void {
  const group = root.getObjectByName('horizon');
  const apply = group?.userData.setQuality as ((tier: QualityTier) => void) | undefined;
  apply?.(tier);
}

// ---- per-zone look ------------------------------------------------------------------------------

interface Style {
  /** Distant trees on the high and medium tiers (the low tier keeps half). */
  trees: number;
  /** Share of the tree line that has turned autumn colors. */
  autumn: number;
  peaks: number;
  houses: number;
  /** Where the hills end up, blue-green by default. */
  farHill: number;
}

const STYLES: Readonly<Record<ZoneId, Style>> = {
  'base-camp': { trees: 300, autumn: 0.04, peaks: 6, houses: 0, farHill: 0x4a8b78 },
  'nature-trail': { trees: 340, autumn: 0.03, peaks: 6, houses: 0, farHill: 0x468a76 },
  'fitness-field': { trees: 200, autumn: 0.03, peaks: 5, houses: 0, farHill: 0x4f8e78 },
  'campfire-circle': { trees: 320, autumn: 0.42, peaks: 5, houses: 0, farHill: 0x7b8a52 },
  'town-square': { trees: 90, autumn: 0.03, peaks: 0, houses: 90, farHill: 0x558f7a },
  'safety-station': { trees: 120, autumn: 0.03, peaks: 0, houses: 80, farHill: 0x558f7a },
};

const GOLDEN = 0.6180339887498949;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rgbOf(hex: number): RGB {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ---- fog ----------------------------------------------------------------------------------------

/**
 * Keep at most `cap` (0 to 1) of the scene fog on this material. The fog is a straight ramp that
 * reaches 100 percent at its far distance, and far things such as mountains sit past that, so
 * without a cap they would be exactly the horizon color and invisible. The material still uses the
 * scene's fog color and near distance, so it fades in step with everything else.
 */
export function capFog<T extends THREE.Material>(material: T, cap: number): T {
  const key = `fog-cap:${cap.toFixed(2)}`;
  material.userData.fogCap = cap;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = min( 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth ), ${cap.toFixed(3)} );
  #else
    float fogFactor = min( smoothstep( fogNear, fogFar, vFogDepth ), ${cap.toFixed(3)} );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,
    );
  };
  return material;
}

// ---- the hills ----------------------------------------------------------------------------------

const HILL_ROWS = 18;
/** Hill color reaches its far (blue-green) value by this distance, holds it, then hands back to grass by the outer edge. */
const HILL_FAR_BLEND_START = 50;
const HILL_FAR_BLEND_END = 56;

/**
 * The ring of hills as one indexed mesh: square rings from `innerHalf` (the ground plane's edge) out
 * to `TERRAIN_OUTER`, with the same number of columns per side as the ground plane so the two share
 * their edge vertices. Heights, normals and the edge color come from the same functions the ground
 * uses, so there is no seam.
 */
function hillsGeometry(terrain: Terrain, innerHalf: number, segments: number, grass: RGB, farHill: RGB): THREE.BufferGeometry {
  const columns = segments * 4;
  const rows = HILL_ROWS;
  const count = columns * (rows + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const outer = Math.max(TERRAIN_OUTER, innerHalf + 10);

  for (let row = 0; row <= rows; row++) {
    // Rows bunch up near the ground, where the view is closest and the slope matters most.
    const t = Math.pow(row / rows, 1.35);
    const half = innerHalf + (outer - innerHalf) * t;
    for (let col = 0; col < columns; col++) {
      const p = perimeterPoint(col / columns, half);
      const y = terrain.height(p.x, p.z);
      const [nx, ny, nz] = terrain.normal(p.x, p.z);
      const i = row * columns + col;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = p.z;
      normals[i * 3] = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = nz;

      // Green at the ground's edge (the very same color), blue-green out in the middle distance, and
      // back to plain grass at the outer edge, where the flat apron takes over without a color seam.
      // Crests are a touch lighter.
      const square = Math.max(Math.abs(p.x), Math.abs(p.z));
      const near = edgeGrassColor(grass, p.x, p.z);
      const handOver = 1 - smoothstep(HILL_FAR_BLEND_END, outer, square);
      const far = smoothstep(innerHalf, HILL_FAR_BLEND_START, square) * handOver * 0.85;
      const lift = 1 + 0.14 * (Math.min(1, y / 8) - 0.3) * smoothstep(innerHalf, innerHalf + 10, square) * handOver;
      colors[i * 3] = (near[0] + (farHill[0] - near[0]) * far) * lift;
      colors[i * 3 + 1] = (near[1] + (farHill[1] - near[1]) * far) * lift;
      colors[i * 3 + 2] = (near[2] + (farHill[2] - near[2]) * far) * lift;
    }
  }

  const index: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const next = (col + 1) % columns;
      const a = row * columns + col;
      const b = row * columns + next;
      const c = (row + 1) * columns + col;
      const d = (row + 1) * columns + next;
      index.push(a, b, c, b, d, c); // counter-clockwise seen from above
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  return geometry;
}

// ---- the tree line ------------------------------------------------------------------------------

/** Three stacked, open cones, 1.1 tall and 1 wide (radius 0.5) at the foot: a conifer with no trunk. */
function coniferGeometry(): THREE.BufferGeometry {
  const tiers: ReadonlyArray<readonly [number, number, number]> = [
    [0.5, 0.55, 0.05],
    [0.4, 0.5, 0.35],
    [0.28, 0.45, 0.65],
  ];
  const parts = tiers.map(([radius, height, y]) => new THREE.ConeGeometry(radius, height, 6, 1, true).translate(0, y + height / 2, 0));
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.ConeGeometry(0.5, 1.1, 6, 1, true).translate(0, 0.55, 0);
}

interface Spread {
  /** Position `i` of an endless low-discrepancy sequence of angles, so any prefix is evenly spread. */
  angle(i: number): number;
}

function goldenSpread(offset: number): Spread {
  return { angle: (i) => (((i * GOLDEN + offset) % 1) + 1) % 1 * Math.PI * 2 };
}

function treeLine(terrain: Terrain, seed: number, style: Style, quality: QualityTier): THREE.InstancedMesh {
  const rng = mulberry32(seed);
  const spread = goldenSpread(rng());
  const phaseA = rng() * Math.PI * 2;
  const phaseB = rng() * Math.PI * 2;
  const total = style.trees;
  const [near, far] = HORIZON_TREE_RANGE;

  const mesh = new THREE.InstancedMesh(
    coniferGeometry(),
    capFog(new THREE.MeshLambertMaterial({ color: 0xffffff }), 0.82),
    total,
  );
  mesh.name = 'horizon-trees';
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let made = 0;
  for (let i = 0; made < total && i < total * 8; i++) {
    const angle = spread.angle(i) + (rng() - 0.5) * 0.05;
    // Woods come in stands with gaps between them: keep a candidate more often where `stand` is high.
    const stand = 0.5 + 0.5 * Math.sin(angle * 3 + phaseA) * Math.sin(angle * 7 + phaseB);
    const radius = near + (far - near) * Math.pow(rng(), 0.85);
    if (rng() > 0.25 + 0.75 * stand) continue;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const tall = 4.5 + rng() * 5;
    const width = tall * (0.26 + rng() * 0.1);
    dummy.position.set(x, terrain.height(x, z) - 0.3, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(width, tall / 1.1, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(made, dummy.matrix);
    // Darker and a little bluer than the zone's own trees (hue about 0.43, where they sit near 0.33).
    if (rng() < style.autumn) color.setHSL(0.06 + rng() * 0.06, 0.5, 0.28 + rng() * 0.08);
    else color.setHSL(0.41 + rng() * 0.05, 0.3, 0.15 + rng() * 0.07);
    mesh.setColorAt(made, color);
    made++;
  }
  mesh.count = made;
  mesh.userData.fullCount = made;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  if (quality === 'low') mesh.count = Math.ceil(made / 2);
  return mesh;
}

// ---- the mountains ------------------------------------------------------------------------------

/** Ring profile of a peak: [share of the base radius, share of the height]. */
const PEAK_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.78, 0.22],
  [0.56, 0.45],
  [0.36, 0.66],
  [0.18, 0.84],
];
const PEAK_SIDES = 10;
/** The base of every peak is sunk this far below the ground, so its edge is never seen. */
const PEAK_SINK = 8;

/** Paint a vertex of a peak by its height: green-grey foot, blue-grey flanks, a pale cap near the top. */
function peakColor(share: number, capped: boolean, out: THREE.Color, shade: number): THREE.Color {
  const foot = new THREE.Color(0x587a72);
  const flank = new THREE.Color(0x71869e);
  const high = new THREE.Color(0x9aaec3);
  const cap = new THREE.Color(0xe8eff7);
  if (share < 0.35) out.copy(foot).lerp(flank, share / 0.35);
  else if (share < 0.75) out.copy(flank).lerp(high, (share - 0.35) / 0.4);
  else if (capped) out.copy(high).lerp(cap, smoothstep(0.74, 0.84, share));
  else out.copy(high);
  return out.multiplyScalar(shade);
}

function peakGeometry(rng: () => number, radius: number, height: number, capped: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const ringCount = PEAK_PROFILE.length;
  const grid: Array<Array<{ x: number; y: number; z: number; share: number; shade: number }>> = [];
  for (let r = 0; r < ringCount; r++) {
    const [rr, hh] = PEAK_PROFILE[r]!;
    const ring: Array<{ x: number; y: number; z: number; share: number; shade: number }> = [];
    for (let k = 0; k < PEAK_SIDES; k++) {
      const angle = ((k + (rng() - 0.5) * 0.5) / PEAK_SIDES) * Math.PI * 2;
      const reach = rr * radius * (0.82 + rng() * 0.3);
      const y = hh * height * (1 + (rng() - 0.5) * 0.08) - (r === 0 ? PEAK_SINK : 0);
      ring.push({ x: Math.cos(angle) * reach, y, z: Math.sin(angle) * reach, share: hh, shade: 0.92 + rng() * 0.16 });
    }
    grid.push(ring);
  }
  const apex = { x: (rng() - 0.5) * radius * 0.08, y: height, z: (rng() - 0.5) * radius * 0.08, share: 1, shade: 1 };

  const push = (v: { x: number; y: number; z: number; share: number; shade: number }): void => {
    positions.push(v.x, v.y, v.z);
    peakColor(v.share, capped, color, v.shade);
    colors.push(color.r, color.g, color.b);
  };
  // Counter-clockwise seen from outside: angles increase counter-clockwise seen from above, so the
  // quad (this ring k, this ring k+1, next ring k+1, next ring k) runs outward-facing when listed so.
  for (let r = 0; r < ringCount - 1; r++) {
    for (let k = 0; k < PEAK_SIDES; k++) {
      const k2 = (k + 1) % PEAK_SIDES;
      const a = grid[r]![k]!;
      const b = grid[r]![k2]!;
      const c = grid[r + 1]![k]!;
      const d = grid[r + 1]![k2]!;
      push(a), push(c), push(b);
      push(b), push(c), push(d);
    }
  }
  const top = grid[ringCount - 1]!;
  for (let k = 0; k < PEAK_SIDES; k++) {
    const k2 = (k + 1) % PEAK_SIDES;
    push(top[k]!), push(apex), push(top[k2]!);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Where one far mountain stands, kept on the mesh's `userData.summits` for tests and debugging. */
export interface Summit {
  x: number;
  z: number;
  /** Height of the summit above the ground. */
  height: number;
  /** Radius of the foot. */
  radius: number;
  /** Distance of the summit from the zone center. */
  distance: number;
}

/** A handful of far mountains in one mesh. At least one stands to the north (-z), where the Scout starts out looking. */
function peaks(seed: number, count: number): THREE.Mesh {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const summits: Summit[] = [];
  const start = rng() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const slot = (Math.PI * 2) / count;
    const angle = k === 0 ? -Math.PI / 2 + (rng() - 0.5) * 0.5 : start + k * slot + (rng() - 0.5) * slot * 0.5;
    // 18 to 38 tall: at 120 to 190 units that tops out around 14 degrees, inside the top of the screen (about 16).
    const height = 18 + rng() * 20;
    const radius = height * (0.95 + rng() * 0.5);
    // The foot stays beyond 85 units, so a peak never crowds the hills.
    const distance = Math.min(HORIZON_PEAK_RANGE[1], Math.max(HORIZON_PEAK_RANGE[0] + rng() * 90, 85 + radius + 6));
    summits.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, height, radius, distance });
  }
  // The tallest peak always wears a pale cap, and so does any other above 30.
  const tallest = summits.reduce((best, s, i) => (s.height > summits[best]!.height ? i : best), 0);
  summits.forEach((s, i) => {
    const geometry = peakGeometry(rng, s.radius, s.height, i === tallest || s.height > 30);
    geometry.translate(s.x, 0, s.z);
    parts.push(geometry);
  });
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(
    merged ?? new THREE.BufferGeometry(),
    capFog(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.7),
  );
  mesh.name = 'horizon-peaks';
  mesh.userData.summits = summits;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the rooftops -------------------------------------------------------------------------------

const WALL_TINTS = [0xf3e6c8, 0xd9c8a4, 0xc9d6e2, 0xe8d3c4, 0xb9c4a8, 0xe9e2d2];

/** A unit house: a 1 by 1 by 1 box with a four-sided roof on top (1.55 tall in all). Walls white, roof dark, so a tint colors the walls. */
function houseGeometry(): THREE.BufferGeometry {
  const wall = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(0.75, 0.55, 4, 1).rotateY(Math.PI / 4).translate(0, 1.275, 0);
  const paint = (geometry: THREE.BufferGeometry, hex: number): void => {
    const c = new THREE.Color(hex);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };
  paint(wall, 0xffffff);
  paint(roof, 0x8c4f40);
  const merged = mergeGeometries([wall, roof]);
  wall.dispose();
  roof.dispose();
  return merged ?? new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

function rooftops(terrain: Terrain, seed: number, count: number): THREE.InstancedMesh {
  const rng = mulberry32(seed);
  const spread = goldenSpread(rng());
  const mesh = new THREE.InstancedMesh(
    houseGeometry(),
    capFog(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.8),
    count,
  );
  mesh.name = 'horizon-rooftops';
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const [near, far] = HORIZON_ROOF_RANGE;
  for (let i = 0; i < count; i++) {
    const angle = spread.angle(i) + (rng() - 0.5) * 0.06;
    const radius = near + (far - near) * Math.pow(rng(), 0.9);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Mostly houses, now and then a bigger block or a slim church tower with a spire.
    const roll = rng();
    let w: number, d: number, h: number;
    if (roll < 0.08) {
      w = 10 + rng() * 4;
      d = 8 + rng() * 4;
      h = 6 + rng() * 4;
    } else if (roll < 0.13) {
      w = 2.6 + rng();
      d = w;
      h = 9 + rng() * 5;
    } else {
      w = 5 + rng() * 5;
      d = 5 + rng() * 4;
      h = 3.2 + rng() * 3;
    }
    dummy.position.set(x, terrain.height(x, z) - 0.4, z);
    dummy.rotation.set(0, Math.floor(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.15, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(WALL_TINTS[Math.floor(rng() * WALL_TINTS.length)]!));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- assembly -----------------------------------------------------------------------------------

/**
 * Add the horizon to a zone's root. Call it once from the zone builder. `half` is the half-size of
 * the walkable square; pass the same `terrain` (or the same zone id, half and seed) that the zone's
 * `createGround` got, and the ground's half-size and segments, so the hills continue the ground.
 */
export function addHorizon(root: THREE.Object3D, opts: HorizonOptions): Horizon {
  const style = STYLES[opts.zoneId];
  const terrain = opts.terrain ?? zoneTerrain(opts.zoneId, opts.half, opts.seed);
  const groundHalf = opts.groundHalf ?? opts.half + HORIZON_DEFAULT_GROUND_MARGIN;
  const segments = opts.groundSegments ?? 48;
  const quality = opts.quality ?? getQuality();
  const grass = rgbOf(opts.grass ?? 0x5f9e45);

  const group = new THREE.Group();
  group.name = 'horizon';

  const hillMaterial = applyGroundTexture(new THREE.MeshLambertMaterial({ vertexColors: true }), createGroundTexture(), 'grass');
  const hills = new THREE.Mesh(hillsGeometry(terrain, groundHalf, segments, grass, rgbOf(style.farHill)), hillMaterial);
  hills.name = 'horizon-hills';
  hills.frustumCulled = false;
  group.add(hills);

  const trees = treeLine(terrain, opts.seed + 1, style, quality);
  group.add(trees);

  let mountains: THREE.Mesh | null = null;
  if (opts.kind === 'outdoor' && style.peaks > 0) {
    mountains = peaks(opts.seed + 2, style.peaks);
    mountains.visible = quality !== 'low';
    group.add(mountains);
  }
  if (opts.kind === 'town' && style.houses > 0) group.add(rooftops(terrain, opts.seed + 3, style.houses));

  const setQuality = (tier: QualityTier): void => {
    const full = (trees.userData.fullCount as number | undefined) ?? trees.count;
    trees.count = tier === 'low' ? Math.ceil(full / 2) : full;
    if (mountains) mountains.visible = tier !== 'low';
  };
  group.userData.setQuality = setQuality;

  root.add(group);
  return { group, setQuality };
}
