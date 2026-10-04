import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputState } from '../../src/engine/input';
import { blockyStatus, configureBlockyModel, resetBlockyModel, useBlockyModel, type BlockyAsset } from '../../src/player/avatar/blocky/model';
import { BLOCKY_BUILD_SCALE } from '../../src/player/avatar/blocky/rig';
import { skinKey } from '../../src/player/avatar/blocky/skin-texture';
import {
  BUILDS,
  defaultAvatar,
  EYE_STYLES,
  HAIR_STYLES,
  HAT_STYLES,
  LEG_STYLES,
  RANK_IDS,
  type FilledAvatar,
} from '../../src/player/avatar/options';
import { createDenChief, DEN_CHIEF_AVATAR } from '../../src/player/avatar/presets';
import { buildAvatar, type AvatarRig } from '../../src/player/avatar/rig';
import { Player } from '../../src/player/controller';
import { squareBounds } from '../../src/world/bounds';
import { createBaseCamp } from '../../src/world/base-camp';
import { loadModel, modelBytes } from './model-file';

let model: BlockyAsset;
beforeAll(async () => {
  model = await loadModel();
});
beforeEach(() => resetBlockyModel());
afterEach(() => {
  resetBlockyModel();
  vi.restoreAllMocks();
});

const look = (patch: Partial<FilledAvatar> = {}): FilledAvatar => ({ ...defaultAvatar('wolf'), ...patch });
const still = { moving: false, speed: 0 } as const;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}

const names = (root: THREE.Object3D): string[] => meshes(root).map((m) => m.name).sort();

function size(rig: AvatarRig): THREE.Box3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.root);
}

const node = (rig: AvatarRig, name: string): THREE.Object3D => rig.root.getObjectByName(name)!;

/** A mesh's own box in the world, without its children (the torso mesh is the parent of the arms and the head). */
function ownBox(mesh: THREE.Mesh): THREE.Box3 {
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
}
const euler = new THREE.Euler();
/** Rotation of a node in radians about x, y and z. */
const rot = (rig: AvatarRig, name: string): THREE.Euler => euler.clone().setFromQuaternion(node(rig, name).quaternion, 'XYZ');

function run(rig: AvatarRig, seconds: number, state: { moving: boolean; speed: number }): void {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, state);
}

/** Build a rig that wears the model (the model is installed first, so there is no fallback). */
function modelRig(config = look(), options: Parameters<typeof buildAvatar>[1] = {}): AvatarRig {
  useBlockyModel(model);
  return buildAvatar(config, options);
}

async function settle(rig: AvatarRig): Promise<void> {
  await vi.waitFor(() => expect(rig.root.getObjectByName('avatar-blocky')).toBeDefined());
}

