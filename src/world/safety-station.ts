/**
 * Safety Station: the personal-safety zone (Wolf "Safety in Numbers", Arrow of Light "First Aid").
 *
 * A 35 by 35 lawn. Looking from the spawn (+z edge) toward -z:
 *   - across the back: a fire station, with a street in front of it (a crossing at the middle, a stop
 *     sign and two street lamps on the near sidewalk) and a paved path from the spawn to the crossing;
 *   - on the left: a playground (slide, swing set, sandbox) built from primitives, since there are no
 *     models for it. The two swing seats sway gently in `update`;
 *   - on the right: two houses behind a fence, with a "Safe meeting spot" signpost in the gap;
 *   - near the middle: a first-aid tent with a white cross on a green board above it.
 *
 * Every prop starts as a primitive (vertex-colored parts merged into one mesh per prop, so the
 * placeholder art costs 21 draw calls, 23 with the two label sprites a browser adds) and is swapped
 * for the CC0 model once it loads, so the zone never waits on assets. After the swap it is 26 draw
 * calls (28 with the sprites), and the sun's shadow pass redraws the 16 casting meshes. The zone
 * carries no lights: the world's environment lights every zone.
 *
 * Solid things block the player (see `Zone.colliders`): tree trunks, the fire station, the two
 * houses, the fence, the stop sign, the lamps, both signposts, the first-aid tent, the slide, the
 * swing set and the sandbox. The street, the sidewalks and the paved path from the spawn stay
 * clear, and so do the open spots and the spawn.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint, squareBounds } from './bounds';
import { boxCollider, circleCollider, type Collider } from './collide';
import { createGround, createGroundApron } from './ground';
import { labelSprite } from './placeholder-zone';
import {
  instancedModel,
  scatterModels,
  scatterPlants,
  tree,
  treeColliders,
  type AvoidCircle,
  type Placement,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';
import type { ZoneDeps } from './zones';

// ---- layout -------------------------------------------------------------------------------------

const SEED = 3104;
/** The player may walk this far from the center in x and z (a 35 by 35 lawn). */
const WALK_HALF = 17.5;
const GROUND_SIZE = 50;
const GRASS_COLOR = 0x5f9e45;
const TREE_COUNT = 32;
const PLANT_COUNT = 90;

const SPAWN = new THREE.Vector3(0, 0, 14.5);
/** The Trail sign: a few steps to the left of the spawn, turned a little toward the player. */
const TRAIL_SIGN = { x: -3.4, z: 14.4, yaw: 0.3, scale: 1.15 };
const TRAIL_SIGN_RADIUS = 2;

const STATION = { x: 0, z: -13.6, scale: 1.25 };
const ROAD_Z = -6.2;
const ROAD_TILE = 5.5;
/** Straight road tiles along x; the crossing tile takes the middle (x = 0). */
const ROAD_TILE_XS = [-16.5, -11, -5.5, 5.5, 11, 16.5];
const ROAD_HALF_LENGTH = 19.25;
/** The road models are set 0.07 below the ground in the manifest; lift them so the asphalt shows. */
const ROAD_LIFT = 0.07;
const SIDEWALK_Z = -2.525; // near sidewalk, z -3.45 to -1.6
const STOP_SIGN = { x: 2.7, z: -2.75, yaw: Math.PI / 2, scale: 1.3 }; // yaw: the plate faces the lawn
const LAMPS: readonly Spot[] = [
  { x: -8.2, z: -2.6 },
  { x: 8.2, z: -2.6 },
];

/** What each prop blocks, as half sizes (boxes) or radii (circles). Posts are thin, so small circles. */
const POST_COLLIDER_RADIUS = 0.3;
const STATION_HALF = { hw: 3.0, hd: 3.1 } as const; // the model at 1.25 times is 6.1 by 6.5
const TENT_HALF = { hw: 2.3, hd: 1.85 } as const; // the A-frame is 4.6 wide and 3.7 deep
const SWING_HALF = { hw: 2.5, hd: 1.0 } as const; // two A-frames 4.6 apart, legs 2 apart
const SANDBOX_COLLIDER_RADIUS = 2.2; // the ring of stones and the sand inside it
const FENCE_HALF = { hw: 0.15, hd: 2.0 } as const; // each fence run is 4 long and thin

const SLIDE = { x: -14.4, z: 3.2, yaw: Math.PI / 2 }; // ramp runs toward +x
/** The slide's frame, ladder, platform and ramp run from -1.9 to 3.7 along its own z, about 1.4 wide. */
const SLIDE_HALF = { hw: 0.7, hd: 2.8 } as const;
const SLIDE_MIDDLE = 0.9; // where the middle of that run is, along the slide's own z
const SWING = { x: -9.2, z: 6.3, yaw: 0.5 };
const SWING_BAR_Y = 3;
const SWING_PIVOT_X = 0.8;
const SWING_ROPE = 2.2;
const SANDBOX = { x: -13.8, z: 10.9, ringRadius: 1.75, rocks: 9 };

const TENT = { x: 5.2, z: 1.4, yaw: -0.4, scale: 1.3 };

