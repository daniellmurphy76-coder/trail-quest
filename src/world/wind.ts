import * as THREE from 'three';
import { injectOccluderFade, isShadowMaterial } from './occluder';

/**
 * Wind: a gentle sway for trees, bushes, grass and flowers, done entirely in the vertex shader, so
 * it costs no CPU and no extra draw calls.
 *
 * One shared clock (`tickWind`, called once per fixed step from the world's update loop) drives
 * every swaying material. `applyWind(material, { strength, heightScale, kind })` patches a built-in
 * material with `onBeforeCompile`:
 *
 *   - The push is worked out in WORLD space and then turned back into the model's own space, so a
 *     field of plants that were each given a different yaw and size still all lean the same way.
 *   - It grows with height above the model's base as `(y * heightScale)^2`: a trunk or a grass root
 *     is planted, a canopy or a blade tip moves most. `heightScale` is one over the height at which
 *     the sway is full, and `strength` is how far, in world units, the very top moves in a gust.
 *   - The phase comes from the instance's own world position (the translation of `modelMatrix *
 *     instanceMatrix`): part a wave that travels across the zone, part a per-instance hash, so
 *     neighbors never move in lockstep. It works for an `InstancedMesh` and for a plain mesh.
 *   - Two motions are mixed: a slow primary sway with a slower gust envelope, and a faster, smaller
 *     flutter whose phase also depends on the vertex, so leaves shiver out of step with each other.
 *
 * The program cache key is one fixed string: kind, strength and height are uniforms, not code, so
 * every swaying material shares a handful of compiled programs.
 *
 * The sun's shadow pass draws trees with a depth material. `windDepthMaterial` is the same sway on
 * a `MeshDepthMaterial`; `applyWindToMesh` sets it as the mesh's `customDepthMaterial`, so a shadow
 * sways with the tree that throws it. It reads the same shared uniforms, so the two never disagree.
 *
 * The same patch also carries the occluder fade (occluder.ts) on every lit material, so a bush or tree
 * that stands between the camera and the Scout drops part of itself. The depth materials never get it.
 *
 * Under `prefers-reduced-motion` the sway is zero: every wind shader multiplies by `uWindScale`,
 * which is 0 while that preference is on (re-read about once a second, so toggling it in the system
 * settings takes effect without a reload). Nothing else moves: the clock keeps running.
 *
 * Models share one material per model id, so `applyWindToMesh` gives a swaying mesh its own
 * clone (one per source material and setting). A rock or tent that shares a source material with
 * a tree keeps the plain one.
 */

/** What sways. Rocks, stumps, logs, tents, buildings and mushrooms are not in the list: they never move. */
export type WindKind = 'tree' | 'bush' | 'grass' | 'flower';

export interface WindOptions {
  /**
   * How far the very top of the model moves, in world units, in an ordinary gust (the strongest
   * gust with the flutter on top reaches about 1.4 times this).
   */
  strength: number;
  /** One over the height (in the model's own units) at which the sway is full. Bigger bends lower down. */
  heightScale: number;
  /** Picks the flutter amount; the strength and height are passed in with it. */
  kind: WindKind;
}

/**
 * Sway settings by kind. `strength` is the tip travel in world units (a Scout is about 1.8 tall):
 * a tree canopy moves a few centimeters, a bush a little more, grass and flowers the most.
 * `flutter` is the size of the fast shiver as a fraction of the slow sway.
 */
export const WIND_KINDS: Readonly<Record<WindKind, { strength: number; flutter: number }>> = {
  tree: { strength: 0.05, flutter: 0.3 },
  bush: { strength: 0.07, flutter: 0.3 },
  flower: { strength: 0.12, flutter: 0.25 },
  grass: { strength: 0.16, flutter: 0.35 },
};

/** A model shorter than this is treated as this tall, so a flat or empty geometry cannot divide by zero. */
const MIN_HEIGHT = 0.1;

