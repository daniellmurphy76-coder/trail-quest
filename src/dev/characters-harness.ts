/**
 * Dev-only comparison page for the character kits. Open /trail-quest/dev/characters.html on the dev server
 * (it is not in vite.config.ts, so it never ships).
 *
 * Shows one Kenney Blocky character, one Kenney Mini character and, between them, the Trail Quest Scout (the
 * Blocky model wearing a painted skin and attachments, see src/player/avatar/blocky), side by side on a grass
 * disc under warm light. Buttons cycle the Blocky skins (18, one shared rig) and the Mini characters, play any
 * clip by name, and the clip list of each kit is on the page, with the clips that map to a Trail Quest role marked.
 * The comparison models live in dev/assets (CC0, from kenney.nl); the Scout loads public/assets/characters/blocky.glb.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildAvatar, defaultAvatar, preloadScoutModel, randomAvatar, scoutModelStatus } from '../player/avatar';
import type { AvatarRig } from '../player/avatar';
import {
  BUILDS,
  CLOTHES_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_COLORS,
  HAT_STYLES,
  LEG_STYLES,
  NECKERCHIEF_COLORS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
  type Choice,
  type FilledAvatar,
} from '../player/avatar/options';
import { h } from '../ui/dom';

const BASE = import.meta.env.BASE_URL;
const BLOCKY_URL = `${BASE}dev/assets/blocky/character-a.glb`;
const MINI_CHARACTERS = ['male-a', 'male-c', 'female-a', 'female-d'] as const;
const BLOCKY_SKINS = 'abcdefghijklmnopqr'.split('');
const FIT_HEIGHT = 1.8;

/** Clips that map to a Trail Quest role, and the role. Anything not listed is still playable. */
const ROLE_OF_CLIP: Readonly<Record<string, string>> = {
  idle: 'idle',
  walk: 'walk',
  sprint: 'run',
  jump: 'jump',
  'pick-up': 'pick up',
  sit: 'sit',
  'emote-yes': 'emote (a nod; there is no wave or cheer)',
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
const tags = document.getElementById('tags') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe6f7);
scene.add(new THREE.HemisphereLight(0xfff3dc, 0x7a8f4a, 1.6));
const sun = new THREE.DirectionalLight(0xffe2b0, 2.8);
sun.position.set(5, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const disc = new THREE.Mesh(
  new THREE.CylinderGeometry(5, 5.15, 0.2, 48),
  new THREE.MeshLambertMaterial({ color: 0x6aa84f, flatShading: true }),
);
disc.position.y = -0.1;
disc.receiveShadow = true;
scene.add(disc);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
camera.position.set(0, 2.4, 9.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.95, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 20;
controls.update();

// ---- kit characters --------------------------------------------------------------------------------

interface Kit {
  holder: THREE.Group;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  clips: THREE.AnimationClip[];
  current: string | null;
}

function newKit(x: number): Kit {
  const holder = new THREE.Group();
  holder.position.x = x;
  scene.add(holder);
  return { holder, model: null, mixer: null, actions: new Map(), clips: [], current: null };
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

/** Scale to FIT_HEIGHT tall and stand on y = 0. */
function fit(model: THREE.Object3D): void {
  model.scale.setScalar(1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const k = FIT_HEIGHT / (box.max.y - box.min.y);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k;
}

function setModel(kit: Kit, model: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  if (kit.model) {
    kit.holder.remove(kit.model);
    kit.mixer?.stopAllAction();
  }
  kit.model = model;
  kit.clips = clips;
  kit.holder.add(model);
  fit(model);
  shadows(model);
  kit.mixer = new THREE.AnimationMixer(model);
  kit.actions = new Map(clips.map((c) => [c.name, kit.mixer!.clipAction(c)]));
}

function playClip(kit: Kit, name: string, fade = 0.2): void {
  const next = kit.actions.get(name);
  if (!next) return;
  const prev = kit.current ? kit.actions.get(kit.current) : undefined;
  next.reset().play();
  if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
  kit.current = name;
}

const loader = new GLTFLoader();
const blocky = newKit(-2.6);
const mini = newKit(2.6);

let blockySkin = 0;
let miniIndex = 0;
const skinTextures = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

function blockyMaterial(): THREE.MeshBasicMaterial | null {
  let found: THREE.MeshBasicMaterial | null = null;
  blocky.model?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !found) found = mesh.material as THREE.MeshBasicMaterial;
  });
  return found;
}

function skinTexture(letter: string): THREE.Texture {
  let tex = skinTextures.get(letter);
  if (!tex) {
    tex = textureLoader.load(`${BASE}dev/assets/blocky/Textures/texture-${letter}.png`);
    tex.flipY = false; // glTF convention, as the kit's own file
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping; // the kit's UVs run outside 0..1
    tex.wrapT = THREE.RepeatWrapping;
    skinTextures.set(letter, tex);
  }
  return tex;
}

function setBlockySkin(index: number): void {
  blockySkin = (index + BLOCKY_SKINS.length) % BLOCKY_SKINS.length;
  const material = blockyMaterial();
  if (material) {
    material.map = skinTexture(BLOCKY_SKINS[blockySkin]!);
    material.needsUpdate = true;
  }
  refreshUi();
}

async function loadMini(index: number): Promise<void> {
  miniIndex = (index + MINI_CHARACTERS.length) % MINI_CHARACTERS.length;
  const gltf = await loader.loadAsync(`${BASE}dev/assets/mini/character-${MINI_CHARACTERS[miniIndex]}.glb`);
  const keep = mini.current ?? 'idle';
  setModel(mini, gltf.scene, gltf.animations);
  mini.current = null;
  playClip(mini, mini.actions.has(keep) ? keep : 'idle', 0);
  refreshUi();
}

// ---- the Trail Quest Scout --------------------------------------------------------------------------

let look: FilledAvatar = defaultAvatar('wolf');
let denCord = false;
let scout: AvatarRig = buildAvatar(look, { denChiefCord: denCord });
scout.root.position.x = 0;
scene.add(scout.root);
let walkSpeed = 0;

function rebuildScout(): void {
  const emote = scout.emote;
  scene.remove(scout.root);
  scout.dispose();
  scout = buildAvatar(look, { denChiefCord: denCord });
  scout.root.position.x = 0;
  scene.add(scout.root);
  scout.play(emote);
}

// ---- panel -----------------------------------------------------------------------------------------

const nowEl = h('p', { id: 'now' });
const blockyLabel = h('span');
const miniLabel = h('span');
const blockyClips = h('div', { class: 'clips' });
const miniClips = h('div', { class: 'clips' });
const scoutStatus = h('p', { class: 'note' });

const stepper = (label: HTMLElement, back: () => void, next: () => void): HTMLElement =>
  h('div', { class: 'row' }, h('button', { type: 'button', title: 'Previous', on: { click: back } }, '◀'), label, h('button', { type: 'button', title: 'Next', on: { click: next } }, '▶'));

function clipButtons(kit: Kit, into: HTMLElement): void {
  into.replaceChildren(
    ...kit.clips.map((clip) => {
      const role = ROLE_OF_CLIP[clip.name];
      const button = h(
        'button',
        {
          type: 'button',
          class: role ? 'role' : '',
          title: role ? `Trail Quest role: ${role}` : 'Not used by Trail Quest',
          attrs: { 'aria-pressed': kit.current === clip.name },
          on: {
            click: () => {
              playClip(kit, clip.name);
              nowEl.textContent = `Playing "${clip.name}" (${clip.duration.toFixed(3)} s)`;
              refreshUi();
            },
          },
        },
        `${clip.name} ${clip.duration.toFixed(2)}s`,
      );
      return button;
    }),
  );
}

function refreshUi(): void {
  blockyLabel.textContent = `skin ${BLOCKY_SKINS[blockySkin]} (${blockySkin + 1} of ${BLOCKY_SKINS.length})`;
  miniLabel.textContent = `${MINI_CHARACTERS[miniIndex]} (${miniIndex + 1} of ${MINI_CHARACTERS.length})`;
  clipButtons(blocky, blockyClips);
  clipButtons(mini, miniClips);
  tag('blocky', `Blocky (skin ${BLOCKY_SKINS[blockySkin]})`, blocky.holder);
  tag('mini', `Mini (${MINI_CHARACTERS[miniIndex]})`, mini.holder);
  tag('scout', 'Trail Quest Scout', scout.root);
}

const tagEls = new Map<string, HTMLElement>();
const tagTargets = new Map<string, THREE.Object3D>();
function tag(id: string, text: string, target: THREE.Object3D): void {
  let el = tagEls.get(id);
  if (!el) {
    el = h('div', { class: 'tag' });
    tags.appendChild(el);
    tagEls.set(id, el);
  }
  el.textContent = text;
  tagTargets.set(id, target);
}

function select<T extends string>(label: string, choices: readonly Choice<T>[], get: () => string, set: (value: T) => void): HTMLElement {
  const el = h(
    'select',
    { on: { change: () => set(el.value as T) } },
    ...choices.map((c) => h('option', { value: c.value, text: c.label })),
  );
  el.value = get();
  return h('label', null, `${label} `, el);
}

function check(label: string, get: () => boolean, set: (value: boolean) => void): HTMLElement {
  const el = h('input', { type: 'checkbox', checked: get(), on: { change: () => set(el.checked) } });
  return h('label', null, el, label);
}

const scoutControls = h('div');
function buildScoutControls(): void {
  const apply = (patch: Partial<FilledAvatar>): void => {
    look = { ...look, ...patch };
    scout.setConfig(look);
  };
  const colors = (patch: (hex: string) => Partial<FilledAvatar>) => (hex: string): void => apply(patch(hex));
  scoutControls.replaceChildren(
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', on: { click: () => { look = randomAvatar('wolf'); buildScoutControls(); scout.setConfig(look); } } }, 'Random look'),
      check('Den Chief cord', () => denCord, (v) => { denCord = v; rebuildScout(); refreshUi(); }),
    ),
    h('div', { class: 'row' }, select('Build', BUILDS, () => look.build, (v) => apply({ build: v })), select('Eyes', EYE_STYLES, () => look.eyes, (v) => apply({ eyes: v }))),
    h('div', { class: 'row' }, select('Hair', HAIR_STYLES, () => look.hairStyle, (v) => apply({ hairStyle: v })), select('Hair color', HAIR_COLORS, () => look.hairColor, (v) => apply({ hairColor: v }))),
    h('div', { class: 'row' }, select('Hat', HAT_STYLES, () => look.hat, (v) => apply({ hat: v })), select('Hat color', HAT_COLORS, () => look.hatColor, (v) => apply({ hatColor: v }))),
    h('div', { class: 'row' }, select('Skin', SKIN_TONES, () => look.skin, colors((hex) => ({ skin: hex }))), select('Shirt', SHIRT_COLORS, () => look.shirt, colors((hex) => ({ shirt: hex, bodyColor: hex })))),
    h('div', { class: 'row' }, select('Legs', LEG_STYLES, () => look.legs, (v) => apply({ legs: v })), select('Leg color', CLOTHES_COLORS, () => look.legColor, colors((hex) => ({ legColor: hex })))),
    h('div', { class: 'row' }, select('Shoes', SHOE_COLORS, () => look.shoes, colors((hex) => ({ shoes: hex }))), select('Neckerchief', NECKERCHIEF_COLORS, () => look.neckerchief, colors((hex) => ({ neckerchief: hex })))),
    h('div', { class: 'row' }, check('Glasses', () => look.glasses, (v) => apply({ glasses: v })), check('Backpack', () => look.backpack, (v) => apply({ backpack: v }))),
  );
}