const HOUSES = [
  { id: 'building.house.a', x: 13.6, z: 3.4, w: 7.1, d: 5.6, wall: 3.0, rise: 1.6, body: 0xf3d9a4, roof: 0xb5523b, windowsX: [-2.3, 2.3], upper: false },
  { id: 'building.house.c', x: 13.9, z: 12.2, w: 5.6, d: 5.6, wall: 3.8, rise: 2.4, body: 0xa8c8e8, roof: 0x4f5560, windowsX: [-1.7, 1.7], upper: true },
] as const;
const HOUSE_YAW = -Math.PI / 2; // the front door faces the lawn
const FENCE_X = 9.7;
const FENCE_ZS = [1.4, 5.4, 13.4]; // 4 units each; the gap between 7.4 and 11.4 is where the sign stands
const MEETING_SIGN = { x: 8.3, z: 9.4, scale: 1.3 };

/** Extra trees inside the lawn, along the front edge. The ring outside the walkable square is separate. */
const EDGE_TREES: readonly Spot[] = [
  { x: -15.8, z: 16.0 },
  { x: -12.4, z: 16.8 },
  { x: 7.4, z: 16.7 },
  { x: 15.8, z: 17.0 },
];

const TREE_MODELS = ['tree.round', 'tree.pine'] as const;
const PLANT_MODELS = ['plant.grass', 'plant.grass.large', 'plant.flower.yellow', 'plant.flower.red', 'plant.bush'] as const;
const STATION_MODELS = [
  'building.firestation',
  'building.house.a',
  'building.house.c',
  'street.straight',
  'street.crossing',
  'street.sign.stop',
  'street.lamp',
  'fence.simple',
  'signpost',
  'signpost.single',
  'tent.open',
  'rock.flat',
  ...TREE_MODELS,
] as const;

/** Yaw that turns a model whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

// ---- keep-out shapes: where props stand, so open spots and plants stay off them ------------------

export type KeepOut =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; minX: number; maxX: number; minZ: number; maxZ: number };

const circle = (x: number, z: number, r: number): KeepOut => ({ kind: 'circle', x, z, r });
const box = (minX: number, maxX: number, minZ: number, maxZ: number): KeepOut => ({ kind: 'box', minX, maxX, minZ, maxZ });

/**
 * The ground the props stand on, with room for their moving parts (the swing arc, the tent
 * ropes). Open spots stay at least `OPEN_SPOT_CLEARANCE` outside every one of these. Exported so
 * the tests can check the same shapes.
 */
export const SAFETY_STATION_KEEP_OUT: readonly KeepOut[] = [
  box(-3.5, 3.5, -17.3, -10.2), // fire station
  box(-19.3, 19.3, -8.8, -3.6), // the road
  box(-16.5, -10.5, 2.2, 4.2), // slide
  circle(SWING.x, SWING.z, 3.0), // swing set and its arc
  circle(SANDBOX.x, SANDBOX.z, 2.5), // sandbox and its rocks
  circle(TENT.x, TENT.z, 3.0), // first-aid tent and its cross
  circle(STOP_SIGN.x, STOP_SIGN.z, 0.7),
  ...LAMPS.map((l) => circle(l.x, l.z, 0.6)),
  circle(MEETING_SIGN.x, MEETING_SIGN.z, 1.0),
  box(FENCE_X - 0.3, FENCE_X + 0.3, -0.8, 7.6), // fence, first run
  box(FENCE_X - 0.3, FENCE_X + 0.3, 11.2, 15.6), // fence, second run
  box(10.7, 16.8, -0.4, 15.2), // the two houses
  circle(TRAIL_SIGN.x, TRAIL_SIGN.z, 0.7),
  ...EDGE_TREES.map((t) => circle(t.x, t.z, 1.2)),
];

/** Open spots stay this far outside every keep-out shape. */
export const OPEN_SPOT_CLEARANCE = 0.8;
/** Open spots keep this far from the spawn and the Trail sign (the placeholder zones use 3). */
const SPOT_KEEP_FROM_SPAWN = 3.6;
/** Open spots keep this far from each other (the contract asks for 2). */
const SPOT_MIN_GAP = 2.4;
const SPOT_JITTER = 0.6;

/** Distance from (x, z) to the keep-out shape; 0 or less means inside. */
export function gapTo(x: number, z: number, k: KeepOut): number {
  if (k.kind === 'circle') return Math.hypot(x - k.x, z - k.z) - k.r;
  const dx = Math.max(k.minX - x, 0, x - k.maxX);
  const dz = Math.max(k.minZ - z, 0, z - k.maxZ);
  if (dx === 0 && dz === 0) return -Math.min(x - k.minX, k.maxX - x, z - k.minZ, k.maxZ - z);
  return Math.hypot(dx, dz);
}

/**
 * Hand-picked homes for the open spots: the playground, the near sidewalk (one on the far side of
 * the street), and the lawn. Each gets a small seeded nudge when the nudge is still clear.
 */