/** The sway settings for a model of `height` world units. */
export function windOptions(kind: WindKind, height: number): WindOptions {
  return { kind, strength: WIND_KINDS[kind].strength, heightScale: 1 / Math.max(height, MIN_HEIGHT) };
}

/**
 * Model ids by pattern (not quoted id strings, which the zone-id check in assets-nature.test.ts would
 * read as models a zone places). Mushrooms, rocks, stumps, logs, tents and buildings match nothing.
 */
const WIND_ID_KINDS: ReadonlyArray<readonly [RegExp, WindKind]> = [
  [/^tree\./, 'tree'],
  [/^plant\.bush/, 'bush'],
  [/^plant\.grass/, 'grass'],
  [/^plant\.flower\./, 'flower'],
];

/** Which kind of sway a model id gets, or null when it stays still. */
export function windKindFor(modelId: string): WindKind | null {
  for (const [pattern, kind] of WIND_ID_KINDS) if (pattern.test(modelId)) return kind;
  return null;
}

/** The marker the injected shader code carries, so tests can see a material was patched. */
export const WIND_MARKER = 'tq wind sway';

/** The one program cache key every wind material uses (strength and height are uniforms, so no variants). */
export const WIND_CACHE_KEY = 'tq-wind-v1';

// ---- the clock and reduced motion -----------------------------------------------------------------

/**
 * The wind clock wraps at this many seconds. Every angular frequency below is a whole number of
 * cycles per period, so the wrap is seamless, and the shader never sees a time large enough to lose
 * float precision however long the game stays open.
 */
export const WIND_PERIOD = 256;
const TAU = Math.PI * 2;
const cyclesPerPeriod = (cycles: number): number => (TAU * cycles) / WIND_PERIOD;

/** Shared uniforms: every swaying material and depth material points at these very objects. */
const windTime: THREE.IUniform<number> = { value: 0 };
const windScale: THREE.IUniform<number> = { value: 1 };

/** True when the player asked their system for less motion. False where there is no `matchMedia` (node). */
export function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return mm.call(globalThis, '(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 1 normally, 0 under reduced motion. The shaders multiply every sway by this. */
export function windMotionScale(): number {
  return windScale.value;
}

/** Re-read the system preference now (tests call this after changing a mocked `matchMedia`). */
export function refreshWindMotion(): number {
  windScale.value = prefersReducedMotion() ? 0 : 1;
  return windScale.value;
}

/** The tip travel `options` gives right now: `strength`, or 0 while reduced motion is on. */
export function effectiveWindStrength(options: Pick<WindOptions, 'strength'>): number {
  return options.strength * windScale.value;
}

/** The shared wind clock, in seconds, in [0, WIND_PERIOD). */
export function windClock(): number {
  return windTime.value;
}

/** Seconds between looks at the system preference while the game runs. */
const MOTION_RECHECK = 1;
let sinceRecheck = 0;

/**
 * Advance the wind clock by `dt` seconds. The world calls it once per fixed simulation step,
 * whichever zone is showing, so the clock runs once however many zones exist.
 */
export function tickWind(dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  windTime.value = (windTime.value + dt) % WIND_PERIOD;
  sinceRecheck += dt;
  if (sinceRecheck >= MOTION_RECHECK) {
    sinceRecheck = 0;
    refreshWindMotion();
  }
}

// ---- the sway itself ------------------------------------------------------------------------------

/** Every number in the sway, in one place: the shader text and `windPush` below are both built from it. */
const SWAY = {
  /** Which way the wind blows across the ground (x, z), 35 degrees off the x axis. */
  dirX: Math.cos(0.61),
  dirZ: Math.sin(0.61),
  /** Slow sway: about 4.8 seconds a swing. */
  primary: cyclesPerPeriod(53),
  /** The gust envelope that swells and eases the sway: about 18 seconds a cycle. */
  gust: cyclesPerPeriod(14),
  /** Two flutter frequencies, about 1.2 and 1.5 seconds a shiver. */
  flutterA: cyclesPerPeriod(208),
  flutterB: cyclesPerPeriod(173),
  /** How the phase changes per world unit of travel along the wind: a wave that sweeps the zone. */
  waveK: 0.45,
  gustK: 0.07,
  flutterK: 1.3,
  /** How the flutter phase changes across a model: x, y, z of the vertex, so leaves shiver out of step. */
  leaf: [1.9, 2.7, 2.3] as const,
  /** The across-wind flutter, as a fraction of the along-wind flutter. */
  across: 0.8,
} as const;

/** A float as GLSL wants it: always with a decimal point. */
const glsl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toPrecision(7))));

