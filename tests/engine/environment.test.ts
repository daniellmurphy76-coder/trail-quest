import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cloudPixels,
  createEnvironment,
  desaturate,
  installShadowEdgeFade,
  SHADOW_EDGE_FADE,
  SHADOW_LEAD,
  SHADOW_RADIUS,
  setShadowCasting,
  shadowEdgeIntensity,
  SKY_GLOW,
  skyPixel,
  sunGlowColors,
  type Environment,
  type SkyParams,
} from '../../src/engine/environment';
import { DEFAULT_LOOK, sunDirection, type LookSettings } from '../../src/engine/look';
import { QUALITY_SETTINGS } from '../../src/engine/quality';

function lightsIn(scene: THREE.Scene): THREE.Light[] {
  const found: THREE.Light[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) found.push(o as THREE.Light);
  });
  return found;
}

function cloudSprites(scene: THREE.Scene): THREE.Sprite[] {
  const found: THREE.Sprite[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) found.push(o as THREE.Sprite);
  });
  return found;
}

describe('createEnvironment', () => {
  it('adds one sun, one camera fill, one hemisphere light, the sky dome, and 6 to 10 clouds', () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, { quality: 'high' });

    const lights = lightsIn(scene);
    expect(lights.filter((l) => (l as THREE.DirectionalLight).isDirectionalLight)).toHaveLength(2);
    expect(lights.filter((l) => (l as THREE.HemisphereLight).isHemisphereLight)).toHaveLength(1);
    expect(lights).toHaveLength(3);

    const sky = scene.getObjectByName('sky') as THREE.Mesh;
    expect(sky.isMesh).toBe(true);
    expect(sky.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect((sky.material as THREE.ShaderMaterial).side).toBe(THREE.BackSide);

    const clouds = cloudSprites(scene);
    expect(clouds.length).toBeGreaterThanOrEqual(6);
    expect(clouds.length).toBeLessThanOrEqual(10);
  });

  it('makes a warm sun that casts soft, acne-free shadows', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    const sun = env.sun;
    expect(sun.color.getHex()).toBe(new THREE.Color(DEFAULT_LOOK.sunColor).getHex());
    expect(sun.color.r).toBeGreaterThan(sun.color.b); // warm
    expect(sun.intensity).toBe(DEFAULT_LOOK.sunIntensity);
    expect(sun.intensity).toBeGreaterThan(1.5); // physically based lights: a full sun is about 3
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.mapSize.y).toBe(2048);
    expect(sun.shadow.bias).toBeLessThan(0);
    expect(sun.shadow.bias).toBeGreaterThan(-0.001);
    expect(sun.shadow.normalBias).toBeGreaterThan(0);
    const cam = sun.shadow.camera;
    expect(cam.right - cam.left).toBe(45);
    expect(cam.top - cam.bottom).toBe(45);
  });

  it('uses a smaller shadow map and reach on the medium tier', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'medium' });
    expect(env.sun.shadow.mapSize.x).toBe(1024);
    const cam = env.sun.shadow.camera;
    expect(cam.right - cam.left).toBe(35);
  });

  it('has a pale sky light over a mossy ground color', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const { color, groundColor } = env.hemisphere;
    expect(color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(0.7);
    expect(groundColor.g).toBeGreaterThan(groundColor.r);
    expect(groundColor.g).toBeGreaterThan(groundColor.b);
  });

  it('fogs the scene in the horizon color, so the sky and distant trees meet', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    expect(scene.fog).toBe(env.fog);
    expect(env.fog).toBeInstanceOf(THREE.Fog);
    const sky = env.sky.material as THREE.ShaderMaterial;
    const horizon = sky.uniforms.uHorizon!.value as THREE.Color;
    expect(env.fog.color.getHex()).toBe(horizon.getHex());
    expect(env.fog.near).toBeLessThan(env.fog.far);
    // Deep blue overhead, paler and warmer at the horizon.
    const zenith = sky.uniforms.uZenith!.value as THREE.Color;
    expect(zenith.b).toBeGreaterThan(zenith.r);
    expect(horizon.r).toBeGreaterThan(zenith.r);
  });

  it('draws the dome behind everything and tone maps it like the fog, so the horizon has no seam', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const mat = env.sky.material as THREE.ShaderMaterial;
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(false);
    // Fogged trees are tone mapped; a dome that skipped tone mapping would not match them.
    expect(mat.toneMapped).toBe(true);
    expect(mat.fragmentShader).toContain('tonemapping_fragment');
    expect(env.sky.renderOrder).toBeLessThan(0);
  });

  it('moves the shadow camera to keep the focus centered', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    const before = env.sun.position.clone();
    const offset = env.sun.position.clone().sub(env.sun.target.position);

    const focus = new THREE.Vector3(100, 0, -40);
    env.update(1 / 60, focus);

    expect(env.sun.position.distanceTo(before)).toBeGreaterThan(50);
    // The target sits on the focus to within one shadow-map texel (45 / 2048 units).
    expect(env.sun.target.position.distanceTo(focus)).toBeLessThan(0.05);
    // The sun keeps the same direction and distance from its target.
    const after = env.sun.position.clone().sub(env.sun.target.position);
    expect(after.distanceTo(offset)).toBeLessThan(1e-9);
    // The target is in the scene, so Three updates its matrix before shadows are drawn.
    expect(env.sun.target.parent).toBe(scene);
  });

  it('snaps the shadow box to whole texels so edges do not shimmer', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const texel = 45 / 2048;
    const toward = env.sun.position.clone().sub(env.sun.target.position).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
    const up = toward.clone().cross(right).normalize();
    for (const [x, z] of [
      [10, 10],
      [-3.37, 8.91],
      [41.123, -17.77],
    ] as const) {
      env.update(0, new THREE.Vector3(x, 0, z));
      const t = env.sun.target.position;
      // Across the shadow map the box only ever moves in whole texels...
      expect(Math.abs(t.dot(right) / texel - Math.round(t.dot(right) / texel))).toBeLessThan(1e-6);
      expect(Math.abs(t.dot(up) / texel - Math.round(t.dot(up) / texel))).toBeLessThan(1e-6);
    }
    // ...so a nudge smaller than a texel does not move it.
    env.update(0, new THREE.Vector3(10, 0, 10));
    const a = env.sun.target.position.clone();
    env.update(0, new THREE.Vector3(10 + 0.0001 * right.x, 0, 10 + 0.0001 * right.z));
    const moved = env.sun.target.position.clone().sub(a);
    expect(Math.abs(moved.dot(right))).toBeLessThan(1e-6);
    expect(Math.abs(moved.dot(up))).toBeLessThan(1e-6);
  });

  it('drifts the clouds slowly and keeps them on a ring around the focus', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    const sprites = cloudSprites(scene);
    const focus = new THREE.Vector3(5, 0, -3);
    env.update(0, focus);
    const start = sprites.map((s) => s.position.clone());
    const radius = (s: THREE.Sprite): number => Math.hypot(s.position.x - focus.x, s.position.z - focus.z);
    const startRadii = sprites.map(radius);

    env.update(10, focus); // ten seconds
    sprites.forEach((s, i) => {
      const moved = s.position.distanceTo(start[i]!);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(8); // very slow: a few units in ten seconds
      expect(radius(s)).toBeCloseTo(startRadii[i]!, 6);
      expect(s.position.y).toBeCloseTo(start[i]!.y, 6);
    });

    // They follow the player instead of being left behind.
    const far = new THREE.Vector3(500, 0, 500);
    env.update(0, far);
    for (const s of sprites) expect(Math.hypot(s.position.x - far.x, s.position.z - far.z)).toBeLessThan(200);
  });

  it('keeps clouds low and far, so they show over the tree line', () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, { quality: 'high' });
    for (const s of cloudSprites(scene)) {
      const ground = Math.hypot(s.position.x, s.position.z);
      const elevation = THREE.MathUtils.radToDeg(Math.atan2(s.position.y, ground));
      expect(ground).toBeGreaterThan(100);
      expect(ground).toBeLessThan(190); // inside the camera's far plane (200)
      expect(elevation).toBeGreaterThan(1);
      expect(elevation).toBeLessThan(12);
    }
  });

  it('is deterministic for a given seed and honors cloudCount', () => {
    const place = (seed: number): number[] => {
      const scene = new THREE.Scene();
      createEnvironment(scene, { quality: 'high', seed, cloudCount: 7 });
      return cloudSprites(scene).flatMap((s) => [s.position.x, s.position.y, s.position.z]);
    };
    expect(place(5)).toEqual(place(5));
    expect(place(5)).not.toEqual(place(6));
    expect(place(5)).toHaveLength(7 * 3);
  });

  it('removes everything it added on dispose', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    expect(scene.children.length).toBeGreaterThan(0);
    env.dispose();
    expect(scene.children).toHaveLength(0);
    expect(scene.fog).toBeNull();
    expect(scene.background).toBeNull();
  });
});