const OPEN_SPOT_ANCHORS: readonly Spot[] = [
  // playground
  { x: -8.2, z: 1.9 },
  { x: -15.5, z: 6.6 },
  { x: -8.6, z: 11.6 },
  // near sidewalk, and the far side of the crossing
  { x: -11.6, z: -2.5 },
  { x: -5.2, z: -2.5 },
  { x: 0, z: -2.5 },
  { x: 5.8, z: -2.5 },
  { x: -6.4, z: -9.7 },
  // lawn
  { x: -3.4, z: 3.4 },
  { x: -3.2, z: 9.0 },
  { x: 3.4, z: 9.0 },
  { x: 4.4, z: 5.8 },
  { x: 6.2, z: 13.0 },
];

function placeOpenSpots(rng: () => number): THREE.Vector3[] {
  const keepFrom = [SPAWN, new THREE.Vector3(TRAIL_SIGN.x, 0, TRAIL_SIGN.z)];
  const spots: THREE.Vector3[] = [];
  const isOpen = (x: number, z: number): boolean =>
    Math.abs(x) <= WALK_HALF - 1 &&
    Math.abs(z) <= WALK_HALF - 1 &&
    SAFETY_STATION_KEEP_OUT.every((k) => gapTo(x, z, k) >= OPEN_SPOT_CLEARANCE) &&
    keepFrom.every((p) => Math.hypot(p.x - x, p.z - z) >= SPOT_KEEP_FROM_SPAWN) &&
    spots.every((s) => Math.hypot(s.x - x, s.z - z) >= SPOT_MIN_GAP);
  for (const anchor of OPEN_SPOT_ANCHORS) {
    const nudgedX = anchor.x + (rng() * 2 - 1) * SPOT_JITTER; // two draws per anchor, always
    const nudgedZ = anchor.z + (rng() * 2 - 1) * SPOT_JITTER;
    const pick = isOpen(nudgedX, nudgedZ) ? { x: nudgedX, z: nudgedZ } : anchor;
    spots.push(new THREE.Vector3(pick.x, 0, pick.z));
  }
  return spots;
}

/** Circles that cover a keep-out shape (plus `pad`), for `scatterPlants`. */
function avoidCircles(k: KeepOut, pad: number): AvoidCircle[] {
  if (k.kind === 'circle') return [{ x: k.x, z: k.z, radius: k.r + pad }];
  const w = k.maxX - k.minX;
  const d = k.maxZ - k.minZ;
  const short = Math.max(Math.min(w, d) / 2, 0.4);
  const radius = short * 1.25 + pad;
  const step = short * 1.5;
  const alongX = w >= d;
  const length = alongX ? w : d;
  const count = Math.max(1, Math.ceil(length / step));
  const out: AvoidCircle[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    out.push(
      alongX
        ? { x: k.minX + w * t, z: (k.minZ + k.maxZ) / 2, radius }
        : { x: (k.minX + k.maxX) / 2, z: k.minZ + d * t, radius },
    );
  }
  return out;
}

// ---- merged primitive meshes --------------------------------------------------------------------

const COLOR = {
  red: 0xc23b32,
  redDark: 0x8f2a24,
  roofGray: 0x5d636b,
  doorLight: 0xdfe4e8,
  doorFrame: 0x2b2f36,
  glass: 0x9fcbe6,
  yellow: 0xf2c744,
  asphalt: 0x4d525a,
  curb: 0xb9bcc0,
  white: 0xf5f5ef,
  concrete: 0xcdc8bd,
  mulch: 0xa57f55,
  sand: 0xe8d49b,
  blue: 0x2f6fd0,
  toyRed: 0xd64545,
  orange: 0xf28c28,
  green: 0x3aa655,
  rope: 0x555a60,
  wood: 0x6b4a2b,
  board: 0xd9b36c,
  door: 0x6b4a2b,
  window: 0xbfe3ff,
  canvas: 0xe9dfc2,
  tentDark: 0x3c3a33,
  aidGreen: 0x2e9e5b,
  pole: 0x6c7279,
  lampHead: 0xfff1b0,
  stone: 0x9aa0a6,
} as const;

type Vec3 = readonly [number, number, number];

/**
 * Collects boxes, cylinders and prisms, each with its own color, and merges them into ONE mesh
 * (vertex colors, flat shading), so a whole prop costs a single draw call. Everything added goes
 * into the current frame: a position on the ground and a turn about the up axis, which lets a prop
 * be built facing +z at the origin and then placed.
 */
class PartBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly frame = new THREE.Matrix4();
  private readonly scratch = new THREE.Matrix4();
  private readonly tint = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly side = new THREE.Vector3(1, 0, 0);

  constructor(x = 0, z = 0, yaw = 0) {
    this.setFrame(x, z, yaw);
  }

  setFrame(x: number, z: number, yaw = 0): this {
    this.frame.makeRotationY(yaw).setPosition(x, 0, z);
    return this;
  }

  private push(geometry: THREE.BufferGeometry, color: number, local: THREE.Matrix4): this {
    let g = geometry;
    if (geometry.index) {
      g = geometry.toNonIndexed();
      geometry.dispose();
    }
    g.deleteAttribute('uv');
    g.applyMatrix4(this.scratch.multiplyMatrices(this.frame, local));
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    this.tint.set(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = this.tint.r;
      colors[i * 3 + 1] = this.tint.g;
      colors[i * 3 + 2] = this.tint.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  private static at(x: number, y: number, z: number, yaw = 0): THREE.Matrix4 {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(1, 1, 1),
    );
  }

  /** A box. (x, y, z) is the middle of its bottom face. */
  box(color: number, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0): this {
    return this.push(new THREE.BoxGeometry(w, h, d), color, PartBuilder.at(x, y + h / 2, z, yaw));
  }

  /** An upright cylinder. (x, y, z) is the middle of its bottom face. */
  cyl(color: number, radius: number, h: number, x: number, y: number, z: number, radial = 8): this {
    return this.push(new THREE.CylinderGeometry(radius, radius, h, radial), color, PartBuilder.at(x, y + h / 2, z));
  }

  /** A triangular prism: width `w` along x, rise `rise`, length `d` along z (the ridge). Bottom at y. */
  gable(color: number, w: number, d: number, rise: number, x: number, y: number, z: number): this {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
    return this.push(geometry, color, PartBuilder.at(x, y, z));
  }

  /** A thin cylinder from point a to point b. */
  rod(color: number, radius: number, a: Vec3, b: Vec3, radial = 6): this {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const length = dir.length();
    const local = new THREE.Matrix4().compose(
      from.clone().addScaledVector(dir, 0.5),
      new THREE.Quaternion().setFromUnitVectors(this.up, dir.normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    return this.push(new THREE.CylinderGeometry(radius, radius, length, radial), color, local);
  }

  /** A box from point a to point b: `w` wide (sideways), `h` thick, as long as the distance between them. */
  strut(color: number, w: number, h: number, a: Vec3, b: Vec3): this {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const length = dir.length();
    const upHint = Math.abs(dir.y / length) > 0.98 ? this.side : this.up;
    const local = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), upHint);
    local.setPosition(from.clone().addScaledVector(dir, 0.5));
    return this.push(new THREE.BoxGeometry(w, h, length), color, local);
  }

  build(name: string, material: THREE.Material): THREE.Mesh {
    const merged = mergeGeometries(this.parts);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error(`safety-station: could not merge the parts of "${name}"`);
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    return mesh;
  }
}

// ---- the props, as primitives -------------------------------------------------------------------

/** The fire station: red body, hose tower, two bays. About the size of the model at its 1.25 scale. */
function fireStationPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder(STATION.x, STATION.z);
  b.box(COLOR.red, 6.0, 5.4, 6.0, 0, 0, 0);
  b.box(COLOR.roofGray, 6.3, 0.3, 6.3, 0, 5.4, 0);
  b.box(COLOR.redDark, 1.9, 8.8, 1.9, 1.9, 0, -1.9); // hose tower, rear right
  b.box(COLOR.roofGray, 2.2, 0.3, 2.2, 1.9, 8.8, -1.9);
  b.box(COLOR.yellow, 6.02, 0.4, 0.1, 0, 3.7, 3.0); // a stripe across the front
  for (const x of [-1.5, 1.5]) {
    b.box(COLOR.doorFrame, 2.3, 3.0, 0.1, x, 0, 3.0);
    b.box(COLOR.doorLight, 1.9, 2.6, 0.14, x, 0.05, 3.02);
  }
  for (const x of [-1.5, 1.5]) b.box(COLOR.glass, 1.0, 0.8, 0.1, x, 4.3, 3.02);
  return b.build('firestation-primitive', material);
}

/** Asphalt, curbs, a dashed center line, and a zebra crossing at the middle. The road models, lifted, match it. */
function streetPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  const roadWidth = ROAD_TILE * 0.8;
  b.box(COLOR.asphalt, ROAD_HALF_LENGTH * 2, 0.055, roadWidth, 0, 0, ROAD_Z);
  for (const side of [-1, 1]) {
    b.box(COLOR.curb, ROAD_HALF_LENGTH * 2, 0.11, 0.55, 0, 0, ROAD_Z + side * (roadWidth / 2 + 0.275));
  }
  for (let x = -16.8; x <= 16.8; x += 2.4) {
    if (Math.abs(x) >= 2.3) b.box(COLOR.white, 1.2, 0.01, 0.14, x, 0.055, ROAD_Z);
  }
  for (let i = -2; i <= 2; i++) b.box(COLOR.white, 0.3, 0.012, 3.8, i * 0.55, 0.055, ROAD_Z);
  return b.build('street-primitive', material);
}

/** The near sidewalk, the strip in front of the fire station, and the path from the spawn to the crossing. */
function sidewalkPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  b.box(COLOR.concrete, ROAD_HALF_LENGTH * 2, 0.06, 1.85, 0, 0, SIDEWALK_Z);
  b.box(COLOR.concrete, ROAD_HALF_LENGTH * 2, 0.06, 1.45, 0, 0, -9.675);
  b.box(COLOR.concrete, 2.2, 0.05, 17.6, 0, 0, 7.2);
  return b.build('sidewalks', material);
}

