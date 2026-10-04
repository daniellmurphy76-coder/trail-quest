/**
 * Dev-only character gallery, for screenshots. Open /trail-quest/dev/gallery.html?set=blocky|mini|scouts on the dev
 * server (it is not in vite.config.ts, so it never ships).
 *
 *   ?set=blocky   the 18 Kenney Blocky skins on the kit model (dev/assets/blocky)
 *   ?set=mini     the 12 Kenney Mini characters (dev/assets/mini; a file that is not on disk shows "(failed to load)")
 *   ?set=scouts   18 Trail Quest Scouts built with `buildAvatar`: the six rank defaults, the Den Chief and 11 seeded
 *                 `randomAvatar` looks with every cosmetic unlocked
 *
 * One WebGLRenderer draws a grid of viewports (setViewport + setScissor), six columns wide. Each cell shows one character
 * on a small grass disc in a three-quarter view, in its idle pose, scaled to 1.8 units tall, under a warm key light and a
 * soft sky fill. The labels are DOM elements under each cell. The page sets `data-ready` on <html> when every cell has
 * either loaded or failed, and `data-failed` to the count of the ones that failed.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildAvatar, defaultAvatar, DEN_CHIEF_AVATAR, preloadScoutModel, randomAvatar, scoutModelStatus } from '../player/avatar';
import type { AvatarRig } from '../player/avatar';
import { BLOCKY_BUILD_SCALE } from '../player/avatar/blocky/rig';
import { ALL_COSMETIC_UNLOCKS, RANK_IDS, type FilledAvatar } from '../player/avatar/options';
import type { RankId } from '../activities/types';

const BASE = import.meta.env.BASE_URL;
const FIT_HEIGHT = 1.8;
const TURN = THREE.MathUtils.degToRad(25);
const COLUMNS = 6;
const FAILED = ' (failed to load)';

// ---- the sets --------------------------------------------------------------------------------------

const SETS = ['blocky', 'mini', 'scouts'] as const;
type SetName = (typeof SETS)[number];

const BLOCKY_SKINS = 'abcdefghijklmnopqr'.split('');
const MINI_NAMES = [
  'female-a',
  'female-b',
  'female-c',
  'female-d',
  'female-e',
  'female-f',
  'male-a',
  'male-b',
  'male-c',
  'male-d',
  'male-e',
  'male-f',
] as const;

const RANK_NAME: Readonly<Record<RankId, string>> = {
  lion: 'Lion',
  tiger: 'Tiger',
  wolf: 'Wolf',
  bear: 'Bear',
  webelos: 'Webelos',
  'arrow-of-light': 'Arrow of Light',
};

interface VariedScout {
  label: string;
  rank: RankId;
  /** Seed for `randomAvatar`, found by searching for a look with exactly the features in the label. */
  seed: number;
}

/**
 * Eleven looks from `randomAvatar` (every cosmetic unlocked) with fixed seeds, picked so that the set shows all six skin
 * tones, seven hair styles plus none, all four hats, glasses, a backpack on two, star eyes, and shorts, pants and skorts.
 * A label names the standout features; hats, glasses and backpacks that the label does not name are not worn.
 */
const VARIED_SCOUTS: readonly VariedScout[] = [
  { label: 'Curly hair, cap', rank: 'lion', seed: 982 },
  { label: 'Braids, backpack', rank: 'tiger', seed: 909 },
  { label: 'Spiky hair, beanie', rank: 'wolf', seed: 2756 },
  { label: 'Long hair, glasses', rank: 'bear', seed: 810 },
  { label: 'Ponytail, bucket hat', rank: 'webelos', seed: 674 },
  { label: 'Buzz cut, scout hat', rank: 'arrow-of-light', seed: 174 },
  { label: 'Short hair, skort', rank: 'lion', seed: 2774 },
  { label: 'Pants, glasses', rank: 'tiger', seed: 78261 },
  { label: 'No hair, shorts', rank: 'wolf', seed: 2802 },
  { label: 'Braids, star eyes', rank: 'bear', seed: 499 },
  { label: 'Skort, backpack', rank: 'webelos', seed: 1043 },
];

/** Small seeded generator (mulberry32), so a seed always gives the same look. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- scene -----------------------------------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const grid = document.getElementById('grid') as HTMLElement;
const note = document.getElementById('note') as HTMLElement;

const GUTTER = new THREE.Color(0xe4dcc6);
const CELL_BACKGROUND = new THREE.Color(0xf6f1e3);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(GUTTER);

const scene = new THREE.Scene();
scene.background = CELL_BACKGROUND;
scene.add(new THREE.HemisphereLight(0xdcecff, 0x8a9a5a, 1.4));
const key = new THREE.DirectionalLight(0xffe2b0, 2.6);
key.position.set(-2.5, 4.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.9, bottom: -1.3, near: 1, far: 14 });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
scene.add(key);

const disc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.85, 0.9, 0.12, 40),
  new THREE.MeshLambertMaterial({ color: 0x6aa84f, flatShading: true }),
);
disc.position.y = -0.06;
disc.receiveShadow = true;
scene.add(disc);

const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
const PITCH = THREE.MathUtils.degToRad(11);
const TARGET_Y = 0.96;
/** Half of the height and width every cell has to show: a hat above the 1.8 head, the disc below the feet. */
const HALF_HEIGHT = 1.2;
const HALF_WIDTH = 0.95;