describe('the camera fill', () => {
  /** Unit vector from the ground toward the fill. */
  const fillDirection = (env: Environment): THREE.Vector3 => env.fill.position.clone().sub(env.fill.target.position).normalize();

  /** A camera at `position` looking at `target`, like the follow camera. */
  const cameraAt = (position: THREE.Vector3, target: THREE.Vector3): THREE.PerspectiveCamera => {
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 300);
    camera.position.copy(position);
    camera.lookAt(target);
    return camera;
  };

  it('is one soft cool light with no shadow, at the default intensity', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    expect(env.fill.isDirectionalLight).toBe(true);
    expect(env.fill).not.toBe(env.sun);
    expect(env.fill.castShadow).toBe(false);
    expect(env.fill.intensity).toBe(DEFAULT_LOOK.fillIntensity);
    expect(env.fill.intensity).toBeLessThan(env.sun.intensity);
    expect(env.fill.color.b).toBeGreaterThan(env.fill.color.r); // cool, against the warm sun
    expect(env.fill.parent).toBe(scene);
    expect(env.fill.target.parent).toBe(scene);
  });

  it('is the only light of its kind in every quality tier, so the shaders never change', () => {
    for (const quality of ['high', 'medium', 'low'] as const) {
      const scene = new THREE.Scene();
      const env = createEnvironment(scene, { quality });
      const unshadowed = lightsIn(scene).filter((l) => (l as THREE.DirectionalLight).isDirectionalLight && !l.castShadow);
      expect(unshadowed, quality).toEqual([env.fill]);
      env.setQuality(quality === 'low' ? 'high' : 'low');
      expect(lightsIn(scene), quality).toHaveLength(3);
      expect(lightsIn(scene).filter((l) => l.castShadow), quality).toEqual([env.sun]);
    }
  });

  it('shines from behind and above the camera toward what it sees', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const player = new THREE.Vector3(12, 0, -30);
    const target = player.clone().add(new THREE.Vector3(0, 1.8, 0));
    const flat = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x, 0, v.z).normalize();
    // The follow camera: 7.5 units behind the player and 3 up, so it looks down a little. Try two sides.
    for (const behind of [new THREE.Vector3(0, 3, 7.5), new THREE.Vector3(-5.3, 3, -5.3)]) {
      const camera = cameraAt(player.clone().add(behind), target);
      env.update(1 / 60, player, camera);
      const dir = fillDirection(env);
      const toCamera = camera.position.clone().sub(target).normalize();
      expect(dir.length()).toBeCloseTo(1, 9);
      expect(dir.y).toBeGreaterThan(toCamera.y); // a little higher than the camera's own line of sight
      expect(dir.y).toBeGreaterThan(0.4);
      // On the camera's side: a face turned to the camera is lit nearly head on.
      expect(flat(dir).dot(flat(toCamera))).toBeGreaterThan(0.99);
      expect(env.fill.target.position.distanceTo(player)).toBeLessThan(1e-9);
    }
  });

  it('turns with the camera, and keeps its last direction when no camera is given', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const player = new THREE.Vector3();
    const target = new THREE.Vector3(0, 1.8, 0);
    env.update(0, player, cameraAt(new THREE.Vector3(0, 3, 7.5), target));
    const front = fillDirection(env);
    expect(front.z).toBeGreaterThan(0.6);
    env.update(0, player, cameraAt(new THREE.Vector3(7.5, 3, 0), target));
    const side = fillDirection(env);
    expect(side.x).toBeGreaterThan(0.6);
    expect(side.distanceTo(front)).toBeGreaterThan(0.5);
    env.update(0, new THREE.Vector3(40, 0, 40)); // walking on with no camera passed
    expect(fillDirection(env).distanceTo(side)).toBeLessThan(1e-9);
    expect(env.fill.target.position.x).toBe(40);
  });

  it('lights a face turned to the camera far better than the sun does (about 0.83 against 0.27)', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const target = new THREE.Vector3(0, 1.8, 0);
    env.update(0, new THREE.Vector3(), cameraAt(new THREE.Vector3(0, 3, -7.5), target)); // the camera behind a player facing +z
    const face = new THREE.Vector3(0, 0, -1); // a Scout turned to face the camera
    const fill = Math.max(0, face.dot(fillDirection(env)));
    const sun = Math.max(0, face.dot(env.sun.position.clone().sub(env.sun.target.position).normalize()));
    expect(fill).toBeGreaterThan(0.75);
    expect(fill).toBeGreaterThan(sun * 2);
  });

  it('follows the look: intensity from fillIntensity, and the light stays in the scene at zero', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high', look: { fillIntensity: 1.4 } });
    expect(env.fill.intensity).toBe(1.4);
    env.setLook({ fillIntensity: 0 });
    expect(env.fill.intensity).toBe(0);
    expect(env.fill.visible).toBe(true);
    expect(lightsIn(scene)).toContain(env.fill);
    env.setLook({ fillIntensity: Number.NaN });
    expect(env.fill.intensity).toBe(0); // not a usable value: ignored
    expect(env.look.fillIntensity).toBe(0);
  });

  it('leaves the tuned sun and sky defaults alone', () => {
    expect(DEFAULT_LOOK).toMatchObject({
      exposure: 1.05,
      sunColor: '#ffdba6',
      sunIntensity: 3.3,
      sunAzimuth: 70,
      sunElevation: 38,
      hemiSkyColor: '#cfe0f2',
      hemiGroundColor: '#6b8a3d',
      hemiIntensity: 0.2,
      envIntensity: 1.3,
    });
  });
});

