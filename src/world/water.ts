/**
 * Stream water: an animated ribbon that follows a centerline, with soft ripples, bank foam, a
 * darker middle, and a few twinkling sparkles. Standalone: it knows nothing about any zone.
 *
 * API
 *
 *   const water = createStreamWater({ path, width, gap, seed, tier });
 *   zone.root.add(water.root);        // once
 *   water.update(dt);                 // every fixed step, from the zone's update
 *   water.dispose();                  // frees the geometry, materials and texture
 *   water.setReducedMotion(true);     // optional live switch (see below)
 *   setWaterLook(look);               // once, and on every look change: the sun and sky every water reads
 *
 *   interface StreamWaterOptions {
 *     path: { x: number; z: number }[]; // centerline, in the direction the water flows. 2 or more points.
 *     width?: number;                   // bank to bank, world units. Default 3.
 *     gap?: { center: { x; z }; length: number }; // leave the water out here (a bridge). Optional.
 *     seed?: number;                    // varies the ripple pattern and the sparkle spots. Default 1.
 *     tier?: 'high' | 'medium' | 'low'; // default getQuality()
 *     reducedMotion?: boolean;          // default: the system's prefers-reduced-motion
 *     y?: number;                       // height of the surface. Default WATER_Y (0.065)
 *     colors?: { deep?: number; shallow?: number; foam?: number }; // hex, sRGB
 *   }
 *   interface StreamWater { root: THREE.Group; update(dt): void; dispose(): void; setReducedMotion(r): void }
 *
 * The path is read in world x and z; the ribbon sits at `y` and faces up. The water body is `width`
 * wide and a soft see-through shore (WATER_FRINGE, 0.3) fades out beyond each bank, so the whole
 * strip is width + 0.6 across, the same as the old flat strip. The gap, when given, is a window of
 * `gap.length` measured along the path and centered on the path point nearest `gap.center`. No
 * triangle touches it: the ribbon is cut exactly at both ends of the window, so the ground (and the
 * bridge's own planks) show through. Without a gap the ribbon is one unbroken strip.
 *
 * Look. One ShaderMaterial, transparent, no depth write (renderOrder 1), with the scene fog. It is
 * lit by a small hand-made model that reads the sun and the sky from uniforms (see `setWaterLook`),
 * not by Three's lights:
 *   - high and medium: two layers of stretched value noise scroll along the flow for soft light
 *     ripples and faint troughs. The same noise gives a slope, so the surface has a gentle normal
 *     that tilts as the ripples pass. Foam along both banks is broken up by a third noise; the color
 *     runs from `shallow` at the banks to `deep` in the middle, and the middle is a bit more opaque.
 *   - low: no noise. A static shallow-to-deep gradient, a static foam edge, and one slow band that
 *     scrolls along the flow. The surface is flat. No glints.
 *   - all tiers: the color is multiplied by a light term (sky and hemisphere ambient plus the sun's
 *     color times N dot L), so water darkens as the sun gets lower. At grazing angles it blends toward
 *     the sky (Schlick fresnel, F0 0.03). It mirrors the sky dome's own gradient: pale horizon color
 *     for the flat view far out, blue higher up. So far water melts into the haze.
 *   - high and medium: sun glints. A tight specular lobe of the sun on the rippled normal, so a few
 *     small bright flecks drift downstream with the ripples when you look toward the sun. They peak a
 *     little over 1.0 (a tiny bloom kick) and are sparse. The ripples flatten out past about 18 units,
 *     so far water is calm and does not shimmer.
 *   - the edge: alpha melts in over WATER_SHORE (0.5) units from the outer edge of the ribbon, so the
 *     water fades into the bank instead of ending on a line. No depth texture is read.
 *   - reduced motion: the clock stops at a fixed value and the sparkles hide, so the water is still
 *     colored and rippled but nothing flows.
 * `colors` sets the water's own (albedo) colors; the lighting works on top of them.
 *
 * Sparkles (high and medium only): up to SPARKLE_MAX tiny additive points that drift downstream on
 * the surface and twinkle, one Points object with a 16 by 16 soft dot built from raw pixels (so it
 * builds in node). Their peak is 1.0, not tone-mapped away, and they ignore fog (they sit near the
 * player). They never leave the water body and never enter the gap.
 *
 * Draw calls: 2 on high and medium (the ribbon and the sparkles), 1 on low (the ribbon only). The glints
 * and the sky tint are in the ribbon's shader, so they add none.
 * Triangles: two per 0.7 units of path (a 50 unit stream is about 140). CPU per frame: one sparkle
 * pass, a few dozen points. A non-finite or too-short path returns an empty group.
 */
