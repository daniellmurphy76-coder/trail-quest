/**
 * Town Square: the citizenship zone, where the Wolf "Council Fire" stops happen.
 *
 * A paved plaza in the middle with a flagpole, four planters and lamp posts. Two streets cross
 * through it (a zebra crossing on each arm, a stop sign on the way in). The four civic buildings
 * stand in the corners and face the plaza: library (blue), school (yellow), fire station (red) and
 * grocery store (green), each with a small name sign in front. Houses line the outer edges, with
 * round trees and plants in the grass between. The player spawns at the south end of the main
 * street, beside the "Back to camp" trail sign, looking north (-z) into the square.
 *
 * Every prop starts as a cheap primitive (boxes in the building colors, merged and instanced) and
 * is swapped for the CC0 model when it loads. Nothing here waits on assets. The zone carries no
 * lights: the world's environment lights every zone. Solid things block the player (see
 * `Zone.colliders`): the buildings, the flagpole, the planters, the lamps, the stop signs, the Trail
 * sign and the lawn trees' trunks. The four name signs stand on their own landmarks, so they have
 * none. Streets, the plaza, the open spots and the landmarks are kept clear of colliders.
 *
 * Draw calls: about 24 with primitives only (28 with the four name signs, which are sprites). After
 * the swap about 39 (buildings 7, plants up to 8, streets 3, planters 5, flagpole 3, and so on).
 * The sun's shadow pass draws the casters a second time, about 25 more, so the zone stays near 65.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { squareBounds } from './bounds';
import { boxCollider, circleCollider, type Collider } from './collide';
import { createGround, createGroundApron } from './ground';
import { labelSprite } from './placeholder-zone';
import {
  flagpole,
  instancedModel,
  scatterPlants,
  tintPlants,
  treeColliders,
  type AvoidCircle,
  type Placement,
  type Rng,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';
import type { ZoneDeps } from './zones';

// ---- layout constants ---------------------------------------------------------------------------

/** The player may walk this far from the center in x and z (a 35 by 35 square). */
export const TOWN_SQUARE_HALF = 17.5;
const GROUND_SIZE = 60;
const SEED = 3303;

const GRASS_COLOR = 0x5f9e45;
const PLAZA_COLOR = 0xcdc5b2;
/** Solid paving out to this radius around the flagpole, then it fades to grass over the feather. */
const PLAZA_RADIUS = 11;
const PLAZA_FEATHER = 2.5;

/** One street tile, in world units (the models are 1 unit wide at scale 5.5). */
const TILE = 5.5;
const ROAD_WIDTH = 0.8 * TILE; // asphalt
const CURB_WIDTH = 0.1 * TILE; // sidewalk strip each side of the asphalt
/** Distance from a street's center line to the outer edge of its sidewalk. */
export const TOWN_SQUARE_STREET_HALF = ROAD_WIDTH / 2 + CURB_WIDTH;
/**
 * The street models are cut 0.07 below their origin so they sit in the ground. The ground in this
 * zone is nearly flat, so lift them: the asphalt then stands 1.5 cm and the curbs 7 cm proud.
 */
const STREET_LIFT = 0.03;
const ASPHALT_TOP = 0.015;
const CURB_TOP = 0.07;

const ISLAND_RADIUS = 1.7;
const ISLAND_HEIGHT = 0.16;

const SPAWN_POS = { x: 0, z: 14 } as const;
const SIGN_POS = { x: -4.6, z: 15 } as const;
const SIGN_RADIUS = 2;
const SIGN_LABEL_HEIGHT = 2.6;
/** The name signs stand this far in front of each civic building's front wall. */
const LANDMARK_GAP = 2.2;
const SIGN_POST_HEIGHT = 2;
const SIGN_LABEL_Y = 2.75;

const TREE_COUNT = 18;
const TREE_REACH = 19.5;
/** A tree's crown is about this wide (radius), so it keeps this much extra room from props. */
const TREE_CROWN_RADIUS = 1.3;
const PLANT_COUNT = 120;
const PLANT_REACH = 20.5;

// ---- the buildings ------------------------------------------------------------------------------

/** A building's ground footprint. `yaw` turns it about the up axis; its front faces (sin yaw, cos yaw). */
export interface TownFootprint {
  id: string;
  x: number;
  z: number;
  yaw: number;
  /** Width along the building's own x axis. */
  w: number;
  /** Depth along its own z axis (the door is on the +z face). */
  d: number;
}

interface BuildingSpec extends TownFootprint {
  /** Manifest id of the model that replaces the primitive. */
  model: string;
  /** Wall height of the primitive stand-in (about the model's height). */
  h: number;
  color: number;
  roofColor: number;
  roofHeight: number;
}

/** Yaw that turns a thing whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

interface CivicSpec {
  /** Landmark id the navigate content uses. */
  id: string;
  model: string;
  /** What the sign in front says. */
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Wall color of the primitive; the models are tinted the same way. */
  color: number;
}