describe('setShadowCasting', () => {
  const solid = (): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());

  it('sets both flags on every mesh in the tree, including instanced ones', () => {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const a = solid();
    const b = solid();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial(), 3);
    inner.add(b, inst);
    root.add(a, inner);

    setShadowCasting(root, true, true);
    for (const m of [a, b, inst]) {
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
    setShadowCasting(root, false, true);
    for (const m of [a, b, inst]) {
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it('leaves transparent meshes (glows, blob shadows) out of both', () => {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
    const root = new THREE.Group();
    root.add(glass);
    setShadowCasting(root, true, true);
    expect(glass.castShadow).toBe(false);
    expect(glass.receiveShadow).toBe(false);
  });

  it('ignores objects that are not meshes', () => {
    const root = new THREE.Group();
    root.add(new THREE.Sprite(), new THREE.Object3D());
    expect(() => setShadowCasting(root, true, true)).not.toThrow();
  });
});

describe('cloudPixels', () => {
  it('fills width x height RGBA, transparent at the edges and solid in the middle', () => {
    const w = 128;
    const h = 64;
    const data = cloudPixels(w, h, 4100);
    expect(data).toHaveLength(w * h * 4);
    const alpha = (x: number, y: number): number => data[(y * w + x) * 4 + 3]!;
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(w - 1, 0)).toBe(0);
    expect(alpha(0, h - 1)).toBe(0);
    expect(alpha(w - 1, h - 1)).toBe(0);
    let solidPixels = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 200) solidPixels++;
    expect(solidPixels).toBeGreaterThan(w * h * 0.1);
    // Edges that fade out keep a light color, so nothing fringes gray when filtered.
    expect(data[0]).toBeGreaterThan(180);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(cloudPixels(32, 16, 1)).toEqual(cloudPixels(32, 16, 1));
    expect(cloudPixels(32, 16, 1)).not.toEqual(cloudPixels(32, 16, 2));
  });
});

describe('environment and the look', () => {
  it('starts from the default look and takes overrides', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    expect(env.look).toEqual(DEFAULT_LOOK);
    const custom = createEnvironment(new THREE.Scene(), { quality: 'high', look: { sunIntensity: 1.25, fogNear: 12 } });
    expect(custom.look.sunIntensity).toBe(1.25);
    expect(custom.sun.intensity).toBe(1.25);
    expect(custom.fog.near).toBe(12);
    expect(custom.look.sunColor).toBe(DEFAULT_LOOK.sunColor);
  });

  it('puts the sun where the look says, and keeps it there as the player walks', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high', look: { sunAzimuth: 120, sunElevation: 30 } });
    const [x, y, z] = sunDirection({ sunAzimuth: 120, sunElevation: 30 });
    const dir = env.sun.position.clone().sub(env.sun.target.position).normalize();
    expect(dir.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
    env.update(1 / 60, new THREE.Vector3(40, 0, -25));
    const after = env.sun.position.clone().sub(env.sun.target.position).normalize();
    expect(after.distanceTo(dir)).toBeLessThan(1e-9);
  });

  it('follows setLook: sun, hemisphere, fog, sky and environment intensity all move together', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene, { quality: 'high' });
    env.setLook({
      sunColor: '#ff0000',
      sunIntensity: 1.5,
      sunAzimuth: 200,
      sunElevation: 60,
      hemiSkyColor: '#00ff00',
      hemiGroundColor: '#0000ff',
      hemiIntensity: 0.9,
      envIntensity: 2.5,
      fogColor: '#336699',
      fogNear: 10,
      fogFar: 50,
      skyZenithColor: '#102030',
    });
    expect(env.sun.color.getHex()).toBe(0xff0000);
    expect(env.sun.intensity).toBe(1.5);
    const dir = env.sun.position.clone().sub(env.sun.target.position).normalize();
    const [x, y, z] = sunDirection({ sunAzimuth: 200, sunElevation: 60 });
    expect(dir.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
    expect(env.hemisphere.color.getHex()).toBe(0x00ff00);
    expect(env.hemisphere.groundColor.getHex()).toBe(0x0000ff);
    expect(env.hemisphere.intensity).toBe(0.9);
    expect(scene.environmentIntensity).toBe(2.5);
    expect(env.fog.near).toBe(10);
    expect(env.fog.far).toBe(50);

    // The fog and the horizon are one color, so distant trees melt into the sky.
    const sky = env.sky.material as THREE.ShaderMaterial;
    const horizon = sky.uniforms.uHorizon!.value as THREE.Color;
    const zenith = sky.uniforms.uZenith!.value as THREE.Color;
    expect(env.fog.color.getHex()).toBe(0x336699);
    expect(horizon.getHex()).toBe(0x336699);
    expect(zenith.getHex()).toBe(0x102030);
    expect((scene.background as THREE.Color).getHex()).toBe(0x336699);
  });

  it('ignores values it cannot use instead of breaking the scene', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    env.setLook({ sunIntensity: Number.NaN, sunColor: 'red' as never, fogNear: Number.POSITIVE_INFINITY });
    expect(env.sun.intensity).toBe(DEFAULT_LOOK.sunIntensity);
    expect(env.fog.near).toBe(DEFAULT_LOOK.fogNear);
    expect(env.sun.color.getHex()).toBe(new THREE.Color(DEFAULT_LOOK.sunColor).getHex());
  });

  it('keeps the shadow box snapped to whole texels after the sun moves', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    env.setLook({ sunAzimuth: 15, sunElevation: 55 });
    const toward = env.sun.position.clone().sub(env.sun.target.position).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
    const texel = 45 / 2048;
    env.update(0, new THREE.Vector3(-3.37, 0, 8.91));
    const t = env.sun.target.position;
    expect(Math.abs(t.dot(right) / texel - Math.round(t.dot(right) / texel))).toBeLessThan(1e-6);
  });

  it('survives a sun straight overhead (the shadow box still has a horizontal axis)', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    env.setLook({ sunElevation: 90 });
    env.update(0, new THREE.Vector3(5, 0, 5));
    expect(Number.isFinite(env.sun.position.x + env.sun.position.y + env.sun.position.z)).toBe(true);
  });

  it('resizes the shadow map when the tier changes, and throws the old map away', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    let disposed = false;
    env.sun.shadow.map = { dispose: () => (disposed = true) } as unknown as THREE.WebGLRenderTarget;
    env.setQuality('medium');
    expect(env.sun.shadow.mapSize.x).toBe(1024);
    expect(env.sun.shadow.camera.right - env.sun.shadow.camera.left).toBe(35);
    expect(disposed).toBe(true);
    expect(env.sun.shadow.map).toBeNull();
    env.setQuality('low');
    expect(env.sun.shadow.mapSize.x).toBe(1024);
    expect(env.sun.shadow.camera.right - env.sun.shadow.camera.left).toBe(30);
    env.setQuality('high');
    expect(env.sun.shadow.mapSize.x).toBe(2048);
    expect(env.sun.shadow.camera.right - env.sun.shadow.camera.left).toBe(45);
  });

  it('has no environment map without a renderer, and leaves scene.environment empty', () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, { quality: 'high' });
    expect(scene.environment).toBeNull();
    expect(scene.environmentIntensity).toBe(DEFAULT_LOOK.envIntensity);
  });

  it('is lit by the environment map first: the hemisphere light is only a small top-up', () => {
    // The environment map carries the ambient (blue from above, green bounce from below). A big
    // hemisphere light on top of it would light every shadow twice and flatten the scene again.
    expect(DEFAULT_LOOK.hemiIntensity).toBeLessThanOrEqual(0.5);
    expect(DEFAULT_LOOK.envIntensity).toBeGreaterThan(DEFAULT_LOOK.hemiIntensity * 2);
    expect(DEFAULT_LOOK.sunIntensity).toBeGreaterThan(2.5);
    expect(DEFAULT_LOOK.sunIntensity).toBeLessThan(4.5);
  });

  it('keeps the horizon a clear blue haze, not a flat white band', () => {
    const horizon = new THREE.Color(DEFAULT_LOOK.fogColor);
    const zenith = new THREE.Color(DEFAULT_LOOK.skyZenithColor);
    const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(luminance(horizon)).toBeLessThan(0.8); // pure white is 1; the old cream haze was 0.8
    expect(horizon.b - horizon.r).toBeGreaterThan(0.3); // tinted blue, not neutral
    expect(luminance(horizon) - luminance(zenith)).toBeGreaterThan(0.3); // a real gradient to the zenith
    expect(DEFAULT_LOOK.fogNear).toBeGreaterThan(15);
    expect(DEFAULT_LOOK.fogFar).toBeLessThan(200); // fully fogged before the far plane
  });

  it('warm afternoon: a low sun with a warm color', () => {
    const sun = new THREE.Color(DEFAULT_LOOK.sunColor);
    expect(sun.r).toBeGreaterThan(sun.g);
    expect(sun.g).toBeGreaterThan(sun.b);
    expect(DEFAULT_LOOK.sunElevation).toBeGreaterThan(20);
    expect(DEFAULT_LOOK.sunElevation).toBeLessThan(50);
  });
});

