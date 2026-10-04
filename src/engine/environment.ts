import * as THREE from 'three';
import { DEFAULT_LOOK, mergeLook, sunDirection, type LookSettings } from './look';
import { getQuality, qualitySettings, type QualityTier } from './quality';
import { mulberry32 } from './seed';

/**
 * The look of the outdoors: a warm low sun with soft shadows that follow the player (and lean
 * toward where the camera looks), a small hemisphere fill, a soft camera fill that keeps faces
 * turned to the player lit, an environment map made from the sky itself (blue from above, green
 * bounced from the grass), a gradient sky dome with a warm glow where the sun is, fog that matches
 * the horizon, and a few slow clouds.
 *
 * Every number comes from `LookSettings` (look.ts), so the panel and the defaults live in one
 * place. A world calls `createEnvironment(scene, ...)` once and `environment.update(dt,
 * player.position, camera)` every frame. Zones add only props; they carry no lights of their own.
 *
 * Cost: 1 draw call for the sky and one per cloud (8 by default), plus the sun's shadow pass. The
 * sun glow is a few more `pow` calls in the sky's fragment shader, nothing else, and none at all
 * when it is turned off. The shadow's soft edge is a few more instructions in the lit shaders.
 * The environment map is built once with a PMREMGenerator (and again, only when the sky or ground
 * colors change), never per frame.
 *
 * Light balance, in Three's physically based units (see look.ts): the sun lights a facing surface
 * with `albedo * intensity * cos / PI`, so 3.3 at 38 degrees up gives grass about 0.7 of its
 * albedo. The environment map adds roughly 0.35 from above and a little more from the sides, the
 * hemisphere light only a 0.07 top-up. Together that is about the same total as the old flat
 * hemisphere light, but now directional: shadows go blue-green instead of just darker.
 */

export interface EnvironmentOptions {
  /** Defaults to `getQuality()`. */
  quality?: QualityTier;
  /** Starting look; anything missing comes from `DEFAULT_LOOK`. */
  look?: Partial<LookSettings>;
  /**
   * The renderer, for building the environment map. Without it the scene has no environment map
   * (the tests, which have no GL context, leave it out) and only the lights carry the ambient.
   */
  renderer?: THREE.WebGLRenderer;
  /** 6 to 10 reads as a sky; the default is 8. */
  cloudCount?: number;
  /** Seed for cloud shapes and places. */
  seed?: number;
}

export interface Environment {
  readonly sun: THREE.DirectionalLight;
  /**
   * The camera fill: a soft cool light with no shadow that shines where the camera looks, from a
   * little above it. Exactly one, in every zone and every tier, so the shaders' light count never changes.
   */
  readonly fill: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  /** The gradient dome. Always drawn behind everything. */
  readonly sky: THREE.Mesh;
  /** Holds the cloud sprites. */
  readonly clouds: THREE.Group;
  readonly fog: THREE.Fog;
  /** The look in use now. */
  readonly look: LookSettings;
  /** Change the look. Invalid values are ignored; the sky and fog follow at once. */
  setLook(partial: Partial<LookSettings>): void;
  /** Change the shadow map size and reach (an automatic downgrade, or the developer panel). */
  setQuality(tier: QualityTier): void;
  /**
   * Keep the sun's shadow box just ahead of `focus` (the player), toward where the `camera` looks,
   * turn the camera fill to match the `camera` and drift the clouds. Call every frame. Without a
   * camera the fill and the shadow box keep their last direction (the box starts centered on `focus`).
   */
  update(dt: number, focus: THREE.Vector3, camera?: THREE.Camera): void;
  /** Remove everything from the scene and free GPU resources. */
  dispose(): void;
}

// ---- tuning -------------------------------------------------------------------------------------

const SUN_DISTANCE = 60;
/**
 * The follow camera pitches down about 9 degrees with a 50 degree field of view, so the top of
 * the screen sees about 16 degrees of sky. The gradient therefore runs from horizon to zenith
 * over the lowest 30% of the view directions (sin of elevation 0 to 0.3) instead of all of them.
 */
const SKY_GRADIENT_HEIGHT = 0.3;
/** The environment map uses a gentler gradient: light really does come from the whole upper sky. */
const ENV_GRADIENT_HEIGHT = 0.9;
/**
 * How much color the environment map loses before it lights anything. The visible sky is a rich
 * blue; as a light source it would tint every shadow cyan. Desaturating it keeps shadows cool
 * rather than colored.
 */
const ENV_DESATURATION = 0.6;
const ENV_MAP_SIZE = 256;

/** Soft and cool, so faces turned to the player get light that is not the sun's orange. */
const FILL_COLOR = 0xdfe9ff;
/** How far above the camera's own line of sight the fill shines from, before it is normalized. */
const FILL_RAISE = 0.5;
const FILL_DISTANCE = 20;