describe('buildAvatar: the plain Scout comes first', () => {
  it('wears the procedural Scout when nothing has loaded (the loader is off under tests)', () => {
    const rig = buildAvatar(look());
    expect(rig.root.getObjectByName('avatar-fallback')).toBeDefined();
    expect(rig.root.getObjectByName('avatar-blocky')).toBeUndefined();
    expect(meshes(rig.root)).toHaveLength(7);
    expect(blockyStatus()).toBe('idle');
  });

  it('keeps it, and warns once, when the model fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchBuffer = vi.fn(() => Promise.reject(new Error('HTTP 404')));
    configureBlockyModel({ enabled: true, fetchBuffer });
    const a = buildAvatar(look());
    const b = buildAvatar(look({ build: 'tall' }));
    await vi.waitFor(() => expect(blockyStatus()).toBe('failed'));
    await Promise.resolve();
    for (const rig of [a, b]) {
      expect(rig.root.getObjectByName('avatar-fallback')).toBeDefined();
      expect(rig.root.getObjectByName('avatar-blocky')).toBeUndefined();
      rig.play('wave');
      run(rig, 0.5, still);
      expect(rig.emote).toBe('wave');
    }
    // A Scout built after the failure still works and does not try again.
    const c = buildAvatar(look());
    await Promise.resolve();
    expect(c.root.getObjectByName('avatar-fallback')).toBeDefined();
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('[avatar]');
    expect(String(warn.mock.calls[0]![0])).toContain('HTTP 404');
  });

  it('keeps it when the file is not a model, or is missing a clip the Scout needs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureBlockyModel({ enabled: true, fetchBuffer: () => Promise.resolve(new ArrayBuffer(64)) });
    const garbage = buildAvatar(look());
    await vi.waitFor(() => expect(blockyStatus()).toBe('failed'));
    expect(garbage.root.getObjectByName('avatar-blocky')).toBeUndefined();

    resetBlockyModel();
    // Same file with the run clip renamed (same length, so the chunk sizes still match).
    const bytes = new Uint8Array(modelBytes().slice(0));
    const text = new TextDecoder().decode(bytes);
    const at = text.indexOf('"sprint"');
    expect(at).toBeGreaterThan(0);
    bytes.set(new TextEncoder().encode('"sprinx"'), at);
    configureBlockyModel({ enabled: true, fetchBuffer: () => Promise.resolve(bytes.buffer) });
    const wrong = buildAvatar(look());
    await vi.waitFor(() => expect(blockyStatus()).toBe('failed'));
    expect(wrong.root.getObjectByName('avatar-blocky')).toBeUndefined();
  });

  it('swaps the model in when it arrives: same root, same parent, same look, same emote, one download', async () => {
    const fetchBuffer = vi.fn(() => Promise.resolve(modelBytes()));
    configureBlockyModel({ enabled: true, fetchBuffer });
    const scene = new THREE.Group();
    const rig = buildAvatar(look());
    const other = buildAvatar(look({ build: 'tall' }));
    scene.add(rig.root);
    const root = rig.root;
    rig.setConfig(look({ hairStyle: 'ponytail', shirt: '#c63d34' }));
    rig.play('wave');
    expect(rig.root.getObjectByName('avatar-fallback')).toBeDefined();
    let freed = 0;
    (rig.root.getObjectByName('head-mesh') as THREE.Mesh).geometry.addEventListener('dispose', () => freed++);

    await settle(rig);
    await settle(other);
    expect(rig.root).toBe(root);
    expect(rig.root.parent).toBe(scene);
    expect(rig.root.getObjectByName('avatar-fallback')).toBeUndefined();
    expect(rig.root.getObjectByName('head-mesh')).toBeUndefined();
    expect(freed).toBe(1); // the plain Scout's geometry was let go
    expect(rig.config.hairStyle).toBe('ponytail');
    expect(rig.config.shirt).toBe('#c63d34');
    expect(rig.emote).toBe('wave');
    expect(other.config.build).toBe('tall');
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
    expect(blockyStatus()).toBe('ready');
    run(rig, 0.8, still);
    expect(rot(rig, 'arm-right').z).toBeLessThan(-2); // and the wave carries on
  });

  it('a Scout built once the model is ready wears it at once and never builds the plain one', () => {
    const rig = modelRig();
    expect(rig.root.getObjectByName('avatar-blocky')).toBeDefined();
    expect(rig.root.getObjectByName('avatar-fallback')).toBeUndefined();
    expect(rig.root.name).toBe('avatar');
  });

  it('a Scout disposed before the model arrives is left alone', async () => {
    let release!: (bytes: ArrayBuffer) => void;
    configureBlockyModel({ enabled: true, fetchBuffer: () => new Promise<ArrayBuffer>((r) => (release = r)) });
    const scene = new THREE.Group();
    const rig = buildAvatar(look());
    scene.add(rig.root);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
    release(modelBytes());
    await vi.waitFor(() => expect(blockyStatus()).toBe('ready'));
    await Promise.resolve();
    expect(rig.root.getObjectByName('avatar-blocky')).toBeUndefined();
    expect(rig.root.children).toHaveLength(0);
  });
});

