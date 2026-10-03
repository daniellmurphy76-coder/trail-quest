/**
 * Nature Trail: the outdoors zone (Wolf "Paws on the Path", Arrow of Light "Outdoor Adventurer").
 *
 * A winding dirt path runs from a trailhead sign near the spawn, over a footbridge that crosses a
 * stream, up to a lookout (a cluster of rocks with a flat spot in front) and ends at a small
 * campsite (tent, campfire, firewood). Dense trees ring the edges, plants cover the grass, and a
 * rabbit, a frog and a bird idle off the path. The zone carries no lights of its own: the world's
 * environment lights it, and the campfire adds its own warm point light.
 *
 * Every prop starts as a primitive (instant, never blocks) and upgrades to its model when the
 * asset library has loaded it. Placement is pure and seeded (`natureTrailLayout`), so the primitive
 * and model versions stand in exactly the same places and the tests can check it without a renderer.
 *
 * Solid things block the player (`TrailLayout.colliders`, built from the same lists that place the
 * props, so they cannot drift): tree trunks, the lookout rocks, stumps, the tent, firewood, the log
 * seats, the fire ring, the Back to camp sign, and the stream, which is a wall of boxes with a gap
 * exactly as wide as the bridge. The trailhead sign stands on its own landmark, so it has none. The
 * path, the open spots and the flat lookout are kept clear of colliders by construction.
 *
 * Draw calls: primitives about 23 (ground 2, path 1, stream 1, trees 2, rocks 1, stumps 1, plants 1,
 * bridge 1, signs 2, tent 1, firewood 1, seats 1, campfire 5, animals 3), plus 4 landmark labels in a
 * browser. After the models load about 40 (trees 4, rocks 3, plants up to 8, rabbit 2, the rest 1
 * each). The sun's shadow pass draws the casting props a second time.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets, type ModelAnimator } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint, squareBounds } from './bounds';
import { boxCollider, circleCollider, type BoxCollider, type Collider } from './collide';
import { createGround, createGroundApron } from './ground';
import { labelSprite } from './placeholder-zone';
import {
  CAMPFIRE_COLLIDER_RADIUS,
  campfire,
  instancedModel,
  scatterModels,
  scatterPlants,
  tree,
  treeColliders,
  type AvoidCircle,
  type Placement,
  type Rng,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';
import type { ZoneDeps } from './zones';

// ---- tuning -------------------------------------------------------------------------------------

const SEED = 3301;
/**
 * The player may walk this far from the center in x and z (35 by 35; the existing zone tests cap a
 * zone at 35 across). Trees stand just outside.
 */
export const NATURE_TRAIL_HALF = 17.5;
const GROUND_SIZE = 50;

const GRASS_COLOR = 0x58a042;
const DIRT_COLOR = 0xb59468;
const DIRT_EDGE_COLOR = 0x8d9d56; // where the path fades into the grass
const LOOKOUT_PAD_COLOR = 0xaca28c;
const CAMP_PAD_COLOR = 0xa58a5e;
const STREAM_DEEP = 0x2f86c9;
const STREAM_SHALLOW = 0x86cdee;

const SPAWN: Spot = { x: 0, z: 13.5 };
/** The "Back to camp" sign stands this far to the left of the spawn (the spawn is out of its reach). */
const SIGN_OFFSET_X = -3.2;
const SIGN_RADIUS = 2;
const SIGN_LABEL_HEIGHT = 2.6;
/** Open spots keep this far from the spawn, the Trail sign and every landmark. */
const SPOT_KEEP_LANDMARK = 3.6;
/** Open spots keep this far from the edge of any prop. */
const SPOT_KEEP_PROP = 1.1;
const SPOT_GAP = 2.6;
const SPOT_COUNT = 12;
const SPOT_EDGE_MARGIN = 1.5;

const PATH_HALF = 1.15;
const PATH_Y = 0.04;
const PAD_Y = 0.046;
const STREAM_Y = 0.065;
const STREAM_HALF = 1.5; // the stream is 3 units wide
const STREAM_FRINGE = 0.3; // soft, see-through shore on each side
const LOOKOUT_PAD_RADIUS = 2.6;
const CAMP_PAD_CENTER: Spot = { x: 11.0, z: -11.6 };
const CAMP_PAD_RADIUS = 4.0;

/** The path, as control points the curve passes through. The bridge, lookout and camp are three of them. */
const PATH_CONTROL: readonly Spot[] = [
  { x: 0, z: 16.8 },
  { x: 0, z: 13.0 },
  { x: -1.6, z: 9.6 },
  { x: -3.6, z: 6.6 },
  { x: -2.6, z: 3.4 },
  { x: 0, z: 1.6 },
  { x: 0, z: -1.5 }, // footbridge
  { x: 0, z: -4.4 },
  { x: -1.2, z: -7.0 },
  { x: -3.0, z: -9.0 },
  { x: -5.2, z: -11.0 }, // lookout
  { x: -4.6, z: -13.4 },
  { x: -1.8, z: -14.2 },
  { x: 2.6, z: -13.4 },
  { x: 6.4, z: -11.6 },
  { x: 9.8, z: -10.6 }, // campsite
];
const BRIDGE_INDEX = 6;
const LOOKOUT_INDEX = 10;
const CAMP_INDEX = PATH_CONTROL.length - 1;

/** The stream flows west to east across the whole zone. It runs straight under the bridge. */
const STREAM_CONTROL: readonly Spot[] = [
  { x: -24, z: -2.6 },
  { x: -17, z: -0.8 },
  { x: -10, z: -2.5 },
  { x: -4.5, z: -1.3 },
  { x: -1.8, z: -1.5 },
  { x: 0, z: -1.5 },
  { x: 1.8, z: -1.5 },
  { x: 5, z: -1.7 },
  { x: 9, z: -0.4 },
  { x: 15, z: -1.9 },
  { x: 24, z: -0.9 },
];

/**
 * The bridge model is 4.16 long (along its x), 4.16 wide and 1.6 tall with a deck 0.9 up. The player
 * walks at y = 0, so flatten it (deck 0.26 up) and narrow it (3.1 wide), then turn it to run north-south.
 */
