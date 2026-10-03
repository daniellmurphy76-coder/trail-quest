/**
 * Campfire Circle: the quiet, welcoming grove for the family-and-reverence adventures. It carries
 * no symbols of any faith: just a campfire ringed by log benches, lanterns, and trees.
 *
 * The player spawns near the +z edge beside the "Back to camp" trail sign and walks north through
 * a log gateway (the gap in an inner ring of trees) into the grove. At the center is the shared
 * `campfire` prop, ringed by eight log benches facing inward and a few stump seats, on a soft dirt
 * clearing. Lantern posts, a flat reading rock, and a small woodpile stand around it. An outer wall
 * of autumn trees just outside the walkable square closes the edge, and a few fireflies drift.
 *
 * Everything starts as an instanced primitive and upgrades to the CC0 models as they load; nothing
 * waits on assets. The zone carries no lights of its own beyond the campfire's: the environment
 * (sun, sky light, fog) lights every zone. The player has no colliders and walks through props, so
 * the gateway path and the open spots are kept clear by layout, not by blocking.
 *
 * Draw calls. Primitives only: about 20 (ground 2, trees 2, campfire 4 meshes plus its embers,
 * plants 1, benches 1, gateway 1, stumps 1, lanterns 2, trail sign 2, rock 1, woodpile 1,
 * fireflies 1). After the model swap: about 26 (the campfire model is 2 meshes, the three tree
 * models take 3 calls, benches and gateway share one `log.single` call, the plant mix takes up to
 * 8), plus 1 for the sign's text label where a canvas exists. The sun's shadow pass draws the
 * casting props again, about 15 more. Far below the 80 target and the 150 budget.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint, squareBounds } from './bounds';
import { createGround, createGroundApron } from './ground';
import { labelSprite } from './placeholder-zone';
import {
  campfire,
  instancedModel,
  scatterPlants,
  tree,
  type AvoidCircle,
  type Placement,
  type Rng,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';
import type { ZoneDeps } from './zones';

const SEED = 1105;
/** The player may walk this far from the center in x and z (35 by 35). Trees stand just outside. */
const WALK_HALF = 17.5;
const GROUND_SIZE = 56;
const GRASS_COLOR = 0x749a45;
const DIRT_COLOR = 0xa98b5f;
const CLEARING_RADIUS = 6.6;
const CLEARING_FEATHER = 3.2;
const PLANT_COUNT = 260;

// ---- layout (x east, z south; angles run from +x toward +z, so +z, the entrance, is 90 degrees) --
const SPAWN = new THREE.Vector3(0, 0, 15.4);
const SIGN_X = -3.3;
const SIGN_Z = 15.4;
const SIGN_YAW = 0.35; // turns the sign a little toward the spawn
const SIGN_RADIUS = 2;
const SIGN_LABEL_HEIGHT = 2.6; // where the name tag hangs (see Interactable)
const SIGN_TEXT_HEIGHT = 3.5; // the "Back to camp" text sprite floats above that
const ENTRANCE_ANGLE = Math.PI / 2;

const GATE_Z = 12.2;
const GATE_POST_X = 2.2;
const GATE_HEIGHT = 3.08;
const GATE_BEAM_LENGTH = 5.2;

const BENCH_COUNT = 8;
const BENCH_RADIUS = 4.4;
const BENCH_LENGTH = 2.2; // a `log.single` model is 2.2 long once the manifest scale is applied
/** Benches leave an entrance gap this wide (half-angle) around +z; the other seven are evenly spaced. */
const BENCH_GAP_HALF = (28 * Math.PI) / 180;
const STUMP_RADIUS = 6;
const STUMP_GAPS = [0, 2, 4, 6] as const; // stumps sit behind these gaps between neighbouring benches

const LANTERN_RING = 10.6;
const LANTERN_RING_COUNT = 6;
const LANTERN_HEIGHT = 2.4; // a `signpost.single` model is 2.4 tall
const GLOBE_RADIUS = 0.2;
const DECOR_RING = 11.3; // the reading rock and the woodpile stand a little beyond the lanterns