// Sizes are the models' bounding boxes at scale 5.5. The corners sit at (+-11.5, +-11.5), facing the plaza.
const CIVIC: readonly CivicSpec[] = [
  { id: 'library', model: 'building.library', label: 'Library', x: -11.5, z: 11.5, w: 4.86, d: 6.0, h: 4.9, color: 0x3b7dd8 },
  { id: 'school', model: 'building.school', label: 'School', x: -11.5, z: -11.5, w: 9.02, d: 5.54, h: 4.9, color: 0xf2c744 },
  { id: 'fire-station', model: 'building.firestation', label: 'Fire station', x: 11.5, z: 11.5, w: 4.86, d: 5.17, h: 7.1, color: 0xd64541 },
  { id: 'store', model: 'building.store', label: 'Grocery store', x: 11.5, z: -11.5, w: 11.46, d: 5.19, h: 8.1, color: 0x4aa35a },
];

const HOUSE_TYPES = {
  a: { model: 'building.house.a', w: 7.15, d: 5.65, h: 4.6, color: 0xe8dcc4 },
  b: { model: 'building.house.b', w: 7.85, d: 7.85, h: 4.05, color: 0xd9c4a5 },
  c: { model: 'building.house.c', w: 5.65, d: 5.61, h: 6.3, color: 0xefe9dc },
} as const;

type HouseType = keyof typeof HOUSE_TYPES;

const FACE_EAST = Math.PI / 2; // front toward +x
const FACE_WEST = -Math.PI / 2;
const FACE_NORTH = Math.PI; // front toward -z
const FACE_SOUTH = 0; // front toward +z

// Outside the walkable square, along the four edges. The south edge is left open around the
// spawn so the camera, which trails the player, never ends up inside a house.
const HOUSES: ReadonlyArray<{ type: HouseType; x: number; z: number; yaw: number }> = [
  { type: 'a', x: -22, z: -9.5, yaw: FACE_EAST },
  { type: 'c', x: -22, z: 9.5, yaw: FACE_EAST },
  { type: 'b', x: 22, z: -9.5, yaw: FACE_WEST },
  { type: 'a', x: 22, z: 9.5, yaw: FACE_WEST },
  { type: 'c', x: -13.5, z: -22, yaw: FACE_SOUTH },
  { type: 'b', x: 0, z: -23.5, yaw: FACE_SOUTH },
  { type: 'a', x: 13.5, z: -22, yaw: FACE_SOUTH },
  { type: 'b', x: -15, z: 22, yaw: FACE_NORTH },
  { type: 'c', x: 15, z: 22, yaw: FACE_NORTH },
];

const HOUSE_ROOF_COLOR = 0x8f5b47;

function buildingSpecs(): BuildingSpec[] {
  const civic = CIVIC.map<BuildingSpec>((c) => ({
    id: c.id,
    model: c.model,
    x: c.x,
    z: c.z,
    yaw: yawToward(c.x, c.z, 0, 0),
    w: c.w,
    d: c.d,
    h: c.h,
    color: c.color,
    roofColor: new THREE.Color(c.color).multiplyScalar(0.6).getHex(),
    roofHeight: 1.6,
  }));
  const houses = HOUSES.map<BuildingSpec>((h, i) => {
    const t = HOUSE_TYPES[h.type];
    return {
      id: `house-${i + 1}`,
      model: t.model,
      x: h.x,
      z: h.z,
      yaw: h.yaw,
      w: t.w,
      d: t.d,
      h: t.h,
      color: t.color,
      roofColor: HOUSE_ROOF_COLOR,
      roofHeight: 2.2,
    };
  });
  return [...civic, ...houses];
}

const BUILDINGS = buildingSpecs();

/** Footprints of every building (the four civic ones first), for layout checks. */
export const TOWN_SQUARE_BUILDINGS: readonly TownFootprint[] = BUILDINGS.map(({ id, x, z, yaw, w, d }) => ({
  id,
  x,
  z,
  yaw,
  w,
  d,
}));

