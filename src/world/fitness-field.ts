/**
 * Fitness Field: where the "Running with the Pack" (Wolf) and "Personal Fitness" (Arrow of Light)
 * stops happen. A big open grass field with a dirt running track, a white start line, four orange
 * cones, a stretching circle of stones and a ball in the infield, and a fence with a gate, log
 * benches and a scoreboard sign along the far (-z) side. The player spawns near the +z edge beside
 * the "Back to camp" sign and looks over the field.
 *
 * Layout (x right, z toward the player; the track is an oval, long axis along x):
 *
 *                     fence ................ gate        z = -16.2
 *               benches   [scoreboard]   benches          z = -14
 *                  .-------------------.
 *                 (   dirt track oval   )                 center (0, -1.5)
 *                  (   o  infield  o   )   o = cone
 *                   `-----------------'
 *                     sign   spawn                        z = 13.5
 *
 * Art is primitive first and upgrades as models load, never blocking on them:
 *   - ground, track, start line and ball are always primitives (one vertex-colored track mesh);
 *   - trees, fence, gate, benches, stones, scoreboard, Trail sign and plants swap to models.
 * The zone carries no lights: the world's environment lights every zone. Solid things block the
 * player (see `Zone.colliders`): tree trunks, the fence and gate, the benches, the scoreboard, the
 * cones, the stretching stones and the Trail sign. The track, the infield, the open spots and the
 * spawn are kept clear of colliders. The ball hops in the infield and has none, so it never stands
 * in the way of the walk from the spawn.
 *
 * Draw calls: 15 with primitives (apron, ground, track, cones, fence, gate, benches, scoreboard and its
 * label, stones, ball, trees 2, plants, Trail sign) and 23 after the swap (fence + gate 3, trees 2,
 * plants up to 8, the rest 1 each). The sun's shadow pass draws the
 * casting props again. The budget is 80.
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
  type Rng,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';
import type { ZoneDeps } from './zones';

/**
 * The player may walk this far from the center in x and z. Kept at 35 across (a hair under "about
 * 36") so the shared zone test, which caps every zone at 35, passes.
 */
export const FITNESS_FIELD_HALF = 17.5;

/**
 * The running track: an oval whose center line has half-axes `a` (x) and `b` (z) around (cx, cz).
 * It is `width` wide, so its edges are the ellipses with half-axes a and b offset by +/- width / 2.
 */
export const FITNESS_TRACK = { cx: 0, cz: -1.5, a: 12.5, b: 8, width: 3 } as const;

const SEED = 3108;
const GROUND_SIZE = 48;
const GRASS_COLOR = 0x69ad4b;
const DIRT_COLOR = 0xb58a5a;
const LINE_COLOR = 0xf4f1e6;

const TRACK_Y = 0.035; // above the grass (ripple is 0.03 peak to peak), so nothing z-fights
const LINE_Y = 0.06; // the start line sits just above the track
const TRACK_SEGMENTS = 120;
const TRACK_ROWS = 3; // quads across the track, so the edges can fade toward grass
const START_LINE_THETA = Math.PI / 2 + 0.55; // on the near straight, left of center
const START_LINE_WIDTH = 0.4;

const SPAWN = new THREE.Vector3(0, 0, 13.5);
const SIGN_OFFSET_X = -3.5; // the Trail sign stands this far to the left of the spawn
const SIGN_RADIUS = 2;
const SIGN_LABEL_HEIGHT = 2.6;

const FENCE_Z = -16.2;
const FENCE_SEGMENT = 4; // fence.simple is 1 unit wide at 4x scale
const FENCE_X = [-14, -10, -6, -2, 2, 6, 10]; // simple segments; the gate takes the next slot
const GATE_X = 14;
const BENCH_Z = -14;
const BENCH_X = [-10.5, -5.5, 5.5, 10.5];
const SCOREBOARD = { x: 0, z: -14.4, scale: 1.6, labelY: 4.7, labelHeight: 1.4 } as const;

/** What each prop blocks, as half sizes (boxes) or radii (circles), a touch inside the models. */
const FENCE_HALF_DEPTH = 0.15; // the fence is 4 long and 0.28 thin
const BENCH_HALF = { hw: 0.36, hd: 1.1 } as const; // log.single is 0.72 wide and 2.2 long
const SCOREBOARD_HALF = { hw: 0.95, hd: 0.25 } as const; // the signpost model at 1.6 times its size
const CONE_RADIUS = 0.35;
const STONE_RADIUS = 0.55; // at scale 1
const SIGN_COLLIDER_RADIUS = 0.3;