/** Fraction of the circle a hashed position contributes to the primary phase, in radians. */
const HASH_PHASE = 2;

/**
 * The same math as the shader's, in TypeScript, for tests and for anyone checking the feel: the
 * push on a vertex in world x and z, per unit of `strength * bend`. `origin` is the instance's
 * world position, `vertex` the vertex in the model's own space.
 */
export function windPush(
  time: number,
  origin: { x: number; z: number },
  vertex: { x: number; y: number; z: number },
  flutter: number,
): { x: number; z: number } {
  const hashed = Math.sin(origin.x * 12.9898 + origin.z * 78.233) * 43758.5453;
  const hash = hashed - Math.floor(hashed);
  const along = origin.x * SWAY.dirX + origin.z * SWAY.dirZ;
  const primary = 0.45 + 0.55 * Math.sin(time * SWAY.primary + along * SWAY.waveK + hash * HASH_PHASE);
  const gust = 0.75 + 0.25 * Math.sin(time * SWAY.gust + along * SWAY.gustK);
  const leaf = vertex.x * SWAY.leaf[0] + vertex.y * SWAY.leaf[1] + vertex.z * SWAY.leaf[2] + hash * TAU;
  const shiverA = Math.sin(time * SWAY.flutterA + along * SWAY.flutterK + leaf);
  const shiverB = Math.sin(time * SWAY.flutterB + along * SWAY.flutterK * 0.7 + leaf * 1.3);
  const alongPush = primary * gust + flutter * shiverA;
  const acrossPush = flutter * SWAY.across * shiverB;
  return {
    x: SWAY.dirX * alongPush - SWAY.dirZ * acrossPush,
    z: SWAY.dirZ * alongPush + SWAY.dirX * acrossPush,
  };
}

/** How much of the full sway a vertex at `y` (model units) gets: 0 at and below the base, 1 at the top. */
export function windBend(y: number, heightScale: number): number {
  const rise = Math.max(y, 0) * heightScale;
  return rise * rise;
}

const WIND_UNIFORMS_GLSL = /* glsl */ `
uniform float uWindTime;
uniform float uWindScale;
uniform float uWindStrength;
uniform float uWindHeightScale;
uniform float uWindFlutter;
`;

/**
 * Runs right after `begin_vertex` (which declares `vec3 transformed`). `tqLinear` is the 3 by 3 of
 * the whole object-to-world matrix (instance matrix included) and `tqOrigin` its translation, the
 * instance's world position, the source of the phase. The push is in world space; the last line
 * turns it into the model's space (the inverse of a turn and a uniform size is its transpose over
 * the size squared; the tufts' extra height stretch only touches y, and the push is level).
 */
