import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cloudPixels, createEnvironment, setShadowCasting } from '../../src/engine/environment';

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
  it('adds one sun, one hemisphere light, the sky dome, and 6 to 10 clouds', () => {
    const scene = new THREE.Scene();
    createEnvironment(scene, { quality: 'high' });

    const lights = lightsIn(scene);
    expect(lights.filter((l) => (l as THREE.DirectionalLight).isDirectionalLight)).toHaveLength(1);
    expect(lights.filter((l) => (l as THREE.HemisphereLight).isHemisphereLight)).toHaveLength(1);
    expect(lights).toHaveLength(2);

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
    expect(sun.color.getHex()).toBe(0xfff1d6);
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

  it('does not take the sky out of the tone-mapped scene by accident: the dome ignores fog and depth', () => {
    const env = createEnvironment(new THREE.Scene(), { quality: 'high' });
    const mat = env.sky.material as THREE.ShaderMaterial;
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.toneMapped).toBe(false);
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
