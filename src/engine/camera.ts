import * as THREE from 'three';
import { dampAngle, dampFactor, shortestAngle, wrapAngle } from './damp';

/** What the camera follows. `position` is read live, so pass the object that gets moved each frame. */
export interface FollowTarget {
  position: THREE.Vector3;
  /** Heading in radians. Forward is (sin facing, 0, cos facing); 0 looks down +z. */
  facing: number;
  isMoving: boolean;
}

export const CAMERA_FOV = 50;
export const CAMERA_DISTANCE = 7.5;
export const CAMERA_HEIGHT = 3;
/** The camera looks at a point this far above the player's feet. */
export const CAMERA_LOOK_HEIGHT = 1.8;

// Damping rates, "per second". Bigger is snappier.
const POSITION_K = 6;
const LOOK_K = 10;
const YAW_K = 2.5;
/** The camera swings behind the player only after they have stood still this long (seconds). */
const RECENTER_DELAY = 0.35;
/** It never swings more than this far; turning the whole world around would confuse a kid. */
const MAX_RECENTER_SWING = THREE.MathUtils.degToRad(100);

/**
 * Third-person follow camera. Sits behind and above the player and looks slightly above their
 * head. There is no free look: the player never has to manage the camera.
 *
 * Design note: movement is camera-relative, so if the camera also kept turning to match the
 * player's facing while the stick is held sideways, the player would walk in circles. So the
 * view direction (`viewYaw`) holds steady while the player moves, then eases to sit behind
 * their facing once they stop. Position and look target are smoothed every frame.
 */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);

  private yaw = Math.PI; // looking down -z, the default Three.js view
  private idleTime = 0;
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();

  /**
   * Direction the camera looks along, as a heading in radians: forward is
   * (sin viewYaw, 0, cos viewYaw). The player moves relative to this.
   */
  get viewYaw(): number {
    return this.yaw;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight behind the target with no smoothing (first frame, zone change). */
  snapTo(target: FollowTarget): void {
    this.yaw = target.facing;
    this.idleTime = 0;
    this.computeDesired(target);
    this.position.copy(this.desiredPosition);
    this.lookAt.copy(this.desiredLook);
    this.apply();
  }

  /** Advance the camera by `dt` seconds (the real frame time; damping is frame-rate independent). */
  update(dt: number, target: FollowTarget): void {
    if (target.isMoving) {
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
      if (
        this.idleTime > RECENTER_DELAY &&
        Math.abs(shortestAngle(this.yaw, target.facing)) <= MAX_RECENTER_SWING
      ) {
        this.yaw = wrapAngle(dampAngle(this.yaw, target.facing, YAW_K, dt));
      }
    }

    this.computeDesired(target);
    this.position.lerp(this.desiredPosition, dampFactor(POSITION_K, dt));
    this.lookAt.lerp(this.desiredLook, dampFactor(LOOK_K, dt));
    this.apply();
  }

  private computeDesired(target: FollowTarget): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.desiredPosition.set(
      target.position.x - fx * CAMERA_DISTANCE,
      target.position.y + CAMERA_HEIGHT,
      target.position.z - fz * CAMERA_DISTANCE,
    );
    this.desiredLook.set(target.position.x, target.position.y + CAMERA_LOOK_HEIGHT, target.position.z);
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }
}
