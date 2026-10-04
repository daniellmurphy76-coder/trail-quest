import * as THREE from 'three';

/**
 * Occluder fade: when a bush, a tuft of grass, a rock or a tree stands between the follow camera
 * and the Scout, part of it drops out, so the Scout can always be seen. It is a screen-door fade: an
 * ordered 4 by 4 dither on the screen pixel, done in the fragment shader of the prop's own material,
 * so it costs no CPU, no extra draw calls, and no blending (nothing turns see-through, so there is
 * no sorting and no overdraw).
 *
 * The shader looks at a line from the camera (`cameraPosition`, three's own uniform) to a target
 * just above the Scout's feet (`uOccluderTarget`, one uniform shared by every patched material).
 * For a fragment `p`:
 *
 *   - `s` is where `p` falls along that line, 0 at the camera and 1 at the Scout.
 *   - `d` is how far `p` is from the line.
 *   - It fades only between the camera and the Scout (never what is behind them), and only near
 *     the line: full inside `OCCLUDER_NEAR`, none past `OCCLUDER_FAR`, a smooth ramp between.
 *   - The ends of the range are ramps too, so a bush that straddles the Scout, or that touches the
 *     lens, has no hard line cut through it.
 *   - At most `OCCLUDER_MAX_DROP` of the pixels go (three of every four), so a Scout still sees the
 *     bush is there and can tell what it is.
 *
 * Which materials: only a lit prop material that asks for it. `injectOccluderFade` is called by the
 * wind patch (wind.ts) for every swaying prop, and `applyOccluderFadeToMesh` patches the props that
 * never sway (rocks, stumps, logs, tents). The sun's shadow pass uses a depth material, which does
 * not get the fade, so a faded bush still throws its whole shadow. The avatar, the Den Chief, the
 * ground, the water, the horizon, the sky and the labels use other materials and never fade.
 *
 * `occluderDrop` and `bayer4` below are the shader's math in TypeScript, for tests and for anyone
 * checking the feel.
 */

/** The marker the injected shader code carries, so tests can see a material was patched. */
export const OCCLUDER_MARKER = 'tq occluder fade';

/** The program cache key a fade-only material uses (a swaying one uses the wind key, which covers the fade). */
export const OCCLUDER_CACHE_KEY = 'tq-fade-v1';

/** Where the line ends: this far above the Scout's feet, about the middle of the body. */
export const OCCLUDER_AIM_HEIGHT = 0.9;
/** Closer to the line than this (world units) fades fully. */
export const OCCLUDER_NEAR = 0.6;
/** Farther from the line than this fades not at all. */
export const OCCLUDER_FAR = 1.3;
/** Past this far along the line (0 camera, 1 Scout) is "behind the Scout" and never fades. */
export const OCCLUDER_BEHIND = 0.92;
/** The fade eases out over this much of the line before `OCCLUDER_BEHIND`, so there is no hard edge. */
export const OCCLUDER_BEHIND_EASE = 0.08;
/** The fade eases in across this much of the line either side of the camera (inside the near plane for any visible pixel). */
export const OCCLUDER_CAMERA_EASE = 0.02;
/** The most pixels that ever drop: 0.75 is three of every four. */
export const OCCLUDER_MAX_DROP = 0.75;

// ---- the shared target ----------------------------------------------------------------------------

/** Shared by every patched material and updated once a frame by `setOccluderTarget`. */
const occluderTarget: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(0, OCCLUDER_AIM_HEIGHT, 0) };

/** Where the fade aims right now (the Scout's aim point). The same vector every patched material reads. */
export function occluderTargetPoint(): THREE.Vector3 {
  return occluderTarget.value;
}

/** Aim the fade at a Scout standing at `feet`. The world calls it once per rendered frame. */
export function setOccluderTarget(feet: { x: number; y: number; z: number }): void {
  occluderTarget.value.set(feet.x, feet.y + OCCLUDER_AIM_HEIGHT, feet.z);
}

// ---- the same math in TypeScript ------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
  z: number;
}

/** GLSL's `smoothstep`, for `edge0 < edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The share of pixels that drop at world point `p`, between 0 and `OCCLUDER_MAX_DROP`, with the
 * camera at `camera` and the Scout's aim point at `target`.
 */
