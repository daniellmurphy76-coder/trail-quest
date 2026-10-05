/**
 * The three ready-made heroes: whole starting looks a Scout can pick in one tap, then change like any
 * other look. Pure data and functions (no Three.js, no DOM).
 *
 * A hero only uses options that are free, so picking one never hands out something that has to be
 * earned (the scout hat, star eyes, the backpack, the gold shirt). A hero keeps the rank's
 * neckerchief, so a Wolf hero is still a Wolf.
 */
import type { RankId } from '../../activities/types';
import { defaultAvatar, sameAvatar, type FilledAvatar } from './options';

export type HeroId = 'trail-blazer' | 'camp-builder' | 'explorer';

/** The parts of a look a hero sets: everything except the neckerchief, which follows the rank. */
export type HeroLook = Omit<FilledAvatar, 'neckerchief' | 'bodyColor'>;

export interface Hero {
  id: HeroId;
  /** What the tile says. One or two words. */
  name: string;
  /** A short line under the name, in words a Wolf can read. */
  blurb: string;
  look: Readonly<HeroLook>;
}

export const HEROES: readonly Hero[] = [
  {
    id: 'trail-blazer',
    name: 'Trail Blazer',
    blurb: 'Small and fast.',
    look: {
      build: 'small',
      skin: '#efbf99',
      hairStyle: 'spiky',
      hairColor: '#c8652d',
      eyes: 'round',
      glasses: false,
      shirt: '#5b9bd5',
      legs: 'shorts',
      legColor: '#1f3557',
      shoes: '#c63d34',
      hat: 'cap',
      hatColor: '#c63d34',
      backpack: false,
    },
  },
  {
    id: 'camp-builder',
    name: 'Camp Builder',
    blurb: 'Smart and handy.',
    look: {
      build: 'regular',
      skin: '#a96e44',
      hairStyle: 'curly',
      hairColor: '#2b2320',
      eyes: 'happy',
      glasses: true,
      shirt: '#567a3a',
      legs: 'pants',
      legColor: '#7d8590',
      shoes: '#6b4a2f',
      hat: 'none',
      hatColor: '#ea8a2c',
      backpack: false,
    },
  },
  {
    id: 'explorer',
    name: 'Explorer',
    blurb: 'Tall and calm.',
    look: {
      build: 'tall',
      skin: '#d9a070',
      hairStyle: 'braids',
      hairColor: '#5a3a24',
      eyes: 'wink',
      glasses: false,
      shirt: '#1f3557',
      legs: 'pants',
      legColor: '#c9a877',
      shoes: '#2b2b30',
      hat: 'none',
      hatColor: '#567a3a',
      backpack: false,
    },
  },
];

/** One hero by id, or undefined for an id the game does not know. */
export function findHero(id: string): Hero | undefined {
  return HEROES.find((hero) => hero.id === id);
}

/** The hero's whole look for a Scout of this rank: the hero's style with the rank's neckerchief. */
export function heroAvatar(id: HeroId, rank: RankId): FilledAvatar {
  const hero = findHero(id) ?? HEROES[0]!;
  const base = defaultAvatar(rank);
  return { ...base, ...hero.look, bodyColor: hero.look.shirt, neckerchief: base.neckerchief };
}

/** The hero this look is, exactly, or undefined once anything has been changed. */
export function heroOf(look: Partial<FilledAvatar>, rank: RankId): HeroId | undefined {
  return HEROES.find((hero) => sameAvatar(look, heroAvatar(hero.id, rank), rank))?.id;
}