/** True when the ground point (x, z) is inside the footprint grown by `margin` on every side. */
export function insideFootprint(x: number, z: number, fp: TownFootprint, margin = 0): boolean {
  const dx = x - fp.x;
  const dz = z - fp.z;
  const c = Math.cos(fp.yaw);
  const s = Math.sin(fp.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= fp.w / 2 + margin && Math.abs(lz) <= fp.d / 2 + margin;
}

// ---- street furniture and plaza layout ----------------------------------------------------------

interface Circle {
  x: number;
  z: number;
  r: number;
}

const PLANTERS: readonly Spot[] = [
  { x: 6, z: 6 },
  { x: -6, z: 6 },
  { x: 6, z: -6 },
  { x: -6, z: -6 },
];
const PLANTER_RING_RADIUS = 0.95;
const PLANTER_STONES = 6;
const PLANTER_STONE_SCALE = 0.85;
/** What a planter blocks: its ring of stones and a little more, bed and bush inside. */
const PLANTER_COLLIDER_RADIUS = PLANTER_RING_RADIUS + 0.25;
const FLAGPOLE_COLLIDER_RADIUS = 0.35;
/** A lamp post, a stop sign post or the Trail sign: a thin post, so a small circle. */
const POST_COLLIDER_RADIUS = 0.25;

interface Lamp {
  x: number;
  z: number;
  /** The lamp's arm reaches out toward this point. */
  toX: number;
  toZ: number;
}

/** Four at the corners of the crossing, and a pair on each street arm. */
const LAMPS: readonly Lamp[] = [
  ...[
    [3.9, 3.9],
    [-3.9, 3.9],
    [3.9, -3.9],
    [-3.9, -3.9],
  ].map(([x, z]) => ({ x: x!, z: z!, toX: 0, toZ: 0 })),
  { x: 3.4, z: 12.8, toX: 0, toZ: 12.8 },
  { x: -3.4, z: 12.8, toX: 0, toZ: 12.8 },
  { x: 3.4, z: -12.8, toX: 0, toZ: -12.8 },
  { x: -3.4, z: -12.8, toX: 0, toZ: -12.8 },
  { x: 12.8, z: 3.4, toX: 12.8, toZ: 0 },
  { x: 12.8, z: -3.4, toX: 12.8, toZ: 0 },
  { x: -12.8, z: 3.4, toX: -12.8, toZ: 0 },
  { x: -12.8, z: -3.4, toX: -12.8, toZ: 0 },
];

/** Where a street lamp's arm points: its arm runs toward local -z, so that is yaw away from the target. */
function lampYaw(l: Lamp): number {
  return Math.atan2(l.x - l.toX, l.z - l.toZ);
}

/** Stop signs stand just past the zebra crossings. `yaw` is the direction the sign faces, as for any front-+z thing. */
const STOP_SIGNS: ReadonlyArray<{ x: number; z: number; yaw: number }> = [
  { x: 3.3, z: 9, yaw: FACE_SOUTH }, // for walkers coming in from the south
  { x: -3.3, z: -9, yaw: FACE_NORTH },
];

/** The landmark (and name sign) in front of each civic building's door. */
function landmarkOf(c: CivicSpec): THREE.Vector3 {
  const yaw = yawToward(c.x, c.z, 0, 0);
  const out = c.d / 2 + LANDMARK_GAP;
  return new THREE.Vector3(c.x + Math.sin(yaw) * out, 0, c.z + Math.cos(yaw) * out);
}

/** 13 walkable points: a ring around the plaza, along the sidewalks, and down the street arms. */
const OPEN_SPOTS: readonly Spot[] = [
  { x: 9.4, z: 4.6 },
  { x: 9.4, z: -4.6 },
  { x: -9.4, z: 4.6 },
  { x: -9.4, z: -4.6 },
  { x: 4.6, z: -9.4 },
  { x: -4.6, z: 9.4 },
  { x: 9.5, z: 0 },
  { x: -9.5, z: 0 },
  { x: 0, z: -9.5 },
  { x: 0, z: 9.5 },
  { x: 15, z: 0 },
  { x: -15, z: 0 },
  { x: 0, z: -15 },
];

/** Round obstacles on the ground (not trees): the layout keeps open spots and plants out of these. */
export const TOWN_SQUARE_PROPS: readonly Circle[] = [
  { x: 0, z: 0, r: ISLAND_RADIUS },
  ...PLANTERS.map((p) => ({ x: p.x, z: p.z, r: 1.6 })),
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.5 })),
  ...STOP_SIGNS.map((s) => ({ x: s.x, z: s.z, r: 0.5 })),
  { x: SIGN_POS.x, z: SIGN_POS.z, r: 0.9 },
  ...CIVIC.map((c) => {
    const p = landmarkOf(c);
    return { x: p.x, z: p.z, r: 0.6 };
  }),
];

// ---- small geometry helpers ---------------------------------------------------------------------

const dummy = new THREE.Object3D();

function setInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx = 1,
  sy = sx,
  sz = sx,
): void {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, yaw, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

const vertexColored = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** `geo` with every vertex painted `color`, as non-indexed geometry that merges with its siblings. */
function colored(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

/** A colored box of size (w, h, d) centered at (x, y, z). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  return colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** Merge colored parts into one geometry (one draw call). */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

/** One InstancedMesh of `geometry` with the given placements (yaw only, uniform scale). */
function instanceAll(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly Placement[],
  y = 0,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = name;
  placements.forEach((p, i) => setInstance(mesh, i, p.x, y, p.z, p.yaw ?? 0, p.scale ?? 1));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function dispose(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

// ---- streets ------------------------------------------------------------------------------------

type TileKind = 'straight' | 'crossing' | 'intersection';

interface Tile {
  kind: TileKind;
  x: number;
  z: number;
  yaw: number;
}

const STREET_MODELS: Record<TileKind, string> = {
  straight: 'street.straight',
  crossing: 'street.crossing',
  intersection: 'street.intersection',
};

/** A cross through the middle: an intersection, then a zebra crossing and two plain tiles on each arm. */
function streetTiles(): Tile[] {
  const tiles: Tile[] = [{ kind: 'intersection', x: 0, z: 0, yaw: 0 }];
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const kind: TileKind = Math.abs(k) === 1 ? 'crossing' : 'straight';
    tiles.push({ kind, x: 0, z: k * TILE, yaw: Math.PI / 2 }); // the models run along x; turn them to run along z
    tiles.push({ kind, x: k * TILE, z: 0, yaw: 0 });
  }
  return tiles;
}

const ASPHALT_COLOR = 0x3f434a;
const CURB_COLOR = 0xb4b2ab;
const MARK_COLOR = 0xf0ead2;

/** Primitive look-alikes of the three street models, so the roads read the same before the art loads. */
function tileGeometry(kind: TileKind): THREE.BufferGeometry {
  const asphaltY = ASPHALT_TOP - 0.05;
  const curbY = CURB_TOP - 0.07;
  if (kind === 'intersection') {
    const corner = TILE / 2 - CURB_WIDTH / 2;
    return mergeParts([
      box(TILE, 0.1, TILE, 0, asphaltY, 0, ASPHALT_COLOR),
      ...[
        [corner, corner],
        [-corner, corner],
        [corner, -corner],
        [-corner, -corner],
      ].map(([x, z]) => box(CURB_WIDTH, 0.14, CURB_WIDTH, x!, curbY, z!, CURB_COLOR)),
    ]);
  }
  const edge = ROAD_WIDTH / 2 + CURB_WIDTH / 2;
  const parts = [
    box(TILE, 0.1, ROAD_WIDTH, 0, asphaltY, 0, ASPHALT_COLOR),
    box(TILE, 0.14, CURB_WIDTH, 0, curbY, edge, CURB_COLOR),
    box(TILE, 0.14, CURB_WIDTH, 0, curbY, -edge, CURB_COLOR),
  ];
  if (kind === 'straight') {
    for (const x of [-1.8, 0, 1.8]) parts.push(box(1, 0.012, 0.14, x, ASPHALT_TOP + 0.006, 0, MARK_COLOR));
  } else {
    // Zebra bars run along the road, side by side across it.
    for (const k of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
      parts.push(box(1.4, 0.012, 0.34, 0, ASPHALT_TOP + 0.006, k * 0.55, MARK_COLOR));
    }
  }
  return mergeParts(parts);
}

interface Streets {
  group: THREE.Group;
  /** Trade the primitive tiles for the models that have loaded. */
  swap(): void;
}

function buildStreets(): Streets {
  const group = new THREE.Group();
  group.name = 'streets';
  const tiles = streetTiles();
  const material = vertexColored();
  const primitives = new Map<TileKind, THREE.InstancedMesh>();
  const byKind = (kind: TileKind): Tile[] => tiles.filter((t) => t.kind === kind);
  for (const kind of ['straight', 'crossing', 'intersection'] as const) {
    const mesh = instanceAll(`street-${kind}`, tileGeometry(kind), material, byKind(kind));
    setShadowCasting(mesh, false, true);
    primitives.set(kind, mesh);
    group.add(mesh);
  }
  return {
    group,
    swap() {
      for (const [kind, primitive] of primitives) {
        const id = STREET_MODELS[kind];
        if (!assets.has(id)) continue;
        const model = instancedModel(id, byKind(kind), { cast: false, receive: true });
        if (!model) continue;
        model.position.y = STREET_LIFT;
        group.remove(primitive);
        primitive.geometry.dispose();
        primitives.delete(kind);
        group.add(model);
      }
      if (primitives.size === 0) material.dispose();
    },
  };
}

// ---- buildings ----------------------------------------------------------------------------------

/**
 * Every building as three InstancedMeshes (walls, roofs, doors; 3 draw calls for all 13). When a
 * model arrives, its primitive is retired by squashing that instance out of sight; the meshes hide
 * once every instance is gone.
 */
class PrimitiveBuildings {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];
  private alive: number;

  constructor(private readonly specs: readonly BuildingSpec[]) {
    this.group.name = 'buildings';
    const n = specs.length;
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert(0xffffff), n);
    walls.name = 'building-walls';
    // A four-sided cone is a pyramid roof; the 45 degree turn lines its corners up with the walls.
    const roofs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
      lambert(0xffffff),
      n,
    );
    roofs.name = 'building-roofs';
    const doors = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 2.2, 0.2).translate(0, 1.1, 0), lambert(0x4a3a2c), n);
    doors.name = 'building-doors';

    const color = new THREE.Color();
    specs.forEach((s, i) => {
      setInstance(walls, i, s.x, 0, s.z, s.yaw, s.w, s.h, s.d);
      walls.setColorAt(i, color.set(s.color));
      setInstance(roofs, i, s.x, s.h, s.z, s.yaw, s.w * 1.08, s.roofHeight, s.d * 1.08);
      roofs.setColorAt(i, color.set(s.roofColor));
      const front = s.d / 2;
      setInstance(doors, i, s.x + Math.sin(s.yaw) * front, 0, s.z + Math.cos(s.yaw) * front, s.yaw);
    });
    this.meshes = [walls, roofs, doors];
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      setShadowCasting(mesh, true, true);
      this.group.add(mesh);
    }
    this.alive = n;
  }

  retire(index: number): void {
    for (const mesh of this.meshes) {
      setInstance(mesh, index, 0, -100, 0, 0, 0.001);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.alive--;
    if (this.alive <= 0) for (const mesh of this.meshes) mesh.visible = false;
  }

  /** Replace every building whose model has loaded: civic ones one by one, houses one draw per type. */
  swap(root: THREE.Object3D): void {
    const byModel = new Map<string, number[]>();
    this.specs.forEach((s, i) => {
      const list = byModel.get(s.model) ?? [];
      list.push(i);
      byModel.set(s.model, list);
    });
    for (const [model, indices] of byModel) {
      if (!assets.has(model)) continue;
      const placements: Placement[] = indices.map((i) => {
        const s = this.specs[i]!;
        return { x: s.x, z: s.z, yaw: s.yaw };
      });
      const mesh = instancedModel(model, placements);
      if (!mesh) continue;
      mesh.name = model;
      root.add(mesh);
      for (const i of indices) this.retire(i);
    }
  }
}

