import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import type { Bounds } from './bounds';
import { circlesAt, TREE_TRUNK_RADIUS, type CircleCollider } from './collide';

/** Seeded random source returning floats in [0, 1), for example `mulberry32(2026)`. */
export type Rng = () => number;

export interface Spot {
  x: number;
  z: number;
}

/** A prop that needs per-frame animation. */
export interface AnimatedProp {
  root: THREE.Group;
  update(dt: number): void;
}

const dummy = new THREE.Object3D();

function lambert(color: number, flatShading = true): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading });
}

/** Fractional part, for cheap repeatable "random" numbers from an index. */
function frac(v: number): number {
  return v - Math.floor(v);
}

// ---- instanced props ----------------------------------------------------------------------------

/**
 * A stand of low-poly pine trees, one per spot. Size, turn, and leaf color vary using `rng`, so
 * the same seed always gives the same grove. Two draw calls total (trunks, crowns).
 */
export function tree(rng: Rng, spots: readonly Spot[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 6).translate(0, 1, 0);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x7b5230), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, lambert(0xffffff), spots.length);
  const leaf = new THREE.Color();

  spots.forEach((spot, i) => {
    const scale = 0.8 + rng() * 0.7;
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
    leaf.setHSL(0.36 + rng() * 0.04, 0.45, 0.22 + rng() * 0.08);
    crowns.setColorAt(i, leaf);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  setShadowCasting(trunks, true, true);
  setShadowCasting(crowns, true, true);
  group.add(trunks, crowns);
  return group;
}

/** Gray boulders, one per spot, squashed and turned using `rng`. One draw call. */
export function rock(rng: Rng, spots: readonly Spot[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.8, 0).translate(0, 0.35, 0),
    lambert(0x8a8f94),
    spots.length,
  );
  mesh.name = 'rocks';
  spots.forEach((spot, i) => {
    const s = 0.7 + rng() * 0.9;
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.6 + rng() * 0.3), s * (0.8 + rng() * 0.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  setShadowCasting(mesh, true, true);
  return mesh;
}

/**
 * Trunk-sized colliders for a stand of trees: one circle per spot, the trunk and not the crown.
 * Pass the very same `spots` given to `tree(rng, spots)` and `scatterModels(..., spots, ...)`, so
 * the colliders can never drift from the trees.
 */
export function treeColliders(spots: readonly Spot[], radius = TREE_TRUNK_RADIUS): CircleCollider[] {
  return circlesAt(spots, radius);
}

/** What a boulder at a spot blocks: a bit under the widest model (rocks differ a lot in size). */
export const ROCK_COLLIDER_RADIUS = 0.9;

/**
 * Boulder-sized colliders for `rock(rng, spots)` and the rock models scattered over the same
 * `spots`: one circle per spot. Pass the very same list so the colliders can never drift.
 */
export function rockColliders(spots: readonly Spot[], radius = ROCK_COLLIDER_RADIUS): CircleCollider[] {
  return circlesAt(spots, radius);
}

// ---- model-backed props -------------------------------------------------------------------------

/** Where one copy of a model goes. `scale` multiplies the size set in the asset manifest. */
export interface Placement {
  x: number;
  z: number;
  /** Turn about the up axis, in radians. */
  yaw?: number;
  scale?: number;
}

export interface ShadowOptions {
  /** Cast shadows from the sun. Default true. */
  cast?: boolean;
  /** Receive shadows from the sun. Default true. */
  receive?: boolean;
}

/**
 * One InstancedMesh holding a copy of model `id` at every placement. Needs `assets.has(id)` and a
 * single-static-mesh model (trees, rocks, tents). Returns undefined if the model cannot be instanced.
 * Casts and receives sun shadows unless `shadows` says otherwise.
 */
export function instancedModel(
  id: string,
  placements: readonly Placement[],
  shadows: ShadowOptions = {},
): THREE.InstancedMesh | undefined {
  if (placements.length === 0) return undefined;
  const mesh = assets.instanced(id, placements.length);
  if (!mesh) return undefined;
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, p.yaw ?? 0, 0);
    dummy.scale.setScalar(p.scale ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  setShadowCasting(mesh, shadows.cast ?? true, shadows.receive ?? true);
  return mesh;
}

/**
 * Scatter loaded models over `spots`: each spot picks one of `ids` at random, then gets a random
 * turn and a size in `scale` (a [min, max] multiplier). One draw call per model id used. Ids that
 * are not loaded are skipped; returns null when none are, so the caller keeps its primitive props.
 */
export function scatterModels(
  name: string,
  ids: readonly string[],
  spots: readonly Spot[],
  rng: Rng,
  scale: readonly [number, number],
  shadows: ShadowOptions = {},
): THREE.Group | null {
  const usable = ids.filter((id) => assets.has(id));
  if (usable.length === 0) return null;
  const buckets: Placement[][] = usable.map(() => []);
  for (const spot of spots) {
    const pick = Math.floor(rng() * usable.length);
    buckets[pick]!.push({
      x: spot.x,
      z: spot.z,
      yaw: rng() * Math.PI * 2,
      scale: scale[0] + rng() * (scale[1] - scale[0]),
    });
  }
  const group = new THREE.Group();
  group.name = name;
  usable.forEach((id, i) => {
    const mesh = instancedModel(id, buckets[i]!, shadows);
    if (mesh) group.add(mesh);
  });
  return group.children.length > 0 ? group : null;
}

// ---- plants -------------------------------------------------------------------------------------

/** A circle that plants keep out of: a clearing, a path, or the room around a prop. */
export interface AvoidCircle {
  x: number;
  z: number;
  radius: number;
}

export interface ScatterPlantsOptions {
  /** Model ids to use instead of the default `plant.*` mix. Each is picked equally often. */
  ids?: readonly string[];
  /**
   * Multiplier on `count`: the zones ask for a number, and this thins it (0.6 keeps 60 percent).
   * Default `DEFAULT_PLANT_DENSITY`. Pass 1 to get exactly `count` (when there is room).
   */
  density?: number;
  /**
   * Gather plants near the edges of the `avoid` circles. A candidate that is `d` units outside the
   * nearest circle is kept with probability exp(-d / edgeFalloff), so about a third survive at
   * `edgeFalloff` units out. Leave it out for an even scatter.
   */
  edgeFalloff?: number;
}

/**
 * How much of the asked-for plant count `scatterPlants` makes unless `density` says otherwise. The
 * first scatter was dense enough to read as clutter, so it is cut by 40 percent.
 */
export const DEFAULT_PLANT_DENSITY = 0.6;

/** How often each `plant.*` model turns up: lots of grass, some flowers and bushes, the odd mushroom. */
const PLANT_CHOICES: ReadonlyArray<{ id: string; weight: number }> = [
  { id: 'plant.grass', weight: 4 },
  { id: 'plant.grass.large', weight: 3 },
  { id: 'plant.flower.yellow', weight: 1.2 },
  { id: 'plant.flower.red', weight: 1 },
  { id: 'plant.flower.purple', weight: 1 },
  { id: 'plant.bush', weight: 1.2 },
  { id: 'plant.mushroom', weight: 0.5 },
  { id: 'plant.bush.large', weight: 0.4 },
];

/** Rejection-sample up to `count` spots inside `bounds` and outside every `avoid` circle. */
function plantSpots(
  rng: Rng,
  count: number,
  bounds: Bounds,
  avoid: readonly AvoidCircle[],
  edgeFalloff: number | undefined,
): Spot[] {
  const spots: Spot[] = [];
  const maxAttempts = count * 30;
  for (let attempt = 0; attempt < maxAttempts && spots.length < count; attempt++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
    let nearest = Infinity;
    let blocked = false;
    for (const a of avoid) {
      const outside = Math.hypot(x - a.x, z - a.z) - a.radius;
      if (outside < 0) {
        blocked = true;
        break;
      }
      nearest = Math.min(nearest, outside);
    }
    if (blocked) continue;
    if (edgeFalloff !== undefined && edgeFalloff > 0 && avoid.length > 0 && rng() > Math.exp(-nearest / edgeFalloff)) continue;
    spots.push({ x, z });
  }
  return spots;
}

/** Three thin blades in one geometry: a tiny tuft of grass. */
function tuftGeometry(): THREE.BufferGeometry {
  const blades = [
    { ox: -0.07, oz: 0.0, tilt: 0.22, yaw: 0.0 },
    { ox: 0.06, oz: 0.03, tilt: -0.28, yaw: 2.1 },
    { ox: 0.0, oz: -0.07, tilt: 0.16, yaw: 4.2 },
  ].map((b) =>
    new THREE.ConeGeometry(0.06, 0.55, 3)
      .translate(0, 0.275, 0)
      .rotateZ(b.tilt)
      .rotateY(b.yaw)
      .translate(b.ox, 0, b.oz),
  );
  const merged = mergeGeometries(blades);
  for (const blade of blades) blade.dispose();
  return merged ?? new THREE.ConeGeometry(0.1, 0.5, 3).translate(0, 0.25, 0);
}

/** Primitive stand-in: one InstancedMesh of green tufts. */
function tufts(rng: Rng, spots: readonly Spot[]): THREE.InstancedMesh | null {
  if (spots.length === 0) return null;
  const mesh = new THREE.InstancedMesh(tuftGeometry(), lambert(0xffffff), spots.length);
  mesh.name = 'plant-tufts';
  const color = new THREE.Color();
  spots.forEach((spot, i) => {
    const s = 0.7 + rng() * 0.8;
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.8 + rng() * 0.5), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.24 + rng() * 0.08, 0.5, 0.3 + rng() * 0.12);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  setShadowCasting(mesh, false, true);
  return mesh;
}

// ---- plant color --------------------------------------------------------------------------------

/**
 * Every leaf and stem in the Kenney nature kit is painted one bright mint-teal, as a vertex color
 * (linear RGB, as the GLB stores it). Read straight, it looks like cyan clutter on the grass.
 */
const KENNEY_TEAL = new THREE.Color().setRGB(0.173, 0.847, 0.722);
/** The grass green it is shifted to: a little deeper than the ground, so tufts still read against it. */
const PLANT_GREEN = new THREE.Color(0x4e9b3a);
/** What a teal vertex color is multiplied by to land on `PLANT_GREEN`, per channel. */
const PLANT_TINT = new THREE.Color().setRGB(
  PLANT_GREEN.r / KENNEY_TEAL.r,
  PLANT_GREEN.g / KENNEY_TEAL.g,
  PLANT_GREEN.b / KENNEY_TEAL.b,
);

/** True for the kit's teal (and its shades): green at least as strong as blue, both well above red. */
function isKitTeal(r: number, g: number, b: number): boolean {
  return g > 0.3 && g >= b && b >= r * 1.8;
}

/**
 * Multiply every teal vertex color of `geometry` by the teal-to-green tint, in place. Anything
 * else (petals, mushroom caps and stems) is left exactly as painted, so flowers keep their colors.
 * Returns how many vertices were teal and how many there are; a geometry with no vertex colors
 * reports none teal.
 */
export function tintTealVertices(geometry: THREE.BufferGeometry): { teal: number; total: number } {
  const color = geometry.getAttribute('color');
  if (!color) return { teal: 0, total: 0 };
  let teal = 0;
  for (let i = 0; i < color.count; i++) {
    const r = color.getX(i);
    const g = color.getY(i);
    const b = color.getZ(i);
    if (!isKitTeal(r, g, b)) continue;
    color.setXYZ(i, r * PLANT_TINT.r, g * PLANT_TINT.g, b * PLANT_TINT.b);
    teal++;
  }
  if (teal > 0) color.needsUpdate = true;
  return { teal, total: color.count };
}

/**
 * Turn the kit's teal to grass green on a plant mesh made by `instancedModel` (it owns its
 * geometry, so tinting it touches no other mesh and keeps the draw call count as it was). When
 * the whole model is foliage (every vertex teal, as for grass and bushes) and `rng` is given, each
 * instance also gets its own slight shift in hue and lightness, so a field of tufts is not one
 * flat green. Flowers get the stems tinted and the petals untouched, and no per-instance shift.
 */
export function tintPlants(mesh: THREE.InstancedMesh, rng?: Rng): void {
  const { teal, total } = tintTealVertices(mesh.geometry);
  if (!rng || total === 0 || teal < total) return;
  const shifted = new THREE.Color();
  const multiplier = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    shifted.copy(PLANT_GREEN).offsetHSL((rng() * 2 - 1) * 0.025, 0, (rng() - 0.4) * 0.07);
    // The vertex colors already carry the green, so the instance only carries the change from it.
    mesh.setColorAt(i, multiplier.setRGB(shifted.r / PLANT_GREEN.r, shifted.g / PLANT_GREEN.g, shifted.b / PLANT_GREEN.b));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * About `count * density` plants (see `ScatterPlantsOptions.density`; 60 percent by default)
 * scattered over `bounds`, never inside an `avoid` circle. Starts as one InstancedMesh of tiny
 * green tufts (1 draw call) and upgrades itself to the `plant.*` models (grass, flowers, bushes,
 * mushrooms; one draw call per model used, at most 8) when they load, recolored from the kit's
 * teal to grass green (see `tintPlants`). Same seed, same layout. Plants do not cast shadows,
 * they only receive them.
 */
export function scatterPlants(
  rng: Rng,
  count: number,
  bounds: Bounds,
  avoid: readonly AvoidCircle[],
  options: ScatterPlantsOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'plants';
  const wanted = Math.round(Math.max(0, count) * (options.density ?? DEFAULT_PLANT_DENSITY));
  const spots = plantSpots(rng, wanted, bounds, avoid, options.edgeFalloff);
  // A separate stream for the models, so the layout is the same whichever art is showing.
  const modelRng = mulberry32(Math.floor(rng() * 0x100000000));
  const placeholder = tufts(rng, spots);
  if (placeholder) group.add(placeholder);

  const choices = options.ids ? options.ids.map((id) => ({ id, weight: 1 })) : PLANT_CHOICES;
  const upgrade = (): void => {
    const usable = choices.filter((c) => assets.has(c.id));
    if (usable.length === 0 || spots.length === 0) return;
    const total = usable.reduce((sum, c) => sum + c.weight, 0);
    const buckets: Placement[][] = usable.map(() => []);
    for (const spot of spots) {
      let r = modelRng() * total;
      let pick = 0;
      while (pick < usable.length - 1 && r >= usable[pick]!.weight) {
        r -= usable[pick]!.weight;
        pick++;
      }
      buckets[pick]!.push({ x: spot.x, z: spot.z, yaw: modelRng() * Math.PI * 2, scale: 0.8 + modelRng() * 0.5 });
    }
    const meshes: THREE.InstancedMesh[] = [];
    usable.forEach((c, i) => {
      const mesh = instancedModel(c.id, buckets[i]!, { cast: false, receive: true });
      if (!mesh) return;
      tintPlants(mesh, modelRng); // after every placement draw, so the layout never shifts
      meshes.push(mesh);
    });
    if (meshes.length === 0) return;
    if (placeholder) {
      group.remove(placeholder);
      placeholder.geometry.dispose();
      (placeholder.material as THREE.Material).dispose();
    }
    group.add(...meshes);
  };
  assets
    .load(choices.map((c) => c.id))
    .then(upgrade)
    .catch(() => {});
  return group;
}

// ---- campfire -----------------------------------------------------------------------------------

/** What a `campfire()` blocks, flames and stone ring together (the ring is 1.1 out; the model pit is 1.2 wide). */
export const CAMPFIRE_COLLIDER_RADIUS = 1.25;

/** A campfire that can trade its primitive stones and logs for the `campfire` model. */
export interface CampfireProp extends AnimatedProp {
  /** Swap in the model if it has loaded. The flames, light, and embers stay. Returns true once swapped. */
  useModel(): boolean;
}

const EMBER_COUNT = 12;
const FIRE_LIGHT_COLOR = 0xff9640;
const FIRE_LIGHT_INTENSITY = 16; // candela; at 3 units it lights the ground about as strongly as the sky does
const FIRE_LIGHT_RANGE = 14;

/**
 * A flame: a teardrop of six faces whose vertex colors run from `base` at the bottom to `tip` at
 * the top. Colors are in Three's working (linear) space, matching `MeshBasicMaterial` vertex colors.
 */
function flameGeometry(radius: number, height: number, base: number, tip: number): THREE.BufferGeometry {
  const profile = [
    [0.0, 0.0],
    [0.7, 0.08],
    [1.0, 0.3],
    [0.85, 0.58],
    [0.5, 0.82],
    [0.2, 0.95],
    [0.0, 1.0],
  ].map(([r, h]) => new THREE.Vector2(r! * radius, h! * height));
  const geometry = new THREE.LatheGeometry(profile, 6);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const from = new THREE.Color(base);
  const to = new THREE.Color(tip);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    c.copy(from).lerp(to, Math.min(1, Math.max(0, position.getY(i) / height)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A 16 by 16 soft white dot, for round embers. */
function softDotTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
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

/**
 * Stone ring, crossed logs, a two-layer flame, rising embers, and a warm flickering light that
 * does not cast shadows. The stones and logs cast and receive shadows. 5 draw calls: stones, logs
 * (or the model's 2), outer flame, inner flame, embers.
 */
export function campfire(): CampfireProp {
  const root = new THREE.Group();
  root.name = 'campfire';

  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.28, 0).translate(0, 0.15, 0),
    lambert(0x777c82),
    8,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 0.8, 1.2);
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
  }

  const logs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6).rotateZ(Math.PI / 2),
    lambert(0x5a3a22),
    3,
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + 0.3;
    dummy.position.set(0, 0.16, 0);
    dummy.rotation.set(0, a, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    logs.setMatrixAt(i, dummy.matrix);
  }
  setShadowCasting(stones, true, true);
  setShadowCasting(logs, true, true);

  // Outer flame: red at the foot, orange at the tip, glowing (additive) so it looks lit from inside.
  // Inner flame: orange to yellow and opaque, so the core burns hotter where the two overlap.
  const outer = new THREE.Mesh(
    flameGeometry(0.5, 1.5, 0xd8300f, 0xff8a1a),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  outer.position.y = 0.2;
  outer.renderOrder = 2;
  const inner = new THREE.Mesh(
    flameGeometry(0.28, 1.0, 0xff9d1c, 0xffe36a),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
  );
  inner.position.y = 0.2;

  const light = new THREE.PointLight(FIRE_LIGHT_COLOR, FIRE_LIGHT_INTENSITY, FIRE_LIGHT_RANGE, 2);
  light.name = 'campfire-light';
  light.position.set(0, 1.1, 0);
  light.castShadow = false;

  // Embers: a few glowing dots that rise, drift, and fade out, then start over at the fire.
  const emberPositions = new Float32Array(EMBER_COUNT * 3);
  const emberColors = new Float32Array(EMBER_COUNT * 3);
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  emberGeometry.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));
  const embers = new THREE.Points(
    emberGeometry,
    new THREE.PointsMaterial({
      size: 0.24,
      map: softDotTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    }),
  );
  embers.name = 'embers';
  embers.frustumCulled = false; // the points move every frame, so the starting bounds would be wrong
  const emberSeeds = Array.from({ length: EMBER_COUNT }, (_, i) => ({
    phase: frac(i * 0.618),
    speed: 0.28 + 0.22 * frac(i * 0.381 + 0.2),
    angle: i * 2.399,
    radius: 0.15 + 0.35 * frac(i * 0.755 + 0.1),
  }));

  root.add(stones, logs, outer, inner, light, embers);

  let t = 0;
  let swapped = false;
  const updateEmbers = (): void => {
    emberSeeds.forEach((e, i) => {
      const life = frac(e.phase + t * e.speed);
      const spread = e.radius * (0.4 + life);
      emberPositions[i * 3] = Math.cos(e.angle + life * 1.5) * spread + 0.12 * life * Math.sin(t * 2.3 + i);
      emberPositions[i * 3 + 1] = 0.5 + life * 2.8;
      emberPositions[i * 3 + 2] = Math.sin(e.angle + life * 1.5) * spread + 0.12 * life * Math.cos(t * 1.9 + i);
      // Fade in fast, fade out slowly, with a little sparkle. Black is invisible when added.
      const glow = Math.pow(1 - life, 1.5) * Math.min(1, life * 8) * (0.8 + 0.2 * Math.sin(t * 20 + i * 1.7));
      emberColors[i * 3] = 1.0 * glow;
      emberColors[i * 3 + 1] = 0.55 * glow;
      emberColors[i * 3 + 2] = 0.15 * glow;
    });
    emberGeometry.getAttribute('position').needsUpdate = true;
    emberGeometry.getAttribute('color').needsUpdate = true;
  };
  updateEmbers();

  return {
    root,
    useModel(): boolean {
      if (swapped) return true;
      if (!assets.has('campfire')) return false;
      root.remove(stones, logs);
      const model = assets.instance('campfire');
      setShadowCasting(model, true, true);
      root.add(model);
      swapped = true;
      return true;
    },
    update(dt: number): void {
      t += dt;
      // Sums of sines give a lively flicker with no per-frame randomness.
      const tall = 1 + 0.14 * Math.sin(t * 11) + 0.08 * Math.sin(t * 23 + 1.3);
      const wide = 1 + 0.07 * Math.sin(t * 17 + 0.6);
      outer.scale.set(wide, tall, wide);
      outer.position.y = 0.2 + 0.03 * Math.sin(t * 13 + 0.4);
      outer.rotation.y = t * 0.8;
      inner.scale.set(1 / wide, 1 + 0.2 * Math.sin(t * 19 + 2.1), 1 / wide);
      inner.position.y = 0.2 + 0.04 * Math.sin(t * 17 + 1.9);
      inner.rotation.y = 0.5 - t * 1.3;
      light.intensity = FIRE_LIGHT_INTENSITY * (0.86 + 0.1 * Math.sin(t * 13) + 0.06 * Math.sin(t * 29 + 1.1) + 0.04 * Math.sin(t * 47 + 2.3));
      light.position.y = 1.1 + 0.08 * Math.sin(t * 9);
      updateEmbers();
    },
  };
}

// ---- flagpole, lodge ----------------------------------------------------------------------------

/** A tall pole with a plain flag. Not any real organization's flag. 3 draw calls. */
export function flagpole(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'flagpole';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 8), lambert(0xd9dde0));
  pole.position.y = 3.2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lambert(0xe2b93b));
  ball.position.y = 6.5;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.05), lambert(0x2f7a46));
  flag.position.set(0.88, 5.7, 0);
  g.add(pole, ball, flag);
  setShadowCasting(g, true, true);
  return g;
}