const BRIDGE_SCALE = new THREE.Vector3(1, 0.3, 0.75);
const BRIDGE_YAW = Math.PI / 2;

const RING_COUNT = 64;
const INNER_TREE_COUNT = 24;
const STUMP_COUNT = 6;
const SMALL_ROCK_COUNT = 5;
const PLANT_COUNT = 320;
/** No trees in front of the entrance: the camera stands behind the spawn, outside the walkable square. */
const ENTRANCE_HALF = 8;

const TREE_MODELS = ['tree.pine', 'tree.pine.tall', 'tree.round', 'tree.oak'] as const;
const NATURE_TRAIL_MODELS = [
  ...TREE_MODELS,
  'rock.large',
  'rock.tall',
  'rock.small',
  'path.stone',
  'stump',
  'bridge',
  'signpost',
  'tent.small',
  'log.stack',
  'log.single',
  'campfire',
  'animal.rabbit',
  'animal.frog',
  'animal.bird',
] as const;

const RABBIT_SCALE = 0.75;
const FROG_SCALE = 1;
const BIRD_SCALE = 0.8;

// ---- layout: pure, seeded, no Three.js objects ---------------------------------------------------

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export type RockKind = 'large' | 'tall' | 'small';

export interface RockSpec {
  kind: RockKind;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface AnimalSpec {
  x: number;
  z: number;
  yaw: number;
  /** Height above the ground it stands at (the bird sits on a rock). */
  y: number;
}

/** A polyline with arc length: the path and the stream. */
export class Polyline {
  readonly cum: number[] = [0];
  readonly pts: readonly Spot[];

