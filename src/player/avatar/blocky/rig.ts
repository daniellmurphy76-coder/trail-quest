/**
 * The Kenney Blocky Scout as a rig: a copy of the model, a painted skin, a few merged attachment meshes and
 * an AnimationMixer. It speaks the same `emote` / `update` / `play` / `setConfig` language as the procedural
 * Scout, so `buildAvatar` (../rig.ts) can swap one for the other without the caller noticing.
 *
 * Cost per Scout: 6 body meshes sharing one material and one skin texture, plus at most 2 attachment meshes
 * (head, torso) and a blob shadow: 9 draw calls. A look change repaints (or re-uses) the skin texture and
 * rebuilds only the attachment mesh whose inputs changed.
 *
 * Animation: idle, walk and run are the kit's clips, cheer and wave are keyframed in clips.ts. Every clip
 * is always "playing" with a weight; the weights ease toward their targets, which is the cross-fade. Walk and
 * run are driven by one shared phase, so blending them by speed never makes the legs fight each other.
 *
 * Space: feet at y = 0, front is +z, a regular build with a bare head is 1.8 units tall.
 */
import * as THREE from 'three';
import { damp } from '../../../engine/damp';
import { setShadowCasting } from '../../../engine/environment';
import type { RankId } from '../../../activities/types';
import type { AvatarConfig } from '../../../save/types';
import { fillAvatar, type Build, type FilledAvatar } from '../options';
import { BLEND_RATE, BLOB_GEOMETRY, BLOB_LIFT, BLOB_MATERIAL, blobScale, ONE_SHOT_SECONDS, REFERENCE_SPEED } from '../procedural';
import type { AvatarState, Emote } from '../rig-types';
import { buildHeadAttachments, buildTorsoAttachments } from './attachments';
import { ALL_ROLES, type ClipRole } from './clips';
import { instantiateBlocky, type BlockyAsset } from './model';
import { getSkinTexture } from './skin-texture';

/** Build scales the whole figure. */
export const BLOCKY_BUILD_SCALE: Readonly<Record<Build, number>> = { small: 0.85, regular: 1, tall: 1.15 };

/** Ground covered by one walk cycle (two steps) in the kit's units, from the legs' +-60 degree swing. */
const WALK_STRIDE_KIT = 4 * Math.sin((60 * Math.PI) / 180);
/** And by one run cycle, from the +-90 degree swing. */
const RUN_STRIDE_KIT = 4 * Math.sin((90 * Math.PI) / 180);
/** Ground speeds (units per second, after scaling) between which walking turns into running. */
export const RUN_BLEND_FROM = 4.4;
export const RUN_BLEND_TO = 5;

/** One material for every attachment: the color lives in the vertices. Never disposed. */
const ATTACHMENT_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export interface BlockyRigOptions {
  rank: RankId;
  denChiefCord: boolean;
  blobShadow: boolean;
}

