import { CAMERA_DISTANCE } from '../engine/camera';

/**
 * Keep tree canopies out of the way of the follow camera.
 *
 * The KayKit tree models have crowns about twice as wide as the old primitive cones and they start
 * low (an oak's foliage begins under a meter off the ground). The follow camera sits `CAMERA_DISTANCE`
 * (7.5) units behind the player and 3 up, which is level with the foliage, so a canopy over that
 * spot puts leaves in front of the lens. On arrival the player stands at the zone's spawn facing
 * -z, so the camera hangs at (spawn.x, spawn.z + 7.5), usually out past the wall of trees.
 *
 * The "camera lane" is the ground strip from just ahead of the spawn back to a little past that
 * point. No canopy (a circle of `reach` around a trunk) may overlap it. The same circle test also
 * keeps canopies off the main paths.
 */

/** Half the width of the lane, either side of the spawn's x. */
export const CAMERA_LANE_HALF_WIDTH = 4;
/** The lane starts this far ahead of the spawn (toward -z) so the Scout is not framed by leaves either. */
export const CAMERA_LANE_AHEAD = 1.5;
/** ...and runs this far past the point where the camera sits on arrival. */
export const CAMERA_LANE_BEYOND = 3;

export interface Lane {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The camera lane behind a spawn at (x, z), for a Scout who arrives facing -z. */
export function cameraLane(spawn: { x: number; z: number }): Lane {
  return {
    minX: spawn.x - CAMERA_LANE_HALF_WIDTH,
    maxX: spawn.x + CAMERA_LANE_HALF_WIDTH,
    minZ: spawn.z - CAMERA_LANE_AHEAD,
    maxZ: spawn.z + CAMERA_DISTANCE + CAMERA_LANE_BEYOND,
  };
}

/** True when a canopy (a circle of `reach` around a trunk at (x, z)) overlaps the rectangle `lane`. */
export function canopyHitsLane(x: number, z: number, reach: number, lane: Lane): boolean {
  const nearX = Math.min(lane.maxX, Math.max(lane.minX, x));
  const nearZ = Math.min(lane.maxZ, Math.max(lane.minZ, z));
  return Math.hypot(x - nearX, z - nearZ) < reach;
}

/**
 * How far each tree model's crown reaches from its trunk, in world units at scale 1 (the farthest
 * vertex of the model, measured on the glTF and rounded up a little). Placement scale multiplies it.
 */
export const TREE_CROWN_REACH: Readonly<Record<string, number>> = {
  'tree.pine': 1.45,
  'tree.pine.tall': 1.45,
  'tree.pine.round': 2.05,
  'tree.round': 2.35,
  'tree.oak': 2.65,
  'tree.fall': 2.2,
  'tree.birch': 2.2,
};

/** The widest crown a zone can grow: the largest reach among its tree models times its largest scale. */
export function worstCrownReach(ids: readonly string[], scale: readonly [number, number]): number {
  let widest = 0;
  for (const id of ids) {
    const reach = TREE_CROWN_REACH[id];
    if (reach === undefined) throw new Error(`no crown reach known for ${id}`);
    widest = Math.max(widest, reach);
  }
  return widest * Math.max(scale[0], scale[1]);
}