import * as THREE from 'three';
import { DEFAULT_LOOK, sunDirection, type LookSettings } from '../engine/look';
import { getQuality, type QualityTier } from '../engine/quality';
import { mulberry32 } from '../engine/seed';

// ---- types ---------------------------------------------------------------------------------------

export interface WaterPoint {
  x: number;
  z: number;
}

export interface WaterGap {
  center: WaterPoint;
  /** Length of the empty window, measured along the path. */
  length: number;
}

export interface StreamWaterColors {
  deep?: number;
  shallow?: number;
  foam?: number;
}

export interface StreamWaterOptions {
  path: readonly WaterPoint[];
  width?: number;
  gap?: WaterGap;
  seed?: number;
  tier?: QualityTier;
  reducedMotion?: boolean;
  y?: number;
  colors?: StreamWaterColors;
}

export interface StreamWater {
  root: THREE.Group;
  update(dt: number): void;
  dispose(): void;
  /** Turn the flow and the sparkles off or back on without rebuilding. */
  setReducedMotion(reduced: boolean): void;
}

// ---- tuning --------------------------------------------------------------------------------------

/** Surface height. The dirt path is at 0.04 and the pads at 0.046, so the water sits just above. */
export const WATER_Y = 0.065;
/** The soft shore, beyond each bank, that fades to nothing. */
export const WATER_FRINGE = 0.3;
/** Distance between rows of the ribbon along the path. */
export const WATER_SPACING = 0.7;
export const DEFAULT_WIDTH = 3;
export const SPARKLE_MAX = 36;
const SPARKLE_MIN = 12;
/** Spacing of one sparkle per this much water, along the path. */
const SPARKLE_PER_UNIT = 2.2;
const SPARKLE_SIZE = 0.16;
const SPARKLE_LIFT = 0.05;
/** Water segments shorter than this are dropped (a sliver left next to a gap near the end of the path). */
const MIN_SEGMENT = 0.05;
/** Largest step one update takes, so a stalled frame cannot throw the clock. */
const MAX_STEP = 0.25;
/** The clock value shown while motion is reduced. */
export const FROZEN_TIME = 6.5;
/** Ripple scroll speed (units per second, roughly). */
const FLOW_SPEED = 0.8;

const DEEP = 0x2b7fc4;
const SHALLOW = 0x7cc6ec;
const FOAM = 0xf2faff;

/** Reflectance of water looking straight down (Schlick's F0). Real water is about 0.02. */
export const WATER_F0 = 0.03;
/** The edge melts in over this far from the outer edge of the ribbon (0.3 of fringe, then 0.2 inside the bank). */
export const WATER_SHORE = 0.5;
/** How steep the ripples are: the surface slope is the noise slope times this. */
const RIPPLE_TILT = 0.22;
/** The ripples fade out between these distances from the camera, so far water is calm and does not shimmer. */
const RIPPLE_FADE_NEAR = 18;
const RIPPLE_FADE_FAR = 42;
/** Sharpness of the sun glint (a Blinn lobe, about 3 degrees across), and its brightness. */
const GLINT_SHINE = 350;
const GLINT_GAIN = 1.3;
/** The sky dome runs from the horizon to the zenith color over this much sine of elevation (SKY_GRADIENT_HEIGHT in environment.ts). */
const SKY_HEIGHT = 0.3;
/** Foam is white, so its light is capped to keep it under the bloom threshold. */
const FOAM_LIGHT_CAP = 0.95;
/** Ambient light on a flat surface: the sky halfway to the zenith, desaturated like the environment map. */
const AMBIENT_SKY_MIX = 0.45;
const AMBIENT_DESATURATION = 0.6;