const OPEN_RING = 8.4;
const OPEN_SLOTS = 12;
const OPEN_CLEARANCE = 1; // an open spot stays this far beyond the edge of any prop

const OUTER_TREE_COUNT = 56;
const INNER_TREE_COUNT = 26;
const INNER_RING = 12.6;
const ENTRANCE_HALF_WIDTH = 5.2; // the inner tree ring leaves this much room either side of x = 0

const FIREFLY_COUNT = 9;

const WOOD_COLOR = 0x6b4a2b;
const BENCH_COLOR = 0x7b5230;
const STUMP_COLOR = 0x8a6340;

/** Autumn mix for the primitive tree crowns: [hue, saturation, lightness]. */
const AUTUMN_CROWNS: ReadonlyArray<readonly [number, number, number]> = [
  [0.07, 0.72, 0.42], // orange
  [0.11, 0.78, 0.46], // gold
  [0.03, 0.62, 0.38], // red
  [0.3, 0.42, 0.28], // still green
];

/** Models that replace the primitive props once they load. Plants load themselves in scatterPlants. */
const MODEL_IDS = [
  'tree.fall',
  'tree.oak',
  'tree.pine.tall',
  'log.single',
  'stump',
  'signpost.single',
  'signpost',
  'rock.flat',
  'log.stack',
  'campfire',
] as const;

/** How often each tree model turns up: mostly autumn oaks. */
const TREE_CHOICES: ReadonlyArray<{ id: string; weight: number }> = [
  { id: 'tree.fall', weight: 5 },
  { id: 'tree.oak', weight: 2 },
  { id: 'tree.pine.tall', weight: 2 },
];

// ---- small helpers -------------------------------------------------------------------------------

const dummy = new THREE.Object3D();

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

/** The point `radius` from the center at `angle` (see the layout note above). */
function polar(angle: number, radius: number): Spot {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** One InstancedMesh of `geometry`, one copy per placement, standing on y = 0. Casts and receives shadows. */
function primitiveInstances(
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

/** Merge parts that share the same attributes into one geometry (one draw call); the parts are freed. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) return parts[0]!;
  for (const part of parts) part.dispose();
  return merged;
}

/** Free the GPU memory of every mesh under `object`. */
function disposeMeshes(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
  });
}

/** Take a primitive out of the zone and put its replacement in. Does nothing without a replacement. */
function replace(root: THREE.Object3D, old: THREE.Object3D, next: THREE.Object3D | undefined): void {
  if (!next) return;
  root.remove(old);
  root.add(next);
  disposeMeshes(old);
}