describe('desaturate', () => {
  const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  it('keeps luminance and pulls the channels together', () => {
    const c = new THREE.Color(0.1, 0.4, 0.9);
    const before = luminance(c);
    desaturate(c, 0.5);
    expect(luminance(c)).toBeCloseTo(before, 6);
    expect(c.b - c.r).toBeCloseTo((0.9 - 0.1) * 0.5, 6);
  });

  it('0 changes nothing and 1 makes gray', () => {
    const same = desaturate(new THREE.Color(0.2, 0.5, 0.7), 0);
    expect([same.r, same.g, same.b]).toEqual([0.2, 0.5, 0.7]);
    const gray = desaturate(new THREE.Color(0.2, 0.5, 0.7), 1);
    expect(gray.r).toBeCloseTo(gray.g, 9);
    expect(gray.g).toBeCloseTo(gray.b, 9);
  });
});

// ---- sun glow ------------------------------------------------------------------------------------

/** What the sky shader reads, taken from the dome's own uniforms so the wiring is tested too. */
function skyParamsOf(env: Environment): SkyParams {
  const u = (env.sky.material as THREE.ShaderMaterial).uniforms;
  const rgb = (c: THREE.Color): [number, number, number] => [c.r, c.g, c.b];
  const dir = u.uSunDir!.value as THREE.Vector3;
  return {
    zenith: rgb(u.uZenith!.value as THREE.Color),
    horizon: rgb(u.uHorizon!.value as THREE.Color),
    ground: rgb(u.uGround!.value as THREE.Color),
    height: u.uHeight!.value as number,
    sunDir: [dir.x, dir.y, dir.z],
    glowColor: rgb(u.uGlowColor!.value as THREE.Color),
    hazeColor: rgb(u.uGlowHaze!.value as THREE.Color),
    glow: u.uGlow!.value as number,
    size: u.uGlowSize!.value as number,
  };
}

const luminanceOf = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** Every direction on a coarse grid (5 degrees around, 2.5 degrees up) plus the sun's own direction and its near neighbors. */
function skyDirections(sun: readonly [number, number, number]): Array<[number, number, number]> {
  const dirs: Array<[number, number, number]> = [];
  for (let az = 0; az < 360; az += 5) {
    for (let el = -30; el <= 90; el += 2.5) {
      const a = THREE.MathUtils.degToRad(az);
      const e = THREE.MathUtils.degToRad(el);
      dirs.push([Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]);
    }
  }
  dirs.push([sun[0], sun[1], sun[2]]);
  for (const nudge of [0.01, 0.03, 0.1]) {
    dirs.push([sun[0] + nudge, sun[1], sun[2]], [sun[0], sun[1] + nudge, sun[2]], [sun[0], sun[1], sun[2] - nudge]);
  }
  return dirs;
}

