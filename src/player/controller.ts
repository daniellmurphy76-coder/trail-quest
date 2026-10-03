import * as THREE from 'three';
import { damp, dampAngle, shortestAngle, wrapAngle } from '../engine/damp';
import type { InputState } from '../engine/input';
import { clampToBounds } from '../world/bounds';
import { personPlaceholder, type Person } from '../world/props';
import type { Zone } from '../world/zone';

export interface PlayerOptions {
  /** Body color (hex). The neckerchief is a darker shade of it. */
  bodyColor: number;
}

export const PLAYER_SPEED = 4; // units per second
const PLAYER_HEIGHT = 1.95;
const TURN_K = 14; // how fast the player swings to face their direction of travel
const MOVE_THRESHOLD = 0.05; // stick magnitude below this counts as standing still
const BOB_RATE = 12; // radians per second
const BOB_HEIGHT = 0.07;

/** The scout the kid controls. Placeholder capsule body; art comes later. */
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

  private readonly person: Person;
  private readonly prevPosition = new THREE.Vector3();
  private prevFacing = this.facing;
  private bobPhase = 0;
  private bobAmount = 0;

  constructor(options: PlayerOptions) {
    this.person = personPlaceholder(options.bodyColor, PLAYER_HEIGHT);
    this.person.name = 'player';
    this.root.add(this.person);
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

    this.bobAmount = damp(this.bobAmount, this.isMoving ? 1 : 0, 12, dt);
    if (this.isMoving) this.bobPhase += dt * BOB_RATE;
    this.person.body.position.y = Math.abs(Math.sin(this.bobPhase)) * BOB_HEIGHT * this.bobAmount;
  }

  /** Place the scene object between the last two simulation steps. `alpha` is in [0, 1). */
  interpolate(alpha: number): void {
    this.root.position.lerpVectors(this.prevPosition, this.position, alpha);
    this.root.rotation.y = this.prevFacing + shortestAngle(this.prevFacing, this.facing) * alpha;
  }
}