// ---- the light model, in TypeScript --------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the sky shows in the water. `cosView` is N dot V (1 looking straight down, 0 at the
 * horizon). Schlick: about WATER_F0 at 1, 1 at 0. The shader does the same sum.
 */
export function waterFresnel(cosView: number): number {
  const c = Math.min(1, Math.max(0, cosView));
  return WATER_F0 + (1 - WATER_F0) * Math.pow(1 - c, 5);
}

/**
 * The alpha factor at the edge. `inside` is the distance in from the outer edge of the ribbon: 0 at the
 * very edge (nothing), WATER_SHORE or more in the middle (full). The shader does the same sum.
 */
export function waterShore(inside: number, soft: number = WATER_SHORE): number {
  return smoothstep(0, soft, inside);
}

/**
 * The sun and sky every water reads. One set of uniforms is shared by all the water in the game (as the
 * wind does with its clock), so `setWaterLook` reaches the streams in zones that are not on screen too.
 * Colors are linear, like the scene's.
 *
 *   uSunDir      unit vector toward the sun
 *   uSunColor    sun color times intensity over PI: what a surface facing the sun straight on gets
 *   uAmbient     sky and hemisphere light on a flat surface (the environment map is not read directly)
 *   uSkyHorizon  the fog color, which is also the sky's color at the horizon
 *   uSkyZenith   the sky straight up
 */
const waterLight = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uAmbient: { value: new THREE.Color() },
  uSkyHorizon: { value: new THREE.Color() },
  uSkyZenith: { value: new THREE.Color() },
};

/** Pull `color` toward its own luminance by `amount` (the same sum as `desaturate` in environment.ts). */
function grayed(color: THREE.Color, amount: number): THREE.Color {
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const keep = 1 - amount;
  return color.setRGB(color.r * keep + luminance * amount, color.g * keep + luminance * amount, color.b * keep + luminance * amount);
}

/**
 * Point every water at the world's sun and sky. Call it with the look at start and on every change
 * (world.ts does); a water built before the call picks it up on its next frame. A new game starts
 * with DEFAULT_LOOK, so a scene with no call (a test, a preview) is still lit the way the game is.
 */
export function setWaterLook(look: LookSettings): void {
  // The same clamp environment.ts puts on the sun, so a flat sun never lights the water from the side.
  const [x, y, z] = sunDirection({ sunAzimuth: look.sunAzimuth, sunElevation: Math.min(88, Math.max(2, look.sunElevation)) });
  waterLight.uSunDir.value.set(x, y, z);
  waterLight.uSunColor.value.set(look.sunColor).multiplyScalar(look.sunIntensity / Math.PI);
  waterLight.uSkyHorizon.value.set(look.fogColor);
  waterLight.uSkyZenith.value.set(look.skyZenithColor);
  const sky = grayed(new THREE.Color(look.fogColor).lerp(new THREE.Color(look.skyZenithColor), AMBIENT_SKY_MIX), AMBIENT_DESATURATION);
  const hemi = new THREE.Color(look.hemiSkyColor).multiplyScalar(look.hemiIntensity / Math.PI);
  waterLight.uAmbient.value.copy(sky).multiplyScalar(look.envIntensity).add(hemi);
}
setWaterLook(DEFAULT_LOOK);

// ---- shaders -------------------------------------------------------------------------------------

/** A GLSL float literal: always has a decimal point (GLSL ES 3.00 has no implicit int to float). */
const glsl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * `aFlow` is (arc length along the path, across the ribbon from -1 to 1). `aTangent` is the flow
 * direction on the ground (x, z). Fog comes from the scene.
 */