const WIND_VERTEX_GLSL = /* glsl */ `
// ${WIND_MARKER}
{
  #ifdef USE_INSTANCING
    mat3 tqLinear = mat3( modelMatrix ) * mat3( instanceMatrix );
    vec3 tqOrigin = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  #else
    mat3 tqLinear = mat3( modelMatrix );
    vec3 tqOrigin = modelMatrix[ 3 ].xyz;
  #endif
  float tqRise = max( transformed.y, 0.0 ) * uWindHeightScale;
  float tqBend = tqRise * tqRise;
  if ( uWindScale > 0.0 && tqBend > 0.0 ) {
    vec2 tqDir = vec2( ${glsl(SWAY.dirX)}, ${glsl(SWAY.dirZ)} );
    float tqHash = fract( sin( dot( tqOrigin.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float tqAlong = dot( tqOrigin.xz, tqDir );
    float tqPrimary = 0.45 + 0.55 * sin( uWindTime * ${glsl(SWAY.primary)} + tqAlong * ${glsl(SWAY.waveK)} + tqHash * ${glsl(HASH_PHASE)} );
    float tqGust = 0.75 + 0.25 * sin( uWindTime * ${glsl(SWAY.gust)} + tqAlong * ${glsl(SWAY.gustK)} );
    float tqLeaf = dot( transformed, vec3( ${SWAY.leaf.map(glsl).join(', ')} ) ) + tqHash * ${glsl(TAU)};
    float tqShiverA = sin( uWindTime * ${glsl(SWAY.flutterA)} + tqAlong * ${glsl(SWAY.flutterK)} + tqLeaf );
    float tqShiverB = sin( uWindTime * ${glsl(SWAY.flutterB)} + tqAlong * ${glsl(SWAY.flutterK * 0.7)} + tqLeaf * 1.3 );
    vec2 tqPush = tqDir * ( tqPrimary * tqGust + uWindFlutter * tqShiverA ) + vec2( -tqDir.y, tqDir.x ) * ( uWindFlutter * ${glsl(SWAY.across)} * tqShiverB );
    vec3 tqWorld = vec3( tqPush.x, 0.0, tqPush.y ) * ( uWindStrength * uWindScale * tqBend );
    transformed += ( transpose( tqLinear ) * tqWorld ) / max( dot( tqLinear[ 0 ], tqLinear[ 0 ] ), 0.0001 );
  }
}
`;

/** The `onBeforeCompile` argument, as far as the wind patch needs it (the fragment shader is for the occluder fade). */
export interface WindShader {
  vertexShader: string;
  fragmentShader?: string;
  uniforms: Record<string, THREE.IUniform>;
}

/** The three per-material uniforms; the clock and the reduced-motion scale are shared. */
interface WindUniforms {
  uWindStrength: THREE.IUniform<number>;
  uWindHeightScale: THREE.IUniform<number>;
  uWindFlutter: THREE.IUniform<number>;
}

function uniformsFor(options: WindOptions): WindUniforms {
  return {
    uWindStrength: { value: options.strength },
    uWindHeightScale: { value: options.heightScale },
    uWindFlutter: { value: WIND_KINDS[options.kind].flutter },
  };
}

/**
 * Put the sway into a vertex shader. Exposed so tests can look at the result; the materials do
 * this through `applyWind`. A shader with no `begin_vertex` chunk (a material that does not use
 * the standard vertex path) is left alone. `fade` (default true) also puts in the occluder fade;
 * the shadow pass's depth materials pass false, so a shadow stays whole.
 */