function buildPanel(): void {
  const speed = h('input', {
    type: 'range',
    attrs: { min: 0, max: 7, step: 0.1, value: 0, 'aria-label': 'Walk speed' },
    on: { input: () => { walkSpeed = Number(speed.value); speedLabel.textContent = `${walkSpeed.toFixed(1)} units/s`; } },
  });
  const speedLabel = h('span', null, '0.0 units/s');
  panel.replaceChildren(
    h('h1', null, 'Character comparison'),
    h('p', { class: 'note' }, 'Kenney Blocky Characters 2.0 and Mini Characters (CC0, kenney.nl) next to the Trail Quest Scout. Drag to orbit, scroll to zoom. Each character is scaled to 1.8 units tall.'),
    nowEl,
    h('h2', null, 'Blocky (kit)'),
    h('p', { class: 'note' }, '6 box meshes, 72 triangles, no skinning: the clips move 7 nodes. All 18 skins share one rig and one UV layout.'),
    stepper(blockyLabel, () => setBlockySkin(blockySkin - 1), () => setBlockySkin(blockySkin + 1)),
    blockyClips,
    h('h2', null, 'Mini (kit)'),
    h('p', { class: 'note' }, 'Skinned, 7 bones, 2 meshes, about 700 triangles. Looks are different meshes, not recolored skins.'),
    stepper(miniLabel, () => void loadMini(miniIndex - 1), () => void loadMini(miniIndex + 1)),
    miniClips,
    h('p', { class: 'legend' }, 'Gold clips map to a Trail Quest role (idle, walk, run = sprint, jump, pick up, sit, emote). Neither kit has wave or cheer; the Scout keyframes those itself.'),
    h('h2', null, 'Trail Quest Scout (ours)'),
    scoutStatus,
    h(
      'div',
      { class: 'row' },
      ...(['idle', 'wave', 'cheer'] as const).map((emote) => h('button', { type: 'button', on: { click: () => scout.play(emote) } }, emote)),
    ),
    h('div', { class: 'row' }, h('label', null, 'Walk speed ', speed), speedLabel),
    h('p', { class: 'note' }, 'Above 0 the Scout walks; it blends into the run clip between 4.4 and 5 units/s.'),
    scoutControls,
  );
  buildScoutControls();
}

