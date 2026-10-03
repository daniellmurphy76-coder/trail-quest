import { buildAvatar, type AvatarRig } from './rig';
import type { FilledAvatar } from './options';

/**
 * The Den Chief: an older Scout, tall, in a ranger hat and glasses, with a happy squint and a
 * yellow cord across the chest. Friendly and a little goofy. Looks nothing like the default
 * Scout colors (blue or tan), so a kid can tell them apart at a glance.
 */
export const DEN_CHIEF_AVATAR: Readonly<FilledAvatar> = {
  bodyColor: '#567a3a',
  shirt: '#567a3a',
  build: 'tall',
  skin: '#d9a070',
  hairStyle: 'short',
  hairColor: '#2b2320',
  eyes: 'happy',
  glasses: true,
  hat: 'scout',
  hatColor: '#c9a877',
  neckerchief: '#c63d34',
  legs: 'pants',
  legColor: '#c9a877',
  shoes: '#6b4a2f',
  backpack: false,
};

/** A rig dressed as the Den Chief. The root is named 'den-chief'. */
export function createDenChief(): AvatarRig {
  const rig = buildAvatar(DEN_CHIEF_AVATAR, { denChiefCord: true });
  rig.root.name = 'den-chief';
  return rig;
}