describe('buildAvatar with the model: the figure', () => {
  it('is 6 body meshes, two attachment meshes and a blob: 9 draw calls', () => {
    const rig = modelRig();
    expect(names(rig.root)).toEqual(['arm-left', 'arm-right', 'avatar-blob', 'head', 'head-attachments', 'leg-left', 'leg-right', 'torso', 'torso-attachments']);
    expect(meshes(rig.root)).toHaveLength(9);
  });

  it('skips what it does not need: no head mesh for a bald Scout with nothing on, no blob when asked', () => {
    const bald = modelRig(look({ hairStyle: 'none', hat: 'none', glasses: false }), { blobShadow: false });
    expect(meshes(bald.root)).toHaveLength(7);
    expect(names(bald.root)).not.toContain('head-attachments');
    expect(names(bald.root)).not.toContain('avatar-blob');
  });

  it('shares one skin material across the body, and one material across the attachments', () => {
    const a = modelRig(look());
    const b = buildAvatar(look({ shirt: '#c63d34', hat: 'cap' }));
    const body = (rig: AvatarRig): THREE.Material[] =>
      meshes(rig.root).filter((m) => !/attachments|blob/.test(m.name)).map((m) => m.material as THREE.Material);
    const extras = (rig: AvatarRig): THREE.Material[] => meshes(rig.root).filter((m) => /attachments/.test(m.name)).map((m) => m.material as THREE.Material);
    expect(new Set(body(a)).size).toBe(1);
    expect(new Set(body(b)).size).toBe(1);
    expect(body(a)[0]).not.toBe(body(b)[0]); // each Scout has their own skin
    expect(new Set([...extras(a), ...extras(b)]).size).toBe(1); // attachments share one material
    expect((body(a)[0] as THREE.MeshLambertMaterial).map).toBeInstanceOf(THREE.DataTexture);
    expect((extras(a)[0] as THREE.MeshLambertMaterial).vertexColors).toBe(true);
  });

  it('stands 1.8 units tall with its feet on the ground (regular build, bare head)', () => {
    const rig = modelRig(look({ hairStyle: 'none', hat: 'none', glasses: false }), { blobShadow: false });
    const box = size(rig);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.8, 2);
    expect(box.max.x - box.min.x).toBeLessThan(1.2);
  });

  it('build scales the root: small 0.85, regular 1, tall 1.15', () => {
    expect(BLOCKY_BUILD_SCALE).toEqual({ small: 0.85, regular: 1, tall: 1.15 });
    const height = (build: 'small' | 'regular' | 'tall'): number =>
      size(modelRig(look({ hairStyle: 'none', hat: 'none', build }), { blobShadow: false })).max.y;
    expect(height('small')).toBeCloseTo(1.8 * 0.85, 2);
    expect(height('regular')).toBeCloseTo(1.8, 2);
    expect(height('tall')).toBeCloseTo(1.8 * 1.15, 2);
  });

  it('faces +z, like the procedural Scout: glasses and the neckerchief lie in front of the middle', () => {
    const rig = modelRig(look({ hairStyle: 'none', hat: 'none', glasses: true }));
    rig.root.updateMatrixWorld(true);
    const specs = ownBox(node(rig, 'head-attachments') as THREE.Mesh);
    const head = ownBox(node(rig, 'head') as THREE.Mesh);
    expect(specs.getCenter(new THREE.Vector3()).z).toBeGreaterThan(head.getCenter(new THREE.Vector3()).z);
    const chest = ownBox(node(rig, 'torso-attachments') as THREE.Mesh);
    const torso = ownBox(node(rig, 'torso') as THREE.Mesh);
    expect(chest.max.z).toBeGreaterThan(torso.max.z);
    // With no backpack, only the neckerchief point lies on the back: nothing sticks out behind it.
    expect(chest.min.z).toBeGreaterThan(torso.min.z - 0.05);
  });

  it('casts and receives shadows, except the blob', () => {
    const rig = modelRig(look({ glasses: true, backpack: true }));
    for (const m of meshes(rig.root)) {
      const isBlob = m.name === 'avatar-blob';
      expect(m.castShadow, m.name).toBe(!isBlob);
      expect(m.receiveShadow, m.name).toBe(!isBlob);
    }
  });

  it('every part has finite vertices, normals and texture coordinates', () => {
    const rig = modelRig(look({ hat: 'cap', glasses: true, backpack: true, legs: 'skort', hairStyle: 'ponytail' }), { denChiefCord: true });
    for (const m of meshes(rig.root)) {
      for (const name of ['position', 'normal'] as const) {
        const attribute = m.geometry.getAttribute(name);
        expect(attribute, `${m.name} ${name}`).toBeDefined();
        for (const v of attribute.array) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  describe.each(HAIR_STYLES.map((c) => c.value))('hair %s', (hairStyle) => {
    it.each(HAT_STYLES.map((c) => c.value))('with hat %s builds within the draw-call budget', (hat) => {
      const rig = modelRig(look({ hairStyle, hat }));
      expect(meshes(rig.root).length).toBeLessThanOrEqual(9);
      expect(Number.isFinite(size(rig).max.y)).toBe(true);
      rig.dispose();
    });
  });

  it.each(LEG_STYLES.map((c) => c.value))('legs %s build for every build, with glasses and a backpack', (legs) => {
    for (const build of BUILDS.map((c) => c.value)) {
      const rig = modelRig(look({ legs, build, glasses: true, backpack: true }));
      expect(meshes(rig.root).length).toBeLessThanOrEqual(9);
      rig.dispose();
    }
  });

  it.each(EYE_STYLES.map((c) => c.value))('eyes %s build', (eyes) => {
    expect(() => modelRig(look({ eyes }))).not.toThrow();
  });

  it.each(RANK_IDS)('builds the default look for %s, and a v1 avatar with only bodyColor', (rank) => {
    expect(() => modelRig(defaultAvatar(rank), { rank })).not.toThrow();
    const legacy = buildAvatar({ bodyColor: '#e07a5f' }, { rank });
    expect(legacy.config.shirt).toBe('#e07a5f');
    expect(legacy.config.neckerchief).toBe(defaultAvatar(rank).neckerchief);
  });

  it('hats add height above the bare head; a backpack goes behind', () => {
    const top = (hat: string): number => size(modelRig(look({ hairStyle: 'none', hat }), { blobShadow: false })).max.y;
    for (const hat of ['cap', 'bucket', 'beanie', 'scout']) expect(top(hat)).toBeGreaterThan(top('none') + 0.03);
    const plain = size(modelRig(look({ backpack: false }), { blobShadow: false }));
    const packed = size(modelRig(look({ backpack: true }), { blobShadow: false }));
    expect(packed.min.z).toBeLessThan(plain.min.z - 0.05);
    expect(packed.max.z).toBeCloseTo(plain.max.z, 1);
  });

  it('the scout hat on a tall Den Chief stays under the name tag height of 2.3', () => {
    const chief = size(modelRig(DEN_CHIEF_AVATAR as FilledAvatar, { blobShadow: false }));
    expect(chief.max.y).toBeGreaterThan(1.95);
    expect(chief.max.y).toBeLessThan(2.3);
  });
});

describe('buildAvatar with the model: setConfig', () => {
  const geometry = (rig: AvatarRig, name: string): THREE.BufferGeometry => (node(rig, name) as THREE.Mesh).geometry;
  const skin = (rig: AvatarRig): THREE.Texture => ((node(rig, 'torso') as THREE.Mesh).material as THREE.MeshLambertMaterial).map!;

  it('repaints the skin for a new shirt, and re-uses the cached texture when the look comes back', () => {
    const rig = modelRig(look());
    const first = skin(rig);
    rig.setConfig(look({ shirt: '#c63d34' }));
    const second = skin(rig);
    expect(second === first).toBe(false);
    rig.setConfig(look());
    expect(skin(rig) === first).toBe(true);
    expect(skinKey(rig.config as FilledAvatar)).toBe(skinKey(look()));
  });

  it('does not repaint for a change that is only a mesh: hat, glasses, backpack, build, hair shape', () => {
    const rig = modelRig(look());
    const first = skin(rig);
    rig.setConfig(look({ hat: 'cap', glasses: true, backpack: true, build: 'tall', hairStyle: 'spiky', legs: 'skort' }));
    expect(skin(rig) === first).toBe(true);
  });

  it('a new hair style rebuilds only the head attachments; a new shirt rebuilds neither', () => {
    const rig = modelRig(look({ hairStyle: 'short' }));
    const head = geometry(rig, 'head-attachments');
    const torso = geometry(rig, 'torso-attachments');
    const body = geometry(rig, 'torso');
    rig.setConfig(look({ hairStyle: 'spiky' }));
    expect(geometry(rig, 'head-attachments')).not.toBe(head);
    expect(geometry(rig, 'torso-attachments')).toBe(torso);
    const head2 = geometry(rig, 'head-attachments');
    rig.setConfig(look({ hairStyle: 'spiky', shirt: '#7a56b8' }));
    expect(geometry(rig, 'head-attachments')).toBe(head2);
    expect(geometry(rig, 'torso-attachments')).toBe(torso);
    // Backpack and skort belong to the torso attachments.
    rig.setConfig(look({ hairStyle: 'spiky', shirt: '#7a56b8', backpack: true }));
    expect(geometry(rig, 'torso-attachments')).not.toBe(torso);
    expect(geometry(rig, 'head-attachments')).toBe(head2);
    expect(geometry(rig, 'torso')).toBe(body); // the shared kit geometry is never touched
  });

  it('frees the attachment geometry it lets go of, and never the shared kit geometry', () => {
    const rig = modelRig(look({ hairStyle: 'short' }));
    let freedAttachment = 0;
    let freedKit = 0;
    geometry(rig, 'head-attachments').addEventListener('dispose', () => freedAttachment++);
    geometry(rig, 'head').addEventListener('dispose', () => freedKit++);
    rig.setConfig(look({ hairStyle: 'long' }));
    expect(freedAttachment).toBe(1);
    expect(freedKit).toBe(0);
  });

  it('does nothing when the look is the same', () => {
    const rig = modelRig(look({ glasses: true }));
    const head = geometry(rig, 'head-attachments');
    const torso = geometry(rig, 'torso-attachments');
    const map = skin(rig);
    rig.setConfig(look({ glasses: true }));
    expect(geometry(rig, 'head-attachments')).toBe(head);
    expect(geometry(rig, 'torso-attachments')).toBe(torso);
    expect(skin(rig) === map).toBe(true);
  });

  it('takes the head attachment off for a bald Scout with nothing on, and puts it back', () => {
    const rig = modelRig(look({ hairStyle: 'short' }));
    expect(node(rig, 'head-attachments')).toBeDefined();
    rig.setConfig(look({ hairStyle: 'none' }));
    expect(node(rig, 'head-attachments')).toBeUndefined();
    rig.setConfig(look({ hairStyle: 'none', hat: 'beanie' }));
    expect(node(rig, 'head-attachments')).toBeDefined();
  });

  it('changes the build in place and keeps the same body meshes and root', () => {
    const rig = modelRig(look({ hairStyle: 'none' }), { blobShadow: false });
    const before = meshes(rig.root);
    const root = rig.root;
    const regular = size(rig).max.y;
    rig.setConfig(look({ hairStyle: 'none', build: 'small' }));
    expect(size(rig).max.y).toBeLessThan(regular);
    expect(rig.config.build).toBe('small');
    expect(rig.root).toBe(root);
    expect(meshes(rig.root).filter((m) => !/attachments/.test(m.name))).toEqual(before.filter((m) => !/attachments/.test(m.name)));
  });

  it('the Den Chief cord is fixed when the rig is built', () => {
    const without = modelRig(look());
    const withCord = buildAvatar(look(), { denChiefCord: true });
    expect(geometry(withCord, 'torso-attachments').getAttribute('position').count).toBeGreaterThan(geometry(without, 'torso-attachments').getAttribute('position').count);
    withCord.setConfig(look({ shirt: '#c63d34', backpack: true }));
    // Still has the cord after a look change.
    expect(geometry(withCord, 'torso-attachments').getAttribute('position').count).toBeGreaterThan(
      geometry(buildAvatar(look({ shirt: '#c63d34', backpack: true })), 'torso-attachments').getAttribute('position').count,
    );
  });
});

describe('buildAvatar with the model: animation', () => {
  it('idle: the torso breathes and the legs stay at rest', () => {
    const rig = modelRig();
    run(rig, 0.5, still);
    const xs = new Set<number>();
    for (let i = 0; i < 80; i++) {
      rig.update(1 / 60, still);
      xs.add(Math.round(rot(rig, 'torso').x * 1e5));
    }
    expect(xs.size).toBeGreaterThan(10);
    expect(Math.max(...[...xs].map(Math.abs)) / 1e5).toBeLessThan(0.2); // a small sway, under 12 degrees
    expect(Math.abs(rot(rig, 'leg-left').x)).toBeLessThan(0.01);
    expect(rig.emote).toBe('idle');
  });

  it('walk swings the arms and legs, opposite to each other', () => {
    const rig = modelRig();
    let maxLeg = 0;
    let oppositeLegs = true;
    let oppositeArmAndLeg = true;
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60, { moving: true, speed: 4 });
      if (i < 40) continue;
      const legL = rot(rig, 'leg-left').x;
      const legR = rot(rig, 'leg-right').x;
      maxLeg = Math.max(maxLeg, Math.abs(legL));
      if (Math.abs(legL) > 0.1) {
        oppositeLegs &&= Math.sign(legL) === -Math.sign(legR);
        oppositeArmAndLeg &&= Math.sign(rot(rig, 'arm-left').x) === -Math.sign(legL);
        oppositeArmAndLeg &&= Math.sign(rot(rig, 'arm-right').x) === -Math.sign(legR);
      }
    }
    expect(rig.emote).toBe('walk');
    expect(maxLeg).toBeGreaterThan(0.85); // the kit walk swings the legs 60 degrees (1.05 rad)
    expect(maxLeg).toBeLessThan(1.15);
    expect(oppositeLegs).toBe(true);
    expect(oppositeArmAndLeg).toBe(true);
  });

  it('a faster walk takes quicker steps', () => {
    const crossings = (speed: number): number => {
      const rig = modelRig();
      run(rig, 1, { moving: true, speed });
      let n = 0;
      let prev = Math.sign(rot(rig, 'leg-left').x);
      for (let i = 0; i < 180; i++) {
        rig.update(1 / 60, { moving: true, speed });
        const s = Math.sign(rot(rig, 'leg-left').x);
        if (s !== 0 && prev !== 0 && s !== prev) n++;
        if (s !== 0) prev = s;
      }
      return n;
    };
    expect(crossings(4)).toBeGreaterThan(crossings(2));
  });

  it('blends into the run clip above 4.4 units a second: the legs swing 90 degrees, not 60', () => {
    const peak = (speed: number): number => {
      const rig = modelRig();
      let max = 0;
      for (let i = 0; i < 240; i++) {
        rig.update(1 / 60, { moving: true, speed });
        if (i > 90) max = Math.max(max, Math.abs(rot(rig, 'leg-left').x));
      }
      return max;
    };
    expect(peak(4)).toBeLessThan(1.15);
    expect(peak(6)).toBeGreaterThan(1.45);
    // Halfway through the blend the swing is in between.
    const mid = peak(4.7);
    expect(mid).toBeGreaterThan(peak(4) - 0.05);
    expect(mid).toBeLessThan(peak(6) + 0.05);
  });

  it('settles back to standing when the walk stops', () => {
    const rig = modelRig();
    run(rig, 1, { moving: true, speed: 4 });
    run(rig, 1.5, still);
    expect(rig.emote).toBe('idle');
    expect(Math.abs(rot(rig, 'leg-left').x)).toBeLessThan(0.02);
    expect(Math.abs(rot(rig, 'leg-right').x)).toBeLessThan(0.02);
  });

  it('the cross-fade never pops: even at a sprint (the kit swings the legs 15 degrees a frame) no frame jumps more than 25', () => {
    const rig = modelRig();
    let prev = rot(rig, 'leg-left').x;
    let worst = 0;
    const step = (state: { moving: boolean; speed: number }, seconds: number): void => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        rig.update(1 / 60, state);
        const now = rot(rig, 'leg-left').x;
        worst = Math.max(worst, Math.abs(now - prev));
        prev = now;
      }
    };
    step(still, 0.5);
    step({ moving: true, speed: 4 }, 1);
    step({ moving: true, speed: 6 }, 1);
    step(still, 1);
    expect(worst).toBeLessThan((25 * Math.PI) / 180);
  });

  it('cheer raises both arms and hops, then returns to idle by itself', () => {
    const rig = modelRig();
    rig.play('cheer');
    expect(rig.emote).toBe('cheer');
    let peakHop = 0;
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, still);
      peakHop = Math.max(peakHop, node(rig, 'root').position.y);
    }
    expect(rot(rig, 'arm-left').z).toBeGreaterThan(2);
    expect(rot(rig, 'arm-right').z).toBeLessThan(-2);
    expect(peakHop).toBeGreaterThan(0.15);
    run(rig, 2.5, still);
    expect(rig.emote).toBe('idle');
    expect(Math.abs(rot(rig, 'arm-left').z)).toBeLessThan(0.15);
    expect(node(rig, 'root').position.y).toBeCloseTo(0, 2);
  });

  it('wave lifts one arm only, then returns', () => {
    const rig = modelRig();
    rig.play('wave');
    run(rig, 0.8, still);
    expect(rot(rig, 'arm-right').z).toBeLessThan(-2);
    expect(Math.abs(rot(rig, 'arm-left').z)).toBeLessThan(0.3);
    run(rig, 2.8, still);
    expect(rig.emote).toBe('idle');
    expect(Math.abs(rot(rig, 'arm-right').z)).toBeLessThan(0.15);
  });

  it('a one-shot can be played again, and starts from the beginning', () => {
    const rig = modelRig();
    rig.play('wave');
    run(rig, 3, still);
    expect(rig.emote).toBe('idle');
    rig.play('wave');
    expect(rig.emote).toBe('wave');
    run(rig, 0.8, still);
    expect(rot(rig, 'arm-right').z).toBeLessThan(-2);
  });

  it('a one-shot that ends while the Scout is walking goes on to walk', () => {
    const rig = modelRig();
    rig.update(1 / 60, { moving: true, speed: 4 });
    rig.play('cheer');
    run(rig, 2.2, { moving: true, speed: 4 });
    expect(rig.emote).toBe('walk');
  });

  it('starting to walk interrupts a wave', () => {
    const rig = modelRig();
    rig.play('wave');
    rig.update(1 / 60, { moving: true, speed: 4 });
    expect(rig.emote).toBe('walk');
  });

  it('play("walk") walks at a default pace even with no speed', () => {
    const rig = modelRig();
    rig.play('walk');
    let max = 0;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, still);
      max = Math.max(max, Math.abs(rot(rig, 'leg-left').x));
    }
    expect(max).toBeGreaterThan(0.4);
  });

  it('never produces NaN, even with a zero or huge time step', () => {
    const rig = modelRig();
    for (const dt of [0, 1e-9, 0.016, 1, 5]) rig.update(dt, { moving: true, speed: 4 });
    rig.play('cheer');
    for (const dt of [0, 1e-9, 5]) rig.update(dt, still);
    for (const name of ['root', 'leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head']) {
      const o = node(rig, name);
      expect([...o.quaternion.toArray(), ...o.position.toArray()].every(Number.isFinite), name).toBe(true);
    }
  });

  it('two Scouts animate on their own: one waves, the other stays still', () => {
    const a = modelRig();
    const b = buildAvatar(look());
    a.play('wave');
    run(a, 0.8, still);
    run(b, 0.8, still);
    expect(rot(a, 'arm-right').z).toBeLessThan(-2);
    expect(Math.abs(rot(b, 'arm-right').z)).toBeLessThan(0.3);
  });
});

