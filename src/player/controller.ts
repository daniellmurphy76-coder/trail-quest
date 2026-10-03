import * as THREE from 'three';
import type { RankId } from '../activities/types';
import { dampAngle, shortestAngle, wrapAngle } from '../engine/damp';
import type { InputState } from '../engine/input';
import type { AvatarConfig } from '../save/types';
import { clampToBounds } from '../world/bounds';
import type { Zone } from '../world/zone';
import { defaultAvatar } from './avatar/options';
import { buildAvatar, type AvatarRig, type Emote } from './avatar/rig';

export interface PlayerOptions {
  /** The Scout's look. Defaults to the Wolf uniform. */
  avatar?: AvatarConfig;
  /** Decides the default neckerchief for an avatar that leaves it out (a v1 save). Default 'wolf'. */
  rank?: RankId;
}

export const PLAYER_SPEED = 4; // units per second
const TURN_K = 14; // how fast the player swings to face their direction of travel
const MOVE_THRESHOLD = 0.05; // stick magnitude below this counts as standing still

/**
 * The scout the kid controls: the blocky avatar rig (see player/avatar), walking when the stick is
 * pushed and breathing when it is not. The look can change at any time with `setAvatar`.
 */
export class Player {
  /** Scene object. Its transform is the interpolated, on-screen pose (see `interpolate`). */
  readonly root = new THREE.Group();
  /** Simulation position on the ground (y is 0). */
  readonly position = new THREE.Vector3();
  /** Heading in radians. Forward is (sin facing, 0, cos facing); the model's front is +z. */
  facing = Math.PI;
  isMoving = false;
  /**
   * Heading of the camera's view direction, in the same convention as `facing`. Set it from the
   * camera every update so "up" on the stick means "away from the camera".
   */
  viewYaw = Math.PI;

  private rig: AvatarRig;
  private rank: RankId;
  private readonly prevPosition = new THREE.Vector3();
  private prevFacing = this.facing;

  constructor(options: PlayerOptions = {}) {
    this.rank = options.rank ?? 'wolf';
    this.rig = buildAvatar(options.avatar ?? defaultAvatar(this.rank), { rank: this.rank });
    this.rig.root.name = 'player';
    this.root.add(this.rig.root);
  }

  /** The look now showing, with every field filled in. */
  get avatar(): AvatarRig['config'] {
    return this.rig.config;
  }

  /** What the avatar is playing now ('idle', 'walk', 'cheer' or 'wave'). */
  get emote(): Emote {
    return this.rig.emote;
  }

  /**
   * Change the Scout's look in place: only the parts that changed are rebuilt, and the pose and
   * position carry on. Pass the profile's `rank` so a v1 avatar gets its rank's neckerchief.
   */
  setAvatar(config: AvatarConfig, rank?: RankId): void {
    if (rank && rank !== this.rank) {
      // The rank sets the defaults for missing fields, so a new rank needs a new rig.
      this.rank = rank;
      const old = this.rig;
      const next = buildAvatar(config, { rank });
      next.root.name = 'player';
      next.play(old.emote);
      this.root.add(next.root);
      old.dispose();
      this.rig = next;
      return;
    }
    this.rig.setConfig(config);
  }

  /** Cheer: both arms up and a hop. Plays once, then back to standing or walking. */
  celebrate(): void {
    this.rig.play('cheer');
  }

  /** Wave hello. Plays once. */
  wave(): void {
    this.rig.play('wave');
  }

  /** Teleport (zone change, spawn). Clears interpolation so nothing slides. */
  setPosition(p: THREE.Vector3, facing = this.facing): void {
    this.position.set(p.x, 0, p.z);
    this.prevPosition.copy(this.position);
    this.facing = facing;
    this.prevFacing = facing;
    this.root.position.copy(this.position);
    this.root.rotation.y = facing;
  }

  /** One fixed simulation step. */
  update(dt: number, input: InputState, zone: Pick<Zone, 'bounds'>): void {
    this.prevPosition.copy(this.position);
    this.prevFacing = this.facing;

    const mx = input.move.x;
    const mz = input.move.z;
    const magnitude = Math.hypot(mx, mz);
    this.isMoving = magnitude > MOVE_THRESHOLD;

    if (this.isMoving) {
      // Camera-relative: forward is away from the camera, right is the camera's right.
      const fx = Math.sin(this.viewYaw);
      const fz = Math.cos(this.viewYaw);
      const dirX = -fz * mx - fx * mz;
      const dirZ = fx * mx - fz * mz;

      const next = clampToBounds(
        this.position.x + dirX * PLAYER_SPEED * dt,
        this.position.z + dirZ * PLAYER_SPEED * dt,
        zone.bounds,
      );
      this.position.x = next.x;
      this.position.z = next.z;
      this.facing = wrapAngle(dampAngle(this.facing, Math.atan2(dirX, dirZ), TURN_K, dt));
    }

    this.rig.update(dt, { moving: this.isMoving, speed: this.isMoving ? PLAYER_SPEED : 0 });
  }

  /** Place the scene object between the last two simulation steps. `alpha` is in [0, 1). */
  interpolate(alpha: number): void {
    this.root.position.lerpVectors(this.prevPosition, this.position, alpha);
    this.root.rotation.y = this.prevFacing + shortestAngle(this.prevFacing, this.facing) * alpha;
  }
}