// ---- lamps, stop signs ---------------------------------------------------------------------------

/** Merged stand-in for `street.lamp`: a pole, an arm running toward local -z, and a lamp head. */
function lampGeometry(): THREE.BufferGeometry {
  return mergeParts([
    colored(new THREE.CylinderGeometry(0.07, 0.1, 4.95, 6).translate(0, 2.475, 0), 0x6b7078),
    box(0.1, 0.1, 1.78, 0, 4.9, -0.89, 0x6b7078),
    box(0.5, 0.14, 0.34, 0, 4.82, -1.65, 0xf4e7a1),
  ]);
}

/**
 * Merged stand-in for `street.sign.stop`: a post and a red octagon with a white rim. Unlike the
 * model (whose face looks toward -x), this one faces +z, so the placements differ by a quarter turn.
 */
function stopSignGeometry(): THREE.BufferGeometry {
  const octagon = (radius: number, thick: number, z: number, color: number): THREE.BufferGeometry =>
    colored(new THREE.CylinderGeometry(radius, radius, thick, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.3, z), color);
  return mergeParts([
    box(0.08, 2.4, 0.08, 0, 1.2, 0, 0x7a7f86),
    octagon(0.47, 0.04, 0.06, 0xf4f4f0),
    octagon(0.4, 0.05, 0.075, 0xd32f2f),
  ]);
}

// ---- planters -----------------------------------------------------------------------------------

interface Flower {
  x: number;
  z: number;
  kind: 'yellow' | 'red';
}

interface PlanterParts {
  stones: Placement[];
  bushes: Placement[];
  flowers: Flower[];
}

/** A ring of flat stones around a bed with one bush and three flowers. All spots are on the ground (x, z). */
function planterParts(): PlanterParts {
  const stones: Placement[] = [];
  const bushes: Placement[] = [];
  const flowers: Flower[] = [];
  PLANTERS.forEach((p, n) => {
    for (let i = 0; i < PLANTER_STONES; i++) {
      const a = (i / PLANTER_STONES) * Math.PI * 2 + n * 0.5;
      // Turn each stone so its long side runs along the ring.
      stones.push({
        x: p.x + Math.cos(a) * PLANTER_RING_RADIUS,
        z: p.z + Math.sin(a) * PLANTER_RING_RADIUS,
        yaw: Math.atan2(-Math.cos(a), -Math.sin(a)),
        scale: PLANTER_STONE_SCALE,
      });
    }
    bushes.push({ x: p.x, z: p.z, yaw: n * 1.3, scale: 0.7 });
    for (let k = 0; k < 3; k++) {
      const a = n * 0.9 + (k * Math.PI * 2) / 3;
      flowers.push({ x: p.x + Math.cos(a) * 0.5, z: p.z + Math.sin(a) * 0.5, kind: (k + n) % 2 === 0 ? 'yellow' : 'red' });
    }
  });
  return { stones, bushes, flowers };
}

// ---- trees --------------------------------------------------------------------------------------

/** Rejection-sample lawn spots: off the plaza, the streets, every building and every prop. Seeded. */
function lawnTreeSpots(rng: Rng, count: number, blocked: readonly Circle[]): Spot[] {
  const spots: Spot[] = [];
  const plazaClear = PLAZA_RADIUS + PLAZA_FEATHER + 0.5;
  const streetClear = TOWN_SQUARE_STREET_HALF + 1.7;
  for (let attempt = 0; attempt < 900 && spots.length < count; attempt++) {
    const x = (rng() * 2 - 1) * TREE_REACH;
    const z = (rng() * 2 - 1) * TREE_REACH;
    if (Math.hypot(x, z) < plazaClear) continue;
    if (Math.abs(x) < streetClear || Math.abs(z) < streetClear) continue;
    if (BUILDINGS.some((b) => insideFootprint(x, z, b, 2.2))) continue;
    if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + TREE_CROWN_RADIUS)) continue;
    if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 3.2)) continue;
    spots.push({ x, z });
  }
  return spots;
}

interface Trees {
  group: THREE.Group;
  spots: readonly Spot[];
  swap(): void;
}

