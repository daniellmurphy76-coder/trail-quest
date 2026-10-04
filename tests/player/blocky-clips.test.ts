import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ALL_ROLES,
  CHEER_SECONDS,
  HANDMADE_ROLES,
  KIT_CLIP_FOR_ROLE,
  WAVE_SECONDS,
  makeCheerClip,
  makeWaveClip,
  resolveRoleClips,
} from '../../src/player/avatar/blocky/clips';
import { MODEL_NODES, parseBlockyModel } from '../../src/player/avatar/blocky/model';
import { loadModel, modelBytes, modelFileSize, readGlb } from './model-file';

const deg = (rad: number): number => (rad * 180) / Math.PI;

/** The angle (degrees) of a quaternion keyframe, ignoring its axis. */
function angle(values: ArrayLike<number>, key: number): number {
  const w = Math.abs(values[key * 4 + 3]!);
  return deg(2 * Math.acos(Math.min(1, w)));
}

function track(clip: THREE.AnimationClip, name: string): THREE.KeyframeTrack {
  const t = clip.tracks.find((x) => x.name === name);
  if (!t) throw new Error(`no track ${name} in ${clip.name}`);
  return t;
}

describe('clip roles', () => {
  it('maps idle, walk and run to the kit clips idle, walk and sprint; cheer and wave are hand-made', () => {
    expect(KIT_CLIP_FOR_ROLE).toEqual({ idle: 'idle', walk: 'walk', run: 'sprint' });
    expect([...HANDMADE_ROLES]).toEqual(['cheer', 'wave']);
    expect([...ALL_ROLES].sort()).toEqual(['cheer', 'idle', 'run', 'walk', 'wave']);
  });

  it('the shipped model carries exactly the kit clips the game uses, and resolves every role', async () => {
    const model = await loadModel();
    const names = readGlb().json.animations.map((a) => a.name);
    expect(names).toEqual(['idle', 'walk', 'sprint']);
    const { clips, handmade } = model.roles;
    expect(Object.keys(clips).sort()).toEqual([...ALL_ROLES].sort());
    expect(clips.idle.name).toBe('idle');
    expect(clips.walk.name).toBe('walk');
    expect(clips.run.name).toBe('sprint');
    expect(handmade).toEqual(['cheer', 'wave']);
    expect(clips.idle.duration).toBeCloseTo(1.333, 2);
    expect(clips.walk.duration).toBeCloseTo(0.667, 2);
    expect(clips.run.duration).toBeCloseTo(0.5, 2);
    expect(clips.cheer.duration).toBeCloseTo(CHEER_SECONDS, 3);
    expect(clips.wave.duration).toBeCloseTo(WAVE_SECONDS, 3);
  });

  it('every track of every role drives a node the model has', async () => {
    const model = await loadModel();
    const nodes = new Set<string>(MODEL_NODES);
    for (const role of ALL_ROLES) {
      const clip = model.roles.clips[role];
      expect(clip.tracks.length, role).toBeGreaterThan(0);
      for (const t of clip.tracks) {
        const [node, property] = t.name.split('.');
        expect(nodes.has(node!), `${role}: ${t.name}`).toBe(true);
        expect(['quaternion', 'position'], `${role}: ${t.name}`).toContain(property);
        for (const v of t.values) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('resolveRoleClips fails loudly when the model lacks a kit clip, and takes a kit cheer or wave when there is one', () => {
    const clip = (name: string): THREE.AnimationClip => new THREE.AnimationClip(name, 1, []);
    expect(() => resolveRoleClips([clip('idle'), clip('walk')])).toThrow(/sprint/);
    expect(() => resolveRoleClips([])).toThrow(/idle/);
    const kitCheer = clip('cheer');
    const r = resolveRoleClips([clip('idle'), clip('walk'), clip('sprint'), kitCheer]);
    expect(r.clips.cheer).toBe(kitCheer);
    expect(r.handmade).toEqual(['wave']);
  });

  it('a file that is not a Scout model is refused', async () => {
    await expect(parseBlockyModel(new ArrayBuffer(16))).rejects.toBeDefined();
  });
});

describe('the shipped model file', () => {
  it('is small: well under the 600 KB target', () => {
    expect(modelFileSize()).toBeLessThan(600 * 1024);
    expect(modelFileSize()).toBeGreaterThan(1000);
  });

  it('has 7 nodes, 6 box meshes of 12 triangles, no material and no texture', () => {
    const { json } = readGlb();
    expect(json.nodes.map((n) => n.name).sort()).toEqual([...MODEL_NODES].sort());
    expect(json.meshes).toHaveLength(6);
    expect(json.materials).toBeUndefined();
    expect(json.textures).toBeUndefined();
    expect(json.images).toBeUndefined();
    for (const n of json.nodes) expect(n.scale, n.name).toBeUndefined(); // the head's 0.1 scale is baked in
  });

  it('parses into a model 1.8 units tall once scaled, with its feet on y = 0', async () => {
    const model = await parseBlockyModel(modelBytes());
    const box = new THREE.Box3().setFromObject(model.scene);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.max.y - box.min.y) * model.scale).toBeCloseTo(1.8, 5);
    for (const name of MODEL_NODES) expect(model.scene.getObjectByName(name), name).toBeDefined();
    let triangles = 0;
    model.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) triangles += mesh.geometry.getAttribute('position').count / 3;
    });
    expect(triangles).toBe(72);
  });
});