describe('the sun glow in the sky', () => {
  const uniforms = (env: Environment): Record<string, { value: unknown }> => (env.sky.material as THREE.ShaderMaterial).uniforms;

  it('feeds the shader the sun direction from the look, and follows the panel live', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const sunDir = uniforms(env).uSunDir!.value as THREE.Vector3;
    const [x, y, z] = sunDirection(DEFAULT_LOOK);
    expect(sunDir.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
    expect(sunDir.length()).toBeCloseTo(1, 9);

    for (const [azimuth, elevation] of [
      [200, 20],
      [310, 61],
      [0, 5],
    ] as const) {
      env.setLook({ sunAzimuth: azimuth, sunElevation: elevation });
      const [ex, ey, ez] = sunDirection({ sunAzimuth: azimuth, sunElevation: elevation });
      expect(sunDir.distanceTo(new THREE.Vector3(ex, ey, ez))).toBeLessThan(1e-9);
      // The glow and the light agree: the sun in the sky is where the light comes from.
      const light = env.sun.position.clone().sub(env.sun.target.position).normalize();
      expect(light.distanceTo(sunDir)).toBeLessThan(1e-9);
    }
  });

  it('starts at the default strength and size, and takes both from the look', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    expect(uniforms(env).uGlow!.value).toBeCloseTo(DEFAULT_LOOK.sunGlow, 9); // the default sun is well above the horizon
    expect(uniforms(env).uGlowSize!.value).toBe(DEFAULT_LOOK.sunGlowSize);
    env.setLook({ sunGlow: 0.5, sunGlowSize: 1.6 });
    expect(uniforms(env).uGlow!.value).toBeCloseTo(0.5, 9);
    expect(uniforms(env).uGlowSize!.value).toBe(1.6);
    env.setLook({ sunGlow: 0 });
    expect(uniforms(env).uGlow!.value).toBe(0); // the shader skips the glow at 0
    env.setLook({ sunGlow: Number.NaN, sunGlowSize: Number.NaN });
    expect(uniforms(env).uGlowSize!.value).toBe(1.6); // not usable: ignored
  });

  it('never divides by a size of zero or less', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high', look: { sunGlowSize: 0 } });
    expect(uniforms(env).uGlowSize!.value as number).toBeGreaterThan(0);
    env.setLook({ sunGlowSize: -2 });
    expect(uniforms(env).uGlowSize!.value as number).toBeGreaterThan(0);
  });

  it('fades out as the sun sinks below the horizon, and is gone once it is under it', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const glowAt = (elevation: number): number => {
      env.setLook({ sunElevation: elevation });
      return uniforms(env).uGlow!.value as number;
    };
    expect(glowAt(38)).toBeCloseTo(1, 9);
    expect(glowAt(10)).toBeCloseTo(1, 1); // still full a little above the horizon
    const edge = glowAt(0);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(0.6);
    expect(glowAt(-1.5)).toBeLessThan(edge);
    expect(glowAt(-3)).toBe(0);
    expect(glowAt(-45)).toBe(0);
    // Smoothly, never rising as the sun goes down.
    let last = Infinity;
    for (let elevation = 20; elevation >= -10; elevation -= 1) {
      const now = glowAt(elevation);
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      last = now;
    }
    // The sky sees the real direction, not the clamped one the shadow box uses.
    env.setLook({ sunElevation: -20 });
    expect((uniforms(env).uSunDir!.value as THREE.Vector3).y).toBeLessThan(-0.3);
    expect(env.sun.position.y - env.sun.target.position.y).toBeGreaterThan(0); // the light itself never goes under the ground
  });

  it('has a warm core and a paler haze that follow the sun color, both under the bloom threshold in luminance', () => {
    const core = new THREE.Color();
    const haze = new THREE.Color();
    for (const hex of ['#ffdba6', '#ffffff', '#ff8800', '#112233', '#ffffee']) {
      sunGlowColors(new THREE.Color(hex), core, haze);
      expect(luminanceOf([core.r, core.g, core.b]), hex).toBeLessThanOrEqual(SKY_GLOW.maxLuminance + 1e-9);
      expect(luminanceOf([haze.r, haze.g, haze.b]), hex).toBeLessThanOrEqual(SKY_GLOW.maxLuminance + 1e-9);
    }
    sunGlowColors(new THREE.Color(DEFAULT_LOOK.sunColor), core, haze);
    expect(core.r).toBeGreaterThan(core.b); // warm
    expect(core.g).toBeGreaterThan(core.b);
    expect(haze.b).toBeGreaterThan(core.b); // paler than the core: nearer to white
    expect(haze.r - haze.b).toBeLessThan(core.r - core.b);

    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    env.setLook({ sunColor: '#3366ff' });
    const live = uniforms(env).uGlowColor!.value as THREE.Color;
    expect(live.b).toBeGreaterThan(live.r);
  });

  it('draws the glow only when asked: the shader declares its uniforms and skips the work at 0', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const shader = (env.sky.material as THREE.ShaderMaterial).fragmentShader;
    for (const name of ['uSunDir', 'uGlowColor', 'uGlowHaze', 'uGlow', 'uGlowSize']) {
      expect(shader, name).toContain(`uniform`);
      expect(shader, name).toContain(name);
      expect(uniforms(env)[name], name).toBeDefined();
    }
    expect(shader).toContain('if (uGlow > 0.0)');
    // The shader and skyPixel share their numbers: change one in SKY_GLOW and both move.
    expect(shader).toContain(`pow(s, ${SKY_GLOW.corePower}.0 * spread)`);
    expect(shader).toContain(`pow(s, ${SKY_GLOW.haloPower}.0 * spread)`);
    expect(shader).toContain(`min(amount, ${SKY_GLOW.maxMix})`);
    expect(shader).toContain('tonemapping_fragment'); // still tone mapped like the fog
  });

  describe('the peak stays under the bloom threshold (1.0)', () => {
    const looks: Array<[string, Partial<LookSettings>]> = [
      ['the defaults', {}],
      ['full strength, a tight glow', { sunGlow: 2, sunGlowSize: 0.5 }],
      ['full strength, a wide glow', { sunGlow: 2, sunGlowSize: 2 }],
      ['a low sun', { sunElevation: 5 }],
      ['a high sun', { sunElevation: 85 }],
      ['a sun on the horizon', { sunElevation: 0 }],
      ['a white sun', { sunColor: '#ffffff', sunGlow: 2 }],
      ['a pale yellow sun', { sunColor: '#ffffcc', sunGlow: 2 }],
      ['a pale sky', { fogColor: '#e8f0ff', skyZenithColor: '#9ab8ff', sunGlow: 2 }],
    ];

    for (const [name, look] of looks) {
      it(`in every direction, with ${name}`, () => {
        const env = createEnvironment(new THREE.Scene(), { quality: 'high', look });
        const p = skyParamsOf(env);
        const plain: SkyParams = { ...p, glow: 0 };
        let peak = 0;
        let lift = 0;
        for (const dir of skyDirections(p.sunDir)) {
          const lit = skyPixel(dir, p);
          const bare = skyPixel(dir, plain);
          for (const c of lit) expect(Number.isFinite(c)).toBe(true);
          const l = luminanceOf(lit);
          peak = Math.max(peak, l);
          lift = Math.max(lift, l - luminanceOf(bare));
          // The glow mixes toward a color of luminance <= the cap, so it can never be brighter than
          // the plain sky or the cap, whichever is higher.
          expect(l).toBeLessThanOrEqual(Math.max(luminanceOf(bare), SKY_GLOW.maxLuminance) + 1e-9);
        }
        expect(peak).toBeLessThan(1);
        if ((look.sunElevation ?? DEFAULT_LOOK.sunElevation) > 0) expect(lift).toBeGreaterThan(0.005); // and it really draws something
      });
    }

    it('keeps a margin under the bloom threshold: the glow colors are capped well below 1, and some sky always shows through', () => {
      expect(DEFAULT_LOOK.bloomThreshold).toBe(1); // post.ts blooms from here
      expect(SKY_GLOW.maxLuminance).toBeLessThanOrEqual(0.95);
      expect(SKY_GLOW.maxMix).toBeLessThan(1);
      expect(SKY_GLOW.coreWeight + SKY_GLOW.haloWeight + SKY_GLOW.bandWeight).toBeGreaterThan(SKY_GLOW.maxMix); // the cap really is what limits it at full strength
    });

    it('with no glow, the sky is the plain gradient', () => {
      const env = createEnvironment(new THREE.Scene(), { quality: 'high', look: { sunGlow: 0 } });
      const p = skyParamsOf(env);
      expect(p.glow).toBe(0);
      const horizon = skyPixel([0, 0.05, 1], p);
      const top = skyPixel([0, 1, 0], p);
      expect(horizon[2]).toBeGreaterThan(horizon[0]);
      expect(luminanceOf(horizon)).toBeGreaterThan(luminanceOf(top));
      // Glow off must leave the dome exactly as it was before the glow existed.
      const h = 0.05;
      const gradient = Math.pow(Math.min(1, Math.max(0, h / p.height)), 0.65);
      const ground = THREE.MathUtils.smoothstep(h, -0.12, 0.04);
      const got = skyPixel([0, h, Math.sqrt(1 - h * h)], p);
      got.forEach((c, i) => {
        const sky = p.horizon[i]! + (p.zenith[i]! - p.horizon[i]!) * gradient;
        expect(c).toBeCloseTo(p.ground[i]! + (sky - p.ground[i]!) * ground, 9);
      });
    });
  });

  it('is brightest and warmest toward the sun, and lights the horizon on the sun side more than the far side', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const p = skyParamsOf(env);
    const plain: SkyParams = { ...p, glow: 0 };
    const sun = p.sunDir;
    const atSun = skyPixel(sun, p);
    const bareAtSun = skyPixel(sun, plain);
    expect(luminanceOf(atSun)).toBeGreaterThan(luminanceOf(bareAtSun));
    expect(atSun[0] - atSun[2]).toBeGreaterThan(bareAtSun[0] - bareAtSun[2]); // warmer
    expect(atSun[0]).toBeGreaterThan(atSun[2]); // warm outright: more red than blue at the sun itself
    // The glow falls off with the angle from the sun.
    const lift = (dir: readonly [number, number, number]): number => luminanceOf(skyPixel(dir, p)) - luminanceOf(skyPixel(dir, plain));
    const turned = (degrees: number): [number, number, number] => {
      const a = THREE.MathUtils.degToRad(degrees);
      const el = Math.asin(sun[1]);
      const az = Math.atan2(sun[0], sun[2]) + a;
      return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    };
    expect(lift(sun)).toBeGreaterThan(lift(turned(8)));
    expect(lift(turned(8))).toBeGreaterThan(lift(turned(30)));
    expect(lift(turned(30))).toBeGreaterThan(lift(turned(120)) - 1e-9);
    // On the horizon band, the sun's side is lifted and the opposite side is not.
    const lowAt = (azimuthDegrees: number, h: number): [number, number, number] => {
      const az = THREE.MathUtils.degToRad(azimuthDegrees);
      return [Math.sqrt(1 - h * h) * Math.sin(az), h, Math.sqrt(1 - h * h) * Math.cos(az)];
    };
    const sunAzimuth = THREE.MathUtils.radToDeg(Math.atan2(sun[0], sun[2]));
    expect(lift(lowAt(sunAzimuth, 0.08))).toBeGreaterThan(0.01);
    expect(lift(lowAt(sunAzimuth + 180, 0.08))).toBeLessThan(0.002);
    expect(lift(lowAt(sunAzimuth, 0.08))).toBeGreaterThan(lift(lowAt(sunAzimuth + 90, 0.08)));
    // The band grows out of the fog at the horizon instead of starting with an edge.
    expect(lift(lowAt(sunAzimuth, 0.002))).toBeLessThan(0.005);
  });

  it('has no seam around the compass, straight up, or straight down', () => {
    for (const size of [0.5, 1, 2]) {
      const env = createEnvironment(new THREE.Scene(), { quality: 'high', look: { sunGlowSize: size } });
      const p = skyParamsOf(env);
      let previous: number | null = null;
      for (let az = 0; az <= 360; az += 1) {
        const a = THREE.MathUtils.degToRad(az);
        const h = 0.1;
        const l = luminanceOf(skyPixel([Math.sqrt(1 - h * h) * Math.sin(a), h, Math.sqrt(1 - h * h) * Math.cos(a)], p));
        if (previous !== null) expect(Math.abs(l - previous), `size ${size} at ${az}`).toBeLessThan(0.02); // one degree never jumps
        previous = l;
      }
      for (const dir of [
        [0, 1, 0],
        [0, -1, 0],
      ] as Array<[number, number, number]>) {
        for (const c of skyPixel(dir, p)) expect(Number.isFinite(c)).toBe(true);
      }
    }
  });
});