function buildTrees(rng: Rng, blocked: readonly Circle[]): Trees {
  const group = new THREE.Group();
  group.name = 'trees';
  const spots = lawnTreeSpots(rng, TREE_COUNT, blocked);
  const placements: Placement[] = spots.map((s) => ({ ...s, yaw: rng() * Math.PI * 2, scale: 0.9 + rng() * 0.5 }));
  // Round crowns on short trunks, the same two parts for every tree.
  const trunks = instanceAll('tree-trunks', new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6).translate(0, 1.2, 0), lambert(0x7b5230), placements);
  const crowns = instanceAll('tree-crowns', new THREE.IcosahedronGeometry(1.15, 1).translate(0, 3.3, 0), lambert(0xffffff), placements);
  const leaf = new THREE.Color();
  placements.forEach((_, i) => crowns.setColorAt(i, leaf.setHSL(0.27 + rng() * 0.06, 0.45, 0.3 + rng() * 0.08)));
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  setShadowCasting(trunks, true, true);
  setShadowCasting(crowns, true, true);
  group.add(trunks, crowns);
  return {
    group,
    spots,
    swap() {
      if (!assets.has('tree.round')) return;
      const model = instancedModel('tree.round', placements);
      if (!model) return;
      group.remove(trunks, crowns);
      dispose(trunks);
      dispose(crowns);
      group.add(model);
    },
  };
}

// ---- the zone -----------------------------------------------------------------------------------

const TOWN_SQUARE_MODELS = [
  'street.straight',
  'street.crossing',
  'street.intersection',
  'street.lamp',
  'street.sign.stop',
  ...CIVIC.map((c) => c.model),
  ...Object.values(HOUSE_TYPES).map((t) => t.model),
  'tree.round',
  'rock.flat',
  'plant.bush',
  'plant.flower.yellow',
  'plant.flower.red',
  'signpost',
] as const;

