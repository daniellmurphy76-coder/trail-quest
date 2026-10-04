import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cloudPixels, createEnvironment, desaturate, setShadowCasting, type Environment } from '../../src/engine/environment';
import { DEFAULT_LOOK, sunDirection } from '../../src/engine/look';

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
