/**
 * How tall a look stands: the height of its highest point above the feet, hair, hat or headgear included. Callers use
 * it to hang something (a name tag) above a character without building a rig first.
 *
 * The Kenney Blocky Scout and the procedural Scout stand on the same 1.8 and differ a little by build, so the answer is
 * the taller of the two: a tag that clears one clears the other, whichever is showing.
 */
import type { AvatarConfig } from '../../save/types';
import { buildHeadAttachments, KIT } from './blocky/attachments';
import { SCOUT_HEIGHT } from './blocky/model';
import { BLOCKY_BUILD_SCALE } from './blocky/rig';
import { fillAvatar } from './options';
import { buildHeadGeometry, JOINTS } from './parts';
import { BUILD_SCALE } from './procedural';
import type { AvatarRigOptions } from './rig-types';

/** World height of the highest point of a Scout (or guide) with this look and gear, standing at rest. */
export function avatarTopHeight(config: AvatarConfig, options: Pick<AvatarRigOptions, 'rank' | 'npcGear'> = {}): number {
  const cfg = fillAvatar(config, options.rank ?? 'wolf');
  const gear = options.npcGear;

  // The Kenney Scout: the head's base, then the head or whatever sticks out above it, in kit units, scaled to the Scout.
  const extras = buildHeadAttachments(cfg, { npcGear: gear });
  const kitTop = Math.max(KIT.headHeight, extras?.boundingBox?.max.y ?? 0);
  extras?.dispose();
  const kit = (KIT.headBase + kitTop) * (SCOUT_HEIGHT / KIT.height) * BLOCKY_BUILD_SCALE[cfg.build];

  // The procedural Scout: its head turns about the neck, and is scaled by the build.
  const head = buildHeadGeometry(cfg, gear);
  const build = BUILD_SCALE[cfg.build];
  const plain = build.height * (JOINTS.neckY + build.head * head.boundingBox!.max.y);
  head.dispose();

  return Math.max(kit, plain);
}
