/**
 * How each zone guide looks: a grown-up built on the same blocky rig as the Scouts, with gear the Scouts never
 * wear (a helmet, an apron, a sash...). The looks span skin tones, hair styles and builds, and each guide has one
 * thing you can read from across the zone: the Coach's cap and whistle, the Ranger's round hat, the Mayor's sash,
 * the Firefighter's helmet, the Camp Cook's tall white hat. Looks only use the rig; nothing here is offered in
 * the avatar editor or saved.
 */
import { avatarTopHeight } from '../player/avatar/height';
import { buildAvatar, type AvatarRig, type NpcGear } from '../player/avatar/rig';
import type { FilledAvatar } from '../player/avatar/options';
import type { GuideId } from './guide-types';

/** Name tags hang this high (world units above the feet) unless a guide's hat needs more room. */
const LABEL_HEIGHT = 2.3;
/** A name tag floats at least this far above the guide's highest point. */
const LABEL_CLEARANCE = 0.25;

export const GUIDE_LOOKS: Readonly<Record<GuideId, Readonly<FilledAvatar>>> = {
  // A bright track top, shorts and a yellow cap, with braids and a whistle.
  coach: {
    bodyColor: '#7a56b8', shirt: '#7a56b8', build: 'regular', skin: '#a96e44', hairStyle: 'braids', hairColor: '#2b2320',
    eyes: 'round', glasses: false, hat: 'cap', hatColor: '#f2c230', neckerchief: '#f2f2f2', legs: 'shorts',
    legColor: '#1f3557', shoes: '#f2f2f2', backpack: false,
  },
  // A forest-green shirt, khaki pants and a brown round hat, with a ponytail and a badge.
  ranger: {
    bodyColor: '#415c2b', shirt: '#415c2b', build: 'tall', skin: '#f8d9c0', hairStyle: 'ponytail', hairColor: '#94683c',
    eyes: 'happy', glasses: false, hat: 'scout', hatColor: '#6b4a2f', neckerchief: '#567a3a', legs: 'pants',
    legColor: '#a88a5a', shoes: '#3b2a1d', backpack: false,
  },
  // A navy suit, gray hair and glasses, with an orange sash.
  mayor: {
    bodyColor: '#1f3557', shirt: '#1f3557', build: 'tall', skin: '#7a4a2c', hairStyle: 'short', hairColor: '#b9b9b9',
    eyes: 'happy', glasses: true, hat: 'none', hatColor: '#2b2b30', neckerchief: '#ea8a2c', legs: 'pants',
    legColor: '#1f3557', shoes: '#2b2b30', backpack: false,
  },
  // A tan turnout coat with yellow stripes, dark pants and a red helmet (the helmet takes the hat color).
  firefighter: {
    bodyColor: '#c9a877', shirt: '#c9a877', build: 'tall', skin: '#efbf99', hairStyle: 'short', hairColor: '#5a3a24',
    eyes: 'round', glasses: false, hat: 'none', hatColor: '#c63d34', neckerchief: '#2b2b30', legs: 'pants',
    legColor: '#2b2b30', shoes: '#2b2b30', backpack: false,
  },
  // A sky-blue shirt under a white apron, with curly hair and a tall white chef hat.
  'camp-cook': {
    bodyColor: '#5b9bd5', shirt: '#5b9bd5', build: 'regular', skin: '#4d2f1e', hairStyle: 'curly', hairColor: '#2b2320',
    eyes: 'happy', glasses: false, hat: 'none', hatColor: '#f2f2f2', neckerchief: '#f2f2f2', legs: 'pants',
    legColor: '#7d8590', shoes: '#2b2b30', backpack: false,
  },
};

/**
 * What each guide wears on top of its look. No guide wears a neckerchief: that is a Scout's. For the Coach, the Mayor
 * and the Camp Cook the look's `neckerchief` color is the accent: the whistle cord, the sash and the apron.
 */
export const GUIDE_GEAR: Readonly<Record<GuideId, Readonly<NpcGear>>> = {
  coach: { torso: ['whistle'], neckerchief: false },
  ranger: { torso: ['badge'], neckerchief: false },
  mayor: { torso: ['sash'], neckerchief: false },
  firefighter: { headgear: 'fire-helmet', torso: ['reflective-stripes'], neckerchief: false },
  'camp-cook': { headgear: 'chef-hat', torso: ['apron'], neckerchief: false },
};

const labelHeights = new Map<GuideId, number>();

/** How high this guide's name tag hangs above the feet: 2.3, or higher when the guide's hat or build needs more room. */
export function guideLabelHeight(id: GuideId): number {
  let height = labelHeights.get(id);
  if (height === undefined) {
    const top = avatarTopHeight(GUIDE_LOOKS[id], { npcGear: GUIDE_GEAR[id] });
    height = Math.max(LABEL_HEIGHT, top + LABEL_CLEARANCE);
    labelHeights.set(id, height);
  }
  return height;
}

/** A rig dressed as this guide. The root is named `guide-<id>`. */
export function createGuideRig(id: GuideId): AvatarRig {
  const rig = buildAvatar(GUIDE_LOOKS[id], { npcGear: GUIDE_GEAR[id] });
  rig.root.name = `guide-${id}`;
  return rig;
}
