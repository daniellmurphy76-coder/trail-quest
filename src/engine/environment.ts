import * as THREE from 'three';
import { DEFAULT_LOOK, mergeLook, sunDirection, type LookSettings } from './look';
import { getQuality, qualitySettings, type QualityTier } from './quality';
import { mulberry32 } from './seed';

/**
 * The look of the outdoors: a warm low sun with soft shadows that follows the player, a small
 * hemisphere fill, a soft camera fill that keeps faces turned to the player lit, an environment
 * map made from the sky itself (blue from above, green bounced from the grass), a gradient sky
 * dome, fog that matches the horizon, and a few slow clouds.
 *
 * Every number comes from `LookSettings` (look.ts), so the panel and the defaults live in one
 * place. A world calls `createEnvironment(scene, ...)` once and `environment.update(dt,
 * player.position, camera)` every frame. Zones add only props; they carry no lights of their own.
 *
 * Cost: 1 draw call for the sky and one per cloud (8 by default), plus the sun's shadow pass. The
 * environment map is built once with a PMREMGenerator (and again, only when the sky or ground
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
   * Keep the sun's shadow box centered on `focus` (the player), turn the camera fill to match the
   * `camera` and drift the clouds. Call every frame. Without a camera the fill keeps its last direction.
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
 */
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform float uHeight;
  varying vec3 vDirection;
  void main() {
    float h = normalize(vDirection).y;
    float t = pow(clamp(h / uHeight, 0.0, 1.0), 0.65);
    vec3 sky = mix(uHorizon, uZenith, t);
    gl_FragColor = vec4(mix(uGround, sky, smoothstep(-0.12, 0.04, h)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * `toneMapped` is true for the visible dome: it goes through the same tone mapping as the fog, so
 * the horizon matches the faded trees exactly (before, the dome skipped tone mapping and the fog
 * did not, which left a visible seam). It is false for the environment map, which wants raw radiance.
 */
function createSkyMaterial(
  horizon: THREE.Color,
  zenith: THREE.Color,
  ground: THREE.Color,
  height: number,
  toneMapped: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
      uGround: { value: ground },
      uHeight: { value: height },
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

  // Sun. Its shadow camera is a square box `shadowDistance` wide that follows the player.
  const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
  sun.name = 'sun';
  sun.castShadow = true;
  // Low-poly faces are big and flat: a small depth bias plus a push along the normal stops acne.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
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
  const snapped = new THREE.Vector3();

  const applyShadowQuality = (): void => {
    const half = quality.shadowDistance / 2;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
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
   * Keep the shadow box centered on `focus`, snapped to whole shadow-map texels. Without the
   * snap, shadow edges shimmer as the player walks.
   */
  const moveSun = (focus: THREE.Vector3): void => {
    focusNow.copy(focus);
    const r = focus.dot(lightRight);
    const u = focus.dot(lightUp);
    snapped
      .copy(focus)
      .addScaledVector(lightRight, Math.round(r / texel) * texel - r)
      .addScaledVector(lightUp, Math.round(u / texel) * texel - u);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(sunDir, SUN_DISTANCE);
  };

  /** Aim the fill from behind and above `camera` toward what it sees, centered on `focus`. */
  const moveFill = (focus: THREE.Vector3, camera?: THREE.Camera): void => {
    if (camera) {
      // The camera looks along its target, so the way back from the target is the camera's own backward.
      camera.getWorldDirection(fillDir).negate();
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

  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), createSkyMaterial(horizon, zenith, horizon, SKY_GRADIENT_HEIGHT, true));
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