export function createTownSquare(deps: ZoneDeps): Zone {
  const root = new THREE.Group();
  root.name = 'town-square';

  // Ground and plants use their own random streams, so moving one never shifts the others.
  root.add(createGroundApron(GRASS_COLOR));
  root.add(
    createGround({
      size: GROUND_SIZE,
      rng: mulberry32(SEED + 2),
      grass: GRASS_COLOR,
      dirt: PLAZA_COLOR,
      path: { center: { x: 0, z: 0 }, radius: PLAZA_RADIUS, feather: PLAZA_FEATHER },
      segments: 60,
      ripple: 0.02, // town lawns are flat; a small ripple also keeps the grass below the asphalt
    }),
  );

  const spawn = new THREE.Vector3(SPAWN_POS.x, 0, SPAWN_POS.z);

  // ---- streets, plaza props ----------------------------------------------------------------------
  const streets = buildStreets();
  root.add(streets.group);

  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 0.12, ISLAND_HEIGHT, 20).translate(0, ISLAND_HEIGHT / 2, 0),
    lambert(0xdcd6c6),
  );
  island.name = 'plaza-island';
  setShadowCasting(island, true, true);
  root.add(island);

  const pole = flagpole();
  pole.position.set(0, ISLAND_HEIGHT, 0);
  root.add(pole);
  const flag = pole.children[2]; // the pole, its ball, then the flag

  // Planters: flat stones and a bed, bush and flowers. The stones and plants are swapped for models.
  const planters = planterParts();
  const stoneGeo = new THREE.DodecahedronGeometry(0.5, 0).scale(1.4, 0.36, 1.1).translate(0, 0.1, 0);
  const primitiveStones = instanceAll('planter-stones', stoneGeo, lambert(0x8a8f94), planters.stones);
  const soil = instanceAll(
    'planter-soil',
    new THREE.CylinderGeometry(PLANTER_RING_RADIUS, PLANTER_RING_RADIUS, 0.1, 16).translate(0, 0.05, 0),
    lambert(0x5b4331),
    PLANTERS.map((p) => ({ ...p, yaw: 0 })),
  );
  const primitiveBushes = instanceAll(
    'planter-bushes',
    new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.75, 1).translate(0, 0.4, 0),
    lambert(0x3f8a3f),
    planters.bushes,
  );
  const primitiveFlowers = instanceAll(
    'planter-flowers',
    new THREE.SphereGeometry(0.14, 6, 4).translate(0, 0.45, 0),
    lambert(0xffffff),
    planters.flowers.map((f) => ({ x: f.x, z: f.z, yaw: 0 })),
  );
  const flowerColor = new THREE.Color();
  planters.flowers.forEach((f, i) => primitiveFlowers.setColorAt(i, flowerColor.set(f.kind === 'yellow' ? 0xf5d33a : 0xe04848)));
  if (primitiveFlowers.instanceColor) primitiveFlowers.instanceColor.needsUpdate = true;
  for (const m of [primitiveStones, soil, primitiveBushes, primitiveFlowers]) {
    setShadowCasting(m, m !== primitiveFlowers, true);
    root.add(m);
  }

  // Lamps: stand-in geometry has the same arm direction as the model, so one yaw serves both.
  const lampPlacements: Placement[] = LAMPS.map((l) => ({ x: l.x, z: l.z, yaw: lampYaw(l) }));
  const primitiveLamps = instanceAll('lamps', lampGeometry(), vertexColored(), lampPlacements);
  setShadowCasting(primitiveLamps, true, true);
  root.add(primitiveLamps);

  // Stop signs. The model faces -x, the stand-in faces +z: a quarter turn apart.
  const stopPrimitive = instanceAll(
    'stop-signs',
    stopSignGeometry(),
    vertexColored(),
    STOP_SIGNS.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw })),
  );
  setShadowCasting(stopPrimitive, true, true);
  root.add(stopPrimitive);

  // ---- buildings and their name signs -------------------------------------------------------------
  const buildings = new PrimitiveBuildings(BUILDINGS);
  root.add(buildings.group);

  const landmarks: Record<string, THREE.Vector3> = {};
  const signPosts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.09, SIGN_POST_HEIGHT, 6).translate(0, SIGN_POST_HEIGHT / 2, 0),
    lambert(0x6b4a2b),
    CIVIC.length,
  );
  signPosts.name = 'landmark-posts';
  // A ball in the building's color tops each post, so a kid can match sign to building.
  const signCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6).translate(0, SIGN_POST_HEIGHT + 0.12, 0), lambert(0xffffff), CIVIC.length);
  signCaps.name = 'landmark-caps';
  const capColor = new THREE.Color();
  const signs = new THREE.Group();
  signs.name = 'landmark-signs';
  CIVIC.forEach((c, i) => {
    const at = landmarkOf(c);
    landmarks[c.id] = at;
    setInstance(signPosts, i, at.x, 0, at.z, 0);
    setInstance(signCaps, i, at.x, 0, at.z, 0);
    signCaps.setColorAt(i, capColor.set(c.color));
    // Each landmark is a named group, with its name sprite hung above it (no sprite without a canvas).
    const marker = new THREE.Group();
    marker.name = `landmark:${c.id}`;
    marker.position.copy(at);
    const label = labelSprite(c.label, 0.9);
    if (label) {
      label.position.set(0, SIGN_LABEL_Y, 0);
      marker.add(label);
    }
    signs.add(marker);
  });
  for (const m of [signPosts, signCaps]) {
    m.instanceMatrix.needsUpdate = true;
    setShadowCasting(m, true, true);
    signs.add(m);
  }
  if (signCaps.instanceColor) signCaps.instanceColor.needsUpdate = true;
  root.add(signs);

  // ---- the Trail sign: back to Base Camp ------------------------------------------------------------
  // Faces the spot where the camera trails the player at the spawn, so its board reads from there.
  const signYaw = yawToward(SIGN_POS.x, SIGN_POS.z, spawn.x, spawn.z + 6.5);
  const trailSign = new THREE.Group();
  trailSign.name = 'trail-sign';
  trailSign.position.set(SIGN_POS.x, 0, SIGN_POS.z);
  trailSign.rotation.y = signYaw;
  const trailSignPrimitive = new THREE.Mesh(
    mergeParts([
      colored(new THREE.CylinderGeometry(0.1, 0.13, 2.4, 8).translate(0, 1.2, 0), 0x6b4a2b),
      box(1.8, 0.55, 0.1, 0, 2.1, 0.12, 0xd9b36c),
    ]),
    vertexColored(),
  );
  setShadowCasting(trailSignPrimitive, true, true);
  trailSign.add(trailSignPrimitive);
  root.add(trailSign);
  const back: Interactable = {
    id: 'trail-sign',
    position: new THREE.Vector3(SIGN_POS.x, SIGN_LABEL_HEIGHT, SIGN_POS.z),
    radius: SIGN_RADIUS,
    label: 'Back to camp',
    nameTag: 'Trail sign',
    onInteract: deps.onReturnToBaseCamp,
  };

  // ---- trees and plants in the grass -------------------------------------------------------------
  const openSpots = OPEN_SPOTS.map((s) => new THREE.Vector3(s.x, 0, s.z));
  const keepClear: Circle[] = [
    ...TOWN_SQUARE_PROPS,
    ...OPEN_SPOTS.map((s) => ({ x: s.x, z: s.z, r: 2.2 })),
    { x: spawn.x, z: spawn.z, r: 3 },
  ];
  const trees = buildTrees(mulberry32(SEED + 4), keepClear);
  root.add(trees.group);

  // ---- colliders: footprints, not crowns ---------------------------------------------------------
  // Buildings from the same footprints that place them, trunks from the same spots as the trees.
  // The civic name signs are left out on purpose: each stands exactly on its landmark.
  const colliders: Collider[] = [
    ...BUILDINGS.map((b) => boxCollider(b.x, b.z, b.w / 2, b.d / 2, b.yaw)),
    circleCollider(0, 0, FLAGPOLE_COLLIDER_RADIUS),
    ...PLANTERS.map((p) => circleCollider(p.x, p.z, PLANTER_COLLIDER_RADIUS)),
    ...LAMPS.map((l) => circleCollider(l.x, l.z, POST_COLLIDER_RADIUS)),
    ...STOP_SIGNS.map((s) => circleCollider(s.x, s.z, POST_COLLIDER_RADIUS)),
    circleCollider(SIGN_POS.x, SIGN_POS.z, POST_COLLIDER_RADIUS),
    ...treeColliders(trees.spots),
  ];

  // Plants stay off the paving, the streets, the buildings, the props and the tree trunks.
  const avoid: AvoidCircle[] = [
    { x: 0, z: 0, radius: PLAZA_RADIUS + PLAZA_FEATHER },
    ...[-1, 1].flatMap((side) =>
      [12, 14.4, 16.8, 19.2].flatMap((d) => [
        { x: side * d, z: 0, radius: TOWN_SQUARE_STREET_HALF + 0.9 },
        { x: 0, z: side * d, radius: TOWN_SQUARE_STREET_HALF + 0.9 },
      ]),
    ),
    ...BUILDINGS.map((b) => ({ x: b.x, z: b.z, radius: Math.hypot(b.w, b.d) / 2 + 0.6 })),
    ...TOWN_SQUARE_PROPS.map((p) => ({ x: p.x, z: p.z, radius: p.r + 0.5 })),
    ...OPEN_SPOTS.map((s) => ({ x: s.x, z: s.z, radius: 1 })),
    { x: spawn.x, z: spawn.z, radius: 2.5 },
    ...trees.spots.map((s) => ({ x: s.x, z: s.z, radius: 1.4 })),
  ];
  root.add(
    scatterPlants(
      mulberry32(SEED + 3),
      PLANT_COUNT,
      { minX: -PLANT_REACH, maxX: PLANT_REACH, minZ: -PLANT_REACH, maxZ: PLANT_REACH },
      avoid,
    ),
  );

  // ---- progressive swap: primitives stay until the models arrive -----------------------------------
  const swapPlanters = (): void => {
    if (assets.has('rock.flat')) {
      const stones = instancedModel('rock.flat', planters.stones);
      if (stones) {
        root.remove(primitiveStones);
        dispose(primitiveStones);
        root.add(stones);
      }
    }
    if (assets.has('plant.bush')) {
      const bushes = instancedModel('plant.bush', planters.bushes, { cast: false, receive: true });
      if (bushes) {
        tintPlants(bushes);
        root.remove(primitiveBushes);
        dispose(primitiveBushes);
        root.add(bushes);
      }
    }
    const kinds = ['yellow', 'red'] as const;
    if (kinds.every((k) => assets.has(`plant.flower.${k}`))) {
      const meshes = kinds.map((k) =>
        instancedModel(
          `plant.flower.${k}`,
          planters.flowers.filter((f) => f.kind === k).map((f) => ({ x: f.x, z: f.z, yaw: f.x * 3, scale: 0.9 })),
          { cast: false, receive: true },
        ),
      );
      if (meshes.every((m) => m !== undefined)) {
        for (const m of meshes) tintPlants(m!);
        root.remove(primitiveFlowers);
        dispose(primitiveFlowers);
        root.add(...(meshes as THREE.InstancedMesh[]));
      }
    }
  };

  const swapLamps = (): void => {
    if (!assets.has('street.lamp')) return;
    const model = instancedModel('street.lamp', lampPlacements);
    if (!model) return;
    root.remove(primitiveLamps);
    dispose(primitiveLamps);
    root.add(model);
  };

  const swapStopSigns = (): void => {
    if (!assets.has('street.sign.stop')) return;
    // The model's face looks toward -x, not +z, so it needs a quarter turn more than the stand-in.
    const model = instancedModel(
      'street.sign.stop',
      STOP_SIGNS.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw + Math.PI / 2 })),
    );
    if (!model) return;
    root.remove(stopPrimitive);
    dispose(stopPrimitive);
    root.add(model);
  };

  const swapTrailSign = (): void => {
    if (!assets.has('signpost')) return;
    const model = assets.instance('signpost');
    setShadowCasting(model, true, true);
    trailSign.remove(trailSignPrimitive);
    dispose(trailSignPrimitive);
    trailSign.add(model);
  };

  const steps: ReadonlyArray<readonly [string, () => void]> = [
    ['streets', () => streets.swap()],
    ['buildings', () => buildings.swap(root)],
    ['trees', () => trees.swap()],
    ['planters', swapPlanters],
    ['lamps', swapLamps],
    ['stop signs', swapStopSigns],
    ['trail sign', swapTrailSign],
  ];
  const swapInModels = (): void => {
    // Each step stands alone: one that fails leaves its primitives on screen and the rest carry on.
    for (const [name, step] of steps) {
      try {
        step();
      } catch (err: unknown) {
        console.warn(`[town-square] could not swap in the ${name}, keeping placeholder art`, err);
      }
    }
  };

  assets
    .load(TOWN_SQUARE_MODELS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[town-square] could not swap in models, keeping placeholder art', err);
    });

  let time = 0;
  return {
    id: 'town-square',
    root,
    bounds: squareBounds(TOWN_SQUARE_HALF),
    spawn,
    interactables: [back],
    openSpots,
    landmarks,
    colliders,
    update: (dt: number) => {
      time += dt;
      // The flag flutters a little.
      if (flag) {
        flag.rotation.y = 0.14 * Math.sin(time * 1.8);
        flag.scale.x = 1 + 0.04 * Math.sin(time * 2.6 + 1);
      }
    },
  };
}