export function occluderDrop(p: Point, camera: Point, target: Point): number {
  const sx = target.x - camera.x;
  const sy = target.y - camera.y;
  const sz = target.z - camera.z;
  const px = p.x - camera.x;
  const py = p.y - camera.y;
  const pz = p.z - camera.z;
  const s = (px * sx + py * sy + pz * sz) / Math.max(sx * sx + sy * sy + sz * sz, 0.0001);
  const c = Math.min(1, Math.max(0, s));
  const d = Math.hypot(px - sx * c, py - sy * c, pz - sz * c);
  let fade = 1 - smoothstep(OCCLUDER_NEAR, OCCLUDER_FAR, d);
  fade *= smoothstep(-OCCLUDER_CAMERA_EASE, OCCLUDER_CAMERA_EASE, s);
  fade *= 1 - smoothstep(OCCLUDER_BEHIND - OCCLUDER_BEHIND_EASE, OCCLUDER_BEHIND, s);
  return fade * OCCLUDER_MAX_DROP;
}

/** The 4 by 4 ordered (Bayer) matrix, row by row: every value 0 to 15 once, spread so any cut is an even screen-door. */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** The dither threshold at screen pixel (x, y), in (0, 1): a pixel drops when this is below the drop share. */
export function bayer4(x: number, y: number): number {
  return (BAYER_4[(Math.floor(x) & 3) + ((Math.floor(y) & 3) << 2)]! + 0.5) / 16;
}

/** True when pixel (x, y) is dropped, given a drop share from `occluderDrop`. */
export function occluderDrops(drop: number, x: number, y: number): boolean {
  return bayer4(x, y) < drop;
}

// ---- the shader code ------------------------------------------------------------------------------

/** A float as GLSL wants it: always with a decimal point. */
const glsl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toPrecision(7))));

/** Declared in both shaders: the world position of the fragment is passed across in `vTqWorld`. */
const OCCLUDER_VERTEX_PARS_GLSL = /* glsl */ `
varying vec3 vTqWorld;
`;

/**
 * Right after `project_vertex`, so the world position already includes the instance matrix and the
 * wind push (`transformed` has both by then).
 */
const OCCLUDER_VERTEX_GLSL = /* glsl */ `
// ${OCCLUDER_MARKER}
{
  vec4 tqWorld4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    tqWorld4 = instanceMatrix * tqWorld4;
  #endif
  vTqWorld = ( modelMatrix * tqWorld4 ).xyz;
}
`;

const OCCLUDER_FRAGMENT_PARS_GLSL = /* glsl */ `
uniform vec3 uOccluderTarget;
varying vec3 vTqWorld;

const float TQ_BAYER[ 16 ] = float[ 16 ]( ${BAYER_4.map(glsl).join(', ')} );

// The share of pixels to drop here: ${OCCLUDER_MARKER}.
float tqOccluderDrop() {
  vec3 tqSeg = uOccluderTarget - cameraPosition;
  vec3 tqRel = vTqWorld - cameraPosition;
  float tqS = dot( tqRel, tqSeg ) / max( dot( tqSeg, tqSeg ), 0.0001 );
  float tqD = length( tqRel - tqSeg * clamp( tqS, 0.0, 1.0 ) );
  float tqFade = 1.0 - smoothstep( ${glsl(OCCLUDER_NEAR)}, ${glsl(OCCLUDER_FAR)}, tqD );
  tqFade *= smoothstep( ${glsl(-OCCLUDER_CAMERA_EASE)}, ${glsl(OCCLUDER_CAMERA_EASE)}, tqS );
  tqFade *= 1.0 - smoothstep( ${glsl(OCCLUDER_BEHIND - OCCLUDER_BEHIND_EASE)}, ${glsl(OCCLUDER_BEHIND)}, tqS );
  return tqFade * ${glsl(OCCLUDER_MAX_DROP)};
}
`;

/** Right after the clipping planes, the first thing the fragment shader does, so a dropped pixel costs nothing more. */
const OCCLUDER_FRAGMENT_GLSL = /* glsl */ `
// ${OCCLUDER_MARKER}
{
  float tqDrop = tqOccluderDrop();
  int tqCell = ( int( gl_FragCoord.x ) & 3 ) + ( ( int( gl_FragCoord.y ) & 3 ) << 2 );
  if ( tqDrop > 0.0 && ( TQ_BAYER[ tqCell ] + 0.5 ) / 16.0 < tqDrop ) discard;
}
`;