/**
 * Where the shadow box sits: its center leads the player toward where the camera looks, by this
 * fraction of the box's half-width. The player ends up just under a third of the box's width in
 * from the back edge (0.5 - 0.4 / 2 = 0.3), so shadows cover what the Scout is looking at instead
 * of what is behind the camera.
 */
export const SHADOW_LEAD = 0.4;
/**
 * Softness of the shadow edge: how many shadow-map texels the filter spreads over (the default is
 * 1). Texels are bigger on the cheaper tiers, so they get fewer of them, and the edge comes out
 * about the same width in the world on all three (a little over 0.05 units). The low tier still
 * draws a 1024 shadow map (see quality.ts), so it gets a radius too.
 */
export const SHADOW_RADIUS: Readonly<Record<QualityTier, number>> = { high: 2.25, medium: 1.5, low: 1.75 };
/**
 * Shadows fade out over this fraction of the box's width, measured in from each edge, so there is
 * no line where they stop. The player is always further in than that (see `SHADOW_LEAD`).
 */
export const SHADOW_EDGE_FADE = 0.18;
/** A camera looking more steeply than this (the horizontal part of its direction is shorter) keeps the last lead. */
const MIN_LEAD_LENGTH = 0.2;

const DEFAULT_CLOUDS = 8;
/** Clouds sit on a ring around the player: far away and low, so they peek over the tree line. */
const CLOUD_DISTANCE: readonly [number, number] = [110, 160];
const CLOUD_ELEVATION_DEG: readonly [number, number] = [2.5, 8];
const CLOUD_WIDTH: readonly [number, number] = [50, 85];
/** Radians per second around the player: about 0.1 to 0.25 degrees a second, a full lap in 25 minutes or more. */
const CLOUD_DRIFT: readonly [number, number] = [0.0015, 0.004];
const CLOUD_VARIANTS = 3;
const CLOUD_TEX_W = 128;
const CLOUD_TEX_H = 64;

// ---- shadow helper ------------------------------------------------------------------------------

/**
 * Set `castShadow` and `receiveShadow` on every mesh under `object` (instanced and skinned meshes
 * included). Meshes with a transparent material (glows, blob shadows, flames) are always left
 * out of both: they would cast solid shadows.
 */
export function setShadowCasting(object: THREE.Object3D, cast: boolean, receive: boolean): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    const transparent = Array.isArray(material) ? material.some((m) => m.transparent) : material.transparent;
    mesh.castShadow = transparent ? false : cast;
    mesh.receiveShadow = transparent ? false : receive;
  });
}

// ---- color helper -------------------------------------------------------------------------------

/** Pull `color` toward its own luminance by `amount` (0 keeps it, 1 makes it gray). Changes `color`. */
export function desaturate(color: THREE.Color, amount: number): THREE.Color {
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const keep = 1 - amount;
  color.r = luminance + (color.r - luminance) * keep;
  color.g = luminance + (color.g - luminance) * keep;
  color.b = luminance + (color.b - luminance) * keep;
  return color;
}

// ---- cloud texture ------------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * RGBA pixels (row 0 is the bottom) for one puffy cloud: overlapping soft blobs with a flat,
 * slightly gray-blue underside and a white top. Pure and seeded, so it works without a canvas.
 */
export function cloudPixels(width: number, height: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const blobCount = 7 + Math.floor(rng() * 3);
  const blobs: Array<{ cx: number; cy: number; r: number }> = [];
  for (let i = 0; i < blobCount; i++) {
    const cx = 0.16 + (0.68 * (i + 0.5 + (rng() - 0.5) * 0.6)) / blobCount;
    const hump = Math.sin(Math.PI * cx); // bigger and taller toward the middle
    blobs.push({ cx, cy: 0.3 + 0.16 * hump + rng() * 0.14, r: (0.035 + 0.07 * hump + rng() * 0.035) * width });
  }

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      // The union of the blobs, so the outline keeps its bumps instead of melting into one oval.
      let inside = 0;
      for (const b of blobs) {
        const d = Math.hypot((u - b.cx) * width, (v - b.cy) * height) / b.r;
        inside = Math.max(inside, 1 - d);
      }
      const alpha = smoothstep(0, 0.22, inside) * smoothstep(0.12, 0.26, v);
      const top = smoothstep(0.2, 0.7, v);
      const i = (y * width + x) * 4;
      // Color is written even where alpha is 0, so linear filtering never fringes the edges dark.
      data[i] = Math.round(255 * (0.8 + 0.2 * top));
      data[i + 1] = Math.round(255 * (0.84 + 0.16 * top));
      data[i + 2] = Math.round(255 * (0.93 + 0.07 * top));
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  return data;
}

