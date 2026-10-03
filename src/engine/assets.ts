import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Model library: loads the CC0 GLB models listed in `public/assets/manifest.json` on demand.
 *
 * Callers keep a primitive fallback, call `assets.load([...ids])`, and swap models in when the
 * promise resolves and `assets.has(id)` is true. A model that fails to load logs one warning and
 * stays missing, so the fallback simply stays on screen. Nothing here ever throws from `load`.
 *
 * Units: `scale` and `yOffset` in the manifest are applied to a wrapper so that every model is
 * already the right size (a character is about 1.8 units tall, a tree 4 to 6) and rests on y = 0.
 * `yOffset` is in world units, after scaling. Models face +z.
 */

export interface ModelEntry {
  /** Path under the site root, for example `assets/models/kenney-nature-kit/tree_default.glb`. */
  path: string;
  /** Pack slug, matches a row in CREDITS.md. */
  pack: string;
  scale: number;
  yOffset: number;
  /**
   * Maps a role to a clip name inside the GLB. `idle` and `walk` are always present on rigged
   * characters; some also have `run`, `cheer`, `pickup`, or `jump`.
   */
  animations?: Record<string, string>;
}

export interface AssetManifest {
  version: 1;
  models: Record<string, ModelEntry>;
}

/** Check the shape of a parsed manifest. Throws a readable error; used by `load` and by tests. */
export function parseManifest(raw: unknown): AssetManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('manifest is not an object');
  const obj = raw as { version?: unknown; models?: unknown };
  if (obj.version !== 1) throw new Error(`unsupported manifest version ${String(obj.version)}`);
  if (typeof obj.models !== 'object' || obj.models === null) throw new Error('manifest has no models');
  const models: Record<string, ModelEntry> = {};
  for (const [id, value] of Object.entries(obj.models)) {
    const m = value as Partial<ModelEntry> | null;
    if (!m || typeof m.path !== 'string' || m.path === '') throw new Error(`model "${id}" has no path`);
    if (typeof m.pack !== 'string' || m.pack === '') throw new Error(`model "${id}" has no pack`);
    if (typeof m.scale !== 'number' || !(m.scale > 0)) throw new Error(`model "${id}" has a bad scale`);
    if (typeof m.yOffset !== 'number') throw new Error(`model "${id}" has a bad yOffset`);
    const entry: ModelEntry = { path: m.path, pack: m.pack, scale: m.scale, yOffset: m.yOffset };
    if (m.animations !== undefined) {
      if (typeof m.animations !== 'object' || m.animations === null) throw new Error(`model "${id}" has bad animations`);
      entry.animations = { ...m.animations };
    }
    models[id] = entry;
  }
  return { version: 1, models };
}

interface LoadedModel {
  entry: ModelEntry;
  /** Identity wrapper holding the scaled, lifted model. Never added to a scene directly. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Set when the model is exactly one static mesh (so it can be instanced). */
  staticMesh: THREE.Mesh | null;
  /** Geometry of `staticMesh` with scale, lift, and node transforms baked in. */
  bakedGeometry: THREE.BufferGeometry | null;
}

export interface AssetLibraryOptions {
  /** When false, `load` resolves at once and nothing is fetched. Defaults to off under Vitest. */
  enabled?: boolean;
  /** Site base, for example `/trail-quest/`. Defaults to Vite's `BASE_URL`. */
  baseUrl?: string;
  /** Replaces `fetch` for the manifest request. Tests use this. */
  fetchManifest?: (url: string) => Promise<Response>;
}