  constructor(pts: readonly Spot[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }

  pointAt(s: number): Spot {
    const c = Math.min(this.length, Math.max(0, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < c) i++;
    const s0 = this.cum[i - 1]!;
    const s1 = this.cum[i]!;
    const t = s1 > s0 ? (c - s0) / (s1 - s0) : 0;
    const a = this.pts[i - 1]!;
    const b = this.pts[i]!;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Unit direction of travel at arc length `s`. */
  tangentAt(s: number): Spot {
    const a = this.pointAt(s - 0.3);
    const b = this.pointAt(s + 0.3);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /** The closest point on the line to (x, z): how far away it is, and its arc length. */
  nearest(x: number, z: number): { dist: number; s: number } {
    let best = Infinity;
    let bestS = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!;
      const b = this.pts[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1]! + Math.sqrt(len2) * t;
      }
    }
    return { dist: best, s: bestS };
  }
}

function smoothLine(control: readonly Spot[], divisions: number): Polyline {
  const curve = new THREE.CatmullRomCurve3(
    control.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'centripetal',
  );
  return new Polyline(curve.getSpacedPoints(divisions).map((v) => ({ x: v.x, z: v.z })));
}

export interface TrailLayout {
  spawn: Spot;
  /** The "Back to camp" signpost. */
  backSign: Spot & { yaw: number };
  path: Polyline;
  stream: Polyline;
  pathHalf: number;
  streamHalf: number;
  landmarks: { trailhead: Spot; footbridge: Spot; lookout: Spot; campsite: Spot };
  /** The trailhead signpost, a little to the right of the path. */
  trailheadSign: Spot & { yaw: number };
  lookoutPad: Circle;
  campPad: Circle;
  rocks: RockSpec[];
  tent: Placement;
  fire: Spot;
  firewood: Placement;
  seats: Placement[];
  flagstones: Placement[];
  stumps: Placement[];
  trees: Spot[];
  rabbit: AnimalSpec;
  frog: AnimalSpec;
  bird: AnimalSpec;
  openSpots: Spot[];
  /** Everything with a footprint, for keeping plants and spots off it. */
  blockers: Circle[];
  /** What the player cannot walk through. Never on the path, an open spot, a landmark or the spawn. */
  colliders: Collider[];
}

/** Yaw that turns a thing whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ROCK_RADIUS: Record<RockKind, number> = { large: 1.35, tall: 1.2, small: 0.6 };
const ROCK_HEIGHT: Record<RockKind, number> = { large: 0.72, tall: 2.4, small: 0.58 };
/** Each rock model's size at scale 1 (width, height, depth), which the primitive matches. */
const ROCK_SIZE: Record<RockKind, readonly [number, number, number]> = {
  large: [2.16, 0.72, 2.8],
  tall: [2.37, 2.4, 1.65],
  small: [1.1, 0.58, 1.1],
};
/** A rock blocks this much of its width and depth (rocks are lumpy, and the player is round). */
const ROCK_FOOTPRINT = 0.75;
const STUMP_COLLIDER_RADIUS = 0.6; // at scale 1
const SIGN_COLLIDER_RADIUS = 0.3;
/** Half sizes of the small tent model (2.58 by 3.0) and the firewood and log seat models, a touch inside. */
const TENT_HALF = { hw: 1.25, hd: 1.3 } as const;
const FIREWOOD_HALF = { hw: 0.7, hd: 1.15 } as const;
const SEAT_HALF = { hw: 0.35, hd: 1.1 } as const;
/** The bridge deck is 3.1 wide; the stream's wall leaves a gap this wide (half) for it. */
const BRIDGE_GAP_HALF = 1.5;
/** Each stretch of the stream's wall is about this long; neighbours overlap a little so a bend leaves no crack. */
const STREAM_CHUNK = 2;
const STREAM_JOINT = 0.2;

/**
 * The stream as a chain of turned boxes along its curve, a stream wide, with a gap where the
 * bridge crosses. The stream flows west to east across the whole zone, so its x grows with its arc
 * length and the gap edges are found by halving. The boxes run past the walkable square.
 */
function streamColliders(stream: Polyline, bridgeX: number): BoxCollider[] {
  const arcAt = (x: number): number => {
    let lo = 0;
    let hi = stream.length;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (stream.pointAt(mid).x < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const out: BoxCollider[] = [];
  const stretch = (from: number, to: number): void => {
    const n = Math.max(1, Math.ceil((to - from) / STREAM_CHUNK));
    for (let i = 0; i < n; i++) {
      const a = stream.pointAt(from + ((to - from) * i) / n);
      const b = stream.pointAt(from + ((to - from) * (i + 1)) / n);
      out.push(
        boxCollider(
          (a.x + b.x) / 2,
          (a.z + b.z) / 2,
          STREAM_HALF,
          Math.hypot(b.x - a.x, b.z - a.z) / 2 + STREAM_JOINT,
          Math.atan2(b.x - a.x, b.z - a.z),
        ),
      );
    }
  };
  // Each box reaches STREAM_JOINT past its ends, so the stretches stop that far short of the gap.
  stretch(0, arcAt(bridgeX - BRIDGE_GAP_HALF - STREAM_JOINT));
  stretch(arcAt(bridgeX + BRIDGE_GAP_HALF + STREAM_JOINT), stream.length);
  return out;
}

/** Where everything stands. Same answer every call. */
export function natureTrailLayout(): TrailLayout {
  const rng = mulberry32(SEED);
  const path = smoothLine(PATH_CONTROL, 160);
  const stream = smoothLine(STREAM_CONTROL, 120);
  const control = (i: number): Spot => ({ ...PATH_CONTROL[i]! });

  const blockers: Circle[] = [];
  const block = (x: number, z: number, r: number): void => {
    blockers.push({ x, z, r });
  };

  // ---- signs and landmarks ----------------------------------------------------------------------
  const spawn = { ...SPAWN };
  const backSign = { x: spawn.x + SIGN_OFFSET_X, z: spawn.z, yaw: 0.35 };
  block(backSign.x, backSign.z, 0.6);

  const sSpawn = path.nearest(spawn.x, spawn.z).s;
  const signS = sSpawn + 5.4;
  const signBase = path.pointAt(signS);
  const heading = path.tangentAt(signS);
  const trailheadX = signBase.x - heading.z * 1.6; // right of the direction of travel
  const trailheadZ = signBase.z + heading.x * 1.6;
  const trailheadSign = { x: trailheadX, z: trailheadZ, yaw: yawToward(trailheadX, trailheadZ, spawn.x, spawn.z) };
  block(trailheadSign.x, trailheadSign.z, 0.6);

  const bridge = control(BRIDGE_INDEX);
  block(bridge.x, bridge.z - 1.3, 1.9); // the bridge: three circles along its walkway
  block(bridge.x, bridge.z, 1.9);
  block(bridge.x, bridge.z + 1.3, 1.9);

  const lookout = control(LOOKOUT_INDEX);
  const campsite = control(CAMP_INDEX);
  const landmarks = { trailhead: { x: trailheadX, z: trailheadZ }, footbridge: bridge, lookout, campsite };

  // ---- the lookout: rocks behind (west and north), the flat spot in front ------------------------
  const rocks: RockSpec[] = [
    { kind: 'tall', x: -8.8, z: -13.6, yaw: 0.4, scale: 1.15 },
    { kind: 'large', x: -9.0, z: -10.2, yaw: 2.2, scale: 1.25 }, // the bird sits on this one
    { kind: 'tall', x: -7.6, z: -16.2, yaw: 3.9, scale: 1.0 },
    { kind: 'large', x: -10.8, z: -15.2, yaw: 5.1, scale: 1.0 },
    { kind: 'small', x: -10.8, z: -12.2, yaw: 1.0, scale: 1.0 },
  ];
  for (const r of rocks) block(r.x, r.z, ROCK_RADIUS[r.kind] * r.scale);
  const lookoutPad: Circle = { x: lookout.x, z: lookout.z, r: LOOKOUT_PAD_RADIUS };
  // Two flagstone slabs (4 by 2.3) side by side make the viewing floor, turned along the path.
  const lookoutHeading = path.tangentAt(path.nearest(lookout.x, lookout.z).s);
  const lookoutYaw = Math.atan2(lookoutHeading.x, lookoutHeading.z) + Math.PI / 2;
  const flagstones: Placement[] = [-1.15, 1.15].map((off) => ({
    x: lookout.x - lookoutHeading.z * off,
    z: lookout.z + lookoutHeading.x * off,
    yaw: lookoutYaw,
  }));

  // ---- the campsite ------------------------------------------------------------------------------
  const campPad: Circle = { ...CAMP_PAD_CENTER, r: CAMP_PAD_RADIUS };
  const fire = { x: 12.3, z: -12.2 };
  block(fire.x, fire.z, 1.5);
  const tent: Placement = { x: 9.6, z: -14.6, yaw: yawToward(9.6, -14.6, fire.x, fire.z) };
  block(tent.x, tent.z, 1.7);
  const firewood: Placement = { x: 13.8, z: -15.0, yaw: 1.2 };
  block(firewood.x, firewood.z, 1.3);
  const seats: Placement[] = [
    { x: 12.7, z: -9.8, yaw: Math.PI / 2 },
    { x: 14.9, z: -12.4, yaw: 0 },
  ];
  for (const s of seats) block(s.x, s.z, 1.2);

  // ---- random scatter: trees, small rocks, stumps -------------------------------------------------
  // Keep-out zones for scattered props, on top of the blockers: the spawn, the signs, the pads.
  const noGo: Circle[] = [
    { x: spawn.x, z: spawn.z, r: 3.2 },
    { x: backSign.x, z: backSign.z, r: 1.4 },
    { x: trailheadX, z: trailheadZ, r: 1.6 },
    { ...lookoutPad, r: LOOKOUT_PAD_RADIUS + 0.4 },
    { ...campPad },
  ];
  const clearOf = (x: number, z: number, r: number): boolean =>
    Math.abs(x) <= NATURE_TRAIL_HALF - 0.8 &&
    Math.abs(z) <= NATURE_TRAIL_HALF - 0.8 &&
    path.nearest(x, z).dist >= PATH_HALF + r + 0.5 &&
    stream.nearest(x, z).dist >= STREAM_HALF + STREAM_FRINGE + r + 0.4 &&
    noGo.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + r) &&
    blockers.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + r + 0.3);

  const scatter = (
    rand: Rng,
    count: number,
    radius: number,
    inside: (x: number, z: number) => boolean,
    gap: number,
  ): Spot[] => {
    const out: Spot[] = [];
    const half = NATURE_TRAIL_HALF - 0.8;
    for (let attempt = 0; attempt < count * 80 && out.length < count; attempt++) {
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      if (!inside(x, z) || !clearOf(x, z, radius)) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < gap)) continue;
      out.push({ x, z });
      block(x, z, radius > 1 ? 0.8 : radius);
    }
    return out;
  };