function stopSignPrimitive(material: THREE.Material): THREE.Mesh {
  const s = STOP_SIGN.scale;
  const b = new PartBuilder(STOP_SIGN.x, STOP_SIGN.z, STOP_SIGN.yaw);
  b.cyl(COLOR.pole, 0.05 * s, 2.2 * s, 0, 0, 0, 6);
  // The model's plate faces -x, so the primitive's does too: a red octagon with a white bar for the word.
  b.rod(COLOR.toyRed, 0.42 * s, [-0.02, 2.25 * s, 0], [-0.1, 2.25 * s, 0], 8);
  b.box(COLOR.white, 0.03, 0.1 * s, 0.5 * s, -0.11, 2.2 * s, 0);
  return b.build('stop-sign-primitive', material);
}

function lampsPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  for (const lamp of LAMPS) {
    b.setFrame(lamp.x, lamp.z);
    b.cyl(COLOR.pole, 0.1, 5.0, 0, 0, 0, 6);
    b.box(COLOR.pole, 0.18, 0.18, 1.8, 0, 4.82, -0.9); // the arm reaches over the road (-z), like the model
    b.box(COLOR.lampHead, 0.5, 0.14, 0.5, 0, 4.7, -1.75);
  }
  return b.build('lamps-primitive', material);
}

type HouseSpec = (typeof HOUSES)[number];

function housePrimitive(spec: HouseSpec, material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder(spec.x, spec.z, HOUSE_YAW);
  const front = spec.d / 2 + 0.03;
  b.box(spec.body, spec.w, spec.wall, spec.d, 0, 0, 0);
  b.gable(spec.roof, spec.w + 0.5, spec.d + 0.5, spec.rise, 0, spec.wall, 0);
  b.box(COLOR.door, 1.0, 2.0, 0.12, 0, 0, front);
  for (const x of spec.windowsX) b.box(COLOR.window, 1.0, 1.0, 0.12, x, 1.1, front);
  if (spec.upper) for (const x of spec.windowsX) b.box(COLOR.window, 1.0, 1.0, 0.12, x, 2.5, front);
  b.box(spec.roof, 0.7, 1.4, 0.7, spec.w / 4, spec.wall + 0.6, -spec.d / 4); // chimney
  return b.build(`${spec.id}-primitive`, material);
}

function fencePrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  for (const z of FENCE_ZS) {
    b.setFrame(FENCE_X, z, Math.PI / 2);
    for (const x of [-1.9, 0, 1.9]) b.box(COLOR.wood, 0.14, 1.3, 0.14, x, 0, 0);
    b.box(COLOR.board, 4, 0.12, 0.06, 0, 0.35, 0);
    b.box(COLOR.board, 4, 0.12, 0.06, 0, 0.85, 0);
  }
  return b.build('fence-primitive', material);
}

/** A wooden post with a board on it. Faces +z in its own frame. */
function signpostPrimitive(
  name: string,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  boardColor: number,
  material: THREE.Material,
): THREE.Mesh {
  const b = new PartBuilder(x, z, yaw);
  b.cyl(COLOR.wood, 0.1 * scale, 2.4 * scale, 0, 0, 0, 8);
  b.box(boardColor, 1.1 * scale, 0.55 * scale, 0.1 * scale, 0, 1.75 * scale, 0.12 * scale);
  return b.build(name, material);
}

/** An A-frame tent with a dark doorway. Faces +z. About the size of `tent.open` at its 1.3 scale. */
function tentPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder(TENT.x, TENT.z, TENT.yaw);
  b.gable(COLOR.canvas, 4.6, 3.7, 3.1, 0, 0, 0);
  b.gable(COLOR.tentDark, 2.0, 0.06, 2.2, 0, 0, 1.87);
  return b.build('tent-primitive', material);
}

/** The first-aid sign above the tent: a green board with a white cross (two thin boxes) on a pole. */
function firstAidCross(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder(TENT.x, TENT.z, TENT.yaw);
  b.cyl(COLOR.pole, 0.07, 1.0, 0, 2.7, 0, 6);
  b.box(COLOR.aidGreen, 1.7, 1.7, 0.1, 0, 3.6, 0);
  b.box(COLOR.white, 1.15, 0.36, 0.06, 0, 4.27, 0.08);
  b.box(COLOR.white, 0.36, 1.15, 0.06, 0, 3.875, 0.08);
  return b.build('first-aid-cross', material);
}