/** Aim the shared camera at the disc so the whole figure fits a cell of this aspect ratio. */
function frameCell(aspect: number): void {
  const distance = Math.max(HALF_HEIGHT / TAN_HALF_FOV, HALF_WIDTH / (TAN_HALF_FOV * aspect));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.position.set(0, TARGET_Y + distance * Math.sin(PITCH), distance * Math.cos(PITCH));
  camera.lookAt(0, TARGET_Y, 0);
}

// ---- helpers ---------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
  });
}

/** Scale to `height` tall and stand on y = 0. */
function fitHeight(model: THREE.Object3D, height: number): void {
  model.scale.setScalar(1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const k = height / (box.max.y - box.min.y);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k;
}

/** The kit's idle clip, played on its own mixer. Returns the step function. */
function playIdle(model: THREE.Object3D, clips: readonly THREE.AnimationClip[]): (dt: number) => void {
  const clip = clips.find((c) => c.name === 'idle') ?? clips.find((c) => /idle/i.test(c.name));
  if (!clip) return () => {};
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  return (dt) => mixer.update(dt);
}

// ---- entries ---------------------------------------------------------------------------------------

interface Entry {
  label: string;
  /** On the disc, turned toward the camera. Hidden except while its own cell is drawn. */
  holder: THREE.Group;
  /** Advance the idle animation. */
  tick: (dt: number) => void;
  /** Build the character into `holder`. Rejects when its model would not load. */
  load: () => Promise<void>;
  /** Set when the model failed. A character that failed is not drawn. */
  failed: boolean;
  /** Extra label text for a character that is drawn but did not load as intended. */
  note?: string;
}

function newEntry(label: string, load: (entry: Entry) => Promise<void>): Entry {
  const holder = new THREE.Group();
  holder.rotation.y = TURN;
  holder.visible = false;
  scene.add(holder);
  const entry: Entry = { label, holder, tick: () => {}, failed: false, load: () => load(entry) };
  return entry;
}

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

// Blocky: one kit model, 18 painted skins.
let blockyKit: Promise<GLTF> | null = null;
const blockyModel = (): Promise<GLTF> => (blockyKit ??= gltfLoader.loadAsync(`${BASE}dev/assets/blocky/character-a.glb`));

async function loadBlocky(entry: Entry, letter: string): Promise<void> {
  const [gltf, texture] = await Promise.all([
    blockyModel(),
    textureLoader.loadAsync(`${BASE}dev/assets/blocky/Textures/texture-${letter}.png`),
  ]);
  texture.flipY = false; // glTF convention, as the kit's own file
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; // the kit's UVs run outside 0..1
  texture.wrapT = THREE.RepeatWrapping;
  const model = cloneWithSkeleton(gltf.scene);
  const skins = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshBasicMaterial;
    let skin = skins.get(source);
    if (!skin) {
      skin = source.clone();
      skin.map = texture;
      skin.needsUpdate = true;
      skins.set(source, skin);
    }
    mesh.material = skin;
  });
  fitHeight(model, FIT_HEIGHT);
  shadows(model);
  entry.holder.add(model);
  entry.tick = playIdle(model, gltf.animations);
}

// Mini: one file per character.
async function loadMini(entry: Entry, name: string): Promise<void> {
  const gltf = await gltfLoader.loadAsync(`${BASE}dev/assets/mini/character-${name}.glb`);
  fitHeight(gltf.scene, FIT_HEIGHT);
  shadows(gltf.scene);
  entry.holder.add(gltf.scene);
  entry.tick = playIdle(gltf.scene, gltf.animations);
}

// Scouts: `buildAvatar`, once the Kenney Scout model has arrived (until then the rig is the plain fallback).
function scoutModelSettled(): Promise<void> {
  return new Promise((resolve) => preloadScoutModel(resolve));
}

async function loadScout(entry: Entry, config: Readonly<FilledAvatar>, rank: RankId, denChiefCord: boolean): Promise<void> {
  await scoutModelSettled();
  const modelReady = scoutModelStatus() === 'ready';
  const rig: AvatarRig = buildAvatar(config, { rank, denChiefCord, blobShadow: false });
  // Build scales the whole figure (small, regular, tall); undo that so every Scout stands 1.8 units to the shoulders.
  if (modelReady) rig.root.scale.setScalar(1 / BLOCKY_BUILD_SCALE[config.build]);
  else entry.note = FAILED;
  shadows(rig.root);
  entry.holder.add(rig.root);
  entry.tick = (dt) => rig.update(dt, { moving: false, speed: 0 });
}

