import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDenChief, DEN_CHIEF_AVATAR } from '../../src/player/avatar/presets';
import {
  BUILDS,
  EYE_STYLES,
  HAIR_STYLES,
  HAT_STYLES,
  LEG_STYLES,
  RANK_IDS,
  defaultAvatar,
} from '../../src/player/avatar/options';
// The procedural Scout is the fallback while the Kenney model loads; these tests cover its internals.
// The composite `buildAvatar` and the model rig are covered in blocky-rig.test.ts.
import { buildProceduralAvatar as buildAvatar } from '../../src/player/avatar/procedural';
import type { AvatarRig } from '../../src/player/avatar/rig-types';

const DRAW_CALL_BUDGET = 30;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}

function triangles(root: THREE.Object3D): number {
  return meshes(root).reduce((sum, m) => sum + (m.geometry.getAttribute('position').count / 3), 0);
}

function box(rig: AvatarRig): THREE.Box3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.root);
}

const joint = (rig: AvatarRig, name: string): THREE.Object3D => rig.root.getObjectByName(name)!;

function run(rig: AvatarRig, seconds: number, state: { moving: boolean; speed: number }): void {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, state);
}

describe('procedural avatar rig: building', () => {
  it('builds with 7 draw calls: head, torso, two arms, two legs and a blob shadow', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const names = meshes(rig.root).map((m) => m.name).sort();
    expect(names).toEqual(['arm-l-mesh', 'arm-r-mesh', 'avatar-blob', 'head-mesh', 'leg-l-mesh', 'leg-r-mesh', 'torso-mesh']);
    expect(buildAvatar(defaultAvatar('wolf'), { blobShadow: false }).root.children[0]!.children.some((c) => c.name === 'avatar-blob')).toBe(false);
  });

  it('shares ONE material across the body parts, so a recolor never makes a material', () => {
    const a = buildAvatar(defaultAvatar('wolf'));
    const b = buildAvatar({ ...defaultAvatar('bear'), hairStyle: 'curly', hat: 'beanie' });
    const body = (rig: AvatarRig): THREE.Material[] => meshes(rig.root).filter((m) => m.name !== 'avatar-blob').map((m) => m.material as THREE.Material);
    expect(new Set([...body(a), ...body(b)]).size).toBe(1);
  });

  it('stands about 1.8 units tall with feet on the ground (regular build, no hat, no hair)', () => {
    const rig = buildAvatar({ ...defaultAvatar('wolf'), hairStyle: 'none', hat: 'none' }, { blobShadow: false });
    const size = box(rig);
    expect(size.min.y).toBeCloseTo(0, 2);
    expect(size.max.y).toBeCloseTo(1.8, 1);
    expect(size.max.x - size.min.x).toBeLessThan(1.2);
  });

  it('every part has finite vertices and normals (no NaN from the bevels)', () => {
    const rig = buildAvatar({ ...defaultAvatar('wolf'), hat: 'cap', glasses: true, backpack: true, legs: 'skort', hairStyle: 'ponytail' }, { denChiefCord: true });
    for (const m of meshes(rig.root)) {
      for (const name of ['position', 'normal'] as const) {
        const attribute = m.geometry.getAttribute(name);
        expect(attribute).toBeDefined();
        for (const v of attribute.array) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('casts and receives shadows, except the blob', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    for (const m of meshes(rig.root)) {
      const isBlob = m.name === 'avatar-blob';
      expect(m.castShadow).toBe(!isBlob);
      expect(m.receiveShadow).toBe(!isBlob);
    }
  });

  describe.each(HAIR_STYLES.map((c) => c.value))('hair %s', (hairStyle) => {
    it.each(HAT_STYLES.map((c) => c.value))('with hat %s builds within the budget', (hat) => {
      const rig = buildAvatar({ ...defaultAvatar('wolf'), hairStyle, hat });
      expect(meshes(rig.root).length).toBeLessThan(DRAW_CALL_BUDGET);
      expect(triangles(rig.root)).toBeLessThan(20000);
      const size = box(rig);
      expect(Number.isFinite(size.max.y)).toBe(true);
      rig.dispose();
    });
  });

  it.each(LEG_STYLES.map((c) => c.value))('legs %s build for every build and stay under the draw-call budget', (legs) => {
    for (const build of BUILDS.map((c) => c.value)) {
      const rig = buildAvatar({ ...defaultAvatar('wolf'), legs, build, glasses: true, backpack: true });
      expect(meshes(rig.root).length).toBeLessThan(DRAW_CALL_BUDGET);
      rig.dispose();
    }
  });

  it.each(EYE_STYLES.map((c) => c.value))('eyes %s build', (eyes) => {
    expect(() => buildAvatar({ ...defaultAvatar('wolf'), eyes })).not.toThrow();
  });

  it.each(RANK_IDS)('builds the default look for %s, and a v1 avatar with only bodyColor', (rank) => {
    expect(() => buildAvatar(defaultAvatar(rank), { rank })).not.toThrow();
    const legacy = buildAvatar({ bodyColor: '#e07a5f' }, { rank });
    expect(legacy.config.shirt).toBe('#e07a5f');
    expect(legacy.config.neckerchief).toBe(defaultAvatar(rank).neckerchief);
  });

  it('build scales the figure: small < regular < tall', () => {
    const height = (build: 'small' | 'regular' | 'tall'): number =>
      box(buildAvatar({ ...defaultAvatar('wolf'), hairStyle: 'none', hat: 'none', build }, { blobShadow: false })).max.y;
    expect(height('small')).toBeLessThan(height('regular'));
    expect(height('regular')).toBeLessThan(height('tall'));
    expect(height('tall')).toBeCloseTo(1.98, 1);
  });

  it('hats add height above the bare head', () => {
    const top = (hat: string): number => box(buildAvatar({ ...defaultAvatar('wolf'), hairStyle: 'none', hat }, { blobShadow: false })).max.y;
    for (const hat of ['cap', 'bucket', 'beanie', 'scout']) expect(top(hat)).toBeGreaterThan(top('none') + 0.03);
  });

  it('a backpack and a skirt widen the silhouette; a backpack goes behind', () => {
    const plain = box(buildAvatar({ ...defaultAvatar('wolf'), backpack: false }, { blobShadow: false }));
    const packed = box(buildAvatar({ ...defaultAvatar('wolf'), backpack: true }, { blobShadow: false }));
    expect(packed.min.z).toBeLessThan(plain.min.z - 0.05);
    expect(packed.max.z).toBeCloseTo(plain.max.z, 1);
    // The skirt flares out past the torso (the arms still set the overall width).
    const torsoWidth = (legs: 'shorts' | 'skort'): number => {
      const g = (joint(buildAvatar({ ...defaultAvatar('wolf'), legs }), 'torso-mesh') as THREE.Mesh).geometry;
      g.computeBoundingBox();
      return g.boundingBox!.max.x - g.boundingBox!.min.x;
    };
    expect(torsoWidth('skort')).toBeGreaterThan(torsoWidth('shorts') + 0.1);
  });
});

describe('procedural avatar rig: setConfig', () => {
  it('swaps the hair and rebuilds only the head', () => {
    const rig = buildAvatar({ ...defaultAvatar('wolf'), hairStyle: 'short' });
    const geometry = (name: string): THREE.BufferGeometry => (joint(rig, name) as THREE.Mesh).geometry;
    const before = {
      head: geometry('head-mesh'),
      torso: geometry('torso-mesh'),
      arm: geometry('arm-l-mesh'),
      leg: geometry('leg-l-mesh'),
    };
    const verticesBefore = before.head.getAttribute('position').count;

    rig.setConfig({ ...defaultAvatar('wolf'), hairStyle: 'spiky' });
    expect(rig.config.hairStyle).toBe('spiky');
    expect(geometry('head-mesh')).not.toBe(before.head);
    expect(geometry('head-mesh').getAttribute('position').count).not.toBe(verticesBefore);
    expect(geometry('torso-mesh')).toBe(before.torso);
    expect(geometry('arm-l-mesh')).toBe(before.arm);
    expect(geometry('leg-l-mesh')).toBe(before.leg);
  });

  it('a new shirt color rebuilds the torso and both arms; new shoes rebuild both legs', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const geometry = (name: string): THREE.BufferGeometry => (joint(rig, name) as THREE.Mesh).geometry;
    const head = geometry('head-mesh');
    const torso = geometry('torso-mesh');
    const arm = geometry('arm-l-mesh');
    const leg = geometry('leg-l-mesh');
    rig.setConfig({ ...defaultAvatar('wolf'), shirt: '#c63d34' });
    expect(geometry('head-mesh')).toBe(head);
    expect(geometry('torso-mesh')).not.toBe(torso);
    expect(geometry('arm-l-mesh')).not.toBe(arm);
    expect(geometry('arm-r-mesh')).toBe(geometry('arm-l-mesh')); // both arms share one geometry
    expect(geometry('leg-l-mesh')).toBe(leg);
    const legNow = geometry('leg-l-mesh');
    rig.setConfig({ ...defaultAvatar('wolf'), shirt: '#c63d34', shoes: '#f2f2f2' });
    expect(geometry('leg-l-mesh')).not.toBe(legNow);
    expect(geometry('leg-r-mesh')).toBe(geometry('leg-l-mesh'));
  });

  it('does nothing when the look is the same', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const torso = (joint(rig, 'torso-mesh') as THREE.Mesh).geometry;
    rig.setConfig(defaultAvatar('wolf'));
    expect((joint(rig, 'torso-mesh') as THREE.Mesh).geometry).toBe(torso);
  });

  it('changes the build in place', () => {
    const rig = buildAvatar({ ...defaultAvatar('wolf'), hairStyle: 'none' }, { blobShadow: false });
    const regular = box(rig).max.y;
    rig.setConfig({ ...defaultAvatar('wolf'), hairStyle: 'none', build: 'small' });
    expect(box(rig).max.y).toBeLessThan(regular);
    expect(rig.config.build).toBe('small');
  });

  it('keeps the same mesh objects and the same root, so the scene never changes', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const before = meshes(rig.root);
    rig.setConfig({ ...defaultAvatar('wolf'), hat: 'cap', backpack: true });
    expect(meshes(rig.root)).toEqual(before);
  });

  it('hat and glasses show up in the head geometry', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const count = (): number => (joint(rig, 'head-mesh') as THREE.Mesh).geometry.getAttribute('position').count;
    const plain = count();
    rig.setConfig({ ...defaultAvatar('wolf'), glasses: true });
    const withGlasses = count();
    expect(withGlasses).toBeGreaterThan(plain);
    rig.setConfig({ ...defaultAvatar('wolf'), glasses: true, hat: 'beanie' });
    expect(box(rig).max.y).toBeGreaterThan(1.9);
  });
});