  // A ring of trees just outside the walkable square, with a gap for the entrance and the stream.
  const trees: Spot[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const p = perimeterPoint((i + rng() * 0.8) / RING_COUNT, NATURE_TRAIL_HALF + 1.2 + rng() * 2.6);
    if (p.z > 0 && Math.abs(p.x) < ENTRANCE_HALF) continue;
    if (stream.nearest(p.x, p.z).dist < STREAM_HALF + 1.2) continue;
    trees.push(p);
  }
  // And clusters just inside the edge, so the forest is dense from the path too.
  const edgeBand = (x: number, z: number): boolean =>
    Math.max(Math.abs(x), Math.abs(z)) >= NATURE_TRAIL_HALF - 4.2 && !(z > 8 && Math.abs(x) < ENTRANCE_HALF + 1);
  trees.push(...scatter(mulberry32(SEED + 11), INNER_TREE_COUNT, 1.6, edgeBand, 2.4));

  const smallRocks = scatter(mulberry32(SEED + 12), SMALL_ROCK_COUNT, 0.6, () => true, 3);
  for (const p of smallRocks) {
    rocks.push({ kind: 'small', x: p.x, z: p.z, yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6 });
  }

  const stumpRng = mulberry32(SEED + 13);
  const stumps: Placement[] = scatter(stumpRng, STUMP_COUNT, 1.0, () => true, 3.5).map((p) => ({
    x: p.x,
    z: p.z,
    yaw: stumpRng() * Math.PI * 2,
    scale: 0.8 + stumpRng() * 0.5,
  }));

  // ---- decorative animals, off the path ---------------------------------------------------------
  const birdRock = rocks[1]!; // the big rock on the west side of the lookout
  const bird: AnimalSpec = {
    x: birdRock.x,
    z: birdRock.z,
    yaw: yawToward(birdRock.x, birdRock.z, lookout.x, lookout.z),
    y: ROCK_HEIGHT[birdRock.kind] * birdRock.scale * 0.8,
  };
  const rabbit: AnimalSpec = { x: -8.2, z: 5.6, yaw: yawToward(-8.2, 5.6, -3.6, 6.6), y: 0 };
  // The frog sits on the south bank of the stream, east of the bridge.
  const frogStream = stream.pointAt(stream.nearest(7.4, -1).s);
  const frog: AnimalSpec = { x: frogStream.x, z: frogStream.z + STREAM_HALF + 0.55, yaw: Math.PI * 0.85, y: 0 };
  const animals: Circle[] = [rabbit, frog, bird].map((a) => ({ x: a.x, z: a.z, r: 2.4 }));

