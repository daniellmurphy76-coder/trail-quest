import * as THREE from 'three';
import { getQuality, qualitySettings, type QualityTier } from './quality';
import { mulberry32 } from './seed';

/**
 * The look of the outdoors: a warm sun with soft shadows that follows the player, a sky and
 * hemisphere light, a gradient sky dome, fog that matches the horizon, and a few slow clouds.
 *
 * A world calls `createEnvironment(scene, ...)` once and `environment.update(dt, player.position)`
 * every frame. Zones add only props; they no longer carry their own lights.
 *
 * Cost: 1 draw call for the sky and one per cloud (8 by default), plus the sun's shadow pass.
 */

export interface EnvironmentOptions {
  /** Defaults to `getQuality()`. */
  quality?: QualityTier;
  /** Sky color at the horizon, also the fog color. */
  horizonColor?: number;
  /** Sky color straight up. */
  zenithColor?: number;
  sunColor?: number;
  fogNear?: number;
  fogFar?: number;
  /** 6 to 10 reads as a sky; the default is 8. */
  cloudCount?: number;
  /** Seed for cloud shapes and places. */
  seed?: number;
}

export interface Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  /** The gradient dome. Always drawn behind everything. */
  readonly sky: THREE.Mesh;
  /** Holds the cloud sprites. */
  readonly clouds: THREE.Group;
  readonly fog: THREE.Fog;
  /** Keep the sun's shadow box centered on `focus` (the player) and drift the clouds. Call every frame. */
  update(dt: number, focus: THREE.Vector3): void;
  /** Remove everything from the scene and free GPU resources. */
  dispose(): void;
}

// ---- tuning -------------------------------------------------------------------------------------
// Light values are for Three's physically based lights (r155 and later): a diffuse surface facing
// the sun reflects albedo * intensity / PI, so a "full" light is about 3. With ACES tone mapping
// at exposure 1.05 these keep sunlit grass close to its painted color and shadows readable.

const SUN_COLOR = 0xfff1d6;
const SUN_INTENSITY = 2.8;
/** Points from the player toward the sun. About 47 degrees up, from the south-east. */
const SUN_DIRECTION = new THREE.Vector3(28, 36, 18).normalize();
const SUN_DISTANCE = 60;
const HEMI_SKY = 0xcfe3f5;
const HEMI_GROUND = 0x6b8a3d;
const HEMI_INTENSITY = 1.7;

const HORIZON = 0xf1e6cc;
const ZENITH = 0x2c64b4;
const FOG_NEAR = 30;
const FOG_FAR = 100;
/**
 * The follow camera pitches down about 22 degrees with a 50 degree field of view, so only the
 * lowest few degrees of sky are ever on screen. The gradient therefore runs from horizon to zenith
 * over the lowest 30% of the view directions (sin of elevation 0 to 0.3) instead of all of them.
 */
const SKY_GRADIENT_HEIGHT = 0.3;

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

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform float uHeight;
  varying vec3 vDirection;
  void main() {
    float h = normalize(vDirection).y;
    float t = pow(clamp(h / uHeight, 0.0, 1.0), 0.65);
    gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
    #include <colorspace_fragment>
  }
`;

function createSky(horizon: THREE.Color, zenith: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
      uHeight: { value: SKY_GRADIENT_HEIGHT },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false, // the horizon must come out exactly the fog color
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), material);
  sky.name = 'sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  return sky;
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
  const quality = qualitySettings(opts.quality ?? getQuality());
  const horizon = new THREE.Color(opts.horizonColor ?? HORIZON);
  const zenith = new THREE.Color(opts.zenithColor ?? ZENITH);
  const rng = mulberry32(opts.seed ?? 1977);

  // Sun. Its shadow camera is a square box `shadowDistance` wide that follows the player.
  const half = quality.shadowDistance / 2;
  const sun = new THREE.DirectionalLight(opts.sunColor ?? SUN_COLOR, SUN_INTENSITY);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = SUN_DISTANCE + quality.shadowDistance * 2;
  cam.updateProjectionMatrix();
  // Low-poly faces are big and flat: a small depth bias plus a push along the normal stops acne.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
  scene.add(sun, sun.target);

  const hemisphere = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemisphere.name = 'hemisphere';
  scene.add(hemisphere);

  const sky = createSky(horizon, zenith);
  scene.add(sky);

  const fog = new THREE.Fog(horizon.getHex(), opts.fogNear ?? FOG_NEAR, opts.fogFar ?? FOG_FAR);
  scene.fog = fog;
  const background = horizon.clone(); // fallback behind the dome
  scene.background = background;

  // Clouds: sprites on a ring around the focus that turn slowly about it.
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'clouds';
  const textures: THREE.DataTexture[] = [];
  const materials: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < CLOUD_VARIANTS; i++) {
    const texture = createCloudTexture(4100 + i * 37);
    textures.push(texture);
    materials.push(
      new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.92, depthWrite: false, fog: false, toneMapped: false }),
    );
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

  // ---- per frame ----

  // Light-space axes of the sun, for snapping the shadow box to whole shadow-map texels. Without
  // the snap, shadow edges shimmer as the player walks.
  const lightRight = new THREE.Vector3(0, 1, 0).cross(SUN_DIRECTION).normalize();
  const lightUp = SUN_DIRECTION.clone().cross(lightRight).normalize();
  const texel = quality.shadowDistance / quality.shadowMapSize;
  const snapped = new THREE.Vector3();

  const placeClouds = (focus: THREE.Vector3): void => {
    for (const c of clouds) {
      c.sprite.position.set(focus.x + Math.cos(c.angle) * c.distance, c.height, focus.z + Math.sin(c.angle) * c.distance);
    }
  };
  placeClouds(new THREE.Vector3());

  const moveSun = (focus: THREE.Vector3): void => {
    const r = focus.dot(lightRight);
    const u = focus.dot(lightUp);
    snapped
      .copy(focus)
      .addScaledVector(lightRight, Math.round(r / texel) * texel - r)
      .addScaledVector(lightUp, Math.round(u / texel) * texel - u);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
  };
  moveSun(new THREE.Vector3());

  return {
    sun,
    hemisphere,
    sky,
    clouds: cloudGroup,
    fog,
    update(dt: number, focus: THREE.Vector3): void {
      moveSun(focus);
      for (const c of clouds) c.angle += c.speed * dt;
      placeClouds(focus);
    },
    dispose(): void {
      scene.remove(sun, sun.target, hemisphere, sky, cloudGroup);
      if (scene.fog === fog) scene.fog = null;
      if (scene.background === background) scene.background = null;
      sun.dispose();
      hemisphere.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