function createEntries(set: SetName): Entry[] {
  switch (set) {
    case 'blocky':
      return BLOCKY_SKINS.map((letter) => newEntry(`Skin ${letter}`, (entry) => loadBlocky(entry, letter)));
    case 'mini':
      return MINI_NAMES.map((name) => newEntry(name, (entry) => loadMini(entry, name)));
    case 'scouts': {
      const entries: Entry[] = RANK_IDS.map((rank) =>
        newEntry(`${RANK_NAME[rank]} default`, (entry) => loadScout(entry, defaultAvatar(rank), rank, false)),
      );
      entries.push(newEntry('Den Chief', (entry) => loadScout(entry, DEN_CHIEF_AVATAR, 'wolf', true)));
      for (const look of VARIED_SCOUTS) {
        const config = randomAvatar(look.rank, seeded(look.seed), ALL_COSMETIC_UNLOCKS);
        entries.push(newEntry(look.label, (entry) => loadScout(entry, config, look.rank, false)));
      }
      return entries;
    }
  }
}

// ---- page ------------------------------------------------------------------------------------------

const requested = new URLSearchParams(window.location.search).get('set');
const set: SetName = (SETS as readonly string[]).includes(requested ?? '') ? (requested as SetName) : 'blocky';

function buildNote(): void {
  note.replaceChildren();
  const showing = requested !== null && requested !== set ? `Unknown set "${requested}", showing ?set=${set}.` : `Showing ?set=${set}.`;
  note.append(`${showing} Other sets: `);
  SETS.filter((name) => name !== set).forEach((name, index) => {
    if (index > 0) note.append(' ');
    const link = el('a', undefined, `?set=${name}`);
    link.href = `?set=${name}`;
    note.append(link);
  });
}

interface Cell {
  entry: Entry;
  view: HTMLElement;
  labelEl: HTMLElement;
  /** The view in canvas pixels, y up from the bottom (what setViewport wants). */
  x: number;
  y: number;
  w: number;
  h: number;
}

const entries = createEntries(set);
const cells: Cell[] = entries.map((entry) => {
  const cell = el('div', 'cell');
  const view = el('div', 'view');
  const labelEl = el('div', 'label', entry.label);
  cell.append(view, labelEl);
  grid.append(cell);
  return { entry, view, labelEl, x: 0, y: 0, w: 0, h: 0 };
});
grid.style.setProperty('--rows', String(Math.max(1, Math.ceil(cells.length / COLUMNS))));
document.title = `Trail Quest character gallery (${set})`;
document.documentElement.dataset.set = set;
buildNote();

function layout(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false);
  const canvasRect = canvas.getBoundingClientRect();
  for (const cell of cells) {
    const r = cell.view.getBoundingClientRect();
    cell.x = r.left - canvasRect.left;
    cell.y = canvasRect.bottom - r.bottom;
    cell.w = r.width;
    cell.h = r.height;
  }
}
window.addEventListener('resize', layout);

let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  for (const cell of cells) cell.entry.tick(dt);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  renderer.clear();
  renderer.setScissorTest(true);
  let shown: THREE.Group | null = null;
  for (const cell of cells) {
    if (cell.w < 1 || cell.h < 1) continue;
    const { entry } = cell;
    const drawn = !entry.failed && entry.holder.children.length > 0;
    if (shown) shown.visible = false;
    entry.holder.visible = drawn;
    shown = entry.holder;
    disc.visible = drawn;
    renderer.setViewport(cell.x, cell.y, cell.w, cell.h);
    renderer.setScissor(cell.x, cell.y, cell.w, cell.h);
    frameCell(cell.w / cell.h);
    renderer.render(scene, camera);
  }
  if (shown) shown.visible = false;
}

async function start(): Promise<void> {
  layout();
  requestAnimationFrame(frame);
  await Promise.all(
    cells.map(async (cell) => {
      try {
        await cell.entry.load();
      } catch (err) {
        cell.entry.failed = true;
        console.warn(`[gallery] ${cell.entry.label}: ${errorText(err)}`);
      }
      cell.labelEl.textContent = cell.entry.label + (cell.entry.failed ? FAILED : (cell.entry.note ?? ''));
      cell.labelEl.classList.toggle('failed', cell.entry.failed || cell.entry.note !== undefined);
    }),
  );
  const failed = cells.filter((cell) => cell.entry.failed || cell.entry.note !== undefined).length;
  document.documentElement.dataset.failed = String(failed);
  document.documentElement.dataset.ready = 'true';
  layout();
  console.info(`[gallery] ${set}: ${cells.length - failed} of ${cells.length} loaded`);
}

void start();