// ---- shadow reach, softness and edge --------------------------------------------------------------

/** A camera at `position` looking at `target`, like the follow camera. */
function lookingAt(position: THREE.Vector3, target: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 300);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

/** The follow camera as the world sets it up: 7.5 units behind the player at `heading` (radians, 0 faces +z), 3 up, looking at the chest. */
function followCamera(player: THREE.Vector3, heading: number): { camera: THREE.PerspectiveCamera; forward: THREE.Vector3 } {
  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const camera = lookingAt(player.clone().addScaledVector(forward, -7.5).add(new THREE.Vector3(0, 3, 0)), player.clone().add(new THREE.Vector3(0, 1.8, 0)));
  return { camera, forward };
}

describe('the shadow box leads toward where the camera looks', () => {
  const tiers = ['high', 'medium', 'low'] as const;
  const headings = [0, 0.7, 1.6, 2.6, 3.9, 5.2];
  const flat = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x, 0, v.z);

  it('puts the center ahead of the player along the camera forward, by SHADOW_LEAD of the half-width', () => {
    for (const tier of tiers) {
      const { shadowDistance, shadowMapSize } = QUALITY_SETTINGS[tier];
      const half = shadowDistance / 2;
      const texel = shadowDistance / shadowMapSize;
      const env = createEnvironment(new THREE.Scene(), { quality: tier });
      const player = new THREE.Vector3(12.3, 0, -30.7);
      for (const heading of headings) {
        const { camera, forward } = followCamera(player, heading);
        env.update(0, player, camera);
        const ahead = flat(env.sun.target.position.clone().sub(player));
        // The snap to texels moves it by well under 2 texels; everything else is the lead.
        expect(Math.abs(ahead.length() - SHADOW_LEAD * half), `${tier} ${heading}`).toBeLessThan(2 * texel);
        expect(ahead.clone().normalize().dot(forward), `${tier} ${heading}`).toBeGreaterThan(0.999);
      }
    }
    expect(SHADOW_LEAD).toBeGreaterThanOrEqual(0.35); // the brief: 35 to 45 percent of the half-size
    expect(SHADOW_LEAD).toBeLessThanOrEqual(0.45);
  });

  it('keeps the sun the same distance and direction from the box center as it leads', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const toward = (): THREE.Vector3 => env.sun.position.clone().sub(env.sun.target.position);
    const before = toward();
    const player = new THREE.Vector3(5, 0, 5);
    env.update(0, player, followCamera(player, 2).camera);
    expect(toward().distanceTo(before)).toBeLessThan(1e-9);
  });

  it('snaps the led box to whole texels, in light space, as the player walks and the camera turns', () => {
    for (const tier of tiers) {
      const { shadowDistance, shadowMapSize } = QUALITY_SETTINGS[tier];
      const texel = shadowDistance / shadowMapSize;
      const env = createEnvironment(new THREE.Scene(), { quality: tier });
      const toward = env.sun.position.clone().sub(env.sun.target.position).normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
      const up = toward.clone().cross(right).normalize();
      for (const [x, z, heading] of [
        [10, 10, 0.3],
        [-3.37, 8.91, 2.2],
        [41.123, -17.77, 4.1],
        [0.001, 0.002, 5.9],
      ] as const) {
        const player = new THREE.Vector3(x, 0, z);
        env.update(1 / 60, player, followCamera(player, heading).camera);
        const t = env.sun.target.position;
        expect(Math.abs(t.dot(right) / texel - Math.round(t.dot(right) / texel)), tier).toBeLessThan(1e-6);
        expect(Math.abs(t.dot(up) / texel - Math.round(t.dot(up) / texel)), tier).toBeLessThan(1e-6);
      }
    }
  });

  it('does not shimmer: a nudge smaller than a texel, with the same camera, almost never moves the box', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const toward = env.sun.position.clone().sub(env.sun.target.position).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
    const player = new THREE.Vector3(10, 0, 10);
    const { camera } = followCamera(player, 1.1);
    // A tenth of a texel along the light's right axis moves the box only when the start sits within a
    // tenth of a texel of a rounding boundary. Try several starting points so the test is not a lucky one.
    let still = 0;
    for (let k = 0; k < 8; k++) {
      const start = player.clone().add(new THREE.Vector3(k * 0.37, 0, k * 0.11));
      env.update(0, start, camera);
      const base = env.sun.target.position.clone();
      env.update(0, start.clone().addScaledVector(right, (45 / 2048) * 0.1), camera);
      if (env.sun.target.position.distanceTo(base) < 1e-9) still++;
    }
    expect(still).toBeGreaterThanOrEqual(6);
  });

  it('keeps the player well inside the box, further in than the shadow fade, on every tier and sun heading', () => {
    for (const tier of tiers) {
      const { shadowDistance } = QUALITY_SETTINGS[tier];
      for (const sunAzimuth of [0, 70, 133, 200, 291]) {
        for (const sunElevation of [8, 38, 80]) {
          const env = createEnvironment(new THREE.Scene(), { quality: tier, look: { sunAzimuth, sunElevation } });
          const toward = env.sun.position.clone().sub(env.sun.target.position).normalize();
          const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
          const up = toward.clone().cross(right).normalize();
          const player = new THREE.Vector3(-20, 0, 7);
          for (const heading of headings) {
            env.update(0, player, followCamera(player, heading).camera);
            const off = player.clone().sub(env.sun.target.position);
            const edge = 0.5 - Math.max(Math.abs(off.dot(right)), Math.abs(off.dot(up))) / shadowDistance; // 0.5 is the center, 0 the edge
            expect(edge, `${tier} sun ${sunAzimuth}/${sunElevation} heading ${heading}`).toBeGreaterThan(SHADOW_EDGE_FADE + 0.08);
          }
        }
      }
    }
  });

  it('keeps the last lead without a camera, and with a camera looking straight down or up', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const player = new THREE.Vector3(3, 0, 4);
    env.update(0, player); // no camera yet: centered on the player
    expect(flat(env.sun.target.position.clone().sub(player)).length()).toBeLessThan(0.05);

    const { camera } = followCamera(player, 1.3);
    env.update(0, player, camera);
    const led = env.sun.target.position.clone().sub(player);
    expect(flat(led).length()).toBeGreaterThan(5);

    env.update(0, player); // walking on with no camera passed
    expect(env.sun.target.position.clone().sub(player).distanceTo(led)).toBeLessThan(1e-9);
    for (const y of [20, -20]) {
      env.update(0, player, lookingAt(player.clone().add(new THREE.Vector3(0, y, 0.0001)), player)); // straight down, or up
      expect(env.sun.target.position.clone().sub(player).distanceTo(led), `camera at height ${y}`).toBeLessThan(1e-9);
    }
  });

  it('scales the lead with the tier: it follows setQuality, and survives a moved sun', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const player = new THREE.Vector3(8, 0, -8);
    env.update(0, player, followCamera(player, 2.4).camera);
    const lead = (): number => flat(env.sun.target.position.clone().sub(player)).length();
    expect(lead()).toBeCloseTo(SHADOW_LEAD * 22.5, 0);
    env.setQuality('medium');
    expect(lead()).toBeCloseTo(SHADOW_LEAD * 17.5, 0);
    env.setQuality('low');
    expect(lead()).toBeCloseTo(SHADOW_LEAD * 15, 0);
    env.setLook({ sunAzimuth: 250 });
    expect(lead()).toBeCloseTo(SHADOW_LEAD * 15, 0);
  });

  it('does not change the camera fill', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const player = new THREE.Vector3();
    const { camera } = followCamera(player, 0);
    env.update(0, player, camera);
    const dir = env.fill.position.clone().sub(env.fill.target.position).normalize();
    expect(dir.z).toBeLessThan(-0.6); // the camera is behind the player (-z) and the fill shines from there
    expect(env.fill.target.position.distanceTo(player)).toBeLessThan(1e-9);
  });
});

