/**
 * Placeholder zone builder. Until a zone builder writes the real art, every non-hub zone is a
 * primitive clearing built here: a colored ground, a ring of the same instanced primitive trees
 * Base Camp uses, 10 to 14 open spots on a loose grid, labeled signposts for the zone's landmarks,
 * and the "Trail sign" that walks the player back to Base Camp.
 *
 * Each zone file (nature-trail.ts and friends) calls `buildPlaceholderZone` with its own color,
 * seed and landmark list. A zone builder replaces that file and need not use this one.
 */
import * as THREE from 'three';
import type { ZoneId } from '../activities/types';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint, squareBounds } from './bounds';
import { tree, type Spot } from './props';
import type { Interactable, Zone, ZoneLabel } from './zone';
import type { ZoneDeps } from './zones';

export interface PlaceholderLandmark {
  /** The navigate waypoint id from the content, for example "footbridge". */
  id: string;
  /** What the signpost says. */
  label: string;
}

export interface PlaceholderOptions {
  id: ZoneId;
  groundColor: number;
  /** Seeds the tree ring and the jitter of the open spots, so every load looks the same. */
  seed: number;
  landmarks: readonly PlaceholderLandmark[];
  deps: ZoneDeps;
}

/** The player may walk this far from the center in x and z (a 30 by 30 clearing). */
export const PLACEHOLDER_HALF = 15;
const GROUND_SIZE = 70;
const TREE_COUNT = 36;
const GRID_START = -12.5;
const GRID_STEP = 5;
const GRID_COUNT = 6;
const JITTER = 1;
const MAX_SPOTS = 12;
const LANDMARK_RADIUS = 8;
const SPAWN = new THREE.Vector3(0, 0, 12);
const SIGN_OFFSET_X = -3.5; // the Trail sign stands this far to the side of the spawn
const SIGN_RADIUS = 2.2;
const SIGN_LABEL_HEIGHT = 2.6;
const LANDMARK_LABEL_HEIGHT = 3.3; // where a landmark's place name hangs
/** Open spots keep this far from the spawn, the Trail sign and every landmark. */
const KEEP_CLEAR = 3.6;

/** Yaw that turns a thing whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function buildPlaceholderZone(options: PlaceholderOptions): Zone {
  const { id, deps } = options;
  const root = new THREE.Group();
  root.name = id;
  const rng = mulberry32(options.seed);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: options.groundColor }),
  );
  root.add(ground);

  // A ring of trees just outside the walkable square, so the edge reads as a wall.
  const treeSpots: Spot[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    treeSpots.push(perimeterPoint((i + rng() * 0.7) / TREE_COUNT, PLACEHOLDER_HALF + 1.5 + rng() * 2));
  }
  root.add(tree(rng, treeSpots));

  const spawn = SPAWN.clone();

  // ---- signposts: one shared set of geometry and materials -------------------------------------
  const postGeo = new THREE.CylinderGeometry(0.1, 0.13, 2.4, 8).translate(0, 1.2, 0);
  const boardGeo = new THREE.BoxGeometry(1.8, 0.55, 0.1).translate(0, 2.1, 0.12);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true });
  const boardMat = new THREE.MeshLambertMaterial({ color: 0xd9b36c, flatShading: true });
  const signpost = (name: string, x: number, z: number, yaw: number): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    g.add(new THREE.Mesh(postGeo, postMat), new THREE.Mesh(boardGeo, boardMat));
    return g;
  };

  // The Trail sign: the way back to Base Camp, a few steps from the spawn.
  const signX = spawn.x + SIGN_OFFSET_X;
  const signZ = spawn.z;
  root.add(signpost('trail-sign', signX, signZ, yawToward(signX, signZ, spawn.x, spawn.z)));
  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(signX, SIGN_LABEL_HEIGHT, signZ),
    radius: SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: deps.onReturnToBaseCamp,
  };

  // Landmarks: labeled signposts spread around a ring, looking at the middle. Not interactable.
  const landmarks: Record<string, THREE.Vector3> = {};
  const labels: ZoneLabel[] = [];
  const count = options.landmarks.length;
  options.landmarks.forEach((landmark, i) => {
    const angle = Math.PI / Math.max(count, 1) + (i * 2 * Math.PI) / Math.max(count, 1);
    const x = Math.cos(angle) * LANDMARK_RADIUS;
    const z = Math.sin(angle) * LANDMARK_RADIUS;
    landmarks[landmark.id] = new THREE.Vector3(x, 0, z);
    const post = signpost(`landmark:${landmark.id}`, x, z, yawToward(x, z, 0, 0));
    labels.push({ text: landmark.label, position: new THREE.Vector3(x, LANDMARK_LABEL_HEIGHT, z) });
    root.add(post);
  });

  // ---- open spots: a loose grid, jittered, clear of everything above ---------------------------
  const keepClearOf: THREE.Vector3[] = [spawn, new THREE.Vector3(signX, 0, signZ), ...Object.values(landmarks)];
  const candidates: THREE.Vector3[] = [];
  for (let row = 0; row < GRID_COUNT; row++) {
    for (let col = 0; col < GRID_COUNT; col++) {
      const x = GRID_START + col * GRID_STEP + (rng() * 2 - 1) * JITTER;
      const z = GRID_START + row * GRID_STEP + (rng() * 2 - 1) * JITTER;
      const clear = keepClearOf.every((p) => Math.hypot(p.x - x, p.z - z) >= KEEP_CLEAR);
      if (clear) candidates.push(new THREE.Vector3(x, 0, z));
    }
  }
  const chosen = new Set(shuffled(candidates, rng).slice(0, MAX_SPOTS));
  const openSpots = candidates.filter((spot) => chosen.has(spot)); // grid order, so the order is stable

  // The zone carries no lights: the world's environment (sun, sky light, fog) lights every zone.
  setShadowCasting(root, true, true);
  ground.castShadow = false;

  return {
    id,
    root,
    bounds: squareBounds(PLACEHOLDER_HALF),
    spawn,
    interactables: [back],
    openSpots,
    landmarks,
    labels,
    update: () => {},
  };
}