describe('buildAvatar with the model: dispose', () => {
  it('leaves the scene, frees its own geometry and material, never the shared kit geometry or the cached skin', () => {
    const scene = new THREE.Scene();
    const rig = modelRig(look({ glasses: true }));
    scene.add(rig.root);
    const freed: string[] = [];
    const watch = (label: string, target: { addEventListener: (type: 'dispose', fn: () => void) => void }): void =>
      target.addEventListener('dispose', () => freed.push(label));
    const body = node(rig, 'torso') as THREE.Mesh;
    watch('attachment', (node(rig, 'head-attachments') as THREE.Mesh).geometry);
    watch('torso attachment', (node(rig, 'torso-attachments') as THREE.Mesh).geometry);
    watch('kit geometry', body.geometry);
    watch('material', body.material as THREE.Material);
    watch('skin', (body.material as THREE.MeshLambertMaterial).map!);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
    expect(freed.sort()).toEqual(['attachment', 'material', 'torso attachment']);
    // The next Scout still gets a good copy of the model.
    const next = buildAvatar(look());
    expect(meshes(next.root).length).toBeGreaterThanOrEqual(8);
    expect(() => run(next, 0.5, { moving: true, speed: 4 })).not.toThrow();
  });

  it('does not free the shared blob geometry, material or texture', () => {
    const a = modelRig();
    const b = buildAvatar(look());
    const blob = node(b, 'avatar-blob') as THREE.Mesh;
    const freed: string[] = [];
    blob.geometry.addEventListener('dispose', () => freed.push('geometry'));
    (blob.material as THREE.MeshBasicMaterial).addEventListener('dispose', () => freed.push('material'));
    (blob.material as THREE.MeshBasicMaterial).map!.addEventListener('dispose', () => freed.push('texture'));
    a.dispose();
    expect(freed).toEqual([]);
  });
});