/** A log cabin: box walls, a triangular roof prism, a door, and two windows. Faces +z. 4 draw calls. */
export function lodge(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lodge';
  const width = 8;
  const depth = 6;
  const wallHeight = 3;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), lambert(0x9c6b3f));
  walls.position.y = wallHeight / 2;

  const gable = new THREE.Shape();
  gable.moveTo(-width / 2 - 0.6, 0);
  gable.lineTo(width / 2 + 0.6, 0);
  gable.lineTo(0, 2.6);
  gable.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(gable, { depth: depth + 0.8, bevelEnabled: false });
  roofGeo.translate(0, 0, -(depth + 0.8) / 2);
  const roof = new THREE.Mesh(roofGeo, lambert(0x7a3b2e));
  roof.position.y = wallHeight;

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.12), lambert(0x4a2e1b));
  door.position.set(0, 1.05, depth / 2 + 0.03);

  const windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 1.1, 0.12),
    lambert(0xbfe3ff),
    2,
  );
  for (let i = 0; i < 2; i++) {
    dummy.position.set(i === 0 ? -2.4 : 2.4, 1.7, depth / 2 + 0.03);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    windows.setMatrixAt(i, dummy.matrix);
  }

  g.add(walls, roof, door, windows);
  setShadowCasting(g, true, true);
  setShadowCasting(windows, false, true); // thin panes: no shadow of their own
  return g;
}