describe('hand-made clips', () => {
  const cheer = makeCheerClip();
  const wave = makeWaveClip();

  it('start and end at the rest pose, so a one-shot never pops', () => {
    for (const clip of [cheer, wave]) {
      for (const t of clip.tracks) {
        if (t.name.endsWith('.quaternion')) {
          expect(angle(t.values, 0), `${clip.name} ${t.name} start`).toBeLessThan(0.01);
          expect(angle(t.values, t.times.length - 1), `${clip.name} ${t.name} end`).toBeLessThan(0.01);
        } else {
          expect(Math.abs(t.values[1]!), `${clip.name} ${t.name} start`).toBeLessThan(1e-6);
          expect(Math.abs(t.values[t.values.length - 2]!), `${clip.name} ${t.name} end`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('cheer throws both arms up (about 145 degrees), mirrored, and hops 0.3 units five times', () => {
    const left = track(cheer, 'arm-left.quaternion');
    const right = track(cheer, 'arm-right.quaternion');
    let peakLeft = 0;
    let peakRight = 0;
    for (let k = 0; k < left.times.length; k++) {
      peakLeft = Math.max(peakLeft, angle(left.values, k));
      peakRight = Math.max(peakRight, angle(right.values, k));
    }
    expect(peakLeft).toBeGreaterThan(125);
    expect(peakRight).toBeGreaterThan(125);
    // Mirror images: the left arm turns one way about z, the right arm the other.
    const mid = Math.floor(left.times.length / 2);
    expect(Math.sign(left.values[mid * 4 + 2]!)).toBe(-Math.sign(right.values[mid * 4 + 2]!));
    const hop = track(cheer, 'root.position');
    const ys = Array.from({ length: hop.times.length }, (_, k) => hop.values[k * 3 + 1]!);
    expect(Math.max(...ys)).toBeGreaterThan(0.25);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    let landings = 0;
    for (let k = 1; k < ys.length - 1; k++) if (ys[k]! < 0.05 && ys[k]! <= ys[k - 1]! && ys[k]! <= ys[k + 1]!) landings++;
    expect(landings).toBeGreaterThanOrEqual(4);
  });

  it('wave lifts only the right arm, high and out to the side (about 146 degrees), and waggles it', () => {
    expect(wave.tracks.some((t) => t.name === 'arm-left.quaternion')).toBe(false);
    const arm = track(wave, 'arm-right.quaternion');
    const angles = Array.from({ length: arm.times.length }, (_, k) => angle(arm.values, k));
    expect(Math.max(...angles)).toBeGreaterThan(150);
    // While it is up the angle moves back and forth.
    const middle = angles.slice(Math.floor(angles.length * 0.3), Math.floor(angles.length * 0.7));
    expect(Math.max(...middle) - Math.min(...middle)).toBeGreaterThan(20);
    // The arm swings out to the character's right (-x): rotation about +z is negative there.
    const z = arm.values[Math.floor(arm.times.length / 2) * 4 + 2]!;
    expect(z).toBeLessThan(0);
  });

  it('are the right length and have 30 keys a second', () => {
    expect(cheer.duration).toBeCloseTo(1.9, 6);
    expect(wave.duration).toBeCloseTo(2.2, 6);
    expect(track(cheer, 'head.quaternion').times.length).toBe(58);
    expect(track(wave, 'arm-right.quaternion').times.length).toBe(67);
  });
});