/** Mulch, the sandbox sand, a slide, and the swing set's frame. The swing seats are separate (they move). */
function playgroundPrimitive(material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  b.box(COLOR.mulch, 10.4, 0.05, 12.2, -11.5, 0, 7.2); // x -16.7 to -6.3, z 1.1 to 13.3
  b.cyl(COLOR.sand, SANDBOX.ringRadius - 0.15, 0.07, SANDBOX.x, 0, SANDBOX.z, 16);

  // Slide, built with the ramp running along +z, then turned by the frame.
  b.setFrame(SLIDE.x, SLIDE.z, SLIDE.yaw);
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.55, 0.55]) b.box(COLOR.blue, 0.14, 2.7, 0.14, sx, 0, sz);
  }
  b.box(COLOR.orange, 1.3, 0.12, 1.3, 0, 1.9, 0);
  for (const sx of [-0.55, 0.55]) b.box(COLOR.blue, 0.08, 0.08, 1.1, sx, 2.5, 0);
  for (const sx of [-0.4, 0.4]) b.strut(COLOR.toyRed, 0.1, 0.1, [sx, 0, -1.9], [sx, 1.95, -0.6]);
  for (const t of [0.2, 0.4, 0.6, 0.8]) b.box(COLOR.toyRed, 0.8, 0.06, 0.08, 0, 1.95 * t, -1.9 + 1.3 * t);
  b.strut(COLOR.yellow, 0.9, 0.08, [0, 1.97, 0.65], [0, 0.34, 3.7]);
  for (const sx of [-0.5, 0.5]) b.strut(COLOR.blue, 0.07, 0.22, [sx, 2.1, 0.65], [sx, 0.46, 3.7]);

  // Swing set frame: two A-frames and a crossbar along x.
  b.setFrame(SWING.x, SWING.z, SWING.yaw);
  for (const sx of [-2.3, 2.3]) {
    b.strut(COLOR.blue, 0.15, 0.15, [sx, 0, 1.0], [sx, SWING_BAR_Y, 0]);
    b.strut(COLOR.blue, 0.15, 0.15, [sx, 0, -1.0], [sx, SWING_BAR_Y, 0]);
  }
  b.rod(COLOR.toyRed, 0.1, [-2.45, SWING_BAR_Y, 0], [2.45, SWING_BAR_Y, 0]);
  return b.build('playground', material);
}

/** One swing seat with its two ropes, built hanging below its pivot (the origin). */
function swingSeatPrimitive(seatColor: number, material: THREE.Material): THREE.Mesh {
  const b = new PartBuilder();
  for (const x of [-0.3, 0.3]) b.rod(COLOR.rope, 0.035, [x, 0, 0], [x, -SWING_ROPE, 0]);
  b.box(seatColor, 0.9, 0.08, 0.34, 0, -SWING_ROPE - 0.08, 0);
  return b.build('swing-seat-mesh', material);
}