// ---- people -------------------------------------------------------------------------------------

export interface PersonOptions {
  /** Neckerchief color. Defaults to a darker shade of `color`. */
  neckerchief?: number;
  /** Skin tone for the head. */
  skin?: number;
}

/** A placeholder person. `body` holds the visible parts (so it can bob); the shadow stays on the ground. */
export class Person extends THREE.Group {
  readonly body = new THREE.Group();
}

const PERSON_BASE_HEIGHT = 1.95; // capsule 0.35 radius + 0.9 length, plus a head

/**
 * Capsule body (0.35 radius, 0.9 length at the base size), a head, a darker neckerchief ring with
 * a point at the front (so you can tell which way they face), and a soft blob shadow under the
 * feet. The body casts and receives sun shadows; the blob stays as contact shadow. The front is
 * +z. 5 draw calls. `height` scales the whole figure (1.95 is the base size).
 */
export function personPlaceholder(color: number, height: number, options: PersonOptions = {}): Person {
  const s = height / PERSON_BASE_HEIGHT;
  const person = new Person();
  person.name = 'person';

  const bodyColor = new THREE.Color(color);
  const scarfColor = options.neckerchief ?? bodyColor.clone().multiplyScalar(0.55).getHex();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35 * s, 0.9 * s, 4, 10), lambert(color, false));
  torso.position.y = 0.8 * s;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25 * s, 12, 10), lambert(options.skin ?? 0xf0c9a0, false));
  head.position.y = 1.7 * s;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31 * s, 0.07 * s, 6, 14), lambert(scarfColor, false));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.4 * s;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.13 * s, 0.3 * s, 4).rotateX(Math.PI),
    lambert(scarfColor, false),
  );
  point.position.set(0, 1.28 * s, 0.34 * s);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55 * s, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.position.y = 0.03;

  person.body.add(torso, head, ring, point);
  person.add(person.body, shadow);
  setShadowCasting(person, true, true); // skips the transparent blob
  return person;
}
