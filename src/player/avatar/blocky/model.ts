/**
 * Loads the Kenney Blocky Scout model (public/assets/characters/blocky.glb) once and hands out copies.
 *
 * One request serves every rig: the player, the Den Chief and the editor preview each call
 * `requestBlockyModel`, and each is told when the model is ready (or that it failed). A failure logs one
 * warning and is remembered; the callers keep the procedural Scout, so nothing ever waits on this file.
 *
 * Under Vitest the loader is off (like the asset library) so no test touches the network; tests that want the
 * model call `useBlockyModel` with a parsed one, or `parseBlockyModel` on the file read from disk.
 *
 * The file has the kit's seven nodes, 6 box meshes and the idle, walk and sprint clips. It has no material
 * and no texture: each rig gives its meshes a material with a painted skin (see skin-texture.ts).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { resolveRoleClips, type RoleClips } from './clips';

/** The node names the rig relies on. All of them must be in the model. */
export const MODEL_NODES = ['root', 'leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head'] as const;
export type ModelNode = (typeof MODEL_NODES)[number];

/** Height of a Scout with a bare head, in world units: the figure the game was drawn for. */
export const SCOUT_HEIGHT = 1.8;

export interface BlockyAsset {
  /** The template scene. Never added to a world; `instantiateBlocky` makes copies. */
  readonly scene: THREE.Group;
  /** Clips by role: the kit's idle, walk and run, and the hand-made cheer and wave. */
  readonly roles: RoleClips;
  /** Uniform scale that makes the model `SCOUT_HEIGHT` tall. */
  readonly scale: number;
}

export type BlockyStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface BlockyModelOptions {
  /** When false, `requestBlockyModel` does nothing and the procedural Scout stays. Default: off under Vitest. */
  enabled?: boolean;
  /** Where to fetch the file from. Default: `${BASE_URL}assets/characters/blocky.glb`. */
  url?: string;
  /** Replace the whole load (tests and the dev harness). Resolves the GLB bytes. */
  fetchBuffer?: () => Promise<ArrayBuffer>;
}

let enabled = import.meta.env.MODE !== 'test';
let url = `${import.meta.env.BASE_URL}assets/characters/blocky.glb`;
let fetchBuffer: (() => Promise<ArrayBuffer>) | undefined;
let status: BlockyStatus = 'idle';
let asset: BlockyAsset | null = null;
let job: Promise<void> | null = null;
const waiters = new Set<() => void>();

/** Change how the model is loaded. Only for tests and dev pages. */
export function configureBlockyModel(options: BlockyModelOptions): void {
  if (options.enabled !== undefined) enabled = options.enabled;
  if (options.url !== undefined) url = options.url;
  if ('fetchBuffer' in options) fetchBuffer = options.fetchBuffer;
}

/** Forget the loaded model and any failure, and go back to the default setup. For tests. */
export function resetBlockyModel(): void {
  status = 'idle';
  asset = null;
  job = null;
  waiters.clear();
  enabled = import.meta.env.MODE !== 'test';
  url = `${import.meta.env.BASE_URL}assets/characters/blocky.glb`;
  fetchBuffer = undefined;
}

export function blockyStatus(): BlockyStatus {
  return status;
}

/** The loaded model, or null while it is loading, off, or failed. */
export function getBlockyAsset(): BlockyAsset | null {
  return asset;
}

/** Use an already parsed model (tests, dev pages). Wakes everyone waiting. */
export function useBlockyModel(model: BlockyAsset): void {
  asset = model;
  status = 'ready';
  settle();
}

function settle(): void {
  const pending = [...waiters];
  waiters.clear();
  for (const wake of pending) wake();
}

/** Parse the bytes of blocky.glb into a model. Rejects when the file is not a Scout model. */
export async function parseBlockyModel(data: ArrayBuffer): Promise<BlockyAsset> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const scene = gltf.scene;
  for (const name of MODEL_NODES) {
    if (!scene.getObjectByName(name)) throw new Error(`the Scout model has no "${name}" node`);
  }
  const roles = resolveRoleClips(gltf.animations);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;
  if (!(height > 0)) throw new Error('the Scout model has no height');
  // The skins are painted, so the loader's default material is never shown: drop it right away.
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      (mesh.material as THREE.Material).dispose();
      mesh.frustumCulled = true;
    }
  });
  return { scene, roles, scale: SCOUT_HEIGHT / height };
}

/**
 * Ask for the model. `onSettled` runs once, when the model is ready or has failed (at once if that is already
 * known, from a microtask, never synchronously). Starts the download the first time only. Does nothing when
 * the loader is off.
 */
export function requestBlockyModel(onSettled?: () => void): void {
  if (status === 'ready' || status === 'failed') {
    if (onSettled) queueMicrotask(onSettled);
    return;
  }
  if (!enabled) return;
  if (onSettled) waiters.add(onSettled);
  if (job) return;
  status = 'loading';
  job = (async () => {
    try {
      const data = fetchBuffer ? await fetchBuffer() : await fetchModelBytes();
      asset = await parseBlockyModel(data);
      status = 'ready';
    } catch (err) {
      status = 'failed';
      console.warn(`[avatar] could not load the Scout model, keeping the plain blocky Scout (${errorText(err)})`);
    }
    settle();
  })();
}

async function fetchModelBytes(): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Stop waiting: a rig that was disposed before the model arrived calls this. */
export function cancelBlockyWait(onSettled: () => void): void {
  waiters.delete(onSettled);
}

/** A fresh copy of the model with its own node tree (and skeleton, if a model ever has one). Geometry is shared. */
export function instantiateBlocky(model: BlockyAsset): THREE.Group {
  return cloneWithSkeleton(model.scene) as THREE.Group;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