/** Plays one clip at a time with a cross-fade. Built by `assets.animator`. */
export class ModelAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: string | null = null;

  constructor(root: THREE.Object3D, clips: ReadonlyMap<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [role, clip] of clips) this.actions.set(role, this.mixer.clipAction(clip));
  }

  /** True when the model has a clip for this role. */
  has(role: string): boolean {
    return this.actions.has(role);
  }

  /** Name of the role that is playing now, or null. */
  get playing(): string | null {
    return this.current;
  }

  /** Playback speed multiplier for one role (for example to match walking speed). */
  setTimeScale(role: string, scale: number): void {
    const action = this.actions.get(role);
    if (action) action.timeScale = scale;
  }

  /** Start `role`, cross-fading from the one playing. Does nothing if it is playing or missing. */
  play(role: string, fade = 0.2): void {
    if (role === this.current) return;
    const next = this.actions.get(role);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.current = role;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

export class AssetLibrary {
  enabled: boolean;
  private readonly baseUrl: string;
  private readonly fetchManifest: (url: string) => Promise<Response>;
  private manifestPromise: Promise<AssetManifest | null> | null = null;
  private readonly models = new Map<string, LoadedModel>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly loader = new GLTFLoader();
  private readonly lambertCache = new Map<THREE.Material, THREE.Material>();

  constructor(options: AssetLibraryOptions = {}) {
    this.enabled = options.enabled ?? import.meta.env.MODE !== 'test';
    this.baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
    this.fetchManifest = options.fetchManifest ?? ((url) => fetch(url));
  }

  /**
   * Fetch the manifest (once), then load each id (once). Safe to call many times with overlapping
   * ids. Ids that fail stay missing; check `has(id)` afterwards.
   */
  async load(ids: readonly string[]): Promise<void> {
    if (!this.enabled) return;
    const manifest = await this.getManifest();
    if (!manifest) return;
    await Promise.all([...new Set(ids)].map((id) => this.loadOne(id, manifest)));
  }

  /** True when `id` has finished loading and can be instantiated. */
  has(id: string): boolean {
    return this.models.has(id);
  }

  /** A fresh copy of the model, ready to position and add to a scene. Skinned models get their own skeleton. */
  instance(id: string): THREE.Object3D {
    return cloneWithSkeleton(this.need(id).root);
  }

  /** Every animation clip in the model (empty for static models). Clips are shared; do not mutate them. */
  clips(id: string): THREE.AnimationClip[] {
    return this.models.get(id)?.clips.slice() ?? [];
  }

  /** The clip for a role such as `idle` or `walk`, using the manifest's `animations` map. */
  clip(id: string, role: string): THREE.AnimationClip | undefined {
    const model = this.models.get(id);
    const name = model?.entry.animations?.[role];
    return name ? model?.clips.find((c) => c.name === name) : undefined;
  }

  /**
   * An animator for a model instance made with `instance(id)`. It has an action for every role
   * in the manifest that resolves to a clip. Returns undefined when the model has no clips.
   */
  animator(id: string, instance: THREE.Object3D): ModelAnimator | undefined {
    const model = this.models.get(id);
    if (!model?.entry.animations) return undefined;
    const byRole = new Map<string, THREE.AnimationClip>();
    for (const role of Object.keys(model.entry.animations)) {
      const clip = this.clip(id, role);
      if (clip) byRole.set(role, clip);
    }
    return byRole.size > 0 ? new ModelAnimator(instance, byRole) : undefined;
  }

  /**
   * One InstancedMesh with room for `count` copies, for models that are a single static mesh
   * (trees, rocks, plants). Scale and lift are baked into the geometry, so an instance matrix of
   * just a position and a yaw puts the model on the ground. Returns undefined if the model is
   * missing, skinned, or made of several meshes.
   */
  instanced(id: string, count: number): THREE.InstancedMesh | undefined {
    const model = this.models.get(id);
    if (!model?.staticMesh || !model.bakedGeometry) return undefined;
    const mesh = new THREE.InstancedMesh(model.bakedGeometry.clone(), model.staticMesh.material, count);
    mesh.name = id;
    return mesh;
  }

  // ---- internals --------------------------------------------------------------------------------

  private need(id: string): LoadedModel {
    const model = this.models.get(id);
    if (!model) throw new Error(`asset "${id}" is not loaded; call assets.load() and check assets.has()`);
    return model;
  }

  private getManifest(): Promise<AssetManifest | null> {
    this.manifestPromise ??= this.fetchManifest(`${this.baseUrl}assets/manifest.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseManifest(await res.json());
      })
      .catch((err: unknown) => {
        console.warn(`[assets] could not read the asset manifest, keeping placeholder art (${errorText(err)})`);
        return null;
      });
    return this.manifestPromise;
  }

  private loadOne(id: string, manifest: AssetManifest): Promise<void> {
    if (this.models.has(id) || this.failed.has(id)) return Promise.resolve();
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;

    const entry = manifest.models[id];
    if (!entry) {
      this.fail(id, 'not in the manifest');
      return Promise.resolve();
    }
    const job = this.loader
      .loadAsync(`${this.baseUrl}${entry.path}`)
      .then((gltf) => {
        this.models.set(id, this.build(id, entry, gltf));
      })
      .catch((err: unknown) => {
        this.fail(id, errorText(err));
      })
      .finally(() => {
        this.pending.delete(id);
      });
    this.pending.set(id, job);
    return job;
  }

  private fail(id: string, why: string): void {
    this.failed.add(id);
    console.warn(`[assets] could not load "${id}", keeping placeholder art (${why})`);
  }

  private build(id: string, entry: ModelEntry, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): LoadedModel {
    const scene = gltf.scene;
    const meshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.toLambert(mesh.material);
      // Skinned bounds come from the bind pose, which can cull a moving character. Never cull them.
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      meshes.push(mesh);
    });

    scene.scale.setScalar(entry.scale);
    scene.position.y = entry.yOffset;
    const root = new THREE.Group();
    root.name = id;
    root.add(scene);
    root.updateMatrixWorld(true);

    const only = meshes.length === 1 ? meshes[0]! : null;
    const isStatic = only !== null && !(only as THREE.SkinnedMesh).isSkinnedMesh && gltf.animations.length === 0;
    const bakedGeometry = isStatic ? bakeGeometry(only.geometry, only.matrixWorld) : null;

    return { entry, root, clips: gltf.animations, staticMesh: isStatic ? only : null, bakedGeometry };
  }

  /** Swap PBR materials for the cheaper Lambert model the rest of the game uses (iPad budget). */
  private toLambert(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
    if (Array.isArray(material)) return material.map((m) => this.toLambert(m) as THREE.Material);
    const cached = this.lambertCache.get(material);
    if (cached) return cached;
    const src = material as THREE.MeshStandardMaterial;
    if (!src.isMeshStandardMaterial) return material;
    const lambert = new THREE.MeshLambertMaterial({
      name: src.name,
      color: src.color,
      map: src.map,
      vertexColors: src.vertexColors,
      side: src.side,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
      emissive: src.emissive,
      emissiveMap: src.emissiveMap,
      emissiveIntensity: src.emissiveIntensity,
    });
    if (src.map) {
      // The kit textures are small palettes. Nearest filtering keeps neighbouring colors from bleeding.
      src.map.magFilter = THREE.NearestFilter;
      src.map.minFilter = THREE.NearestFilter;
      src.map.generateMipmaps = false;
      src.map.needsUpdate = true;
    }
    this.lambertCache.set(material, lambert);
    src.dispose();
    return lambert;
  }
}

/**
 * Copy of `geometry` with `matrix` applied. Quantized models store positions as normalized integers,
 * which cannot hold a scaled-up result, so those attributes become floats first.
 */
function bakeGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const copy = geometry.clone();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attr = copy.getAttribute(name);
    if (!attr || attr.array instanceof Float32Array) continue;
    const floats = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      floats[i * attr.itemSize] = attr.getX(i);
      if (attr.itemSize > 1) floats[i * attr.itemSize + 1] = attr.getY(i);
      if (attr.itemSize > 2) floats[i * attr.itemSize + 2] = attr.getZ(i);
      if (attr.itemSize > 3) floats[i * attr.itemSize + 3] = attr.getW(i);
    }
    copy.setAttribute(name, new THREE.BufferAttribute(floats, attr.itemSize));
  }
  return copy.applyMatrix4(matrix);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The shared library. Zones and the player call `assets.load(...)` for the ids they need. */
export const assets = new AssetLibrary();