/** A 16 by 16 soft white dot for the fireflies. Built from raw pixels, so it needs no canvas. */
function glowDotTexture(): THREE.DataTexture {
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

// ---- fireflies -----------------------------------------------------------------------------------

interface Firefly {
  /** Center of the path. */
  cx: number;
  cy: number;
  cz: number;
  /** How far the path reaches on each axis. */
  ax: number;
  ay: number;
  az: number;
  /** Radians per second on each axis, and where in the cycle it starts. */
  wx: number;
  wy: number;
  wz: number;
  px: number;
  py: number;
  pz: number;
  /** Blink rate (cycles per second) and starting phase. */
  blink: number;
  blinkPhase: number;
}

/**
 * A handful of tiny glowing dots on slow, looping paths (a different slow sine on each axis, so
 * each path closes on itself). One Points object, so one draw call. Black is invisible when added,
 * so the blink is just the vertex color fading up and down. The dot texture is built from raw
 * pixels, so this builds the same in node (the tests) as in the browser.
 */
function createFireflies(rng: Rng): { points: THREE.Points; update(dt: number): void } {
  const bugs: Firefly[] = Array.from({ length: FIREFLY_COUNT }, () => {
    const home = polar(rng() * Math.PI * 2, 3.5 + rng() * 8.5);
    return {
      cx: home.x,
      cy: 1 + rng() * 1.8,
      cz: home.z,
      ax: 0.8 + rng() * 1.4,
      ay: 0.25 + rng() * 0.4,
      az: 0.8 + rng() * 1.4,
      wx: 0.12 + rng() * 0.18,
      wy: 0.2 + rng() * 0.3,
      wz: 0.12 + rng() * 0.18,
      px: rng() * Math.PI * 2,
      py: rng() * Math.PI * 2,
      pz: rng() * Math.PI * 2,
      blink: 0.25 + rng() * 0.3,
      blinkPhase: rng() * Math.PI * 2,
    };
  });
  const positions = new Float32Array(FIREFLY_COUNT * 3);
  const colors = new Float32Array(FIREFLY_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.18,
      map: glowDotTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    }),
  );
  points.name = 'fireflies';
  points.frustumCulled = false; // the points move every frame, so the starting bounds would be wrong

  let t = 0;
  const apply = (): void => {
    bugs.forEach((b, i) => {
      positions[i * 3] = b.cx + b.ax * Math.sin(t * b.wx + b.px);
      positions[i * 3 + 1] = b.cy + b.ay * Math.sin(t * b.wy + b.py);
      positions[i * 3 + 2] = b.cz + b.az * Math.sin(t * b.wz + b.pz);
      const pulse = 0.5 + 0.5 * Math.sin(t * b.blink * Math.PI * 2 + b.blinkPhase);
      const glow = 0.12 + 0.88 * pulse * pulse;
      colors[i * 3] = 0.95 * glow;
      colors[i * 3 + 1] = 0.9 * glow;
      colors[i * 3 + 2] = 0.35 * glow;
    });
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  };
  apply();

  return {
    points,
    update(dt: number): void {
      t += dt;
      apply();
    },
  };
}

// ---- the zone ------------------------------------------------------------------------------------

