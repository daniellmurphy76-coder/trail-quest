/**
 * The blocky Scout: a head, torso, two arms and two legs that turn about their joints, with
 * procedural idle, walk, cheer and wave animation. The look comes from an `AvatarConfig`
 * (see options.ts). The same rig builds the player and the Den Chief.
 *
 * Cost: 7 draw calls (head, torso, two arms, two legs, a soft blob shadow). All the parts use one
 * shared vertex-colored material, so a color change rebuilds geometry, never materials. Parts that
 * did not change are left alone by `setConfig`.
 *
 * Space: feet at y = 0, the front is +z. A regular build stands 1.8 units tall (hats and hair add a bit).
 */
import * as THREE from 'three';
import { damp } from '../../engine/damp';
import { setShadowCasting } from '../../engine/environment';
import type { RankId } from '../../activities/types';
import type { AvatarConfig } from '../../save/types';
import { fillAvatar, type Build, type FilledAvatar } from './options';
import { buildArmGeometry, buildHeadGeometry, buildLegGeometry, buildTorsoGeometry, JOINTS } from './parts';

export type Emote = 'idle' | 'walk' | 'cheer' | 'wave';

export interface AvatarState {
  /** True while the character is walking. Changes start and stop the walk cycle. */
  moving: boolean;
  /** Ground speed in units per second; scales the stride. */
  speed: number;
}

export interface AvatarRigOptions {
  /** Decides defaults for fields the config leaves out (the neckerchief color). Default 'wolf'. */
  rank?: RankId;
  /** Draw the Den Chief cord across the chest. */
  denChiefCord?: boolean;
  /** Draw the soft blob shadow under the feet. Default true. */
  blobShadow?: boolean;
}

export interface AvatarRig {
  /** Add this to the scene. Feet at y = 0, front is +z. */
  readonly root: THREE.Group;
  /** The look now showing, with every field filled in. */
  readonly config: Readonly<FilledAvatar>;
  /** What the rig is playing now. A one-shot (cheer, wave) returns to idle or walk by itself. */
  readonly emote: Emote;
  /** Change the look. Only the parts whose look changed are rebuilt. */
  setConfig(config: AvatarConfig): void;
  /** Advance the animation. Call every step. A change in `moving` starts or stops the walk cycle. */
  update(dt: number, state: AvatarState): void;
  /** Start an emote. 'cheer' and 'wave' play once; 'idle' and 'walk' loop until changed. */
  play(emote: Emote): void;
  /** Free the geometry. The rig must not be used afterwards. */
  dispose(): void;
}

/** Overall size, head size and width for each build. */
const BUILD_SCALE: Readonly<Record<Build, { height: number; head: number; width: number }>> = {
  small: { height: 0.86, head: 1.12, width: 1 },
  regular: { height: 1, head: 1, width: 1 },
  tall: { height: 1.1, head: 0.96, width: 0.94 },
};

const REFERENCE_SPEED = 4; // units per second the walk cycle is drawn for
const STRIDE_RATE = 3.9; // radians of walk phase per unit of ground speed
const BLEND_RATE = 11; // how fast the poses cross-fade, per second
const ONE_SHOT_SECONDS: Readonly<Partial<Record<Emote, number>>> = { cheer: 1.9, wave: 2.2 };

/** One material for every body part: the color lives in the vertices. Never disposed. */
const BODY_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const BLOB_GEOMETRY = new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2);
const BLOB_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

type Part = 'head' | 'torso' | 'arm' | 'leg';

/** What each part's geometry depends on. Parts whose key is unchanged are not rebuilt. */
function partKey(part: Part, c: FilledAvatar, cord: boolean): string {
  switch (part) {
    case 'head':
      return [c.skin, c.eyes, c.glasses, c.hairStyle, c.hairColor, c.hat, c.hatColor, c.neckerchief].join('|');
    case 'torso':
      return [c.shirt, c.legColor, c.legs, c.skin, c.neckerchief, c.backpack, cord].join('|');
    case 'arm':
      return [c.shirt, c.skin].join('|');
    case 'leg':
      return [c.legs, c.legColor, c.skin, c.shoes].join('|');
  }
}