describe('procedural avatar rig: animation', () => {
  it('walk swings the arms and legs, opposite to each other', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    const legL = joint(rig, 'leg-l');
    const legR = joint(rig, 'leg-r');
    const armL = joint(rig, 'arm-l');
    const armR = joint(rig, 'arm-r');
    expect(legL.rotation.x).toBe(0);

    let maxLeg = 0;
    let oppositeLegs = true;
    let oppositeArmAndLeg = true;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, { moving: true, speed: 4 });
      if (i < 30) continue;
      maxLeg = Math.max(maxLeg, Math.abs(legL.rotation.x));
      if (Math.abs(legL.rotation.x) > 0.1) {
        oppositeLegs &&= Math.sign(legL.rotation.x) === -Math.sign(legR.rotation.x);
        oppositeArmAndLeg &&= Math.sign(armL.rotation.x) === -Math.sign(legL.rotation.x);
        oppositeArmAndLeg &&= Math.sign(armR.rotation.x) === -Math.sign(legR.rotation.x);
      }
    }
    expect(rig.emote).toBe('walk');
    expect(maxLeg).toBeGreaterThan(0.5);
    expect(oppositeLegs).toBe(true);
    expect(oppositeArmAndLeg).toBe(true);
  });

  it('a faster walk takes bigger, quicker strides', () => {
    const swing = (speed: number): number => {
      const rig = buildAvatar(defaultAvatar('wolf'));
      let max = 0;
      for (let i = 0; i < 120; i++) {
        rig.update(1 / 60, { moving: true, speed });
        max = Math.max(max, Math.abs(joint(rig, 'leg-l').rotation.x));
      }
      return max;
    };
    expect(swing(6)).toBeGreaterThan(swing(2));
  });

  it('settles back to standing when the walk stops, and breathes at rest', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    run(rig, 1, { moving: true, speed: 4 });
    run(rig, 1.5, { moving: false, speed: 0 });
    expect(rig.emote).toBe('idle');
    expect(Math.abs(joint(rig, 'leg-l').rotation.x)).toBeLessThan(0.02);
    const upper = joint(rig, 'upper');
    const ys = new Set<number>();
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60, { moving: false, speed: 0 });
      ys.add(Math.round(upper.position.y * 1e5));
    }
    expect(ys.size).toBeGreaterThan(10); // the breathing bob moves
    expect(Math.max(...ys) / 1e5).toBeLessThan(0.02); // and it is small
  });

  it('cheer raises both arms and hops, then returns to idle by itself', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    rig.play('cheer');
    expect(rig.emote).toBe('cheer');
    let peakHop = 0;
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, { moving: false, speed: 0 });
      peakHop = Math.max(peakHop, joint(rig, 'avatar-body').position.y);
    }
    expect(joint(rig, 'arm-l').rotation.z).toBeGreaterThan(2);
    expect(joint(rig, 'arm-r').rotation.z).toBeLessThan(-2);
    expect(peakHop).toBeGreaterThan(0.05);
    run(rig, 2.5, { moving: false, speed: 0 });
    expect(rig.emote).toBe('idle');
    expect(joint(rig, 'arm-l').rotation.z).toBeLessThan(0.3);
    expect(joint(rig, 'avatar-body').position.y).toBeCloseTo(0, 2);
  });

  it('wave lifts one arm only, then returns', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    rig.play('wave');
    run(rig, 0.8, { moving: false, speed: 0 });
    expect(joint(rig, 'arm-r').rotation.z).toBeLessThan(-2);
    expect(Math.abs(joint(rig, 'arm-l').rotation.z)).toBeLessThan(0.3);
    run(rig, 2.8, { moving: false, speed: 0 });
    expect(rig.emote).toBe('idle');
  });

  it('a one-shot that ends while the Scout is walking goes on to walk', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    rig.update(1 / 60, { moving: true, speed: 4 });
    rig.play('cheer');
    run(rig, 2.2, { moving: true, speed: 4 });
    expect(rig.emote).toBe('walk');
  });

  it('starting to walk interrupts a wave', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    rig.play('wave');
    rig.update(1 / 60, { moving: true, speed: 4 });
    expect(rig.emote).toBe('walk');
  });

  it('play("walk") walks at a default pace even with no speed', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    rig.play('walk');
    let max = 0;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60, { moving: false, speed: 0 });
      max = Math.max(max, Math.abs(joint(rig, 'leg-l').rotation.x));
    }
    expect(max).toBeGreaterThan(0.4);
  });

  it('never produces NaN, even with a zero or huge time step', () => {
    const rig = buildAvatar(defaultAvatar('wolf'));
    for (const dt of [0, 1e-9, 0.016, 1, 5]) rig.update(dt, { moving: true, speed: 4 });
    for (const name of ['leg-l', 'leg-r', 'arm-l', 'arm-r', 'head', 'upper']) {
      const r = joint(rig, name).rotation;
      expect([r.x, r.y, r.z].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('procedural avatar rig: dispose', () => {
  it('frees the geometry and leaves the scene', () => {
    const scene = new THREE.Scene();
    const rig = buildAvatar(defaultAvatar('wolf'));
    scene.add(rig.root);
    let disposed = 0;
    for (const name of ['head-mesh', 'torso-mesh', 'arm-l-mesh', 'leg-l-mesh']) {
      (joint(rig, name) as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++);
    }
    rig.dispose();
    expect(disposed).toBe(4);
    expect(rig.root.parent).toBeNull();
  });

  it('does not free the shared material (other rigs still use it)', () => {
    const a = buildAvatar(defaultAvatar('wolf'));
    const b = buildAvatar(defaultAvatar('bear'));
    const material = (joint(b, 'head-mesh') as THREE.Mesh).material as THREE.Material;
    let disposed = false;
    material.addEventListener('dispose', () => (disposed = true));
    a.dispose();
    expect(disposed).toBe(false);
  });
});

describe('Den Chief preset (procedural fallback)', () => {
  it('is tall, in a scout hat and glasses, with the cord', () => {
    expect(DEN_CHIEF_AVATAR).toMatchObject({ build: 'tall', hat: 'scout', glasses: true });
    const chief = createDenChief();
    expect(chief.root.name).toBe('den-chief');
    expect(chief.config).toMatchObject({ build: 'tall', hat: 'scout', glasses: true });
    expect(meshes(chief.root)).toHaveLength(7);
    expect(meshes(chief.root).length).toBeLessThan(DRAW_CALL_BUDGET);
    const size = box(chief);
    expect(size.max.y).toBeGreaterThan(1.95); // taller than a regular Scout with a hat
    expect(size.max.y).toBeLessThan(2.3);
  });

  it('has the yellow cord on the torso, so it shows more geometry than the same look without it', () => {
    const withCord = (joint(createDenChief(), 'torso-mesh') as THREE.Mesh).geometry.getAttribute('position').count;
    const without = (joint(buildAvatar(DEN_CHIEF_AVATAR), 'torso-mesh') as THREE.Mesh).geometry.getAttribute('position').count;
    expect(withCord).toBeGreaterThan(without);
    const colors = (joint(createDenChief(), 'torso-mesh') as THREE.Mesh).geometry.getAttribute('color');
    const yellow = new THREE.Color('#f2c230');
    let hits = 0;
    for (let i = 0; i < colors.count; i++) {
      if (Math.abs(colors.getX(i) - yellow.r) + Math.abs(colors.getY(i) - yellow.g) + Math.abs(colors.getZ(i) - yellow.b) < 0.02) hits++;
    }
    expect(hits).toBeGreaterThan(20);
  });

  it('idles and waves without throwing', () => {
    const chief = createDenChief();
    chief.play('wave');
    run(chief, 3, { moving: false, speed: 0 });
    expect(chief.emote).toBe('idle');
  });
});