describe('the shadow edge softness', () => {
  const radiusOf = (tier: 'high' | 'medium' | 'low'): number => createEnvironment(new THREE.Scene(), { quality: tier }).sun.shadow.radius;

  it('is softer on the high tier than on the medium tier, and in range on every tier', () => {
    expect(radiusOf('high')).toBeGreaterThan(radiusOf('medium'));
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(radiusOf(tier), tier).toBe(SHADOW_RADIUS[tier]);
      expect(radiusOf(tier), tier).toBeGreaterThanOrEqual(1.5);
      expect(radiusOf(tier), tier).toBeLessThanOrEqual(2.5);
    }
  });

  it('comes out about the same width in the world on every tier (a little over 0.05 units)', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const { shadowDistance, shadowMapSize } = QUALITY_SETTINGS[tier];
      const world = (SHADOW_RADIUS[tier] * shadowDistance) / shadowMapSize;
      expect(world, tier).toBeGreaterThan(0.04);
      expect(world, tier).toBeLessThan(0.06);
    }
  });

  it('follows the tier when it changes, and keeps the acne-free bias on all of them', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    for (const tier of ['medium', 'low', 'high'] as const) {
      env.setQuality(tier);
      expect(env.sun.shadow.radius, tier).toBe(SHADOW_RADIUS[tier]);
      expect(env.sun.shadow.bias, tier).toBe(-0.0002);
      expect(env.sun.shadow.normalBias, tier).toBe(0.04);
    }
  });
});