  // ---- open spots: along and beside the path, clear of everything --------------------------------
  const keepAway: Circle[] = [
    { x: spawn.x, z: spawn.z, r: SPOT_KEEP_LANDMARK },
    { x: backSign.x, z: backSign.z, r: SPOT_KEEP_LANDMARK },
    ...Object.values(landmarks).map((p) => ({ x: p.x, z: p.z, r: SPOT_KEEP_LANDMARK })),
    ...animals,
  ];
  const spotOk = (x: number, z: number): boolean =>
    Math.abs(x) <= NATURE_TRAIL_HALF - SPOT_EDGE_MARGIN &&
    Math.abs(z) <= NATURE_TRAIL_HALF - SPOT_EDGE_MARGIN &&
    stream.nearest(x, z).dist >= STREAM_HALF + STREAM_FRINGE + SPOT_KEEP_PROP &&
    keepAway.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r) &&
    blockers.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r + SPOT_KEEP_PROP);

  const spotRng = mulberry32(SEED + 14);
  const openSpots: Spot[] = [];
  const tryAdd = (x: number, z: number): boolean => {
    if (!spotOk(x, z) || openSpots.some((p) => Math.hypot(p.x - x, p.z - z) < SPOT_GAP)) return false;
    openSpots.push({ x, z });
    return true;
  };
  const sideOffsets = [0, 1.0, -1.0, 1.9, -1.9, 2.8, -2.8];
  const alongOffsets = [0, -0.8, 0.8, -1.6, 1.6, -2.4, 2.4];
  const walkable = path.length - 4;
  for (let k = 0; k < SPOT_COUNT; k++) {
    const s0 = 2.5 + (walkable * (k + 0.5)) / SPOT_COUNT;
    let placed = false;
    for (const along of alongOffsets) {
      const p = path.pointAt(s0 + along);
      const t = path.tangentAt(s0 + along);
      for (const side of shuffled(sideOffsets, spotRng)) {
        if (tryAdd(p.x - t.z * side, p.z + t.x * side)) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }
  // Top up if the walk past a landmark or the bridge left a gap.
  for (let attempt = 0; attempt < 400 && openSpots.length < SPOT_COUNT; attempt++) {
    const p = path.pointAt(2.5 + spotRng() * walkable);
    const t = path.tangentAt(path.nearest(p.x, p.z).s);
    const side = (spotRng() * 2 - 1) * 3;
    tryAdd(p.x - t.z * side, p.z + t.x * side);
  }

  return {
    spawn,
    backSign,
    path,
    stream,
    pathHalf: PATH_HALF,
    streamHalf: STREAM_HALF,
    landmarks,
    trailheadSign,
    lookoutPad,
    campPad,
    rocks,
    tent,
    fire,
    firewood,
    seats,
    flagstones,
    stumps,
    trees,
    rabbit,
    frog,
    bird,
    openSpots,
    blockers,
    colliders: [
      ...treeColliders(trees),
      ...rocks.map((r) =>
        boxCollider(
          r.x,
          r.z,
          ROCK_SIZE[r.kind][0] * r.scale * 0.5 * ROCK_FOOTPRINT,
          ROCK_SIZE[r.kind][2] * r.scale * 0.5 * ROCK_FOOTPRINT,
          r.yaw,
        ),
      ),
      ...stumps.map((s) => circleCollider(s.x, s.z, STUMP_COLLIDER_RADIUS * (s.scale ?? 1))),
      boxCollider(tent.x, tent.z, TENT_HALF.hw, TENT_HALF.hd, tent.yaw),
      circleCollider(fire.x, fire.z, CAMPFIRE_COLLIDER_RADIUS),
      boxCollider(firewood.x, firewood.z, FIREWOOD_HALF.hw, FIREWOOD_HALF.hd, firewood.yaw),
      ...seats.map((s) => boxCollider(s.x, s.z, SEAT_HALF.hw, SEAT_HALF.hd, s.yaw)),
      circleCollider(backSign.x, backSign.z, SIGN_COLLIDER_RADIUS),
      ...streamColliders(stream, bridge.x),
    ],
  };
}

// ---- primitive building blocks --------------------------------------------------------------------

const dummy = new THREE.Object3D();

function colored(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return geometry;
}

/** One geometry from several colored parts, so a whole prop is a single draw call. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) return parts[0]!; // cannot happen with Three's own primitives; keep something on screen
  for (const part of parts) part.dispose();
  return merged;
}

function flatMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

function signGeometry(): THREE.BufferGeometry {
  return mergeParts([
    colored(new THREE.CylinderGeometry(0.1, 0.13, 2.4, 6).translate(0, 1.2, 0), 0x6b4a2b),
    colored(new THREE.BoxGeometry(1.1, 0.5, 0.1).translate(0, 2.05, 0.1), 0xd9b36c),
  ]);
}

/** Low plank bridge, long axis x (like the model), deck top at 0.26. */
function bridgeGeometry(): THREE.BufferGeometry {
  const deck = 0xa5733f;
  const wood = 0x6e4a2a;
  const parts = [colored(new THREE.BoxGeometry(4.2, 0.2, 3.0).translate(0, 0.16, 0), deck)];
  for (const z of [-1.4, 1.4]) {
    parts.push(colored(new THREE.BoxGeometry(4.2, 0.12, 0.14).translate(0, 0.44, z), wood));
    for (const x of [-2.0, 2.0]) parts.push(colored(new THREE.BoxGeometry(0.16, 0.5, 0.16).translate(x, 0.25, z), wood));
  }
  return mergeParts(parts);
}

function tentGeometry(): THREE.BufferGeometry {
  return mergeParts([
    colored(new THREE.ConeGeometry(1.9, 2.4, 4).rotateY(Math.PI / 4).translate(0, 1.2, 0), 0xd88a3b),
    colored(new THREE.BoxGeometry(0.7, 1.2, 0.08).translate(0, 0.6, 1.33), 0x4a2e1b),
  ]);
}

function firewoodGeometry(): THREE.BufferGeometry {
  const log = (x: number, y: number): THREE.BufferGeometry =>
    colored(new THREE.CylinderGeometry(0.3, 0.3, 2.2, 7).rotateX(Math.PI / 2).translate(x, y, 0), 0x7a5233);
  return mergeParts([log(-0.34, 0.3), log(0.34, 0.3), log(0, 0.84)]);
}

function rabbitGeometry(): THREE.BufferGeometry {
  const fur = 0xb89b78;
  return mergeParts([
    colored(new THREE.SphereGeometry(0.28, 8, 6).scale(1, 0.85, 1.3).translate(0, 0.28, 0), fur),
    colored(new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0.5, 0.32), fur),
    colored(new THREE.BoxGeometry(0.06, 0.3, 0.05).translate(-0.07, 0.78, 0.3), fur),
    colored(new THREE.BoxGeometry(0.06, 0.3, 0.05).translate(0.07, 0.78, 0.3), fur),
    colored(new THREE.SphereGeometry(0.09, 6, 5).translate(0, 0.32, -0.36), 0xf5f0e6),
  ]);
}

function frogGeometry(): THREE.BufferGeometry {
  return mergeParts([
    colored(new THREE.SphereGeometry(0.24, 8, 6).scale(1, 0.62, 1.15).translate(0, 0.15, 0), 0x4fae4a),
    colored(new THREE.SphereGeometry(0.07, 6, 5).translate(-0.11, 0.3, 0.14), 0xf0e68c),
    colored(new THREE.SphereGeometry(0.07, 6, 5).translate(0.11, 0.3, 0.14), 0xf0e68c),
  ]);
}

function birdGeometry(): THREE.BufferGeometry {
  const blue = 0x3d79c4;
  return mergeParts([
    colored(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.9, 1.4).translate(0, 0.22, 0), blue),
    colored(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.4, 0.2), blue),
    colored(new THREE.ConeGeometry(0.04, 0.14, 4).rotateX(Math.PI / 2).translate(0, 0.39, 0.36), 0xf2b705),
    colored(new THREE.BoxGeometry(0.16, 0.04, 0.3).translate(0, 0.2, -0.38), 0x2e5a94),
  ]);
}

const ROCK_MODEL: Record<RockKind, string> = { large: 'rock.large', tall: 'rock.tall', small: 'rock.small' };

