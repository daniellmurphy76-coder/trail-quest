/**
 * Which animation clips the Scout plays, by role. The kit's own clips cover idle, walk and run; it has no
 * wave and no cheer, so those two are keyframed here, in code, on the kit's own arm, head, leg and root nodes.
 *
 * The roles the game cares about, and where each one comes from (Blocky Characters 2.0):
 *   idle     kit `idle`    (1.333 s, torso, arms and head sway)
 *   walk     kit `walk`    (0.667 s, legs and arms +-60 degrees, a 0.1 hop)
 *   run      kit `sprint`  (0.5 s, legs and arms +-90 degrees, torso leans in)
 *   cheer    hand-made     (1.9 s, both arms up and flapping, a hop on every beat)
 *   wave     hand-made     (2.2 s, right arm up and waving)
 * Kit clips the Scout could use later but the shipped model leaves out: `pick-up` (0.333 s), `sit` (0.167 s).
 * The kit has no jump.
 */
import * as THREE from 'three';

export type ClipRole = 'idle' | 'walk' | 'run' | 'cheer' | 'wave';

/** Roles that come from the kit's own clips, and the clip name each one reads. */
export const KIT_CLIP_FOR_ROLE = { idle: 'idle', walk: 'walk', run: 'sprint' } as const;

/** Roles the game animates itself, because the kit has no clip for them. */
export const HANDMADE_ROLES = ['cheer', 'wave'] as const;

export const ALL_ROLES: readonly ClipRole[] = ['idle', 'walk', 'run', 'cheer', 'wave'];

export const CHEER_SECONDS = 1.9;
export const WAVE_SECONDS = 2.2;

const KEY_STEP = 1 / 30;

const DEG = Math.PI / 180;

/** 0 at the start, 1 for the middle, 0 again at the end, with `edge` seconds of smooth ramp each side. */
function envelope(t: number, length: number, edge: number): number {
  const s = (x: number): number => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
  };
  return Math.min(s(t / edge), s((length - t) / edge));
}

const euler = new THREE.Euler();
const quaternion = new THREE.Quaternion();

/** A rotation track for a node, from a function of time that returns x, y, z angles in radians. */
function rotationTrack(
  node: string,
  length: number,
  angles: (t: number) => readonly [number, number, number],
): THREE.QuaternionKeyframeTrack {
  const times: number[] = [];
  const values: number[] = [];
  const steps = Math.round(length / KEY_STEP);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(length, i * KEY_STEP);
    const [x, y, z] = angles(t);
    quaternion.setFromEuler(euler.set(x, y, z));
    times.push(t);
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, values);
}

/**
 * Cheer: both arms thrown up and flapping, legs bouncing, head tipped back, and a hop on every beat.
 * Starts and ends at the rest pose. Hop height is in the kit's units (0.3 is 0.2 once the rig scales it).
 */
export function makeCheerClip(): THREE.AnimationClip {
  const length = CHEER_SECONDS;
  const env = (t: number): number => envelope(t, length, 0.25);
  const flap = (t: number): number => Math.sin(t * 16);
  const beat = (t: number): number => Math.sin(t * 8);

  const hopTimes: number[] = [];
  const hopValues: number[] = [];
  const steps = Math.round(length / KEY_STEP);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(length, i * KEY_STEP);
    // Five hops in 1.9 s: |sin| with a period of 0.38 s, so the clip ends on the ground.
    hopTimes.push(t);
    hopValues.push(0, 0.3 * Math.abs(Math.sin((t * Math.PI * 5) / length)) * env(t), 0);
  }

  return new THREE.AnimationClip('cheer', length, [
    new THREE.VectorKeyframeTrack('root.position', hopTimes, hopValues),
    rotationTrack('arm-left', length, (t) => [0, 0, env(t) * (145 * DEG + flap(t) * 12 * DEG)]),
    rotationTrack('arm-right', length, (t) => [0, 0, -env(t) * (145 * DEG - flap(t) * 12 * DEG)]),
    rotationTrack('leg-left', length, (t) => [env(t) * beat(t) * 0.22, 0, env(t) * 0.14]),
    rotationTrack('leg-right', length, (t) => [-env(t) * beat(t) * 0.22, 0, -env(t) * 0.14]),
    rotationTrack('head', length, (t) => [-env(t) * 0.18, 0, 0]),
  ]);
}

/** Wave: the right arm lifts out to the side and waves, the head tilts a little. Starts and ends at rest. */
export function makeWaveClip(): THREE.AnimationClip {
  const length = WAVE_SECONDS;
  const env = (t: number): number => envelope(t, length, 0.3);
  const wave = (t: number): number => Math.sin(t * 11);
  return new THREE.AnimationClip('wave', length, [
    rotationTrack('arm-right', length, (t) => [0, 0, -env(t) * (146 * DEG + wave(t) * 20 * DEG)]),
    rotationTrack('head', length, (t) => [0, 0, env(t) * 0.12]),
    rotationTrack('torso', length, (t) => [0, -env(t) * 0.08, 0]),
  ]);
}

export interface RoleClips {
  clips: Readonly<Record<ClipRole, THREE.AnimationClip>>;
  /** The roles that had no kit clip and were made by hand. */
  handmade: readonly ClipRole[];
}

/**
 * Pick the clip for every role from the clips a model came with, and make the ones it lacks. Throws when the
 * model is missing a kit clip the Scout cannot do without (idle, walk, sprint), so a wrong file fails loudly
 * and the caller keeps the procedural Scout.
 */
export function resolveRoleClips(kitClips: readonly THREE.AnimationClip[]): RoleClips {
  const byName = new Map(kitClips.map((c) => [c.name, c]));
  const pick = (role: keyof typeof KIT_CLIP_FOR_ROLE): THREE.AnimationClip => {
    const clip = byName.get(KIT_CLIP_FOR_ROLE[role]);
    if (!clip) throw new Error(`the Scout model has no "${KIT_CLIP_FOR_ROLE[role]}" clip for ${role}`);
    return clip;
  };
  const handmade: ClipRole[] = [];
  const named = (role: (typeof HANDMADE_ROLES)[number], make: () => THREE.AnimationClip): THREE.AnimationClip => {
    const kit = byName.get(role);
    if (kit) return kit;
    handmade.push(role);
    return make();
  };
  return {
    clips: {
      idle: pick('idle'),
      walk: pick('walk'),
      run: pick('run'),
      cheer: named('cheer', makeCheerClip),
      wave: named('wave', makeWaveClip),
    },
    handmade,
  };
}