/** The `onBeforeCompile` argument, as far as the fade needs it. */
export interface OccluderShader {
  vertexShader: string;
  fragmentShader?: string;
  uniforms: Record<string, THREE.IUniform>;
}

/**
 * Put the fade into a lit material's shaders. A shader that does not have the chunks the fade
 * hooks into (a custom one that does not use the standard path) is left alone, and a shader that
 * already has the fade is not patched twice. It does not look at what kind of material the shader
 * is for: the callers leave out the shadow pass's depth materials (see `isShadowMaterial`).
 */
export function injectOccluderFade(shader: OccluderShader): void {
  const fragment = shader.fragmentShader;
  if (fragment === undefined) return;
  if (shader.vertexShader.includes(OCCLUDER_MARKER)) return;
  const ready =
    shader.vertexShader.includes('#include <common>') &&
    shader.vertexShader.includes('#include <project_vertex>') &&
    fragment.includes('#include <common>') &&
    fragment.includes('#include <clipping_planes_fragment>');
  if (!ready) return;
  shader.uniforms.uOccluderTarget = occluderTarget;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${OCCLUDER_VERTEX_PARS_GLSL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${OCCLUDER_VERTEX_GLSL}`);
  shader.fragmentShader = fragment
    .replace('#include <common>', `#include <common>\n${OCCLUDER_FRAGMENT_PARS_GLSL}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OCCLUDER_FRAGMENT_GLSL}`);
}

/** True for a material the sun's shadow pass draws with: those never fade, so a shadow stays whole. */
export function isShadowMaterial(material: THREE.Material): boolean {
  const m = material as { isMeshDepthMaterial?: boolean; isMeshDistanceMaterial?: boolean };
  return m.isMeshDepthMaterial === true || m.isMeshDistanceMaterial === true;
}

// ---- fade-only materials (props that never sway) --------------------------------------------------

/** Model ids that fade without swaying. Whole segments only, like the wind patterns. */
const FADE_ID_PATTERNS: readonly RegExp[] = [/^rock\./, /^stump$/, /^log\./, /^tent(\.|$)/];

/** True when a model of this id fades but does not sway (a rock, stump, log or tent). */
export function occluderFadeFor(modelId: string): boolean {
  return FADE_ID_PATTERNS.some((pattern) => pattern.test(modelId));
}

const faders = new WeakSet<THREE.Material>();

/** True once `applyOccluderFade` has patched this material. */
export function hasOccluderFade(material: THREE.Material): boolean {
  return faders.has(material);
}

/**
 * Make `material` fade, in place, and return it. Any `onBeforeCompile` it already had still runs
 * first. This patches the very material it is given: for a material shared with props that must not
 * fade (the avatar, say), use `occluderMaterial` (or `applyOccluderFadeToMesh`), which patches a clone.
 * A shadow material is returned untouched.
 */
export function applyOccluderFade(material: THREE.Material): THREE.Material {
  if (faders.has(material) || isShadowMaterial(material)) return material;
  faders.add(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectOccluderFade(shader);
  };
  const own = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
  material.customProgramCacheKey = () => (own ? `${own.call(material)}|${OCCLUDER_CACHE_KEY}` : OCCLUDER_CACHE_KEY);
  material.needsUpdate = true;
  return material;
}

const clones = new WeakMap<THREE.Material, THREE.Material>();

/** A fading copy of `source`, one per source material, shared by every mesh that asks. The source is never touched. */
export function occluderMaterial(source: THREE.Material): THREE.Material {
  if (faders.has(source)) return source;
  let clone = clones.get(source);
  if (!clone) {
    clone = source.clone();
    clone.name = `${source.name || 'material'} (fade)`;
    applyOccluderFade(clone);
    clones.set(source, clone);
  }
  return clone;
}

export interface OccluderMeshOptions {
  /**
   * Patch the mesh's own materials instead of swapping in clones. Only for a mesh that owns its
   * material (a primitive built just for it); a model's material is shared, so leave this off.
   */
  inPlace?: boolean;
}

/**
 * Make a mesh (instanced or not) fade when it stands between the camera and the Scout. Its shadow
 * is left alone: the mesh keeps whatever depth material it had.
 */
export function applyOccluderFadeToMesh(mesh: THREE.Mesh, options: OccluderMeshOptions = {}): void {
  const patch = (m: THREE.Material): THREE.Material => (options.inPlace ? applyOccluderFade(m) : occluderMaterial(m));
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
}