/** Every rock as one instanced, squashed or stretched dodecahedron. One draw call. */
function primitiveRocks(rocks: readonly RockSpec[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x8a8f94, flatShading: true }),
    rocks.length,
  );
  mesh.name = 'rocks';
  const shade = new THREE.Color();
  rocks.forEach((r, i) => {
    const [w, h, d] = ROCK_SIZE[r.kind];
    dummy.position.set(r.x, h * r.scale * 0.45, r.z);
    dummy.rotation.set(0, r.yaw, 0);
    dummy.scale.set(w * r.scale, h * r.scale, d * r.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const v = 0.9 + ((i * 0.37) % 1) * 0.2;
    mesh.setColorAt(i, shade.setRGB(v, v, v));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  setShadowCasting(mesh, true, true);
  return mesh;
}

function instancedPrimitive(
  name: string,
  geometry: THREE.BufferGeometry,
  color: number,
  placements: readonly Placement[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
    placements.length,
  );
  mesh.name = name;
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, p.yaw ?? 0, 0);
    dummy.scale.setScalar(p.scale ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  setShadowCasting(mesh, true, true);
  return mesh;
}

// ---- ground surfaces: the dirt path and the stream ------------------------------------------------

type RGBA = readonly [number, number, number, number];

function rgba(hex: number, alpha = 1, shade = 1): RGBA {
  const c = new THREE.Color(hex);
  return [Math.min(1, c.r * shade), Math.min(1, c.g * shade), Math.min(1, c.b * shade), alpha];
}

/** A flat mesh builder: vertex-colored triangles that always face up. */
class SurfaceBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly withAlpha: boolean;

  constructor(withAlpha: boolean) {
    this.withAlpha = withAlpha;
  }

  vertex(x: number, y: number, z: number, c: RGBA): number {
    this.positions.push(x, y, z);
    this.colors.push(c[0], c[1], c[2]);
    if (this.withAlpha) this.colors.push(c[3]);
    return this.positions.length / 3 - 1;
  }

  /** A triangle facing up, whichever way round its corners come. */
  tri(a: number, b: number, c: number): void {
    const p = this.positions;
    const ux = p[b * 3]! - p[a * 3]!;
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!;
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    if (uz * vx - ux * vz >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /** A strip along `line` with one vertex per `profile` entry across it (offset to the right, height, color). */
  ribbon(
    line: Polyline,
    spacing: number,
    profile: readonly { offset: number; y: number; color: () => RGBA }[],
    include: (p: Spot) => boolean = () => true,
  ): void {
    const stations = Math.max(1, Math.ceil(line.length / spacing));
    let previous: number[] | null = null;
    for (let i = 0; i <= stations; i++) {
      const s = (line.length * i) / stations;
      const p = line.pointAt(s);
      if (!include(p)) {
        previous = null;
        continue;
      }
      const t = line.tangentAt(s);
      const row = profile.map((v) => this.vertex(p.x - t.z * v.offset, v.y, p.z + t.x * v.offset, v.color()));
      if (previous) {
        for (let k = 0; k < row.length - 1; k++) {
          this.tri(previous[k]!, previous[k + 1]!, row[k]!);
          this.tri(previous[k + 1]!, row[k + 1]!, row[k]!);
        }
      }
      previous = row;
    }
  }

  /** A round patch: solid inside `inner`, fading to `edge` by `outer`, with a slightly ragged rim. */
  disc(center: Spot, inner: number, outer: number, y: number, color: () => RGBA, edge: RGBA, rand: Rng): void {
    const segments = 28;
    const c = this.vertex(center.x, y, center.z, color());
    const innerRing: number[] = [];
    const outerRing: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const ragged = 1 + (rand() - 0.5) * 0.14;
      innerRing.push(this.vertex(center.x + Math.cos(a) * inner * ragged, y, center.z + Math.sin(a) * inner * ragged, color()));
      outerRing.push(this.vertex(center.x + Math.cos(a) * outer * ragged, y - 0.008, center.z + Math.sin(a) * outer * ragged, edge));
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      this.tri(c, innerRing[i]!, innerRing[j]!);
      this.tri(innerRing[i]!, outerRing[i]!, innerRing[j]!);
      this.tri(innerRing[j]!, outerRing[i]!, outerRing[j]!);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const count = this.positions.length / 3;
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, this.withAlpha ? 4 : 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

/** The dirt path (and the two flat pads). It stops at the stream's banks; the bridge carries it over. 1 draw call. */
function pathMesh(layout: TrailLayout, rand: Rng): THREE.Mesh {
  const b = new SurfaceBuilder(false);
  const dirt = (): RGBA => rgba(DIRT_COLOR, 1, 1 + (rand() * 2 - 1) * 0.07);
  const edge = rgba(DIRT_EDGE_COLOR);
  const hw = layout.pathHalf;
  b.ribbon(
    layout.path,
    0.5,
    [
      { offset: -hw - 0.4, y: PATH_Y - 0.008, color: () => edge },
      { offset: -hw, y: PATH_Y, color: dirt },
      { offset: 0, y: PATH_Y, color: dirt },
      { offset: hw, y: PATH_Y, color: dirt },
      { offset: hw + 0.4, y: PATH_Y - 0.008, color: () => edge },
    ],
    (p) => layout.stream.nearest(p.x, p.z).dist >= layout.streamHalf + STREAM_FRINGE + 0.1,
  );
  const lookout = layout.lookoutPad;
  b.disc(lookout, lookout.r - 0.6, lookout.r, PAD_Y, () => rgba(LOOKOUT_PAD_COLOR, 1, 1 + (rand() * 2 - 1) * 0.05), edge, rand);
  const camp = layout.campPad;
  b.disc(camp, camp.r - 0.7, camp.r, PAD_Y, () => rgba(CAMP_PAD_COLOR, 1, 1 + (rand() * 2 - 1) * 0.05), edge, rand);
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'path';
  mesh.receiveShadow = true;
  return mesh;
}

/** A 3 unit wide see-through blue strip with soft shores, from one side of the zone to the other. 1 draw call. */
function streamMesh(layout: TrailLayout): { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial } {
  const b = new SurfaceBuilder(true);
  const half = layout.streamHalf;
  const shallow = (a: number): RGBA => rgba(STREAM_SHALLOW, a);
  b.ribbon(layout.stream, 0.8, [
    { offset: -half - STREAM_FRINGE, y: STREAM_Y, color: () => shallow(0) },
    { offset: -half, y: STREAM_Y, color: () => shallow(0.6) },
    { offset: 0, y: STREAM_Y, color: () => rgba(STREAM_DEEP, 0.8) },
    { offset: half, y: STREAM_Y, color: () => shallow(0.6) },
    { offset: half + STREAM_FRINGE, y: STREAM_Y, color: () => shallow(0) },
  ]);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.name = 'stream';
  mesh.renderOrder = 1;
  return { mesh, material };
}

// ---- the zone -------------------------------------------------------------------------------------

/** An animal: a holder that stays put, the primitive stand-in, and later the model and its animator. */
interface Animal {
  holder: THREE.Group;
  primitive: THREE.Mesh;
  animator?: ModelAnimator | undefined;
}

export function createNatureTrail(deps: ZoneDeps): Zone {
  const layout = natureTrailLayout();
  const root = new THREE.Group();
  root.name = 'nature-trail';

  // Ground and surfaces use their own random streams, so props never move when they change.
  root.add(createGroundApron(GRASS_COLOR));
  root.add(
    createGround({
      size: GROUND_SIZE,
      rng: mulberry32(SEED + 2),
      grass: GRASS_COLOR,
      dirt: DIRT_COLOR,
      path: { center: { x: layout.spawn.x, z: layout.spawn.z - 0.5 }, radius: 3.4, feather: 2.6 },
    }),
  );
  root.add(pathMesh(layout, mulberry32(SEED + 3)));
  const stream = streamMesh(layout);
  root.add(stream.mesh);

  // ---- trees, rocks, stumps, plants ---------------------------------------------------------------
  const primitiveTrees = tree(mulberry32(SEED + 4), layout.trees);
  root.add(primitiveTrees);

  const primitiveRockMesh = primitiveRocks(layout.rocks);
  root.add(primitiveRockMesh);

  const stumpGeometry = new THREE.CylinderGeometry(0.6, 0.7, 0.8, 8).translate(0, 0.4, 0);
  const primitiveStumps = instancedPrimitive('stumps', stumpGeometry, 0x8a6038, layout.stumps);
  if (layout.stumps.length > 0) root.add(primitiveStumps);

  // Plants gather at the edges of the path, the stream and the props, and keep off the spawn, the
  // open spots and the animals. Decoration only: the player walks through them.
  const avoid: AvoidCircle[] = [{ x: layout.spawn.x, z: layout.spawn.z, radius: 2.5 }];
  for (let s = 0; s <= layout.path.length; s += 1) {
    const p = layout.path.pointAt(s);
    avoid.push({ x: p.x, z: p.z, radius: layout.pathHalf + 0.55 });
  }
  for (let s = 0; s <= layout.stream.length; s += 1.2) {
    const p = layout.stream.pointAt(s);
    avoid.push({ x: p.x, z: p.z, radius: layout.streamHalf + 0.7 });
  }
  for (const c of layout.blockers) avoid.push({ x: c.x, z: c.z, radius: c.r + 0.4 });
  avoid.push(
    { x: layout.lookoutPad.x, z: layout.lookoutPad.z, radius: layout.lookoutPad.r },
    { x: layout.campPad.x, z: layout.campPad.z, radius: layout.campPad.r },
  );
  for (const s of layout.openSpots) avoid.push({ x: s.x, z: s.z, radius: 1.1 });
  for (const a of [layout.rabbit, layout.frog, layout.bird]) avoid.push({ x: a.x, z: a.z, radius: 0.9 });
  const edge = NATURE_TRAIL_HALF - 0.5;
  root.add(
    scatterPlants(
      mulberry32(SEED + 5),
      PLANT_COUNT,
      { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge },
      avoid,
      { edgeFalloff: 4 },
    ),
  );

  // ---- landmark groups: each holds its label sprite (a browser has a canvas, node does not) ------
  const landmarkGroup = (id: string, p: Spot, label: string, labelHeight: number): THREE.Group => {
    const group = new THREE.Group();
    group.name = `landmark:${id}`;
    group.position.set(p.x, 0, p.z);
    const sprite = labelSprite(label);
    if (sprite) {
      sprite.position.set(0, labelHeight, 0);
      group.add(sprite);
    }
    root.add(group);
    return group;
  };

  // ---- signposts: the trailhead and the way back to camp -------------------------------------------
  const signGeo = signGeometry();
  const signMat = flatMaterial();
  const signs: Array<{ holder: THREE.Group; primitive: THREE.Mesh }> = [];
  const addSign = (parent: THREE.Object3D, yaw: number): void => {
    const holder = new THREE.Group();
    holder.name = 'signpost';
    holder.rotation.y = yaw;
    const primitive = new THREE.Mesh(signGeo, signMat);
    setShadowCasting(primitive, true, true);
    holder.add(primitive);
    parent.add(holder);
    signs.push({ holder, primitive });
  };
  const trailhead = landmarkGroup('trailhead', layout.landmarks.trailhead, 'Trailhead sign', 3.2);
  addSign(trailhead, layout.trailheadSign.yaw);

  const backSignHolder = new THREE.Group();
  backSignHolder.name = 'trail-sign';
  backSignHolder.position.set(layout.backSign.x, 0, layout.backSign.z);
  addSign(backSignHolder, layout.backSign.yaw);
  root.add(backSignHolder);

  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(layout.backSign.x, SIGN_LABEL_HEIGHT, layout.backSign.z),
    radius: SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: deps.onReturnToBaseCamp,
  };

  // ---- footbridge ---------------------------------------------------------------------------------
  const footbridge = landmarkGroup('footbridge', layout.landmarks.footbridge, 'Footbridge', 2.1);
  const bridgePivot = new THREE.Group();
  bridgePivot.name = 'footbridge';
  bridgePivot.rotation.y = BRIDGE_YAW;
  const primitiveBridge = new THREE.Mesh(bridgeGeometry(), flatMaterial());
  setShadowCasting(primitiveBridge, true, true);
  bridgePivot.add(primitiveBridge);
  footbridge.add(bridgePivot);

  // ---- lookout: the rocks are in the rock mesh; the group carries the label -------------------------
  landmarkGroup('lookout', layout.landmarks.lookout, 'Lookout rock', 3.4);

  // ---- campsite: tent, campfire, firewood, log seats ----------------------------------------------
  landmarkGroup('campsite', layout.landmarks.campsite, 'Campsite', 2.9);
  const fire = campfire();
  fire.root.position.set(layout.fire.x, 0, layout.fire.z);
  root.add(fire.root);

  const tentMesh = new THREE.Mesh(tentGeometry(), flatMaterial());
  tentMesh.name = 'tent';
  tentMesh.position.set(layout.tent.x, 0, layout.tent.z);
  tentMesh.rotation.y = layout.tent.yaw ?? 0;
  setShadowCasting(tentMesh, true, true);
  root.add(tentMesh);

  const firewoodMesh = new THREE.Mesh(firewoodGeometry(), flatMaterial());
  firewoodMesh.name = 'firewood';
  firewoodMesh.position.set(layout.firewood.x, 0, layout.firewood.z);
  firewoodMesh.rotation.y = layout.firewood.yaw ?? 0;
  setShadowCasting(firewoodMesh, true, true);
  root.add(firewoodMesh);

  const seatGeometry = new THREE.CylinderGeometry(0.26, 0.26, 2.2, 7).rotateX(Math.PI / 2).translate(0, 0.26, 0);
  const primitiveSeats = instancedPrimitive('seats', seatGeometry, 0x7a5233, layout.seats);
  root.add(primitiveSeats);

  // ---- animals: primitives now, models and idle animations later ------------------------------------
  const makeAnimal = (name: string, spec: AnimalSpec, geometry: THREE.BufferGeometry): Animal => {
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.set(spec.x, spec.y, spec.z);
    holder.rotation.y = spec.yaw;
    const primitive = new THREE.Mesh(geometry, flatMaterial());
    setShadowCasting(primitive, true, true);
    holder.add(primitive);
    root.add(holder);
    return { holder, primitive };
  };
  const rabbit = makeAnimal('animal.rabbit', layout.rabbit, rabbitGeometry());
  const frog = makeAnimal('animal.frog', layout.frog, frogGeometry());
  const bird = makeAnimal('animal.bird', layout.bird, birdGeometry());

  // ---- progressive swap: primitives stay until the models arrive -----------------------------------
  const swapInModels = (): void => {
    const modelRng = mulberry32(SEED + 6); // separate stream, so the primitive layout never shifts

    const trees = scatterModels('trees', TREE_MODELS, layout.trees, modelRng, [0.85, 1.35]);
    if (trees) {
      root.remove(primitiveTrees);
      root.add(trees);
    }

    // Rocks: swapped as a set, so a partial load never leaves a lookout with missing stones.
    const rockIds = [...new Set(layout.rocks.map((r) => ROCK_MODEL[r.kind]))];
    if (rockIds.every((id) => assets.has(id))) {
      const group = new THREE.Group();
      group.name = 'rocks';
      for (const id of rockIds) {
        const placements = layout.rocks
          .filter((r) => ROCK_MODEL[r.kind] === id)
          .map((r): Placement => ({ x: r.x, z: r.z, yaw: r.yaw, scale: r.scale }));
        const mesh = instancedModel(id, placements);
        if (mesh) group.add(mesh);
      }
      if (group.children.length > 0) {
        root.remove(primitiveRockMesh);
        root.add(group);
      }
    }

    const flagstones = instancedModel('path.stone', layout.flagstones);
    if (flagstones) root.add(flagstones);

    const stumps = instancedModel('stump', layout.stumps);
    if (stumps) {
      root.remove(primitiveStumps);
      root.add(stumps);
    }

    const seats = instancedModel('log.single', layout.seats);
    if (seats) {
      root.remove(primitiveSeats);
      root.add(seats);
    }

    const tents = instancedModel('tent.small', [layout.tent]);
    if (tents) {
      root.remove(tentMesh);
      root.add(tents);
    }
    const wood = instancedModel('log.stack', [layout.firewood]);
    if (wood) {
      root.remove(firewoodMesh);
      root.add(wood);
    }

    fire.useModel();

    if (assets.has('signpost')) {
      for (const sign of signs) {
        const model = assets.instance('signpost');
        setShadowCasting(model, true, true);
        sign.holder.remove(sign.primitive);
        sign.holder.add(model);
      }
    }

    if (assets.has('bridge')) {
      const model = assets.instance('bridge');
      model.scale.copy(BRIDGE_SCALE);
      setShadowCasting(model, true, true);
      bridgePivot.remove(primitiveBridge);
      bridgePivot.add(model);
    }

    const swapAnimal = (animal: Animal, id: string, scale: number, animated: boolean): void => {
      if (!assets.has(id)) return;
      const model = assets.instance(id);
      model.scale.setScalar(scale);
      setShadowCasting(model, true, true);
      animal.holder.remove(animal.primitive);
      animal.holder.add(model);
      if (animated) {
        animal.animator = assets.animator(id, model);
        animal.animator?.play('idle', 0);
        animal.animator?.update(modelRng()); // so the two do not move in step
      }
    };
    swapAnimal(rabbit, 'animal.rabbit', RABBIT_SCALE, true);
    swapAnimal(frog, 'animal.frog', FROG_SCALE, true);
    swapAnimal(bird, 'animal.bird', BIRD_SCALE, false); // the bird has no clips; update() turns its head
  };

  assets
    .load(NATURE_TRAIL_MODELS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[nature-trail] could not swap in models, keeping placeholder art', err);
    });

  let time = 0;
  const birdYaw = layout.bird.yaw;

  return {
    id: 'nature-trail',
    root,
    bounds: squareBounds(NATURE_TRAIL_HALF),
    spawn: new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z),
    interactables: [back],
    colliders: layout.colliders,
    openSpots: layout.openSpots.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    landmarks: {
      trailhead: new THREE.Vector3(layout.landmarks.trailhead.x, 0, layout.landmarks.trailhead.z),
      footbridge: new THREE.Vector3(layout.landmarks.footbridge.x, 0, layout.landmarks.footbridge.z),
      lookout: new THREE.Vector3(layout.landmarks.lookout.x, 0, layout.landmarks.lookout.z),
      campsite: new THREE.Vector3(layout.landmarks.campsite.x, 0, layout.landmarks.campsite.z),
    },
    update: (dt: number) => {
      time += dt;
      fire.update(dt);
      rabbit.animator?.update(dt);
      frog.animator?.update(dt);
      bird.holder.rotation.y = birdYaw + Math.sin(time * 0.8) * 0.5; // looks around
      stream.material.opacity = 0.92 + 0.06 * Math.sin(time * 1.3); // a slow shimmer
    },
  };
}