export function createCampfireCircle(deps: ZoneDeps): Zone {
  const root = new THREE.Group();
  root.name = 'campfire-circle';
  const rng = mulberry32(SEED);

  // Ground, plants, lanterns, fireflies and the open spots use their own random streams, so nothing
  // else moves when one of them changes.
  root.add(createGroundApron(GRASS_COLOR));
  root.add(
    createGround({
      size: GROUND_SIZE,
      rng: mulberry32(SEED + 2),
      grass: GRASS_COLOR,
      dirt: DIRT_COLOR,
      path: { center: { x: 0, z: 0 }, radius: CLEARING_RADIUS, feather: CLEARING_FEATHER },
    }),
  );

  // ---- campfire at the center -----------------------------------------------------------------
  const fire = campfire();
  root.add(fire.root);

  // ---- benches (log.single): eight around the fire, long side along the circle ------------------
  const benchAngles = Array.from(
    { length: BENCH_COUNT },
    (_, i) => ENTRANCE_ANGLE + BENCH_GAP_HALF + (i * (Math.PI * 2 - 2 * BENCH_GAP_HALF)) / (BENCH_COUNT - 1),
  );
  const benchPlacements: Placement[] = benchAngles.map((a) => ({ ...polar(a, BENCH_RADIUS), yaw: -a }));
  const primitiveBenches = primitiveInstances(
    'benches',
    new THREE.CylinderGeometry(0.32, 0.32, BENCH_LENGTH, 8).rotateX(Math.PI / 2).translate(0, 0.32, 0),
    lambert(BENCH_COLOR),
    benchPlacements,
  );
  root.add(primitiveBenches);

  // ---- stump seats, outside the benches, behind four of the gaps --------------------------------
  const stumpPlacements: Placement[] = STUMP_GAPS.map((gap) => {
    const a = (benchAngles[gap]! + benchAngles[gap + 1]!) / 2;
    return { ...polar(a, STUMP_RADIUS), yaw: rng() * Math.PI * 2, scale: 0.85 };
  });
  const primitiveStumps = primitiveInstances(
    'stumps',
    new THREE.CylinderGeometry(0.5, 0.6, 0.77, 9).translate(0, 0.385, 0),
    lambert(STUMP_COLOR),
    stumpPlacements,
  );
  root.add(primitiveStumps);

  // ---- gateway: two upright logs and a crossbeam, across the way in from the spawn ---------------
  const gateGeometry = mergeParts([
    new THREE.CylinderGeometry(0.36, 0.4, GATE_HEIGHT, 8).translate(-GATE_POST_X, GATE_HEIGHT / 2, 0),
    new THREE.CylinderGeometry(0.36, 0.4, GATE_HEIGHT, 8).translate(GATE_POST_X, GATE_HEIGHT / 2, 0),
    new THREE.CylinderGeometry(0.3, 0.3, GATE_BEAM_LENGTH, 8).rotateZ(Math.PI / 2).translate(0, GATE_HEIGHT + 0.22, 0),
  ]);
  const primitiveGate = new THREE.Mesh(gateGeometry, lambert(WOOD_COLOR));
  primitiveGate.name = 'gateway';
  primitiveGate.position.z = GATE_Z;
  setShadowCasting(primitiveGate, true, true);
  root.add(primitiveGate);

  // ---- lanterns: signposts topped with a small warm glowing ball (no extra lights) -------------
  // Two flank the gateway; six more are spread evenly round the rest of the grove.
  const flankZ = GATE_Z - 0.4;
  const flankAngle = Math.atan2(flankZ, 3.2); // where the right-hand flanking lantern stands
  const ringStart = Math.PI - flankAngle; // and the left-hand one
  const ringStep = (Math.PI * 2 - (ringStart - flankAngle)) / (LANTERN_RING_COUNT + 1);
  const lanternRingAngles = Array.from({ length: LANTERN_RING_COUNT }, (_, i) => ringStart + (i + 1) * ringStep);
  const lanternSpots: Spot[] = [
    { x: -3.2, z: flankZ },
    { x: 3.2, z: flankZ },
    ...lanternRingAngles.map((a) => polar(a, LANTERN_RING)),
  ];
  const lanternRng = mulberry32(SEED + 6);
  const lanternPlacements: Placement[] = lanternSpots.map((s) => ({ ...s, yaw: lanternRng() * Math.PI * 2 }));
  const primitiveLanterns = primitiveInstances(
    'lanterns',
    new THREE.CylinderGeometry(0.09, 0.13, LANTERN_HEIGHT, 6).translate(0, LANTERN_HEIGHT / 2, 0),
    lambert(WOOD_COLOR),
    lanternPlacements,
  );
  root.add(primitiveLanterns);
  const globes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xffa43d, emissiveIntensity: 1.6 }),
    lanternSpots.length,
  );
  globes.name = 'lantern-globes';
  lanternSpots.forEach((s, i) => {
    dummy.position.set(s.x, LANTERN_HEIGHT + GLOBE_RADIUS * 0.6, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    globes.setMatrixAt(i, dummy.matrix);
  });
  globes.instanceMatrix.needsUpdate = true;
  setShadowCasting(globes, false, false); // a glowing ball should not throw a shadow
  root.add(globes);

  // ---- reading rock and woodpile, each between two lanterns -------------------------------------
  const rockAngle = (lanternRingAngles[1]! + lanternRingAngles[2]!) / 2;
  const rockSpot = polar(rockAngle, DECOR_RING);
  const smallRockSpot = polar(rockAngle + 0.19, DECOR_RING + 0.3); // a smaller one beside it
  const rockPlacements: Placement[] = [
    { ...rockSpot, yaw: 0.6, scale: 2.2 },
    { ...smallRockSpot, yaw: 2.1, scale: 1.2 },
  ];
  const primitiveRocks = primitiveInstances(
    'reading-rock',
    new THREE.DodecahedronGeometry(1, 0).scale(0.7, 0.14, 0.6).translate(0, 0.1, 0),
    lambert(0x8a8f94),
    rockPlacements,
  );
  root.add(primitiveRocks);

  const stackSpot = polar((lanternRingAngles[3]! + lanternRingAngles[4]!) / 2, DECOR_RING);
  const stackPlacements: Placement[] = [{ ...stackSpot, yaw: 0.9 }];
  const stackLog = (x: number, y: number): THREE.BufferGeometry =>
    new THREE.CylinderGeometry(0.3, 0.3, 2.2, 7).rotateX(Math.PI / 2).translate(x, y, 0);
  const primitiveStack = primitiveInstances(
    'woodpile',
    mergeParts([stackLog(-0.32, 0.3), stackLog(0.32, 0.3), stackLog(0, 0.82)]),
    lambert(BENCH_COLOR),
    stackPlacements,
  );
  root.add(primitiveStack);

  // ---- the trail sign: the way back to camp, beside the spawn ----------------------------------
  const signRoot = new THREE.Group();
  signRoot.name = 'trail-sign';
  signRoot.position.set(SIGN_X, 0, SIGN_Z);
  signRoot.rotation.y = SIGN_YAW;
  const signPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.13, 2.4, 8).translate(0, 1.2, 0),
    lambert(WOOD_COLOR),
  );
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 0.1).translate(0, 2.1, 0.12), lambert(0xd9b36c));
  signRoot.add(signPost, signBoard);
  setShadowCasting(signRoot, true, true);
  root.add(signRoot);
  const signText = labelSprite('Back to camp'); // null where there is no canvas
  if (signText) {
    signText.position.set(SIGN_X, SIGN_TEXT_HEIGHT, SIGN_Z);
    root.add(signText);
  }
  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(SIGN_X, SIGN_LABEL_HEIGHT, SIGN_Z),
    radius: SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: deps.onReturnToBaseCamp,
  };

  // ---- trees: a wall just outside the walkable square, and a ring round the grove ---------------
  // The inner ring leaves a gap at +z, where the gateway stands, and keeps off the rocks and woodpile.
  const treeSpots: Spot[] = [];
  for (let i = 0; i < OUTER_TREE_COUNT; i++) {
    treeSpots.push(perimeterPoint((i + rng() * 0.7) / OUTER_TREE_COUNT, WALK_HALF + 1.5 + rng() * 2.5));
  }
  const innerStart = treeSpots.length;
  const decor = [rockSpot, smallRockSpot, stackSpot];
  for (let i = 0; i < INNER_TREE_COUNT; i++) {
    const a = ((i + rng() * 0.6) / INNER_TREE_COUNT) * Math.PI * 2;
    const spot = polar(a, INNER_RING + (rng() - 0.5) * 1.4);
    if (spot.z > 0 && Math.abs(spot.x) < ENTRANCE_HALF_WIDTH) continue;
    if (decor.some((d) => Math.hypot(d.x - spot.x, d.z - spot.z) < 2.4)) continue;
    treeSpots.push(spot);
  }
  const primitiveTrees = tree(rng, treeSpots);
  // Paint the crowns in autumn colors (the shared helper makes them green).
  const colorRng = mulberry32(SEED + 4);
  const leaf = new THREE.Color();
  primitiveTrees.traverse((o) => {
    const crowns = o as THREE.InstancedMesh;
    if (!crowns.isInstancedMesh || !crowns.instanceColor) return;
    for (let i = 0; i < crowns.count; i++) {
      const [h, s, l] = AUTUMN_CROWNS[Math.floor(colorRng() * AUTUMN_CROWNS.length)]!;
      crowns.setColorAt(i, leaf.setHSL(h + (colorRng() - 0.5) * 0.02, s, l + (colorRng() - 0.5) * 0.08));
    }
    crowns.instanceColor.needsUpdate = true;
  });
  root.add(primitiveTrees);

  // ---- open spots: a ring between the benches and the lanterns ----------------------------------
  // Each prop is a circle (x, z, radius); a spot stays OPEN_CLEARANCE beyond its edge.
  const solids: AvoidCircle[] = [
    { x: 0, z: 0, radius: 1.6 }, // campfire
    ...benchPlacements.map((p) => ({ x: p.x, z: p.z, radius: BENCH_LENGTH / 2 + 0.3 })),
    ...stumpPlacements.map((p) => ({ x: p.x, z: p.z, radius: 0.7 })),
    { x: -GATE_POST_X, z: GATE_Z, radius: 0.6 },
    { x: GATE_POST_X, z: GATE_Z, radius: 0.6 },
    ...lanternSpots.map((p) => ({ ...p, radius: 0.5 })),
    { ...rockSpot, radius: 1.6 },
    { ...smallRockSpot, radius: 1 },
    { ...stackSpot, radius: 1.6 },
    { x: SIGN_X, z: SIGN_Z, radius: 0.6 },
  ];
  const spotRng = mulberry32(SEED + 5);
  const openSpots: THREE.Vector3[] = [];
  for (let slot = 0; slot < OPEN_SLOTS; slot++) {
    const slotAngle = ((15 + slot * 30) * Math.PI) / 180; // never exactly on +z, the way in
    for (let attempt = 0; attempt < 10; attempt++) {
      const spot = polar(slotAngle + (spotRng() - 0.5) * 0.14, OPEN_RING + (spotRng() - 0.5) * 0.8);
      const clearOfProps = solids.every((s) => Math.hypot(s.x - spot.x, s.z - spot.z) >= s.radius + OPEN_CLEARANCE);
      const clearOfSpawn =
        Math.hypot(spot.x - SPAWN.x, spot.z - SPAWN.z) >= 3.6 && Math.hypot(spot.x - SIGN_X, spot.z - SIGN_Z) >= 3.6;
      const spaced = openSpots.every((o) => Math.hypot(o.x - spot.x, o.z - spot.z) >= 2.5);
      if (clearOfProps && clearOfSpawn && spaced) {
        openSpots.push(new THREE.Vector3(spot.x, 0, spot.z));
        break;
      }
    }
  }

  // ---- plants: heavy, gathered round the clearing and the props, kept off the way in ------------
  const keepClear: AvoidCircle[] = [
    { x: 0, z: 0, radius: CLEARING_RADIUS + 1 },
    { x: SPAWN.x, z: SPAWN.z, radius: 2.5 },
    { x: SIGN_X, z: SIGN_Z, radius: 1.4 },
    ...[8.8, 10.8, 12.8, 14.8, 16.8].map((z) => ({ x: 0, z, radius: 2 })), // the lane from the spawn to the fire
    ...stumpPlacements.map((p) => ({ x: p.x, z: p.z, radius: 1.2 })),
    { x: -GATE_POST_X, z: GATE_Z, radius: 1 },
    { x: GATE_POST_X, z: GATE_Z, radius: 1 },
    ...lanternSpots.map((p) => ({ ...p, radius: 0.9 })),
    { ...rockSpot, radius: 2.2 },
    { ...smallRockSpot, radius: 1.4 },
    { ...stackSpot, radius: 1.9 },
    ...openSpots.map((p) => ({ x: p.x, z: p.z, radius: 0.9 })),
  ];
  root.add(
    scatterPlants(
      mulberry32(SEED + 3),
      PLANT_COUNT,
      { minX: -(WALK_HALF - 0.5), maxX: WALK_HALF - 0.5, minZ: -(WALK_HALF - 0.5), maxZ: WALK_HALF - 0.5 },
      keepClear,
      { edgeFalloff: 4 },
    ),
  );

  // ---- fireflies --------------------------------------------------------------------------------
  const fireflies = createFireflies(mulberry32(SEED + 7));
  root.add(fireflies.points);

  // ---- progressive swap: primitives stay until the models arrive --------------------------------
  const swapInModels = (): void => {
    fire.useModel();
    const modelRng = mulberry32(SEED + 1); // separate stream, so the primitive layout never shifts

    // Trees: mostly autumn oaks, some green oaks and tall pines. The outer wall is the taller one.
    const usable = TREE_CHOICES.filter((c) => assets.has(c.id));
    if (usable.length > 0) {
      const total = usable.reduce((sum, c) => sum + c.weight, 0);
      const buckets: Placement[][] = usable.map(() => []);
      treeSpots.forEach((spot, i) => {
        let r = modelRng() * total;
        let pick = 0;
        while (pick < usable.length - 1 && r >= usable[pick]!.weight) {
          r -= usable[pick]!.weight;
          pick++;
        }
        const [lo, hi] = i < innerStart ? [0.95, 1.4] : [0.8, 1.1];
        buckets[pick]!.push({ ...spot, yaw: modelRng() * Math.PI * 2, scale: lo! + modelRng() * (hi! - lo!) });
      });
      const meshes: THREE.InstancedMesh[] = [];
      usable.forEach((c, i) => {
        const mesh = instancedModel(c.id, buckets[i]!);
        if (mesh) meshes.push(mesh);
      });
      if (meshes.length > 0) {
        const group = new THREE.Group();
        group.name = 'trees';
        group.add(...meshes);
        replace(root, primitiveTrees, group);
      }
    }

    // Benches and the gateway are all `log.single`, so they share one instanced mesh: each post
    // stands a log on end (turned about x and stretched to the gateway's height), and the crossbeam
    // lies along x, stretched to span the posts.
    if (assets.has('log.single')) {
      const logs = assets.instanced('log.single', BENCH_COUNT + 3);
      if (logs) {
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const p = new THREE.Vector3();
        const s = new THREE.Vector3();
        const m = new THREE.Matrix4();
        const put = (i: number, x: number, y: number, z: number, rx: number, ry: number, stretch: number): void => {
          m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, 0)), s.set(1, 1, stretch));
          logs.setMatrixAt(i, m);
        };
        benchPlacements.forEach((b, i) => put(i, b.x, 0, b.z, 0, b.yaw ?? 0, 1));
        const postStretch = GATE_HEIGHT / BENCH_LENGTH;
        const postZ = GATE_Z + 0.27; // standing up swings the log's thickness onto z; this recenters it
        put(BENCH_COUNT, -GATE_POST_X, GATE_HEIGHT / 2, postZ, -Math.PI / 2, 0, postStretch);
        put(BENCH_COUNT + 1, GATE_POST_X, GATE_HEIGHT / 2, postZ, -Math.PI / 2, 0, postStretch);
        put(BENCH_COUNT + 2, 0, GATE_HEIGHT - 0.08, GATE_Z, 0, Math.PI / 2, GATE_BEAM_LENGTH / BENCH_LENGTH);
        logs.instanceMatrix.needsUpdate = true;
        setShadowCasting(logs, true, true);
        logs.name = 'logs';
        root.remove(primitiveBenches, primitiveGate);
        root.add(logs);
        disposeMeshes(primitiveBenches);
        disposeMeshes(primitiveGate);
      }
    }

    if (assets.has('stump')) replace(root, primitiveStumps, instancedModel('stump', stumpPlacements));
    if (assets.has('signpost.single')) {
      replace(root, primitiveLanterns, instancedModel('signpost.single', lanternPlacements));
    }
    if (assets.has('rock.flat')) replace(root, primitiveRocks, instancedModel('rock.flat', rockPlacements));
    if (assets.has('log.stack')) replace(root, primitiveStack, instancedModel('log.stack', stackPlacements));

    if (assets.has('signpost')) {
      const model = assets.instance('signpost');
      model.position.copy(signRoot.position);
      model.rotation.y = SIGN_YAW;
      setShadowCasting(model, true, true);
      replace(root, signRoot, model);
    }
  };

  assets
    .load(MODEL_IDS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[campfire-circle] could not swap in models, keeping placeholder art', err);
    });

  return {
    id: 'campfire-circle',
    root,
    bounds: squareBounds(WALK_HALF),
    spawn: SPAWN.clone(),
    interactables: [back],
    openSpots,
    landmarks: {},
    update: (dt: number) => {
      fire.update(dt);
      fireflies.update(dt);
    },
  };
}