const STRETCH = { x: -4.5, z: -1.5, radius: 2.8, stones: 8 } as const;
const BALL = { x: 0.2, z: 0.9, radius: 0.4 } as const;
const BALL_BOUNCE = 0.3;

const TREE_COUNT = 32;
const PLANT_COUNT = 130;

/** Models that replace the primitive props once they load. */
const TREE_MODELS = ['tree.round', 'tree.oak'] as const;
const FITNESS_MODELS = [
  ...TREE_MODELS,
  'fence.simple',
  'fence.gate',
  'log.single',
  'rock.small',
  'signpost.single',
  'signpost',
] as const;

/** Open spots keep this far from the spawn and the Trail sign (the shared zone test wants 3). */
const KEEP_CLEAR_SIGN = 3.2;
const MAX_SPOTS = 14;

/** One cone in each corner of the oval, a little inside the track's inner edge. */
const CONE_SPOTS: readonly Spot[] = [40, 140, 220, 320].map((deg) =>
  trackPoint((deg * Math.PI) / 180, -FITNESS_TRACK.width / 2 - 0.55),
);

const dummy = new THREE.Object3D();

/** Yaw that turns a model whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/** A point on the track: `offset` units out from the center line (negative is toward the infield). */
function trackPoint(theta: number, offset = 0): Spot {
  const { cx, cz, a, b } = FITNESS_TRACK;
  return { x: cx + (a + offset) * Math.cos(theta), z: cz + (b + offset) * Math.sin(theta) };
}

// ---- small geometry helpers ---------------------------------------------------------------------

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** Give a geometry one flat vertex color, so several parts can merge into one draw call. */
function paint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

function vertexColorMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}