function buildPart(part: Part, c: FilledAvatar, cord: boolean): THREE.BufferGeometry {
  switch (part) {
    case 'head':
      return buildHeadGeometry(c);
    case 'torso':
      return buildTorsoGeometry(c, { denChiefCord: cord });
    case 'arm':
      return buildArmGeometry(c);
    case 'leg':
      return buildLegGeometry(c);
  }
}

export function buildAvatar(config: AvatarConfig, options: AvatarRigOptions = {}): AvatarRig {
  const rank = options.rank ?? 'wolf';
  const cord = options.denChiefCord ?? false;
  let current = fillAvatar(config, rank);

  // ---- scene graph --------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'avatar';
  const body = new THREE.Group(); // build scale and hop
  body.name = 'avatar-body';
  const upper = new THREE.Group(); // everything above the hips: sways and bobs
  upper.name = 'upper';
  root.add(body);

  const joint = (name: string, x: number, y: number, parent: THREE.Object3D): THREE.Group => {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, 0);
    parent.add(group);
    return group;
  };
  const legL = joint('leg-l', JOINTS.legX, JOINTS.hipY, body);
  const legR = joint('leg-r', -JOINTS.legX, JOINTS.hipY, body);
  body.add(upper);
  const head = joint('head', 0, JOINTS.neckY, upper);
  const armL = joint('arm-l', JOINTS.armX, JOINTS.shoulderY, upper);
  const armR = joint('arm-r', -JOINTS.armX, JOINTS.shoulderY, upper);

  const geometries: Record<Part, THREE.BufferGeometry> = {
    head: buildPart('head', current, cord),
    torso: buildPart('torso', current, cord),
    arm: buildPart('arm', current, cord),
    leg: buildPart('leg', current, cord),
  };
  const keys: Record<Part, string> = {
    head: partKey('head', current, cord),
    torso: partKey('torso', current, cord),
    arm: partKey('arm', current, cord),
    leg: partKey('leg', current, cord),
  };

  const mesh = (name: string, part: Part, parent: THREE.Object3D, y = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geometries[part], BODY_MATERIAL);
    m.name = name;
    m.position.y = y;
    parent.add(m);
    return m;
  };
  const headMesh = mesh('head-mesh', 'head', head);
  const torsoMesh = mesh('torso-mesh', 'torso', upper, JOINTS.hipY);
  const armMeshes = [mesh('arm-l-mesh', 'arm', armL), mesh('arm-r-mesh', 'arm', armR)];
  const legMeshes = [mesh('leg-l-mesh', 'leg', legL), mesh('leg-r-mesh', 'leg', legR)];

  if (options.blobShadow ?? true) {
    const blob = new THREE.Mesh(BLOB_GEOMETRY, BLOB_MATERIAL);
    blob.name = 'avatar-blob';
    blob.position.y = 0.03;
    body.add(blob);
  }
  setShadowCasting(root, true, true); // the blob is transparent, so it is skipped

  const applyBuild = (): void => {
    const b = BUILD_SCALE[current.build];
    body.scale.set(b.height * b.width, b.height, b.height * b.width);
    head.scale.setScalar(b.head);
  };
  applyBuild();

  // ---- animation ----------------------------------------------------------------------------
  const weights: Record<Emote, number> = { idle: 1, walk: 0, cheer: 0, wave: 0 };
  let emote: Emote = 'idle';
  let prevMoving = false;
  let clock = 0; // total seconds, for idle sway
  let oneShot = 0; // seconds since the current one-shot began
  let gait = 0; // damped ground speed, so the stride eases in and out
  let walkPhase = 0;

  const setEmote = (next: Emote): void => {
    if (next !== emote) oneShot = 0;
    emote = next;
  };

  const pose = (): void => {
    const w = weights;
    const amp = Math.min(1.4, Math.max(0.5, gait / REFERENCE_SPEED));
    const s = Math.sin(walkPhase) * amp;
    const breathe = Math.sin(clock * 2.2);
    const sway = Math.sin(clock * 1.5);
    const hop = Math.abs(Math.sin(oneShot * 8));
    const flap = Math.sin(oneShot * 16);
    const wave = Math.sin(oneShot * 11);

    legL.rotation.x = w.walk * s * 0.75 + w.cheer * Math.sin(oneShot * 8) * 0.22;
    legR.rotation.x = -w.walk * s * 0.75 - w.cheer * Math.sin(oneShot * 8) * 0.22;
    legL.rotation.z = w.cheer * 0.14;
    legR.rotation.z = -w.cheer * 0.14;

    const restArm = (w.idle + w.wave) * (0.07 + breathe * 0.02) + w.walk * 0.05;
    armL.rotation.x = -w.walk * s * 0.65 + (w.idle + w.wave) * sway * 0.04;
    armR.rotation.x = w.walk * s * 0.65 - w.idle * sway * 0.04;
    armL.rotation.z = restArm + w.cheer * (2.5 + flap * 0.22);
    armR.rotation.z = -(w.idle * (0.07 + breathe * 0.02) + w.walk * 0.05) - w.cheer * (2.5 - flap * 0.22) - w.wave * (2.55 + wave * 0.35);

    upper.position.y = w.idle * breathe * 0.01 + w.walk * Math.abs(Math.cos(walkPhase)) * 0.035 * amp;
    upper.rotation.x = w.walk * 0.06;
    upper.rotation.y = w.walk * s * 0.1;
    body.position.y = w.cheer * hop * 0.2;

    head.rotation.x = -w.cheer * 0.18;
    head.rotation.y = w.idle * Math.sin(clock * 0.8) * 0.12 - w.walk * s * 0.1;
    head.rotation.z = w.wave * 0.12;
  };
  pose();

  return {
    root,
    get config() {
      return current;
    },
    get emote() {
      return emote;
    },
    setConfig(next) {
      current = fillAvatar(next, rank);
      const changed = new Set<Part>();
      for (const part of ['head', 'torso', 'arm', 'leg'] as const) {
        const key = partKey(part, current, cord);
        if (key === keys[part]) continue;
        keys[part] = key;
        geometries[part].dispose();
        geometries[part] = buildPart(part, current, cord);
        changed.add(part);
      }
      if (changed.has('head')) headMesh.geometry = geometries.head;
      if (changed.has('torso')) torsoMesh.geometry = geometries.torso;
      if (changed.has('arm')) for (const m of armMeshes) m.geometry = geometries.arm;
      if (changed.has('leg')) for (const m of legMeshes) m.geometry = geometries.leg;
      applyBuild();
    },
    play(next) {
      oneShot = 0;
      emote = next;
    },
    update(dt, state) {
      if (state.moving !== prevMoving) {
        prevMoving = state.moving;
        if (state.moving) setEmote('walk');
        else if (emote === 'walk') setEmote('idle');
      }
      clock += dt;
      oneShot += dt;
      const length = ONE_SHOT_SECONDS[emote];
      if (length !== undefined && oneShot >= length) setEmote(prevMoving ? 'walk' : 'idle');

      for (const key of ['idle', 'walk', 'cheer', 'wave'] as const) {
        weights[key] = damp(weights[key], key === emote ? 1 : 0, BLEND_RATE, dt);
      }
      const targetGait = emote === 'walk' ? (state.speed > 0 ? state.speed : REFERENCE_SPEED) : 0;
      gait = damp(gait, targetGait, BLEND_RATE, dt);
      walkPhase += dt * STRIDE_RATE * gait;
      pose();
    },
    dispose() {
      for (const part of Object.keys(geometries) as Part[]) geometries[part].dispose();
      root.removeFromParent();
    },
  };
}