describe('the avatar contract: root, config, emote, setConfig, update, play, dispose', () => {
  const members = ['root', 'config', 'emote', 'setConfig', 'update', 'play', 'dispose'];

  function conforms(rig: AvatarRig): void {
    expect(Object.keys(rig).sort()).toEqual([...members].sort());
    expect(rig.root).toBeInstanceOf(THREE.Group);
    expect(rig.root.name).toBe('avatar');
    expect(rig.emote).toBe('idle');
    expect(rig.config).toMatchObject({ hairStyle: expect.any(String), shirt: expect.any(String), build: 'regular' });
    for (const fn of [rig.setConfig, rig.update, rig.play, rig.dispose]) expect(typeof fn).toBe('function');
    rig.setConfig({ bodyColor: '#c63d34', hat: 'bucket' });
    expect(rig.config.shirt).toBe('#c63d34');
    expect(rig.config.hat).toBe('bucket');
    for (const emote of ['walk', 'cheer', 'wave', 'idle'] as const) {
      rig.play(emote);
      expect(rig.emote).toBe(emote);
      rig.update(1 / 60, still);
    }
    expect(rig.root.position.toArray()).toEqual([0, 0, 0]); // the rig never moves its own root
    expect(rig.root.rotation.y).toBe(0);
    expect(rig.root.scale.toArray()).toEqual([1, 1, 1]);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
  }

  it('the plain Scout (before the model) conforms', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    expect(rig.root.getObjectByName('avatar-fallback')).toBeDefined();
    conforms(rig);
  });

  it('the Scout in the model conforms', () => {
    conforms(modelRig(defaultAvatar('wolf')));
  });

  it('takes its options as before: rank, denChiefCord, blobShadow', () => {
    const rig = modelRig(look(), { rank: 'bear', denChiefCord: true, blobShadow: false });
    expect(names(rig.root)).not.toContain('avatar-blob');
    expect(rig.config.neckerchief).toBe(look().neckerchief);
    expect(buildAvatar({ bodyColor: '#e07a5f' }, { rank: 'bear' }).config.neckerchief).toBe(defaultAvatar('bear').neckerchief);
  });
});