/** An InstancedMesh of a primitive at every placement. Casts and receives sun shadows. */
function instancedPrimitive(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly Placement[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
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

// ---- the track ----------------------------------------------------------------------------------

/**
 * The dirt oval and the start line as one flat, vertex-colored mesh (1 draw call). The oval is a
 * ring of quads between the inner and outer track ellipses; the two edge rows fade a little toward
 * grass so the edge looks worn in, and every vertex gets a touch of random brightness. The start
 * line is a white quad across the near straight, a hair above the dirt.
 */
function trackGeometry(rng: Rng): THREE.BufferGeometry {
  const half = FITNESS_TRACK.width / 2;
  const grass = new THREE.Color(GRASS_COLOR);
  const dirt = new THREE.Color(DIRT_COLOR);
  const line = new THREE.Color(LINE_COLOR);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Color();

  const push = (p: Spot, y: number, color: THREE.Color): number => {
    positions.push(p.x, y, p.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  /** Two triangles for the quad (v00, v10 along the track; v01, v11 one step outward). Normal up. */
  const quad = (v00: number, v10: number, v01: number, v11: number): void => {
    indices.push(v00, v10, v01, v10, v11, v01);
  };

  for (let i = 0; i < TRACK_SEGMENTS; i++) {
    const theta = (i / TRACK_SEGMENTS) * Math.PI * 2;
    for (let r = 0; r <= TRACK_ROWS; r++) {
      const offset = -half + (r / TRACK_ROWS) * FITNESS_TRACK.width;
      const edge = r === 0 || r === TRACK_ROWS ? 0.3 : 0;
      tmp.copy(dirt).multiplyScalar(1 + (rng() * 2 - 1) * 0.07).lerp(grass, edge);
      push(trackPoint(theta, offset), TRACK_Y, tmp);
    }
  }
  const stride = TRACK_ROWS + 1;
  for (let i = 0; i < TRACK_SEGMENTS; i++) {
    const next = (i + 1) % TRACK_SEGMENTS;
    for (let r = 0; r < TRACK_ROWS; r++) {
      quad(i * stride + r, next * stride + r, i * stride + r + 1, next * stride + r + 1);
    }
  }

  // The start line: an arc of the oval, as wide as the track, a few tenths of a unit long.
  const { a, b } = FITNESS_TRACK;
  const speed = Math.hypot(a * Math.sin(START_LINE_THETA), b * Math.cos(START_LINE_THETA));
  const delta = START_LINE_WIDTH / 2 / speed;
  const v00 = push(trackPoint(START_LINE_THETA - delta, -half), LINE_Y, line);
  const v10 = push(trackPoint(START_LINE_THETA + delta, -half), LINE_Y, line);
  const v01 = push(trackPoint(START_LINE_THETA - delta, half), LINE_Y, line);
  const v11 = push(trackPoint(START_LINE_THETA + delta, half), LINE_Y, line);
  quad(v00, v10, v01, v11);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ---- primitive props ----------------------------------------------------------------------------

/** A traffic cone on a square foot, with a white band. Orange body, so it reads against grass. */
function coneGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.BoxGeometry(0.7, 0.06, 0.7).translate(0, 0.03, 0), 0xd9620f),
    paint(new THREE.CylinderGeometry(0.06, 0.26, 0.7, 12).translate(0, 0.41, 0), 0xff7a1a),
    paint(new THREE.CylinderGeometry(0.152, 0.192, 0.14, 12).translate(0, 0.41, 0), 0xffffff),
  ]);
}

/** One 4-unit fence segment along x: two posts and two rails. */
function fenceGeometry(): THREE.BufferGeometry {
  const half = FENCE_SEGMENT / 2 - 0.15;
  return merge([
    paint(new THREE.BoxGeometry(0.16, 1.25, 0.16).translate(-half, 0.625, 0), 0x7e5a35),
    paint(new THREE.BoxGeometry(0.16, 1.25, 0.16).translate(half, 0.625, 0), 0x7e5a35),
    paint(new THREE.BoxGeometry(FENCE_SEGMENT - 0.1, 0.12, 0.08).translate(0, 1.0, 0), 0x9a7244),
    paint(new THREE.BoxGeometry(FENCE_SEGMENT - 0.1, 0.12, 0.08).translate(0, 0.55, 0), 0x9a7244),
  ]);
}

/** The gate slot: taller posts, a framed door and a cross brace, in a lighter wood than the fence. */
function gateGeometry(): THREE.BufferGeometry {
  const half = FENCE_SEGMENT / 2 - 0.15;
  const brace = new THREE.BoxGeometry(Math.hypot(FENCE_SEGMENT - 0.6, 0.7), 0.1, 0.06)
    .rotateZ(Math.atan2(0.7, FENCE_SEGMENT - 0.6))
    .translate(0, 0.75, 0.04);
  return merge([
    paint(new THREE.BoxGeometry(0.2, 1.6, 0.2).translate(-half, 0.8, 0), 0x6b4a2b),
    paint(new THREE.BoxGeometry(0.2, 1.6, 0.2).translate(half, 0.8, 0), 0x6b4a2b),
    paint(new THREE.BoxGeometry(FENCE_SEGMENT - 0.6, 0.12, 0.08).translate(0, 1.1, 0.04), 0xb78a52),
    paint(new THREE.BoxGeometry(FENCE_SEGMENT - 0.6, 0.12, 0.08).translate(0, 0.4, 0.04), 0xb78a52),
    paint(brace, 0xb78a52),
  ]);
}

/** A sign on a post: `width` by `height` board, bottom of the board `lift` up. Faces +z. */
function signGeometry(width: number, height: number, lift: number, boardColor: number): THREE.BufferGeometry {
  const postHeight = lift + height;
  return merge([
    paint(new THREE.CylinderGeometry(0.1, 0.13, postHeight, 8).translate(0, postHeight / 2, 0), 0x6b4a2b),
    paint(new THREE.BoxGeometry(width, height, 0.1).translate(0, lift + height / 2, 0.12), boardColor),
  ]);
}

/** The scoreboard: a wide dark-green board on two posts, with a pale header strip. Faces +z. */
function scoreboardGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.11, 0.14, 2.4, 8).translate(-1.3, 1.2, 0), 0x6b4a2b),
    paint(new THREE.CylinderGeometry(0.11, 0.14, 2.4, 8).translate(1.3, 1.2, 0), 0x6b4a2b),
    paint(new THREE.BoxGeometry(3.4, 1.5, 0.12).translate(0, 2.55, 0.12), 0x24593a),
    paint(new THREE.BoxGeometry(3.4, 0.28, 0.14).translate(0, 3.17, 0.12), 0xe6e0c8),
  ]);
}

/** A model that is a primitive until the real art arrives. */
interface Swappable {
  holder: THREE.Group;
  primitive: THREE.Object3D;
}