describe('the shadow edge fade', () => {
  const chunkText = (name: string): string => readFileSync(resolve(__dirname, '../../node_modules/three/src/renderers/shaders/ShaderChunk', `${name}.glsl.js`), 'utf8');
  const threeChunks = (): Record<string, string> => ({
    shadowmap_pars_fragment: chunkText('shadowmap_pars_fragment'),
    lights_fragment_begin: chunkText('lights_fragment_begin'),
    shadowmask_pars_fragment: chunkText('shadowmask_pars_fragment'),
  });

  it('asks for the fade only on the sun: its shadow intensity is 1 plus the fade width', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    expect(env.sun.shadow.intensity).toBeCloseTo(1 + SHADOW_EDGE_FADE, 9);
    expect(new THREE.DirectionalLight().shadow.intensity).toBe(1); // any other light keeps its hard edge
    expect(SHADOW_EDGE_FADE).toBeGreaterThan(0.05);
    expect(SHADOW_EDGE_FADE).toBeLessThan(0.3);
    env.setQuality('low');
    expect(env.sun.shadow.intensity).toBeCloseTo(1 + SHADOW_EDGE_FADE, 9); // a tier change does not lose it
  });

  it('patches Three r186 shadow chunks: the call passes through the fade, and the function is defined once', () => {
    const chunks = threeChunks();
    expect(installShadowEdgeFade(chunks)).toBe(true);
    expect(chunks.lights_fragment_begin).toContain('shadowEdgeIntensity( directionalLightShadow.shadowIntensity, vDirectionalShadowCoord[ i ] ), directionalLightShadow.shadowBias');
    expect(chunks.shadowmask_pars_fragment).toContain('shadowEdgeIntensity( directionalLight.shadowIntensity, vDirectionalShadowCoord[ i ] ), directionalLight.shadowBias');
    const defs = chunks.shadowmap_pars_fragment.match(/float shadowEdgeIntensity\(/g) ?? [];
    expect(defs).toHaveLength(1);
    // The function sits with the directional light's shadow uniforms, before getShadow.
    const fn = chunks.shadowmap_pars_fragment.indexOf('float shadowEdgeIntensity(');
    const uniformsAt = chunks.shadowmap_pars_fragment.indexOf('uniform DirectionalLightShadow directionalLightShadows');
    expect(uniformsAt).toBeGreaterThan(-1);
    expect(fn).toBeGreaterThan(uniformsAt);
    expect(fn).toBeLessThan(chunks.shadowmap_pars_fragment.indexOf('float getShadow('));
    // No other light's lookup is touched.
    expect(chunks.lights_fragment_begin).toContain('spotLightShadow.shadowIntensity, spotLightShadow.shadowBias');
    expect(chunks.lights_fragment_begin).toContain('pointLightShadow.shadowIntensity, pointLightShadow.shadowBias');
  });

  it('is safe to run twice, and leaves the chunks alone when Three has changed their text', () => {
    const chunks = threeChunks();
    expect(installShadowEdgeFade(chunks)).toBe(true);
    const once = { ...chunks };
    expect(installShadowEdgeFade(chunks)).toBe(true);
    expect(chunks).toEqual(once);

    const moved = { ...threeChunks(), lights_fragment_begin: 'void main() {}' };
    const copy = { ...moved };
    expect(installShadowEdgeFade(moved)).toBe(false);
    expect(moved).toEqual(copy);
    expect(installShadowEdgeFade({})).toBe(false);
  });

  it('is installed into Three itself by createEnvironment, ahead of the lights in the lit shaders', () => {
    createEnvironment(new THREE.Scene(), { quality: 'high' });
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('shadowEdgeIntensity(');
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toContain('float shadowEdgeIntensity(');
    for (const shader of [THREE.ShaderLib.lambert.fragmentShader, THREE.ShaderLib.standard.fragmentShader, THREE.ShaderLib.phong.fragmentShader]) {
      const parsAt = shader.indexOf('#include <shadowmap_pars_fragment>');
      const useAt = shader.indexOf('#include <lights_fragment_begin>');
      expect(parsAt).toBeGreaterThan(-1);
      expect(useAt).toBeGreaterThan(parsAt); // defined before it is used
    }
  });

  it('is 1 inside the box, eases to 0 at the edge, and is the same on every side (the shader formula, in TypeScript)', () => {
    const intensity = 1 + SHADOW_EDGE_FADE;
    expect(shadowEdgeIntensity(intensity, 0.5, 0.5)).toBe(1);
    expect(shadowEdgeIntensity(intensity, SHADOW_EDGE_FADE, 0.5)).toBeCloseTo(1, 9); // the fade is done by one fade width in
    expect(shadowEdgeIntensity(intensity, 0.5, 1 - SHADOW_EDGE_FADE)).toBeCloseTo(1, 9);
    expect(shadowEdgeIntensity(intensity, 0, 0.5)).toBe(0);
    expect(shadowEdgeIntensity(intensity, 0.5, 1)).toBe(0);
    expect(shadowEdgeIntensity(intensity, -0.2, 0.5)).toBe(0); // outside the box
    expect(shadowEdgeIntensity(intensity, SHADOW_EDGE_FADE / 2, 0.5)).toBeCloseTo(0.5, 9); // smoothstep: half way is half
    // Mirror images and swapped axes agree.
    for (const e of [0.01, 0.05, 0.1, 0.15]) {
      const v = shadowEdgeIntensity(intensity, e, 0.4);
      expect(shadowEdgeIntensity(intensity, 1 - e, 0.4)).toBeCloseTo(v, 12);
      expect(shadowEdgeIntensity(intensity, 0.4, e)).toBeCloseTo(v, 12);
      expect(shadowEdgeIntensity(intensity, 0.4, 1 - e)).toBeCloseTo(v, 12);
    }
    // Rising smoothly from the edge in, never dipping.
    let last = 0;
    for (let u = 0; u <= 0.5; u += 0.005) {
      const v = shadowEdgeIntensity(intensity, u, 0.5);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      last = v;
    }
    // The corner is no weaker than an edge: the nearer edge sets the fade.
    expect(shadowEdgeIntensity(intensity, 0.05, 0.05)).toBeCloseTo(shadowEdgeIntensity(intensity, 0.05, 0.5), 12);
  });

  it('leaves any other light alone: an intensity of 1 or less passes straight through', () => {
    for (const intensity of [1, 0.7, 0.25, 0]) {
      for (const [u, v] of [
        [0, 0],
        [0.01, 0.5],
        [0.5, 0.5],
      ] as const) {
        expect(shadowEdgeIntensity(intensity, u, v)).toBe(intensity);
      }
    }
  });
});