export function injectWind(shader: WindShader, uniforms: WindUniforms, fade = true): void {
  if (!shader.vertexShader.includes('#include <begin_vertex>')) return;
  shader.uniforms.uWindTime = windTime;
  shader.uniforms.uWindScale = windScale;
  shader.uniforms.uWindStrength = uniforms.uWindStrength;
  shader.uniforms.uWindHeightScale = uniforms.uWindHeightScale;
  shader.uniforms.uWindFlutter = uniforms.uWindFlutter;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_UNIFORMS_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX_GLSL}`);
  if (fade) injectOccluderFade(shader);
}

/** Per-material wind state. Kept off `userData`, which `Material.clone()` copies without the shader patch. */
const states = new WeakMap<THREE.Material, WindUniforms>();

/** True once `applyWind` has patched this material. */
export function hasWind(material: THREE.Material): boolean {
  return states.has(material);
}

/**
 * Make `material` sway, in place, and return it. Calling it again on the same material only
 * updates its settings. Any `onBeforeCompile` the material already had still runs first. This
 * patches the very material it is given: for a material shared with props that must stay still,
 * use `windMaterial` (or `applyWindToMesh`), which patches a clone.
 */
export function applyWind(material: THREE.Material, options: WindOptions): THREE.Material {
  refreshWindMotion();
  const have = states.get(material);
  if (have) {
    const next = uniformsFor(options);
    have.uWindStrength.value = next.uWindStrength.value;
    have.uWindHeightScale.value = next.uWindHeightScale.value;
    have.uWindFlutter.value = next.uWindFlutter.value;
    return material;
  }
  const uniforms = uniformsFor(options);
  states.set(material, uniforms);

  const fade = !isShadowMaterial(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectWind(shader, uniforms, fade);
  };
  // Only a custom key the material set itself is kept: the default one is the text of
  // `onBeforeCompile`, which is the closure above, so it would add nothing.
  const own = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
  material.customProgramCacheKey = () => (own ? `${own.call(material)}|${WIND_CACHE_KEY}` : WIND_CACHE_KEY);
  material.needsUpdate = true;
  return material;
}

const optionsKey = (o: WindOptions): string => `${o.kind}|${o.strength}|${o.heightScale.toFixed(4)}`;

const clones = new WeakMap<THREE.Material, Map<string, THREE.Material>>();

/**
 * A swaying copy of `source`, one per source material and setting, shared by every mesh that asks.
 * The source is never touched, so props that share it (and never sway) are unaffected. A material
 * that already sways is returned as it is.
 */
export function windMaterial(source: THREE.Material, options: WindOptions): THREE.Material {
  if (states.has(source)) return source;
  let byKey = clones.get(source);
  if (!byKey) {
    byKey = new Map();
    clones.set(source, byKey);
  }
  const key = optionsKey(options);
  let clone = byKey.get(key);
  if (!clone) {
    clone = source.clone();
    clone.name = `${source.name || 'material'} (wind ${options.kind})`;
    applyWind(clone, options);
    byKey.set(key, clone);
  }
  return clone;
}

const depthMaterials = new Map<string, THREE.MeshDepthMaterial>();

/**
 * A depth material (what the sun's shadow pass draws a mesh with, as its `customDepthMaterial`)
 * that sways exactly like `applyWind` does. One per distinct setting, shared by every mesh that
 * uses it. It is a plain `MeshDepthMaterial`, the same as the renderer's own for sun shadows.
 */
export function windDepthMaterial(options: WindOptions): THREE.MeshDepthMaterial {
  const key = optionsKey(options);
  let material = depthMaterials.get(key);
  if (!material) {
    material = new THREE.MeshDepthMaterial();
    material.name = `wind depth (${options.kind})`;
    applyWind(material, options);
    depthMaterials.set(key, material);
  }
  return material;
}

/** The height of a geometry above y = 0 (never less than a small floor), in the geometry's own units. */
export function modelHeight(geometry: THREE.BufferGeometry): number {
  if (!geometry.getAttribute('position')) return MIN_HEIGHT;
  geometry.computeBoundingBox();
  const top = geometry.boundingBox?.max.y;
  return top !== undefined && Number.isFinite(top) ? Math.max(top, MIN_HEIGHT) : MIN_HEIGHT;
}

export interface WindMeshOptions {
  /**
   * Patch the mesh's own materials instead of swapping in clones. Only for a mesh that owns its
   * material (a primitive built just for it); a model's material is shared, so leave this off.
   */
  inPlace?: boolean;
}

/**
 * Make a mesh (instanced or not) sway, and its shadow with it. The height comes from the mesh's
 * geometry, so `strength` is the tip travel whatever the model's size. Works on every material
 * the mesh has.
 */
export function applyWindToMesh(mesh: THREE.Mesh, kind: WindKind, meshOptions: WindMeshOptions = {}): void {
  const options = windOptions(kind, modelHeight(mesh.geometry));
  const patch = (m: THREE.Material): THREE.Material => (meshOptions.inPlace ? applyWind(m, options) : windMaterial(m, options));
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
  mesh.customDepthMaterial = windDepthMaterial(options);
}