function createCloudTexture(seed: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(cloudPixels(CLOUD_TEX_W, CLOUD_TEX_H, seed), CLOUD_TEX_W, CLOUD_TEX_H, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---- sky dome -----------------------------------------------------------------------------------

/**
 * The sun glow in the sky, all in one place so the shader and its TypeScript mirror (`skyPixel`)
 * share every number. Three lobes are added up into one `amount`:
 * - a core, `cos(angle to the sun) ^ corePower`. cos^N falls to half at acos(0.5^(1/N)): N of 120
 *   is about 6 degrees.
 * - a wide halo, the same with `haloPower`: N of 12 is about 19 degrees.
 * - a band along the horizon on the sun's side: it grows from nothing at the horizon (where the
 *   fog is, so the two meet without a seam) over `bandRise`, and is gone by `bandHeight` (both are
 *   sine of the elevation, so 0.22 is about 13 degrees up). It is strongest toward the sun's
 *   compass heading, falling away smoothly to nothing on the far side, and weaker the higher the
 *   sun is (a sun straight overhead lights no one side).
 *
 * The sky is then mixed toward a color by `amount` (never past `maxMix`). That color runs from a
 * pale warm haze where the glow is faint to the sun's own color where it is strong (`rampFrom` to
 * `rampTo`). Blue light mixed straight toward orange goes gray and then lilac on the way, and a
 * real sky near the sun goes pale and bright instead, so the haze is what the blue passes through.
 *
 * Mixing toward a color, instead of adding light, is what keeps the peak under the bloom threshold
 * (1.0, see post.ts): the result can never be brighter than the brightest of the sky and the two
 * glow colors, and their luminance is capped at `maxLuminance`. The look's `sunGlow` and
 * `sunGlowSize` scale the lobes, and the sky is never brighter than 1.0 whatever they are.
 */
export const SKY_GLOW = Object.freeze({
  corePower: 120,
  haloPower: 12,
  bandPower: 3,
  bandRise: 0.05,
  bandHeight: 0.22,
  coreWeight: 0.9,
  haloWeight: 0.2,
  bandWeight: 0.5,
  /** The most the sky is ever mixed toward the glow color, so some sky always shows through. */
  maxMix: 0.9,
  /** Where `amount` begins and finishes the change from haze to the sun's color. */
  rampFrom: 0.25,
  rampTo: 0.8,
  /** How far the core color is pulled from the sun's color toward white, and the haze color, which is paler. */
  coreWhiteness: 0.1,
  hazeWhiteness: 0.55,
  /** Linear luminance both colors are capped at: the bloom threshold is 1.0, so this keeps a margin. */
  maxLuminance: 0.92,
  /** The glow fades out as the sun's height (sine of its elevation) goes from `fadeFrom` up to `fadeTo`. */
  fadeFrom: -0.04,
  fadeTo: 0.1,
});

/** A float for GLSL source: always with a decimal point. */
function glsl(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    // Drop the camera position and push the depth to the far plane, so the dome is always
    // behind everything and never clipped, whatever the camera's far distance is.
    vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

/**
 * Horizon to zenith above the horizon, `uGround` below it. The visible dome passes the horizon
 * color as the ground (nothing below the horizon is ever seen); the environment map passes the
 * grass color, which is what makes it bounce green light up into the shadows.
 *
 * The sun glow (see `SKY_GLOW`) is only drawn when `uGlow` is above 0: the environment map keeps it
 * at 0, because the sun is already a light and would be counted twice. `uSunDir` is not clamped
 * the way the shadow box's sun is, so a sun set below the horizon really is below it.
 */
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform float uHeight;
  uniform vec3 uSunDir;
  uniform vec3 uGlowColor;
  uniform vec3 uGlowHaze;
  uniform float uGlow;
  uniform float uGlowSize;
  varying vec3 vDirection;
  void main() {
    vec3 view = normalize(vDirection);
    float h = view.y;
    float t = pow(clamp(h / uHeight, 0.0, 1.0), 0.65);
    vec3 sky = mix(uHorizon, uZenith, t);
    if (uGlow > 0.0) {
      // A bigger size spreads every lobe: the exponents shrink with its square, the band's height grows with it.
      float spread = 1.0 / (uGlowSize * uGlowSize);
      float s = max(dot(view, uSunDir), 0.0);
      float sunSide = length(uSunDir.xz);
      vec2 sunHeading = uSunDir.xz / max(sunSide, 0.0001);
      vec2 heading = view.xz / max(length(view.xz), 0.0001);
      float band = pow(0.5 + 0.5 * dot(heading, sunHeading), max(${glsl(SKY_GLOW.bandPower)} * spread, 1.0))
        * smoothstep(0.0, ${glsl(SKY_GLOW.bandRise)} * uGlowSize, h)
        * (1.0 - smoothstep(0.0, ${glsl(SKY_GLOW.bandHeight)} * uGlowSize, h)) * sunSide;
      float amount = uGlow * (
        ${glsl(SKY_GLOW.coreWeight)} * pow(s, ${glsl(SKY_GLOW.corePower)} * spread) +
        ${glsl(SKY_GLOW.haloWeight)} * pow(s, ${glsl(SKY_GLOW.haloPower)} * spread) +
        ${glsl(SKY_GLOW.bandWeight)} * band
      );
      vec3 target = mix(uGlowHaze, uGlowColor, smoothstep(${glsl(SKY_GLOW.rampFrom)}, ${glsl(SKY_GLOW.rampTo)}, amount));
      sky = mix(sky, target, min(amount, ${glsl(SKY_GLOW.maxMix)}));
    }
    gl_FragColor = vec4(mix(uGround, sky, smoothstep(-0.12, 0.04, h)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Vec3 = readonly [number, number, number];

/** Everything the sky shader reads, as plain numbers (linear colors), for `skyPixel`. */
export interface SkyParams {
  zenith: Vec3;
  horizon: Vec3;
  ground: Vec3;
  /** See `SKY_GRADIENT_HEIGHT`. */
  height: number;
  /** Unit vector from the ground toward the sun. */
  sunDir: Vec3;
  /** The glow's color where it is strong, and the paler haze it fades through where it is faint. */
  glowColor: Vec3;
  hazeColor: Vec3;
  /** 0 draws no glow. Otherwise `look.sunGlow` times `sunGlowFade`. */
  glow: number;
  size: number;
}

/**
 * The sky's linear color looking along `view`, the same arithmetic as `SKY_FRAGMENT` (before tone
 * mapping and the color space conversion). The shader is the one that draws; this is for the tests,
 * which cannot run GLSL, to check the glow stays under the bloom threshold.
 */
export function skyPixel(view: Vec3, p: SkyParams): [number, number, number] {
  const len = Math.hypot(view[0], view[1], view[2]);
  const v: Vec3 = [view[0] / len, view[1] / len, view[2] / len];
  const h = v[1];
  const t = Math.pow(Math.min(1, Math.max(0, h / p.height)), 0.65);
  const sky = [0, 1, 2].map((i) => p.horizon[i]! + (p.zenith[i]! - p.horizon[i]!) * t);
  if (p.glow > 0) {
    const spread = 1 / (p.size * p.size);
    const s = Math.max(0, v[0] * p.sunDir[0] + v[1] * p.sunDir[1] + v[2] * p.sunDir[2]);
    const sunSide = Math.hypot(p.sunDir[0], p.sunDir[2]);
    const heading = Math.hypot(v[0], v[2]);
    const along = (v[0] * p.sunDir[0] + v[2] * p.sunDir[2]) / (Math.max(heading, 0.0001) * Math.max(sunSide, 0.0001));
    const band =
      Math.pow(0.5 + 0.5 * along, Math.max(SKY_GLOW.bandPower * spread, 1)) *
      smoothstep(0, SKY_GLOW.bandRise * p.size, h) *
      (1 - smoothstep(0, SKY_GLOW.bandHeight * p.size, h)) *
      sunSide;
    const amount =
      p.glow *
      (SKY_GLOW.coreWeight * Math.pow(s, SKY_GLOW.corePower * spread) + SKY_GLOW.haloWeight * Math.pow(s, SKY_GLOW.haloPower * spread) + SKY_GLOW.bandWeight * band);
    const ramp = smoothstep(SKY_GLOW.rampFrom, SKY_GLOW.rampTo, amount);
    const mix = Math.min(amount, SKY_GLOW.maxMix);
    for (let i = 0; i < 3; i++) {
      const target = p.hazeColor[i]! + (p.glowColor[i]! - p.hazeColor[i]!) * ramp;
      sky[i] = sky[i]! + (target - sky[i]!) * mix;
    }
  }
  const ground = smoothstep(-0.12, 0.04, h);
  return [0, 1, 2].map((i) => p.ground[i]! + (sky[i]! - p.ground[i]!) * ground) as [number, number, number];
}

/** 1 with the sun up, easing to 0 as it sinks to just below the horizon. `sunY` is the sun direction's y. */
export function sunGlowFade(sunY: number): number {
  return smoothstep(SKY_GLOW.fadeFrom, SKY_GLOW.fadeTo, sunY);
}

const WHITE = new THREE.Color(1, 1, 1);

/** `color` pulled `whiteness` of the way toward white, then scaled down if its luminance passes the cap. Changes and returns `color`. */
function paleAndCapped(color: THREE.Color, whiteness: number): THREE.Color {
  color.lerp(WHITE, whiteness);
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  if (luminance > SKY_GLOW.maxLuminance) color.multiplyScalar(SKY_GLOW.maxLuminance / luminance);
  return color;
}

/** The glow's two colors from the sun's: the core (close to the sun's own) and the paler haze. Changes `core` and `haze`. */
export function sunGlowColors(sunColor: THREE.Color, core: THREE.Color, haze: THREE.Color): void {
  paleAndCapped(core.copy(sunColor), SKY_GLOW.coreWhiteness);
  paleAndCapped(haze.copy(sunColor), SKY_GLOW.hazeWhiteness);
}

/** The uniforms that drive the sun glow. The visible dome shares these objects with the environment, so a look change reaches the sky at once. */
interface SkyGlowUniforms {
  uSunDir: { value: THREE.Vector3 };
  uGlowColor: { value: THREE.Color };
  uGlowHaze: { value: THREE.Color };
  uGlow: { value: number };
  uGlowSize: { value: number };
}

function createSkyGlowUniforms(): SkyGlowUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlowColor: { value: new THREE.Color() },
    uGlowHaze: { value: new THREE.Color() },
    uGlow: { value: 0 },
    uGlowSize: { value: 1 },
  };
}

/**
 * `toneMapped` is true for the visible dome: it goes through the same tone mapping as the fog, so
 * the horizon matches the faded trees exactly (before, the dome skipped tone mapping and the fog
 * did not, which left a visible seam). It is false for the environment map, which wants raw radiance.
 * `glow` holds the sun glow's uniforms; the environment map passes none, and so has no glow.
 */
function createSkyMaterial(
  horizon: THREE.Color,
  zenith: THREE.Color,
  ground: THREE.Color,
  height: number,
  toneMapped: boolean,
  glow: SkyGlowUniforms = createSkyGlowUniforms(),
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
      uGround: { value: ground },
      uHeight: { value: height },
      ...glow,
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped,
  });
}

// ---- shadow edge fade ---------------------------------------------------------------------------

/**
 * The sun's shadow box has a hard edge: outside it nothing is shadowed. The fog cannot hide that
 * (it starts at 26 and is only about 6% thick at the box edge ahead of the player), so the shadow
 * itself fades out toward the edge instead.
 *
 * Three r186 has no setting for that, and where the box edge is only shows inside the lighting
 * shader. So this patches the shader chunks that read a directional light's shadow, once, rather
 * than any material: every lit material (Lambert, Standard, Phong, instanced and skinned too)
 * gets the fade, and zones, props and the avatar need to do nothing. A per-material
 * `onBeforeCompile` would have to be added to every new material, and the world already chains
 * several of those on its materials (wind, the occluder fade, the ground).
 *
 * Only a light that asks gets the fade, so the avatar editor's and the dev pages' key lights keep
 * their hard edges. The ask is the light's `shadow.intensity`: Three gives a value above 1 no
 * meaning, so here an intensity of `1 + w` means "full strength, fading out over the outer `w` of
 * the box's width". An intensity of 1 or less is used as it always was. The sun sets
 * `1 + SHADOW_EDGE_FADE`.
 */
const SHADOW_EDGE_FUNCTION = /* glsl */ `
float shadowEdgeIntensity( float intensity, vec4 shadowCoord ) {
	float fadeWidth = intensity - 1.0;
	if ( fadeWidth <= 0.0 ) return intensity;
	vec2 c = shadowCoord.xy / shadowCoord.w;
	float edge = min( min( c.x, 1.0 - c.x ), min( c.y, 1.0 - c.y ) );
	return smoothstep( 0.0, fadeWidth, edge );
}
`;

/**
 * The shadow's strength at a point `u`, `v` across the shadow box (0 to 1 each, the same
 * arithmetic as `shadowEdgeIntensity` in the shader). 0 at the edge, up to `intensity` (1) from
 * `intensity - 1` of the box's width inward. An `intensity` of 1 or less is returned unchanged.
 */
export function shadowEdgeIntensity(intensity: number, u: number, v: number): number {
  const fadeWidth = intensity - 1;
  if (fadeWidth <= 0) return intensity;
  return smoothstep(0, fadeWidth, Math.min(u, 1 - u, v, 1 - v));
}

/** The one line in Three's shadow lookup that reads a directional light's intensity, in `lights_fragment_begin`. */
const SHADOW_LOOKUP = 'directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias';
/** The same lookup in `shadowmask_pars_fragment`, which a `ShadowMaterial` uses. */
const SHADOW_MASK_LOOKUP = 'directionalLight.shadowIntensity, directionalLight.shadowBias';
/** Where in `shadowmap_pars_fragment` the function goes: after the directional light's shadow uniforms. */
const SHADOW_UNIFORMS = 'uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];';

/**
 * Add the edge fade to the shader chunks in `chunks` (Three's own by default). Safe to call more
 * than once. Returns false, changing nothing, when a chunk is not the text this expects (a new
 * Three release moved it), so the shadow box keeps its hard edge instead of the shaders breaking.
 */
export function installShadowEdgeFade(chunks: Record<string, string> = THREE.ShaderChunk): boolean {
  const pars = chunks.shadowmap_pars_fragment;
  const lights = chunks.lights_fragment_begin;
  const mask = chunks.shadowmask_pars_fragment;
  if (pars === undefined || lights === undefined || mask === undefined) return false;
  if (pars.includes('shadowEdgeIntensity')) return true;
  if (!pars.includes(SHADOW_UNIFORMS) || !lights.includes(SHADOW_LOOKUP) || !mask.includes(SHADOW_MASK_LOOKUP)) return false;
  const call = (light: string): string => `shadowEdgeIntensity( ${light}.shadowIntensity, vDirectionalShadowCoord[ i ] ), ${light}.shadowBias`;
  // Function replacements: the text has `$` in it, which `replace` would read as a pattern.
  chunks.shadowmap_pars_fragment = pars.replace(SHADOW_UNIFORMS, () => `${SHADOW_UNIFORMS}\n${SHADOW_EDGE_FUNCTION}`);
  chunks.lights_fragment_begin = lights.replace(SHADOW_LOOKUP, () => call('directionalLightShadow'));
  chunks.shadowmask_pars_fragment = mask.replace(SHADOW_MASK_LOOKUP, () => call('directionalLight'));
  return true;
}

// ---- environment --------------------------------------------------------------------------------

interface Cloud {
  sprite: THREE.Sprite;
  angle: number;
  distance: number;
  height: number;
  speed: number;
}

export function createEnvironment(scene: THREE.Scene, opts: EnvironmentOptions = {}): Environment {
  let quality = qualitySettings(opts.quality ?? getQuality());
  let look = mergeLook(DEFAULT_LOOK, opts.look);
  const rng = mulberry32(opts.seed ?? 1977);

  // Colors the dome, the fog and the environment map share. The dome's uniforms hold these very
  // objects, so changing a color here changes the sky on the next frame.
  const horizon = new THREE.Color(look.fogColor);
  const zenith = new THREE.Color(look.skyZenithColor);

  // Shadows fade out toward the edge of the sun's box (see `installShadowEdgeFade`).
  const edgeFade = installShadowEdgeFade();
  if (!edgeFade) console.warn('Shadow edge fade not installed; shadows stop at the box edge.');

  // Sun. Its shadow camera is a square box `shadowDistance` wide that follows the player.
  const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
  sun.name = 'sun';
  sun.castShadow = true;
  // Low-poly faces are big and flat: a small depth bias plus a push along the normal stops acne.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  // Asks the shader for the edge fade: full strength, fading out over the outer SHADOW_EDGE_FADE of the box.
  // Only when the fade is installed: stock Three would read an intensity above 1 as darker than black.
  sun.shadow.intensity = edgeFade ? 1 + SHADOW_EDGE_FADE : 1;
  scene.add(sun, sun.target);

  // Camera fill: shines the way the camera looks, from a little higher. It never casts a shadow,
  // and it is never switched off (a light that comes and goes would recompile every material).
  const fill = new THREE.DirectionalLight(FILL_COLOR, look.fillIntensity);
  fill.name = 'camera-fill';
  fill.castShadow = false;
  scene.add(fill, fill.target);
  /** Unit vector from the ground toward the fill. Starts as the default view: the camera on +z, high. */
  const fillDir = new THREE.Vector3(0, FILL_RAISE, 1).normalize();

  /** Light-space axes of the sun and the size of one shadow-map texel, for snapping the box. */
  const sunDir = new THREE.Vector3();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  let texel = 1;
  const focusNow = new THREE.Vector3();
  const boxCenter = new THREE.Vector3();
  const snapped = new THREE.Vector3();
  /** The way the camera looks along the ground (unit, y is 0). Unset until a camera has been seen, and then the box is centered on the player. */
  const lookAhead = new THREE.Vector3();
  let hasLookAhead = false;
  const viewDir = new THREE.Vector3();
  /** Half the box's width, in world units. */
  let boxHalf = 0;

  const applyShadowQuality = (): void => {
    const half = quality.shadowDistance / 2;
    boxHalf = half;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.radius = SHADOW_RADIUS[quality.tier];
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = SUN_DISTANCE + quality.shadowDistance * 2;
    cam.updateProjectionMatrix();
    texel = quality.shadowDistance / quality.shadowMapSize;
    // A map that already exists keeps its old size until it is thrown away; Three makes a new one.
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  };

  const applySunDirection = (): void => {
    // Never straight up: the shadow box needs a horizontal axis to snap along.
    const [x, y, z] = sunDirection({ sunAzimuth: look.sunAzimuth, sunElevation: Math.min(88, Math.max(2, look.sunElevation)) });
    sunDir.set(x, y, z);
    lightRight.set(0, 1, 0).cross(sunDir).normalize();
    lightUp.copy(sunDir).cross(lightRight).normalize();
  };

  /**
   * Put the shadow box `SHADOW_LEAD` of its half-width ahead of `focus` (the player) along the
   * way the camera looks, snapped to whole shadow-map texels. Without the snap, shadow edges
   * shimmer as the box moves. The snap is along the light's own axes, so the box's place in the
   * world stays on one fixed grid however the player walks or the camera turns.
   */
  const moveSun = (focus: THREE.Vector3): void => {
    focusNow.copy(focus);
    boxCenter.copy(focus);
    if (hasLookAhead) boxCenter.addScaledVector(lookAhead, SHADOW_LEAD * boxHalf);
    const r = boxCenter.dot(lightRight);
    const u = boxCenter.dot(lightUp);
    snapped
      .copy(boxCenter)
      .addScaledVector(lightRight, Math.round(r / texel) * texel - r)
      .addScaledVector(lightUp, Math.round(u / texel) * texel - u);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(sunDir, SUN_DISTANCE);
  };

  /** Remember which way `viewDir` looks along the ground. Looking nearly straight up or down keeps the last answer. */
  const aimShadowBox = (): void => {
    const flat = Math.hypot(viewDir.x, viewDir.z);
    if (flat < MIN_LEAD_LENGTH) return;
    lookAhead.set(viewDir.x / flat, 0, viewDir.z / flat);
    hasLookAhead = true;
  };

  /** Aim the fill from behind and above the camera (looking along `viewDir`) toward what it sees, centered on `focus`. */
  const moveFill = (focus: THREE.Vector3, camera?: THREE.Camera): void => {
    if (camera) {
      // The camera looks along its target, so the way back from the target is the camera's own backward.
      fillDir.copy(viewDir).negate();
      fillDir.y += FILL_RAISE;
      fillDir.normalize();
    }
    fill.target.position.copy(focus);
    fill.position.copy(focus).addScaledVector(fillDir, FILL_DISTANCE);
  };

  applyShadowQuality();
  applySunDirection();
  moveSun(new THREE.Vector3());
  moveFill(new THREE.Vector3());

  const hemisphere = new THREE.HemisphereLight(look.hemiSkyColor, look.hemiGroundColor, look.hemiIntensity);
  hemisphere.name = 'hemisphere';
  scene.add(hemisphere);

  // The dome's glow uniforms: `applyLook` keeps them on the look's sun, so the glow follows the panel live.
  const glow = createSkyGlowUniforms();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), createSkyMaterial(horizon, zenith, horizon, SKY_GRADIENT_HEIGHT, true, glow));
  sky.name = 'sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);

  const fog = new THREE.Fog(horizon.clone(), look.fogNear, look.fogFar);
  scene.fog = fog;
  const background = horizon.clone(); // fallback behind the dome
  scene.background = background;

  // ---- environment map: the sky as a light probe ----
  // The same gradient, plus the grass color below the horizon, rendered once into a PMREM so every
  // standard, Lambert and Phong material gets sky light from above and green bounce from below.
  const envHorizon = new THREE.Color();
  const envZenith = new THREE.Color();
  const envGround = new THREE.Color();
  let pmrem: THREE.PMREMGenerator | null = null;
  let envScene: THREE.Scene | null = null;
  let envTarget: THREE.WebGLRenderTarget | null = null;
  let envDirty = false;
  if (opts.renderer) {
    pmrem = new THREE.PMREMGenerator(opts.renderer);
    envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial(envHorizon, envZenith, envGround, ENV_GRADIENT_HEIGHT, false));
    dome.frustumCulled = false;
    envScene.add(dome);
    envDirty = true;
  }

  const rebuildEnvironmentMap = (): void => {
    envDirty = false;
    if (!pmrem || !envScene) return;
    envHorizon.copy(horizon);
    envZenith.copy(zenith);
    desaturate(envHorizon, ENV_DESATURATION);
    desaturate(envZenith, ENV_DESATURATION);
    envGround.set(look.hemiGroundColor);
    try {
      const next = pmrem.fromScene(envScene, 0, 0.1, 100, { size: ENV_MAP_SIZE });
      scene.environment = next.texture;
      envTarget?.dispose();
      envTarget = next;
    } catch (err) {
      console.warn('Environment map failed; lights only.', err);
      scene.environment = null;
      pmrem = null;
    }
  };

  // Clouds: sprites on a ring around the focus that turn slowly about it. They go through tone
  // mapping like everything else; the texture's white tops stay below the bloom threshold.
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'clouds';
  const textures: THREE.DataTexture[] = [];
  const materials: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < CLOUD_VARIANTS; i++) {
    const texture = createCloudTexture(4100 + i * 37);
    textures.push(texture);
    materials.push(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.92, depthWrite: false, fog: false }));
  }
  const count = Math.max(0, Math.round(opts.cloudCount ?? DEFAULT_CLOUDS));
  const clouds: Cloud[] = [];
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(materials[i % CLOUD_VARIANTS]!);
    sprite.name = 'cloud';
    const width = CLOUD_WIDTH[0] + rng() * (CLOUD_WIDTH[1] - CLOUD_WIDTH[0]);
    sprite.scale.set(width, width * (CLOUD_TEX_H / CLOUD_TEX_W) * (0.8 + rng() * 0.3), 1);
    const distance = CLOUD_DISTANCE[0] + rng() * (CLOUD_DISTANCE[1] - CLOUD_DISTANCE[0]);
    const elevation = THREE.MathUtils.degToRad(CLOUD_ELEVATION_DEG[0] + rng() * (CLOUD_ELEVATION_DEG[1] - CLOUD_ELEVATION_DEG[0]));
    clouds.push({
      sprite,
      // Spread evenly around the ring with a little jitter, so they never bunch up.
      angle: ((i + rng() * 0.6) / Math.max(1, count)) * Math.PI * 2,
      distance,
      height: Math.tan(elevation) * distance,
      speed: CLOUD_DRIFT[0] + rng() * (CLOUD_DRIFT[1] - CLOUD_DRIFT[0]),
    });
    cloudGroup.add(sprite);
  }
  scene.add(cloudGroup);

  const placeClouds = (focus: THREE.Vector3): void => {
    for (const c of clouds) {
      c.sprite.position.set(focus.x + Math.cos(c.angle) * c.distance, c.height, focus.z + Math.sin(c.angle) * c.distance);
    }
  };
  placeClouds(new THREE.Vector3());

  // ---- applying the look ----

  const applyLook = (): void => {
    sun.color.set(look.sunColor);
    sun.intensity = look.sunIntensity;
    applySunDirection();
    moveSun(focusNow);
    fill.intensity = look.fillIntensity;

    // The glow reads the sun as set, not as clamped for the shadow box: below the horizon it fades out.
    const [sx, sy, sz] = sunDirection(look);
    glow.uSunDir.value.set(sx, sy, sz);
    sunGlowColors(sun.color, glow.uGlowColor.value, glow.uGlowHaze.value);
    glow.uGlow.value = look.sunGlow * sunGlowFade(sy);
    glow.uGlowSize.value = Math.max(look.sunGlowSize, 0.1);

    hemisphere.color.set(look.hemiSkyColor);
    hemisphere.groundColor.set(look.hemiGroundColor);
    hemisphere.intensity = look.hemiIntensity;

    horizon.set(look.fogColor);
    zenith.set(look.skyZenithColor);
    fog.color.copy(horizon);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    background.copy(horizon);

    scene.environmentIntensity = look.envIntensity;
  };
  applyLook();
  if (envDirty) rebuildEnvironmentMap();

  return {
    sun,
    fill,
    hemisphere,
    sky,
    clouds: cloudGroup,
    fog,
    get look() {
      return look;
    },
    setLook(partial: Partial<LookSettings>): void {
      const before = look;
      look = mergeLook(look, partial);
      applyLook();
      if (pmrem && (before.fogColor !== look.fogColor || before.skyZenithColor !== look.skyZenithColor || before.hemiGroundColor !== look.hemiGroundColor)) {
        envDirty = true; // rebuilt at the next update, once per frame however fast a color is dragged
      }
    },
    setQuality(tier: QualityTier): void {
      quality = qualitySettings(tier);
      applyShadowQuality();
      moveSun(focusNow);
    },
    update(dt: number, focus: THREE.Vector3, camera?: THREE.Camera): void {
      if (envDirty) rebuildEnvironmentMap();
      if (camera) {
        camera.getWorldDirection(viewDir);
        aimShadowBox();
      }
      moveSun(focus);
      moveFill(focus, camera);
      for (const c of clouds) c.angle += c.speed * dt;
      placeClouds(focus);
    },
    dispose(): void {
      scene.remove(sun, sun.target, fill, fill.target, hemisphere, sky, cloudGroup);
      if (scene.fog === fog) scene.fog = null;
      if (scene.background === background) scene.background = null;
      if (envTarget && scene.environment === envTarget.texture) scene.environment = null;
      sun.dispose();
      fill.dispose();
      hemisphere.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      envTarget?.dispose();
      pmrem?.dispose();
      if (envScene) {
        envScene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
      }
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