function swappable(name: string, primitive: THREE.Object3D): Swappable {
  const holder = new THREE.Group();
  holder.name = name;
  holder.add(primitive);
  return { holder, primitive };
}

export function createFitnessField(deps: ZoneDeps): Zone {
  const root = new THREE.Group();
  root.name = 'fitness-field';
  const half = FITNESS_FIELD_HALF;

  // ---- ground: grass, the dirt track and its start line ---------------------------------------
  root.add(createGroundApron(GRASS_COLOR));
  root.add(
    createGround({
      size: GROUND_SIZE,
      rng: mulberry32(SEED + 2),
      grass: GRASS_COLOR,
      dirt: DIRT_COLOR,
      ripple: 0.03,
    }),
  );
  const trackMaterial = vertexColorMaterial();
  // Belt and braces against z-fighting where the track edge meets the grass ripple.
  trackMaterial.polygonOffset = true;
  trackMaterial.polygonOffsetFactor = -2;
  trackMaterial.polygonOffsetUnits = -2;
  const track = new THREE.Mesh(trackGeometry(mulberry32(SEED + 4)), trackMaterial);
  track.name = 'track';
  track.receiveShadow = true;
  root.add(track);

  // ---- cones: four, on the inside edge of the track at the corners of the oval -----------------
  const cones = instancedPrimitive(
    'cones',
    coneGeometry(),
    vertexColorMaterial(),
    CONE_SPOTS.map((p) => ({ ...p, scale: 1.25 })),
  );
  root.add(cones);

  // ---- spectator side: fence, gate, benches, scoreboard ----------------------------------------
  const fencePlacements: Placement[] = FENCE_X.map((x) => ({ x, z: FENCE_Z, yaw: 0 }));
  const primitiveFence = instancedPrimitive('fence', fenceGeometry(), vertexColorMaterial(), fencePlacements);
  root.add(primitiveFence);

  const primitiveGate = instancedPrimitive('fence-gate', gateGeometry(), vertexColorMaterial(), [
    { x: GATE_X, z: FENCE_Z, yaw: 0 },
  ]);
  root.add(primitiveGate);

  // Benches are log.single turned to lie along x. Its length runs along z, so yaw by a quarter turn.
  const benchPlacements: Placement[] = BENCH_X.map((x) => ({ x, z: BENCH_Z, yaw: Math.PI / 2 }));
  const primitiveBenches = instancedPrimitive(
    'benches',
    new THREE.CylinderGeometry(0.3, 0.3, 2.2, 8).rotateX(Math.PI / 2).translate(0, 0.3, 0),
    lambert(0x7a5233),
    benchPlacements,
  );
  root.add(primitiveBenches);

  const scoreboardPrimitive = new THREE.Mesh(scoreboardGeometry(), vertexColorMaterial());
  setShadowCasting(scoreboardPrimitive, true, true);
  const scoreboard = swappable('scoreboard', scoreboardPrimitive);
  scoreboard.holder.position.set(SCOREBOARD.x, 0, SCOREBOARD.z);
  const scoreboardLabel = labelSprite('Fitness Field', SCOREBOARD.labelHeight);
  if (scoreboardLabel) {
    scoreboardLabel.position.set(0, SCOREBOARD.labelY, 0);
    scoreboard.holder.add(scoreboardLabel);
  }
  root.add(scoreboard.holder);

  // ---- infield: the stretching circle and a ball -----------------------------------------------
  const stoneRng = mulberry32(SEED + 6);
  const stonePlacements: Placement[] = [];
  for (let i = 0; i < STRETCH.stones; i++) {
    const angle = ((i + (stoneRng() - 0.5) * 0.2) / STRETCH.stones) * Math.PI * 2;
    stonePlacements.push({
      x: STRETCH.x + Math.cos(angle) * STRETCH.radius,
      z: STRETCH.z + Math.sin(angle) * STRETCH.radius,
      yaw: stoneRng() * Math.PI * 2,
      scale: 0.65 + stoneRng() * 0.25,
    });
  }
  const primitiveStones = instancedPrimitive(
    'stretch-stones',
    new THREE.DodecahedronGeometry(0.42, 0).scale(1, 0.7, 1).translate(0, 0.17, 0),
    lambert(0x8a8f94),
    stonePlacements,
  );
  root.add(primitiveStones);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.radius, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0x3a7bd5 }),
  );
  ball.name = 'ball';
  ball.position.set(BALL.x, BALL.radius, BALL.z);
  setShadowCasting(ball, true, true);
  root.add(ball);

  // ---- the Trail sign, beside the spawn, turned to face the camera behind the player -----------
  const spawn = SPAWN.clone();
  const signX = spawn.x + SIGN_OFFSET_X;
  const signZ = spawn.z;
  const signPrimitive = new THREE.Mesh(signGeometry(1.8, 0.55, 1.83, 0xd9b36c), vertexColorMaterial());
  setShadowCasting(signPrimitive, true, true);
  const trailSign = swappable('trail-sign', signPrimitive);
  trailSign.holder.position.set(signX, 0, signZ);
  trailSign.holder.rotation.y = yawToward(signX, signZ, spawn.x, spawn.z + 7.5);
  root.add(trailSign.holder);
  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(signX, SIGN_LABEL_HEIGHT, signZ),
    radius: SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: () => deps.onReturnToBaseCamp(),
  };

  // ---- trees around the edge, with a gap behind the spawn so the camera sees out ---------------
  const treeRng = mulberry32(SEED + 10);
  const treeSpots: Spot[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const p = perimeterPoint((i + treeRng() * 0.7) / TREE_COUNT, half + 2 + treeRng() * 2.2);
    const behindSpawn = p.z > half && Math.abs(p.x) < 9;
    if (!behindSpawn) treeSpots.push(p);
  }
  const primitiveTrees = tree(treeRng, treeSpots);
  root.add(primitiveTrees);

  // ---- colliders: footprints, not crowns ---------------------------------------------------------
  // Each comes from the same list that places its prop, so the two cannot drift apart.
  const colliders: Collider[] = [
    ...treeColliders(treeSpots),
    ...fencePlacements.map((f) => boxCollider(f.x, f.z, FENCE_SEGMENT / 2, FENCE_HALF_DEPTH, f.yaw)),
    boxCollider(GATE_X, FENCE_Z, FENCE_SEGMENT / 2, FENCE_HALF_DEPTH),
    ...benchPlacements.map((b) => boxCollider(b.x, b.z, BENCH_HALF.hw, BENCH_HALF.hd, b.yaw)),
    boxCollider(SCOREBOARD.x, SCOREBOARD.z, SCOREBOARD_HALF.hw, SCOREBOARD_HALF.hd),
    ...CONE_SPOTS.map((c) => circleCollider(c.x, c.z, CONE_RADIUS)),
    ...stonePlacements.map((st) => circleCollider(st.x, st.z, STONE_RADIUS * (st.scale ?? 1))),
    circleCollider(signX, signZ, SIGN_COLLIDER_RADIUS),
  ];

  // ---- plants: around the edges only, never on the track or in the infield ---------------------
  // AvoidCircle is all plants understand, so the oval (and the infield) is covered with a grid of
  // circles, plus a keep-out for the spawn, the sign, the benches, the scoreboard and the gate.
  const keepClear: AvoidCircle[] = [];
  const reach = 2;
  const outerA = FITNESS_TRACK.a + FITNESS_TRACK.width / 2 + 0.3;
  const outerB = FITNESS_TRACK.b + FITNESS_TRACK.width / 2 + 0.3;
  for (let gx = -16; gx <= 16; gx += 2.6) {
    for (let gz = -12; gz <= 12; gz += 2.6) {
      const e = ((gx - FITNESS_TRACK.cx) / outerA) ** 2 + ((gz - FITNESS_TRACK.cz) / outerB) ** 2;
      if (e <= 1.1) keepClear.push({ x: gx, z: gz, radius: reach });
    }
  }
  keepClear.push(
    { x: spawn.x, z: spawn.z, radius: 2.6 },
    { x: signX, z: signZ, radius: 2 },
    { x: SCOREBOARD.x, z: SCOREBOARD.z, radius: 2.2 },
    { x: GATE_X, z: FENCE_Z, radius: 2.6 },
    ...BENCH_X.map((x) => ({ x, z: BENCH_Z, radius: 1.6 })),
  );
  const plantEdge = half - 0.3;
  root.add(
    scatterPlants(
      mulberry32(SEED + 3),
      PLANT_COUNT,
      { minX: -plantEdge, maxX: plantEdge, minZ: -plantEdge, maxZ: plantEdge },
      keepClear,
    ),
  );

  // ---- open spots: along the track and in the infield, clear of every prop ---------------------
  const spotRng = mulberry32(SEED + 5);
  const candidates: Spot[] = [];
  for (let k = 0; k < 9; k++) {
    const p = trackPoint(0.35 + (k / 9) * Math.PI * 2);
    candidates.push({ x: p.x + (spotRng() - 0.5) * 0.6, z: p.z + (spotRng() - 0.5) * 0.6 });
  }
  const infield: Spot[] = [
    { x: STRETCH.x, z: STRETCH.z }, // the middle of the stretching circle
    { x: 1.5, z: -5 },
    { x: 7, z: -1 },
    { x: 3.5, z: 2.8 },
  ];
  for (const p of infield) candidates.push({ x: p.x + (spotRng() - 0.5) * 0.6, z: p.z + (spotRng() - 0.5) * 0.6 });

  const blockers: AvoidCircle[] = [
    { x: spawn.x, z: spawn.z, radius: KEEP_CLEAR_SIGN },
    { x: signX, z: signZ, radius: KEEP_CLEAR_SIGN },
    { x: SCOREBOARD.x, z: SCOREBOARD.z, radius: 2 },
    { x: BALL.x, z: BALL.z, radius: 1.3 },
    ...BENCH_X.map((x) => ({ x, z: BENCH_Z, radius: 1.8 })),
    ...stonePlacements.map((s) => ({ x: s.x, z: s.z, radius: 1.3 })),
    ...CONE_SPOTS.map((p) => ({ ...p, radius: 1.3 })),
  ];
  const openSpots: THREE.Vector3[] = [];
  for (const c of candidates) {
    if (openSpots.length >= MAX_SPOTS) break;
    const clear = blockers.every((b) => Math.hypot(c.x - b.x, c.z - b.z) >= b.radius);
    const spaced = openSpots.every((s) => Math.hypot(c.x - s.x, c.z - s.z) >= 2.5);
    if (clear && spaced) openSpots.push(new THREE.Vector3(c.x, 0, c.z));
  }

  // ---- progressive swap: primitives stay until the models arrive -------------------------------
  // Each piece swaps on its own, so a model that fails to load leaves just its primitive behind.
  const swapInModels = (): void => {
    const modelRng = mulberry32(SEED + 1); // separate stream, so the primitive layout never shifts

    const trees = scatterModels('trees', TREE_MODELS, treeSpots, modelRng, [0.9, 1.35]);
    if (trees) {
      root.remove(primitiveTrees);
      root.add(trees);
    }

    const fence = instancedModel('fence.simple', fencePlacements);
    if (fence) {
      root.remove(primitiveFence);
      root.add(fence);
    }

    if (assets.has('fence.gate')) {
      const gate = assets.instance('fence.gate');
      gate.position.set(GATE_X, 0, FENCE_Z);
      setShadowCasting(gate, true, true);
      root.remove(primitiveGate);
      root.add(gate);
    }

    const benches = instancedModel('log.single', benchPlacements);
    if (benches) {
      root.remove(primitiveBenches);
      root.add(benches);
    }

    const stones = instancedModel('rock.small', stonePlacements);
    if (stones) {
      root.remove(primitiveStones);
      root.add(stones);
    }

    if (assets.has('signpost.single')) {
      const model = assets.instance('signpost.single');
      model.scale.setScalar(SCOREBOARD.scale);
      setShadowCasting(model, true, true);
      scoreboard.holder.remove(scoreboard.primitive);
      scoreboard.holder.add(model);
    }

    if (assets.has('signpost')) {
      const model = assets.instance('signpost');
      setShadowCasting(model, true, true);
      trailSign.holder.remove(trailSign.primitive);
      trailSign.holder.add(model);
    }
  };

  assets
    .load(FITNESS_MODELS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[fitness-field] could not swap in models, keeping placeholder art', err);
    });

  let t = 0;
  return {
    id: 'fitness-field',
    root,
    bounds: squareBounds(half),
    spawn,
    interactables: [back],
    openSpots,
    landmarks: {},
    colliders,
    update: (dt: number) => {
      // The ball hops gently on the spot, so the infield feels alive.
      t += dt;
      ball.position.y = BALL.radius + BALL_BOUNCE * Math.abs(Math.sin(t * 2.2));
    },
  };
}