export interface BlockyRig {
  /** The figure: scaled by build, feet at y = 0. Add it to the avatar root. */
  readonly group: THREE.Group;
  readonly config: Readonly<FilledAvatar>;
  readonly emote: Emote;
  setConfig(config: AvatarConfig): void;
  play(emote: Emote): void;
  update(dt: number, state: AvatarState): void;
  dispose(): void;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createBlockyRig(model: BlockyAsset, initial: FilledAvatar, options: BlockyRigOptions): BlockyRig {
  const { rank, denChiefCord } = options;
  let current = initial;

  // ---- scene graph ----------------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'avatar-blocky';
  const body = instantiateBlocky(model);
  body.name = 'blocky';
  body.scale.setScalar(model.scale);
  group.add(body);

  const node = (name: string): THREE.Object3D => {
    const found = body.getObjectByName(name);
    if (!found) throw new Error(`the Scout model has no "${name}" node`);
    return found;
  };
  const head = node('head');
  const torso = node('torso');

  const material = new THREE.MeshLambertMaterial({ name: 'scout-skin', map: getSkinTexture(current) });
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = material;
  });

  let skinTexture = material.map;
  let blob: THREE.Mesh | null = null;
  if (options.blobShadow) {
    blob = new THREE.Mesh(BLOB_GEOMETRY, BLOB_MATERIAL);
    blob.name = 'avatar-blob';
    blob.position.y = BLOB_LIFT;
    group.add(blob);
  }
  const hips = node('root'); // the clips hop the whole figure by moving this

  // ---- attachments ----------------------------------------------------------------------------
  const keyOf = {
    head: (c: FilledAvatar): string => [c.hairStyle, c.hairColor, c.hat, c.hatColor, c.glasses, c.neckerchief].join('|'),
    torso: (c: FilledAvatar): string =>
      [c.neckerchief, c.backpack, c.legs === 'skort' ? `skort:${c.legColor}` : 'no-skirt'].join('|'),
  };
  let headKey = '';
  let torsoKey = '';
  let headMesh: THREE.Mesh | null = null;
  let torsoMesh: THREE.Mesh | null = null;

  const attach = (name: string, geometry: THREE.BufferGeometry, parent: THREE.Object3D): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, ATTACHMENT_MATERIAL);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const swap = (old: THREE.Mesh | null, name: string, geometry: THREE.BufferGeometry | null, parent: THREE.Object3D): THREE.Mesh | null => {
    if (old) {
      old.removeFromParent();
      old.geometry.dispose();
    }
    return geometry ? attach(name, geometry, parent) : null;
  };
  const buildAttachments = (): void => {
    const nextHead = keyOf.head(current);
    if (nextHead !== headKey) {
      headKey = nextHead;
      headMesh = swap(headMesh, 'head-attachments', buildHeadAttachments(current), head);
    }
    const nextTorso = keyOf.torso(current);
    if (nextTorso !== torsoKey) {
      torsoKey = nextTorso;
      torsoMesh = swap(torsoMesh, 'torso-attachments', buildTorsoAttachments(current, { denChiefCord }), torso);
    }
  };
  buildAttachments();

  setShadowCasting(group, true, true); // the blob is transparent, so it is skipped

  const applyBuild = (): void => {
    group.scale.setScalar(BLOCKY_BUILD_SCALE[current.build]);
  };
  applyBuild();

  // ---- animation ------------------------------------------------------------------------------
  const mixer = new THREE.AnimationMixer(body);
  const actions = {} as Record<ClipRole, THREE.AnimationAction>;
  for (const role of ALL_ROLES) actions[role] = mixer.clipAction(model.roles.clips[role]);
  const weights: Record<ClipRole, number> = { idle: 1, walk: 0, run: 0, cheer: 0, wave: 0 };
  const startLoop = (role: 'idle' | 'walk' | 'run'): void => {
    const a = actions[role];
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.setEffectiveWeight(weights[role]);
  };
  startLoop('idle');
  startLoop('walk');
  startLoop('run');
  actions.walk.timeScale = 0; // walk and run follow `phase`, set by hand every step
  actions.run.timeScale = 0;
  for (const role of ['cheer', 'wave'] as const) {
    actions[role].setLoop(THREE.LoopOnce, 1);
    actions[role].clampWhenFinished = true;
  }
  const walkSeconds = model.roles.clips.walk.duration;
  const runSeconds = model.roles.clips.run.duration;
  const walkStride = WALK_STRIDE_KIT * model.scale;
  const runStride = RUN_STRIDE_KIT * model.scale;

  let emote: Emote = 'idle';
  let prevMoving = false;
  let oneShot = 0;
  let gait = 0;
  let phase = 0; // 0 to 1 through a walk or run cycle

  const start = (next: Emote): void => {
    emote = next;
    oneShot = 0;
    if (next === 'cheer' || next === 'wave') actions[next].reset().play();
  };

  mixer.update(0);

  return {
    group,
    get config() {
      return current;
    },
    get emote() {
      return emote;
    },
    setConfig(next) {
      current = fillAvatar(next, rank);
      const texture = getSkinTexture(current);
      if (texture !== skinTexture) {
        skinTexture = texture;
        material.map = texture;
        material.needsUpdate = true;
      }
      buildAttachments();
      applyBuild();
    },
    play(next) {
      start(next);
    },
    update(dt, state) {
      if (state.moving !== prevMoving) {
        prevMoving = state.moving;
        if (state.moving) start('walk');
        else if (emote === 'walk') start('idle');
      }
      oneShot += dt;
      const length = ONE_SHOT_SECONDS[emote];
      if (length !== undefined && oneShot >= length) start(prevMoving ? 'walk' : 'idle');

      const targetGait = emote === 'walk' ? (state.speed > 0 ? state.speed : REFERENCE_SPEED) : 0;
      gait = damp(gait, targetGait, BLEND_RATE, dt);
      const runMix = smoothstep(RUN_BLEND_FROM, RUN_BLEND_TO, gait);
      // Cycles per second: the walk clip at this speed, eased toward the run clip's as the speed climbs.
      const cadence = (gait / walkStride) * (1 - runMix) + (gait / runStride) * runMix;
      phase = (phase + cadence * dt) % 1;
      actions.walk.time = phase * walkSeconds;
      actions.run.time = phase * runSeconds;

      const walking = emote === 'walk';
      const target: Record<ClipRole, number> = {
        idle: emote === 'idle' ? 1 : 0,
        walk: walking ? 1 - runMix : 0,
        run: walking ? runMix : 0,
        cheer: emote === 'cheer' ? 1 : 0,
        wave: emote === 'wave' ? 1 : 0,
      };
      for (const role of ALL_ROLES) {
        weights[role] = damp(weights[role], target[role], BLEND_RATE, dt);
        actions[role].setEffectiveWeight(weights[role]);
      }
      mixer.update(dt);
      if (blob) {
        // The blob stays on the ground and shrinks a little while the Scout is in the air.
        const s = blobScale(hips.position.y * model.scale);
        blob.scale.set(s, 1, s);
      }
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      headMesh?.geometry.dispose();
      torsoMesh?.geometry.dispose();
      material.dispose(); // the skin texture is the cache's, not ours
      group.removeFromParent();
    },
  };
}
