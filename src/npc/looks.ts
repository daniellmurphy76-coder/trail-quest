/**
 * How each zone guide looks: a grown-up built on the same blocky rig as the Scouts. Looks only use
 * the rig; nothing here is offered in the avatar editor or saved.
 */
import { buildAvatar, type AvatarRig } from '../player/avatar/rig';
import type { FilledAvatar } from '../player/avatar/options';
import type { GuideId } from './guide-types';

/** Name tags hang this high (world units above the feet) unless a guide's hat needs more room. */
const LABEL_HEIGHT = 2.3;

export const GUIDE_LOOKS: Readonly<Record<GuideId, Readonly<FilledAvatar>>> = {
  coach: {
    bodyColor: '#c63d34', shirt: '#c63d34', build: 'regular', skin: '#a96e44', hairStyle: 'buzz', hairColor: '#2b2320',
    eyes: 'round', glasses: false, hat: 'cap', hatColor: '#2f5fa8', neckerchief: '#c63d34', legs: 'shorts',
    legColor: '#1f3557', shoes: '#f2f2f2', backpack: false,
  },
  ranger: {
    bodyColor: '#567a3a', shirt: '#567a3a', build: 'tall', skin: '#f8d9c0', hairStyle: 'ponytail', hairColor: '#94683c',
    eyes: 'round', glasses: false, hat: 'scout', hatColor: '#7d8590', neckerchief: '#567a3a', legs: 'pants',
    legColor: '#c9a877', shoes: '#6b4a2f', backpack: false,
  },
  mayor: {
    bodyColor: '#1f3557', shirt: '#1f3557', build: 'tall', skin: '#7a4a2c', hairStyle: 'short', hairColor: '#b9b9b9',
    eyes: 'happy', glasses: true, hat: 'none', hatColor: '#2b2b30', neckerchief: '#1f3557', legs: 'pants',
    legColor: '#2b2b30', shoes: '#2b2b30', backpack: false,
  },
  firefighter: {
    bodyColor: '#2b2b30', shirt: '#2b2b30', build: 'tall', skin: '#d9a070', hairStyle: 'short', hairColor: '#5a3a24',
    eyes: 'round', glasses: false, hat: 'cap', hatColor: '#c63d34', neckerchief: '#2b2b30', legs: 'pants',
    legColor: '#2b2b30', shoes: '#2b2b30', backpack: false,
  },
  'camp-cook': {
    bodyColor: '#f2f2f2', shirt: '#f2f2f2', build: 'regular', skin: '#4d2f1e', hairStyle: 'curly', hairColor: '#2b2320',
    eyes: 'happy', glasses: false, hat: 'beanie', hatColor: '#f2f2f2', neckerchief: '#f2f2f2', legs: 'pants',
    legColor: '#7d8590', shoes: '#2b2b30', backpack: false,
  },
};

/** How high this guide's name tag hangs above the feet. */
export function guideLabelHeight(_id: GuideId): number {
  return LABEL_HEIGHT;
}

/** A rig dressed as this guide. The root is named `guide-<id>`. */
export function createGuideRig(id: GuideId): AvatarRig {
  const rig = buildAvatar(GUIDE_LOOKS[id]);
  rig.root.name = `guide-${id}`;
  return rig;
}