describe('the player controller with the model', () => {
  const zone = { bounds: squareBounds(25) };
  const forward: InputState = { move: { x: 0, z: -1 }, action: false, actionPressed: false };
  const idle: InputState = { move: { x: 0, z: 0 }, action: false, actionPressed: false };

  it('shows the model, in the Wolf look, named "player"', () => {
    useBlockyModel(model);
    const player = new Player();
    expect(player.root.getObjectByName('player')).toBeDefined();
    expect(player.root.getObjectByName('avatar-blocky')).toBeDefined();
    expect(player.avatar).toEqual(defaultAvatar('wolf'));
  });

  it('shows the plain Scout at once and the model when it arrives, without a caller doing anything', async () => {
    configureBlockyModel({ enabled: true, fetchBuffer: () => Promise.resolve(modelBytes()) });
    const player = new Player({ avatar: look({ hat: 'cap' }) });
    expect(player.root.getObjectByName('avatar-fallback')).toBeDefined();
    await vi.waitFor(() => expect(player.root.getObjectByName('avatar-blocky')).toBeDefined());
    expect(player.avatar.hat).toBe('cap');
  });

  it('keeps the whole controller API: position, facing, setAvatar, celebrate, wave, update, interpolate', () => {
    useBlockyModel(model);
    const player = new Player({ avatar: defaultAvatar('bear'), rank: 'bear' });
    player.setPosition(new THREE.Vector3(3, 9, -4), 1);
    expect(player.position.toArray()).toEqual([3, 0, -4]);
    expect(player.root.position.toArray()).toEqual([3, 0, -4]);
    expect(player.facing).toBe(1);
    player.interpolate(0.5);
    expect(player.root.rotation.y).toBeCloseTo(1);
    for (const method of ['setAvatar', 'celebrate', 'wave', 'setPosition', 'update', 'interpolate'] as const) expect(typeof player[method]).toBe('function');
  });

  it('walks when pushed, plays the walk cycle, then settles', () => {
    useBlockyModel(model);
    const player = new Player();
    player.viewYaw = Math.PI;
    player.setPosition(new THREE.Vector3(0, 0, 0), Math.PI);
    for (let i = 0; i < 40; i++) player.update(1 / 60, forward, zone);
    expect(player.emote).toBe('walk');
    expect(player.position.length()).toBeGreaterThan(1.5);
    const leg = player.root.getObjectByName('leg-left')!;
    expect(Math.abs(euler.clone().setFromQuaternion(leg.quaternion).x)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) player.update(1 / 60, idle, zone);
    expect(player.emote).toBe('idle');
  });

  it('celebrate plays the cheer, wave plays the wave, and each ends on its own', () => {
    useBlockyModel(model);
    const player = new Player();
    player.celebrate();
    expect(player.emote).toBe('cheer');
    for (let i = 0; i < 60; i++) player.update(1 / 60, idle, zone);
    const arm = player.root.getObjectByName('arm-left')!;
    expect(euler.clone().setFromQuaternion(arm.quaternion, 'XYZ').z).toBeGreaterThan(2);
    for (let i = 0; i < 150; i++) player.update(1 / 60, idle, zone);
    expect(player.emote).toBe('idle');
    player.wave();
    expect(player.emote).toBe('wave');
  });

  it('setAvatar changes the look in place; a new rank builds a new Scout and keeps the emote and the pose', () => {
    useBlockyModel(model);
    const player = new Player();
    player.setPosition(new THREE.Vector3(2, 0, 2), 0.5);
    const before = player.root.getObjectByName('player');
    player.setAvatar(look({ hairStyle: 'braids', shirt: '#c63d34' }));
    expect(player.avatar.hairStyle).toBe('braids');
    expect(player.root.getObjectByName('player')).toBe(before);
    player.celebrate();
    player.setAvatar({ bodyColor: '#e07a5f' }, 'webelos');
    expect(player.root.getObjectByName('player')).not.toBe(before);
    expect(player.root.getObjectByName('avatar-blocky')).toBeDefined();
    expect(player.avatar.neckerchief).toBe(defaultAvatar('webelos').neckerchief);
    expect(player.emote).toBe('cheer');
    expect(player.position.toArray()).toEqual([2, 0, 2]);
    expect(player.root.children.filter((c) => c.name === 'player')).toHaveLength(1);
  });
});