export const WATER_VERTEX_SHADER = /* glsl */ `
attribute vec2 aFlow;
attribute vec2 aTangent;
varying vec2 vFlow;
varying vec2 vTangent;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vFlow = aFlow;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vTangent = (mat3(modelMatrix) * vec3(aTangent.x, 0.0, aTangent.y)).xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** Define TQ_RICH for the noise, normal and glint version (high and medium). Without it the cheap version is built. */
export const WATER_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uHalf;
uniform float uFringe;
uniform float uShore;
uniform float uSpeed;
uniform vec2 uOffset;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
varying vec2 vFlow;
varying vec2 vTangent;
varying vec3 vWorld;
#include <fog_pars_fragment>

const float WATER_F0 = ${glsl(WATER_F0)};
const float SKY_HEIGHT = ${glsl(SKY_HEIGHT)};
const float FOAM_LIGHT_CAP = ${glsl(FOAM_LIGHT_CAP)};

#ifdef TQ_RICH
const float RIPPLE_TILT = ${glsl(RIPPLE_TILT)};
const float RIPPLE_FADE_NEAR = ${glsl(RIPPLE_FADE_NEAR)};
const float RIPPLE_FADE_FAR = ${glsl(RIPPLE_FADE_FAR)};
const float GLINT_SHINE = ${glsl(GLINT_SHINE)};
const float GLINT_GAIN = ${glsl(GLINT_GAIN)};

float tqHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Value noise and its slope: x is the noise, yz is how fast it changes along each axis.
vec3 tqNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  vec2 dw = 6.0 * f * (1.0 - f);
  float a = tqHash(i);
  float b = tqHash(i + vec2(1.0, 0.0));
  float c = tqHash(i + vec2(0.0, 1.0));
  float d = tqHash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  float v = a + (b - a) * w.x + (c - a) * w.y + k * w.x * w.y;
  return vec3(v, dw * vec2(b - a + k * w.y, c - a + k * w.x));
}
float tqNoise(vec2 p) {
  return tqNoiseD(p).x;
}
#endif

void main() {
  float s = vFlow.x;
  float u = vFlow.y * (uHalf + uFringe);
  // How far inside the bank this pixel is (negative out on the shore), and how deep that reads.
  float edge = uHalf - abs(u);
  float depth = smoothstep(0.0, 1.0, clamp(edge / uHalf, 0.0, 1.0));
  vec3 col = mix(uShallow, uDeep, depth);

  vec3 toEye = cameraPosition - vWorld;
  float eyeDist = length(toEye);
  vec3 V = toEye / max(eyeDist, 0.001);
  vec3 N = vec3(0.0, 1.0, 0.0);

  #ifdef TQ_RICH
    float flow = uTime * uSpeed;
    vec3 n1 = tqNoiseD(vec2(s * 0.55 - flow * 0.6, u * 1.7) + uOffset);
    vec3 n2 = tqNoiseD(vec2(s * 1.3 - flow * 1.1, u * 3.1) + uOffset.yx + 17.0);
    float mixed = n1.x * 0.62 + n2.x * 0.38;
    float ripple = smoothstep(0.5, 0.82, mixed);
    float trough = 1.0 - smoothstep(0.18, 0.42, mixed);
    col = mix(col, uShallow, ripple * 0.35);
    col *= 1.0 - trough * 0.12;
    // The surface tilts with the ripples: their slope along the flow and across it, turned into world x and z.
    vec2 slope = vec2(n1.y * 0.55 * 0.62 + n2.y * 1.3 * 0.38, n1.z * 1.7 * 0.62 + n2.z * 3.1 * 0.38);
    vec2 along = normalize(vTangent);
    vec2 push = (along * slope.x + vec2(-along.y, along.x) * slope.y) * RIPPLE_TILT * (1.0 - smoothstep(RIPPLE_FADE_NEAR, RIPPLE_FADE_FAR, eyeDist));
    N = normalize(vec3(-push.x, 1.0, -push.y));
  #else
    float band = 0.5 + 0.5 * sin((s - uTime * uSpeed) * 0.9);
    col = mix(col, uShallow, band * 0.3);
  #endif

  // Light: the sky and the sun's warm color, darker as the sun gets lower.
  vec3 lit = uAmbient + uSunColor * max(dot(N, uSunDir), 0.0);
  col *= lit;

  // Sky tint: Schlick fresnel, and the sky dome's own gradient in the mirrored direction.
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - ndv, 5.0);
  float skyUp = clamp(reflect(-V, N).y / SKY_HEIGHT, 0.0, 1.0);
  col = mix(col, mix(uSkyHorizon, uSkyZenith, pow(skyUp, 0.65)), fresnel);

  // Foam hugs both banks, and spills a little onto the shore.
  float foam = 1.0 - smoothstep(0.0, 0.55, edge);
  #ifdef TQ_RICH
    float fn = tqNoise(vec2(s * 2.6 - uTime * uSpeed * 0.4, u * 3.5) + uOffset * 0.5);
    foam *= 0.45 + 1.1 * fn;
  #endif
  foam = clamp(foam, 0.0, 1.0) * 0.9;
  col = mix(col, uFoam * min(lit, vec3(FOAM_LIGHT_CAP)), foam);

  // See-through, a touch more solid in the deep middle and where the sky shows.
  float alpha = mix(0.55, 0.86, depth);
  alpha = mix(alpha, 0.95, foam);
  alpha = mix(alpha, 0.97, fresnel);

  #ifdef TQ_RICH
    // Sun glints: a tight highlight where a ripple faces the half way point between the sun and the eye.
    // They ride the same scroll as the ripples, so they drift downstream. Foam is rough, so it has none.
    float glint = pow(max(dot(N, normalize(uSunDir + V)), 0.0), GLINT_SHINE) * (1.0 - foam);
    col += uSunColor * (glint * GLINT_GAIN);
    alpha = mix(alpha, 1.0, clamp(glint * 3.0, 0.0, 1.0));
  #endif

  // The edge melts into the bank: nothing at the outer edge, full uShore in.
  float inside = uHalf + uFringe - abs(u);
  alpha *= smoothstep(0.0, uShore, inside);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---- the centerline ------------------------------------------------------------------------------

/** A polyline with arc length. Repeated and non-finite points are dropped. */
class Centerline {
  readonly pts: WaterPoint[] = [];
  readonly cum: number[] = [0];

  constructor(points: readonly WaterPoint[]) {
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const last = this.pts[this.pts.length - 1];
      if (last) {
        const d = Math.hypot(p.x - last.x, p.z - last.z);
        if (d < 1e-6) continue;
        this.cum.push(this.cum[this.cum.length - 1]! + d);
      }
      this.pts.push({ x: p.x, z: p.z });
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }

  get usable(): boolean {
    return this.pts.length >= 2;
  }

  /** The segment (i - 1, i) that holds arc length `c`. */
  private segment(c: number): number {
    let lo = 1;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < c) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number): WaterPoint {
    const c = Math.min(this.length, Math.max(0, s));
    const i = this.segment(c);
    const s0 = this.cum[i - 1]!;
    const s1 = this.cum[i]!;
    const t = s1 > s0 ? (c - s0) / (s1 - s0) : 0;
    const a = this.pts[i - 1]!;
    const b = this.pts[i]!;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Unit direction of the flow at `s`, smoothed over about 0.7 units so bends do not kink the ribbon. */
  tangentAt(s: number): WaterPoint {
    const a = this.pointAt(s - 0.35);
    const b = this.pointAt(s + 0.35);
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-9) {
      const i = this.segment(Math.min(this.length, Math.max(0, s)));
      dx = this.pts[i]!.x - this.pts[i - 1]!.x;
      dz = this.pts[i]!.z - this.pts[i - 1]!.z;
      len = Math.hypot(dx, dz) || 1;
    }
    return { x: dx / len, z: dz / len };
  }

  /** Arc length of the point on the line closest to (x, z). */
  nearestS(x: number, z: number): number {
    let best = Infinity;
    let bestS = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!;
      const b = this.pts[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1]! + Math.sqrt(len2) * t;
      }
    }
    return bestS;
  }
}

/** The stretches of path that carry water: all of it, or everything but the gap. */
function waterSegments(line: Centerline, gap: WaterGap | undefined): Array<[number, number]> {
  const total = line.length;
  if (!gap || !(gap.length > 0) || !Number.isFinite(gap.center.x) || !Number.isFinite(gap.center.z)) {
    return [[0, total]];
  }
  const c = line.nearestS(gap.center.x, gap.center.z);
  const g0 = c - gap.length / 2;
  const g1 = c + gap.length / 2;
  const out: Array<[number, number]> = [];
  if (g0 > MIN_SEGMENT) out.push([0, Math.min(g0, total)]);
  if (g1 < total - MIN_SEGMENT) out.push([Math.max(g1, 0), total]);
  return out;
}

// ---- geometry ------------------------------------------------------------------------------------

/**
 * One strip per water segment: a row of two vertices (left and right edge) every WATER_SPACING,
 * with `aFlow` = (arc length, -1 or +1) and `aTangent` = the unit flow direction (x, z). Triangles
 * all face up.
 */
function buildRibbon(
  line: Centerline,
  segments: ReadonlyArray<[number, number]>,
  halfTotal: number,
  y: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const flow: number[] = [];
  const tangents: number[] = [];
  const indices: number[] = [];

  const triUp = (a: number, b: number, c: number): void => {
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    if (uz * vx - ux * vz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  for (const [from, to] of segments) {
    const rows = Math.max(1, Math.ceil((to - from) / WATER_SPACING));
    let previous: [number, number] | null = null;
    for (let i = 0; i <= rows; i++) {
      const s = i === rows ? to : from + ((to - from) * i) / rows;
      const p = line.pointAt(s);
      const t = line.tangentAt(s);
      const nx = -t.z;
      const nz = t.x;
      const left = positions.length / 3;
      positions.push(p.x - nx * halfTotal, y, p.z - nz * halfTotal);
      flow.push(s, -1);
      positions.push(p.x + nx * halfTotal, y, p.z + nz * halfTotal);
      flow.push(s, 1);
      tangents.push(t.x, t.z, t.x, t.z);
      const row: [number, number] = [left, left + 1];
      if (previous) {
        triUp(previous[0], previous[1], row[0]);
        triUp(previous[1], row[1], row[0]);
      }
      previous = row;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geometry.setAttribute('aTangent', new THREE.Float32BufferAttribute(tangents, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---- sparkles ------------------------------------------------------------------------------------

/** A 16 by 16 soft white dot, from raw pixels so it needs no canvas (the tests run in node). */
function glowDotTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = Math.hypot((px + 0.5) / size - 0.5, (py + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const i = (py * size + px) * 4;
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

interface Sparkle {
  /** Index into the water segments: a sparkle drifts inside its own stretch and wraps there. */
  seg: number;
  /** Arc length along the path. */
  s: number;
  /** Where across the water it floats, -1 to 1 (scaled to 80 percent of the half width). */
  lat: number;
  speed: number;
  wobbleRate: number;
  wobblePhase: number;
  twinkleRate: number;
  twinklePhase: number;
}

function systemPrefersReducedMotion(): boolean {
  // Same check as wind.ts, kept local so this module stands alone.
  const mm = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return mm.call(globalThis, '(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---- the factory ---------------------------------------------------------------------------------

function emptyWater(root: THREE.Group): StreamWater {
  return {
    root,
    update: () => {},
    dispose: () => {},
    setReducedMotion: () => {},
  };
}

export function createStreamWater(options: StreamWaterOptions): StreamWater {
  const root = new THREE.Group();
  root.name = 'stream-water';
  const line = new Centerline(options.path);
  if (!line.usable) return emptyWater(root);

  const tier = options.tier ?? getQuality();
  const rich = tier !== 'low';
  const width = options.width !== undefined && options.width > 0 ? options.width : DEFAULT_WIDTH;
  const half = width / 2;
  const y = options.y ?? WATER_Y;
  const rng = mulberry32(options.seed ?? 1);
  const segments = waterSegments(line, options.gap);
  if (segments.length === 0) return emptyWater(root);

  // ---- the ribbon ----
  const geometry = buildRibbon(line, segments, half + WATER_FRINGE, y);
  const colors = options.colors ?? {};
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uHalf: { value: half },
      uFringe: { value: WATER_FRINGE },
      uShore: { value: WATER_SHORE },
      uSpeed: { value: FLOW_SPEED },
      uOffset: { value: new THREE.Vector2(rng() * 100, rng() * 100) },
      uDeep: { value: new THREE.Color(colors.deep ?? DEEP) },
      uShallow: { value: new THREE.Color(colors.shallow ?? SHALLOW) },
      uFoam: { value: new THREE.Color(colors.foam ?? FOAM) },
    },
  ]);
  // The sun and sky are shared by every water, so merge's copies are replaced with the shared objects.
  Object.assign(uniforms, waterLight);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    defines: rich ? { TQ_RICH: '' } : {},
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = 'stream-water-ribbon';
  ribbon.renderOrder = 1;
  root.add(ribbon);

  // ---- the sparkles ----
  let sparkleGeometry: THREE.BufferGeometry | null = null;
  let sparkleMaterial: THREE.PointsMaterial | null = null;
  let sparklePoints: THREE.Points | null = null;
  const sparkles: Sparkle[] = [];
  const waterLength = segments.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (rich) {
    const wanted = Math.round(waterLength / SPARKLE_PER_UNIT);
    const count = Math.min(SPARKLE_MAX, Math.max(SPARKLE_MIN, wanted));
    for (let i = 0; i < count; i++) {
      // Spread them along the water, then jitter.
      let at = ((i + rng()) / count) * waterLength;
      let seg = 0;
      for (; seg < segments.length - 1; seg++) {
        const len = segments[seg]![1] - segments[seg]![0];
        if (at <= len) break;
        at -= len;
      }
      const [a, b] = segments[seg]!;
      sparkles.push({
        seg,
        s: Math.min(b, a + at),
        lat: rng() * 2 - 1,
        speed: 0.55 + rng() * 0.35,
        wobbleRate: 0.4 + rng() * 0.6,
        wobblePhase: rng() * Math.PI * 2,
        twinkleRate: 1.6 + rng() * 2.2,
        twinklePhase: rng() * Math.PI * 2,
      });
    }
    sparkleGeometry = new THREE.BufferGeometry();
    sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    sparkleGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    sparkleMaterial = new THREE.PointsMaterial({
      size: SPARKLE_SIZE,
      map: glowDotTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
    });
    sparklePoints = new THREE.Points(sparkleGeometry, sparkleMaterial);
    sparklePoints.name = 'stream-sparkles';
    sparklePoints.renderOrder = 2;
    sparklePoints.frustumCulled = false; // they drift every frame, so the first bounds would be wrong
    root.add(sparklePoints);
  }

  let time = rng() * 50;
  let reduced = options.reducedMotion ?? systemPrefersReducedMotion();
  let disposed = false;

  const applySparkles = (): void => {
    if (!sparkleGeometry) return;
    const positions = sparkleGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colorsAttr = sparkleGeometry.getAttribute('color') as THREE.BufferAttribute;
    sparkles.forEach((sp, i) => {
      const [a, b] = segments[sp.seg]!;
      const p = line.pointAt(sp.s);
      const t = line.tangentAt(sp.s);
      const off = (sp.lat * 0.8 + 0.1 * Math.sin(time * sp.wobbleRate + sp.wobblePhase)) * half;
      positions.setXYZ(i, p.x - t.z * off, y + SPARKLE_LIFT, p.z + t.x * off);
      const twinkle = Math.pow(0.5 + 0.5 * Math.sin(time * sp.twinkleRate + sp.twinklePhase), 6);
      const fade = Math.min(1, Math.max(0, Math.min(sp.s - a, b - sp.s) / 1.5));
      const v = twinkle * fade;
      colorsAttr.setXYZ(i, v, v * 0.97, v * 0.88);
    });
    positions.needsUpdate = true;
    colorsAttr.needsUpdate = true;
  };

  const syncMotion = (): void => {
    uniforms.uTime!.value = reduced ? FROZEN_TIME : time;
    if (sparklePoints) sparklePoints.visible = !reduced;
  };
  syncMotion();
  applySparkles();

  return {
    root,
    update(dt: number): void {
      if (disposed || reduced) return;
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), MAX_STEP) : 0;
      time += step;
      uniforms.uTime!.value = time;
      for (const sp of sparkles) {
        const [a, b] = segments[sp.seg]!;
        sp.s += sp.speed * step;
        if (sp.s > b) sp.s = a + ((sp.s - a) % Math.max(b - a, 1e-6));
      }
      applySparkles();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      sparkleGeometry?.dispose();
      sparkleMaterial?.map?.dispose();
      sparkleMaterial?.dispose();
      root.clear();
    },
    setReducedMotion(next: boolean): void {
      reduced = next;
      syncMotion();
    },
  };
}