// ---- loop ------------------------------------------------------------------------------------------

const timer = new THREE.Timer();
const projected = new THREE.Vector3();

function resize(): void {
  const w = Math.max(1, canvas.clientWidth);
  const hgt = Math.max(1, canvas.clientHeight);
  renderer.setSize(w, hgt, false);
  camera.aspect = w / hgt;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function frame(now?: number): void {
  requestAnimationFrame(frame);
  timer.update(now);
  const dt = Math.min(0.1, timer.getDelta());
  blocky.mixer?.update(dt);
  mini.mixer?.update(dt);
  scout.update(dt, { moving: walkSpeed > 0.05, speed: walkSpeed });
  controls.update();

  const showing = scout.root.getObjectByName('avatar-blocky') ? 'the Kenney model' : 'the plain fallback';
  scoutStatus.textContent = `Scout model: ${scoutModelStatus()}; showing ${showing}. Emote: ${scout.emote}.`;

  const rect = canvas.getBoundingClientRect();
  for (const [id, el] of tagEls) {
    const target = tagTargets.get(id);
    if (!target) continue;
    projected.setFromMatrixPosition(target.matrixWorld).setY(2.45);
    projected.project(camera);
    el.style.left = `${(projected.x * 0.5 + 0.5) * rect.width}px`;
    el.style.top = `${(-projected.y * 0.5 + 0.5) * rect.height}px`;
  }
  renderer.render(scene, camera);
}

async function start(): Promise<void> {
  buildPanel();
  resize();
  preloadScoutModel();
  statusEl.textContent = 'Loading models...';
  try {
    const gltf = await loader.loadAsync(BLOCKY_URL);
    setModel(blocky, gltf.scene, gltf.animations);
    const first = blockyMaterial();
    if (first?.map) skinTextures.set('a', first.map);
    setBlockySkin(0);
    playClip(blocky, 'idle', 0);
    await loadMini(0);
    statusEl.textContent = 'Ready';
  } catch (err) {
    statusEl.textContent = `Could not load a model: ${err instanceof Error ? err.message : String(err)}`;
    console.error(err);
  }
  refreshUi();
  frame();
}

void start();