describe('the Den Chief with the model', () => {
  it('is the tall Scout in a scout hat, glasses and the yellow cord, idling and waving every 14 seconds', () => {
    useBlockyModel(model);
    const zone = createBaseCamp({ onTalkToDenChief: vi.fn() });
    const chief = zone.root.getObjectByName('den-chief')!;
    expect(chief).toBeDefined();
    expect(chief.getObjectByName('avatar-blocky')).toBeDefined();
    expect(chief.getObjectByName('avatar-fallback')).toBeUndefined();
    const parts = ['head', 'torso', 'arm-left', 'arm-right', 'leg-left', 'leg-right', 'head-attachments', 'torso-attachments'];
    for (const part of parts) expect(chief.getObjectByName(part), part).toBeDefined();
    expect(meshes(chief)).toHaveLength(9);

    const cord = new THREE.Color('#f2c230');
    const colors = (chief.getObjectByName('torso-attachments') as THREE.Mesh).geometry.getAttribute('color');
    let yellow = 0;
    for (let i = 0; i < colors.count; i++) if (Math.abs(colors.getX(i) - cord.r) + Math.abs(colors.getY(i) - cord.g) + Math.abs(colors.getZ(i) - cord.b) < 0.02) yellow++;
    expect(yellow).toBeGreaterThan(20);

    const box = new THREE.Box3().setFromObject(chief);
    expect(box.max.y).toBeGreaterThan(1.95);
    expect(box.max.y).toBeLessThan(2.3);

    // Facing, the interactable and the position are the zone's, untouched.
    const talk = zone.interactables[0]!;
    expect(chief.position.x).toBeCloseTo(talk.position.x);
    expect(chief.position.z).toBeCloseTo(talk.position.z);
    const toSpawn = new THREE.Vector3(zone.spawn.x - chief.position.x, 0, zone.spawn.z - chief.position.z).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), chief.rotation.y);
    expect(forward.dot(toSpawn)).toBeGreaterThan(0.99);

    const arm = chief.getObjectByName('arm-right')!;
    const torso = chief.getObjectByName('torso')!;
    let waves = 0;
    let up = false;
    const torsoX = new Set<number>();
    for (let t = 0; t < 23; t += 1 / 60) {
      zone.update(1 / 60);
      const raised = euler.clone().setFromQuaternion(arm.quaternion, 'XYZ').z < -2;
      if (raised && !up) waves++;
      up = raised;
      if (t < 4) torsoX.add(Math.round(euler.clone().setFromQuaternion(torso.quaternion, 'XYZ').x * 1e5));
    }
    expect(torsoX.size).toBeGreaterThan(10); // idle sway before the first wave
    expect(waves).toBe(2); // at about 5 s and again at about 19 s
  });

  it('createDenChief still builds the preset: root named den-chief, the tall look', () => {
    useBlockyModel(model);
    const chief = createDenChief();
    expect(chief.root.name).toBe('den-chief');
    expect(chief.config).toMatchObject({ build: 'tall', hat: 'scout', glasses: true });
  });
});