/** Flat stones around the sandbox: one InstancedMesh, 1 draw call. */
function sandboxRocksPrimitive(placements: readonly Placement[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.6, 0).translate(0, 0.6, 0),
    new THREE.MeshLambertMaterial({ color: COLOR.stone, flatShading: true }),
    placements.length,
  );
  mesh.name = 'sandbox-rocks-primitive';
  const m = new THREE.Object3D();
  placements.forEach((p, i) => {
    const s = p.scale ?? 1;
    m.position.set(p.x, 0, p.z);
    m.rotation.set(0, p.yaw ?? 0, 0);
    m.scale.set(1.2 * s, 0.42 * s, 0.9 * s);
    m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function disposeGeometry(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

// ---- the zone -----------------------------------------------------------------------------------

interface SwingSeat {
  pivot: THREE.Group;
  amplitude: number;
  omega: number;
  phase: number;
}

export function createSafetyStation(deps: ZoneDeps): Zone {
  const root = new THREE.Group();
  root.name = 'safety-station';
  const rng = mulberry32(SEED);
  /** One material for every merged primitive; vertex colors carry the colors. */
  const primMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const spawn = SPAWN.clone();

  root.add(createGroundApron(GRASS_COLOR));
  root.add(createGround({ size: GROUND_SIZE, rng: mulberry32(SEED + 2), grass: GRASS_COLOR, dirt: GRASS_COLOR }));

  const solid = <T extends THREE.Object3D>(object: T): T => {
    setShadowCasting(object, true, true);
    root.add(object);
    return object;
  };
  const flat = <T extends THREE.Object3D>(object: T): T => {
    setShadowCasting(object, false, true); // slabs and asphalt: they take shadows, they do not throw them
    root.add(object);
    return object;
  };

  // ---- ground-level layout: street, sidewalks, path ----
  const streetPrim = flat(streetPrimitive(primMaterial));
  flat(sidewalkPrimitive(primMaterial));

  // ---- buildings and street furniture ----
  const stationPrim = solid(fireStationPrimitive(primMaterial));
  const stopPrim = solid(stopSignPrimitive(primMaterial));
  const lampsPrim = solid(lampsPrimitive(primMaterial));
  const housePrims = HOUSES.map((h) => solid(housePrimitive(h, primMaterial)));
  const fencePrim = solid(fencePrimitive(primMaterial));

  const meetYaw = yawToward(MEETING_SIGN.x, MEETING_SIGN.z, spawn.x, spawn.z);
  const meetPrim = solid(
    signpostPrimitive('meeting-sign-primitive', MEETING_SIGN.x, MEETING_SIGN.z, meetYaw, MEETING_SIGN.scale, COLOR.green, primMaterial),
  );
  const meetLabel = labelSprite('Safe meeting spot', 0.9);
  if (meetLabel) {
    meetLabel.position.set(MEETING_SIGN.x, 3.5 * MEETING_SIGN.scale, MEETING_SIGN.z);
    root.add(meetLabel);
  }

  // ---- first-aid tent ----
  const tentPrim = solid(tentPrimitive(primMaterial));
  solid(firstAidCross(primMaterial));
  const aidLabel = labelSprite('First aid', 0.8);
  if (aidLabel) {
    aidLabel.position.set(TENT.x, 5.95, TENT.z);
    root.add(aidLabel);
  }

  // ---- playground ----
  solid(playgroundPrimitive(primMaterial));
  const swingRoot = new THREE.Group();
  swingRoot.name = 'swing-set';
  swingRoot.position.set(SWING.x, 0, SWING.z);
  swingRoot.rotation.y = SWING.yaw;
  const seats: SwingSeat[] = [
    { pivot: new THREE.Group(), amplitude: 0.22, omega: 2.1, phase: 0 },
    { pivot: new THREE.Group(), amplitude: 0.28, omega: 2.3, phase: 1.7 },
  ];
  seats.forEach((seat, i) => {
    seat.pivot.name = `swing-seat-${i}`;
    seat.pivot.position.set(i === 0 ? -SWING_PIVOT_X : SWING_PIVOT_X, SWING_BAR_Y - 0.1, 0);
    seat.pivot.add(swingSeatPrimitive(i === 0 ? COLOR.orange : COLOR.green, primMaterial));
    swingRoot.add(seat.pivot);
  });
  solid(swingRoot);
  let swingTime = 0;
  const applySway = (): void => {
    for (const seat of seats) seat.pivot.rotation.x = seat.amplitude * Math.sin(swingTime * seat.omega + seat.phase);
  };
  applySway();

  const rockRng = mulberry32(SEED + 4);
  const sandboxPlacements: Placement[] = Array.from({ length: SANDBOX.rocks }, (_, i) => {
    const a = ((i + (rockRng() - 0.5) * 0.2) / SANDBOX.rocks) * Math.PI * 2;
    return {
      x: SANDBOX.x + Math.cos(a) * SANDBOX.ringRadius,
      z: SANDBOX.z + Math.sin(a) * SANDBOX.ringRadius,
      yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), // the long side of a flat stone runs along the ring
      scale: 0.95 + rockRng() * 0.2,
    };
  });
  const sandboxPrim = solid(sandboxRocksPrimitive(sandboxPlacements));

  // ---- Trail sign: the way back to Base Camp ----
  const trailPrim = solid(
    signpostPrimitive('trail-sign-primitive', TRAIL_SIGN.x, TRAIL_SIGN.z, TRAIL_SIGN.yaw, TRAIL_SIGN.scale, COLOR.blue, primMaterial),
  );
  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(TRAIL_SIGN.x, 3.1, TRAIL_SIGN.z), // y: where the name tag hangs, above the board
    radius: TRAIL_SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: deps.onReturnToBaseCamp,
  };

  // ---- trees: a ring just outside the walkable square, minus the gap where the road leaves ----
  const treeSpots: Spot[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const p = perimeterPoint((i + rng() * 0.7) / TREE_COUNT, WALK_HALF + 1.5 + rng() * 2);
    const onRoad = Math.abs(p.z - ROAD_Z) < 4.2 && Math.abs(p.x) > WALK_HALF;
    if (!onRoad) treeSpots.push(p);
  }
  treeSpots.push(...EDGE_TREES);
  const primitiveTrees = tree(rng, treeSpots);
  root.add(primitiveTrees);

  // ---- colliders: footprints, not crowns ---------------------------------------------------------
  // Each comes from the same list or constant that places its prop, so the two cannot drift apart.
  const colliders: Collider[] = [
    ...treeColliders(treeSpots),
    boxCollider(STATION.x, STATION.z, STATION_HALF.hw, STATION_HALF.hd),
    circleCollider(STOP_SIGN.x, STOP_SIGN.z, POST_COLLIDER_RADIUS),
    ...LAMPS.map((l) => circleCollider(l.x, l.z, POST_COLLIDER_RADIUS)),
    ...HOUSES.map((h) => boxCollider(h.x, h.z, h.w / 2, h.d / 2, HOUSE_YAW)),
    ...FENCE_ZS.map((z) => boxCollider(FENCE_X, z, FENCE_HALF.hw, FENCE_HALF.hd)),
    circleCollider(MEETING_SIGN.x, MEETING_SIGN.z, POST_COLLIDER_RADIUS),
    circleCollider(TRAIL_SIGN.x, TRAIL_SIGN.z, POST_COLLIDER_RADIUS),
    boxCollider(TENT.x, TENT.z, TENT_HALF.hw, TENT_HALF.hd, TENT.yaw),
    boxCollider(
      SLIDE.x + Math.sin(SLIDE.yaw) * SLIDE_MIDDLE,
      SLIDE.z + Math.cos(SLIDE.yaw) * SLIDE_MIDDLE,
      SLIDE_HALF.hw,
      SLIDE_HALF.hd,
      SLIDE.yaw,
    ),
    boxCollider(SWING.x, SWING.z, SWING_HALF.hw, SWING_HALF.hd, SWING.yaw),
    circleCollider(SANDBOX.x, SANDBOX.z, SANDBOX_COLLIDER_RADIUS),
  ];

  // ---- open spots, then plants that keep off the props, the street, the path and the spots ----
  const openSpots = placeOpenSpots(mulberry32(SEED + 5));
  const plantAvoid: AvoidCircle[] = [
    ...SAFETY_STATION_KEEP_OUT.flatMap((k) => avoidCircles(k, 0.5)),
    ...avoidCircles(box(-19.3, 19.3, -10.4, -1.4), 0.3), // road, sidewalks, strip in front of the fire station
    ...avoidCircles(box(-1.2, 1.2, -1.4, 16.0), 0.3), // path
    ...avoidCircles(box(-16.8, -6.2, 1.0, 13.3), 0.2), // playground mulch
    { x: 0, z: 8.5, radius: 6.5 }, // the middle of the lawn stays plain, so pickups show up
    { x: spawn.x, z: spawn.z, radius: 2.5 },
    ...openSpots.map((s) => ({ x: s.x, z: s.z, radius: 1.2 })),
  ];
  root.add(
    scatterPlants(
      mulberry32(SEED + 3),
      PLANT_COUNT,
      { minX: -(WALK_HALF - 0.4), maxX: WALK_HALF - 0.4, minZ: -(WALK_HALF - 0.4), maxZ: WALK_HALF - 0.4 },
      plantAvoid,
      { ids: PLANT_MODELS },
    ),
  );

  // ---- progressive swap: primitives stay until the models arrive ----------------------------------
  // Draw calls: placeholders 21 (ground 2, street 1, sidewalks 1, fire station 1, stop sign 1, lamps 1,
  // houses 2, fence 1, meeting sign 1, tent 1, cross 1, playground 1, seats 2, sandbox rocks 1, Trail
  // sign 1, trees 2, plants 1) plus 2 label sprites in a browser. After the swap 26: the street becomes
  // 2 (straight tiles and the crossing) and the plants up to 5; every other prop stays one call.
  const replace = (primitive: THREE.Object3D, model: THREE.Object3D | undefined): void => {
    if (!model) return;
    root.remove(primitive);
    disposeGeometry(primitive);
    root.add(model);
  };

  const swapInModels = (): void => {
    const modelRng = mulberry32(SEED + 1); // separate stream, so the primitive layout never shifts

    const trees = scatterModels('trees', TREE_MODELS, treeSpots, modelRng, [0.9, 1.3]);
    if (trees) replace(primitiveTrees, trees);

    // The street needs both of its models, or the primitive asphalt stays.
    const roadShadows = { cast: false, receive: true };
    const straight = instancedModel('street.straight', ROAD_TILE_XS.map((x) => ({ x, z: ROAD_Z })), roadShadows);
    const crossing = instancedModel('street.crossing', [{ x: 0, z: ROAD_Z }], roadShadows);
    if (straight && crossing) {
      straight.position.y = ROAD_LIFT;
      crossing.position.y = ROAD_LIFT;
      const street = new THREE.Group();
      street.name = 'street';
      street.add(straight, crossing);
      replace(streetPrim, street);
    } else {
      straight?.dispose();
      crossing?.dispose();
    }

    replace(
      stationPrim,
      instancedModel('building.firestation', [{ x: STATION.x, z: STATION.z, scale: STATION.scale }]),
    );
    replace(stopPrim, instancedModel('street.sign.stop', [{ x: STOP_SIGN.x, z: STOP_SIGN.z, yaw: STOP_SIGN.yaw, scale: STOP_SIGN.scale }]));
    replace(lampsPrim, instancedModel('street.lamp', LAMPS.map((l) => ({ x: l.x, z: l.z }))));
    HOUSES.forEach((h, i) => {
      replace(housePrims[i]!, instancedModel(h.id, [{ x: h.x, z: h.z, yaw: HOUSE_YAW }]));
    });
    replace(
      fencePrim,
      instancedModel(
        'fence.simple',
        FENCE_ZS.map((z) => ({ x: FENCE_X, z, yaw: Math.PI / 2 })),
      ),
    );
    replace(
      meetPrim,
      instancedModel('signpost.single', [{ x: MEETING_SIGN.x, z: MEETING_SIGN.z, yaw: meetYaw, scale: MEETING_SIGN.scale }]),
    );
    replace(tentPrim, instancedModel('tent.open', [{ x: TENT.x, z: TENT.z, yaw: TENT.yaw, scale: TENT.scale }]));
    replace(sandboxPrim, instancedModel('rock.flat', sandboxPlacements));
    replace(
      trailPrim,
      instancedModel('signpost', [{ x: TRAIL_SIGN.x, z: TRAIL_SIGN.z, yaw: TRAIL_SIGN.yaw, scale: TRAIL_SIGN.scale }]),
    );
  };

  assets
    .load(STATION_MODELS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[safety-station] could not swap in models, keeping placeholder art', err);
    });

  return {
    id: 'safety-station',
    root,
    bounds: squareBounds(WALK_HALF),
    spawn,
    interactables: [back],
    openSpots,
    landmarks: {},
    colliders,
    update: (dt: number) => {
      swingTime += dt;
      applySway();
    },
  };
}
