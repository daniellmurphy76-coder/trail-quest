// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GUIDES } from '../../src/npc/guide-types';
import { HEROES, findHero, heroAvatar, heroOf, type HeroId } from '../../src/player/avatar/heroes';
import { optionIcon } from '../../src/player/avatar/icons';
import {
  BUILDS,
  CLOTHES_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_COLORS,
  HAT_STYLES,
  LEG_STYLES,
  RANK_IDS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
  COSMETIC_LOCKS,
  defaultAvatar,
  fillAvatar,
  sameAvatar,
  type Choice,
  type FilledAvatar,
} from '../../src/player/avatar/options';

const HERO_IDS: readonly HeroId[] = ['trail-blazer', 'camp-builder', 'explorer'];
const HEX = /^#[0-9a-f]{6}$/;
const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

describe('HEROES', () => {
  it('has exactly three heroes, in the order the editor shows them, with unique ids and names', () => {
    expect(HEROES).toHaveLength(3);
    expect(HEROES.map((hero) => hero.id)).toEqual(HERO_IDS);
    expect(HEROES.map((hero) => hero.name)).toEqual(['Trail Blazer', 'Camp Builder', 'Explorer']);
    expect(new Set(HEROES.map((hero) => hero.id)).size).toBe(3);
    expect(new Set(HEROES.map((hero) => hero.name)).size).toBe(3);
  });

  it('never shares a name with a zone guide, so a kid does not mix the two up (the Ranger guide, the Explorer hero)', () => {
    const roles = GUIDES.map((guide) => guide.role.toLowerCase());
    for (const hero of HEROES) {
      expect(roles, hero.name).not.toContain(hero.name.toLowerCase());
      expect(GUIDES.map((guide) => guide.id as string), hero.id).not.toContain(hero.id);
    }
    expect(findHero('ranger')).toBeUndefined();
    expect(findHero('explorer')?.name).toBe('Explorer');
  });

  it.each(HEROES.map((hero) => [hero.id, hero] as const))('%s: a name of one or two words and a blurb a Wolf can read', (_id, hero) => {
    expect(hero.name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
    expect(words(hero.name).length).toBeLessThanOrEqual(2);
    expect(words(hero.blurb).length).toBeGreaterThanOrEqual(1);
    expect(words(hero.blurb).length).toBeLessThanOrEqual(10); // Wolf reading level: 10 words or fewer
    expect(hero.blurb).toMatch(/^[A-Z][A-Za-z ,]+[.!]$/); // a plain sentence: no digits, no odd symbols
  });

  it('keeps the neckerchief and the body color out of the hero looks: those follow the rank and the shirt', () => {
    for (const hero of HEROES) {
      expect(Object.keys(hero.look), hero.id).not.toContain('neckerchief');
      expect(Object.keys(hero.look), hero.id).not.toContain('bodyColor');
    }
  });

  it('gives every hero a full look: the same fields as a default Scout, less neckerchief and body color', () => {
    const wanted = Object.keys(defaultAvatar('wolf'))
      .filter((key) => key !== 'neckerchief' && key !== 'bodyColor')
      .sort();
    for (const hero of HEROES) {
      expect(Object.keys(hero.look).sort(), hero.id).toEqual(wanted);
      for (const [key, value] of Object.entries(hero.look)) expect(value, `${hero.id}.${key}`).not.toBeUndefined();
    }
  });

  it('never needs an earned option: no scout hat, beanie, bucket hat, star eyes, backpack or gold shirt', () => {
    const lockedHats = COSMETIC_LOCKS.filter((lock) => lock.group === 'hat').map((lock) => lock.value);
    const lockedShirts = COSMETIC_LOCKS.filter((lock) => lock.group === 'shirt').map((lock) => lock.value);
    for (const hero of HEROES) {
      expect(lockedHats, hero.id).not.toContain(hero.look.hat);
      expect(lockedShirts, hero.id).not.toContain(hero.look.shirt);
      expect(hero.look.eyes, hero.id).not.toBe('star');
      expect(hero.look.backpack, hero.id).toBe(false);
    }
  });

  it('draws every value from the option lists, so every other tab shows a check for a picked hero', () => {
    const has = (list: readonly Choice[], value: string): boolean => list.some((choice) => choice.value === value);
    for (const { id, look } of HEROES) {
      expect(has(BUILDS, look.build), `${id} build`).toBe(true);
      expect(has(SKIN_TONES, look.skin), `${id} skin`).toBe(true);
      expect(has(HAIR_STYLES, look.hairStyle), `${id} hairStyle`).toBe(true);
      expect(has(HAIR_COLORS, look.hairColor), `${id} hairColor`).toBe(true);
      expect(has(EYE_STYLES, look.eyes), `${id} eyes`).toBe(true);
      expect(typeof look.glasses, `${id} glasses`).toBe('boolean');
      expect(has(SHIRT_COLORS, look.shirt), `${id} shirt`).toBe(true);
      expect(has(LEG_STYLES, look.legs), `${id} legs`).toBe(true);
      expect(has(CLOTHES_COLORS, look.legColor), `${id} legColor`).toBe(true);
      expect(has(SHOE_COLORS, look.shoes), `${id} shoes`).toBe(true);
      expect(has(HAT_STYLES, look.hat), `${id} hat`).toBe(true);
      expect(has(HAT_COLORS, look.hatColor), `${id} hatColor`).toBe(true);
      expect(typeof look.backpack, `${id} backpack`).toBe('boolean');
      for (const color of [look.skin, look.hairColor, look.shirt, look.legColor, look.shoes, look.hatColor]) {
        expect(color, id).toMatch(HEX);
      }
    }
  });

  it('makes the three heroes differ from each other and from a default Scout of every rank', () => {
    for (const a of HEROES) {
      for (const b of HEROES) {
        if (a.id === b.id) continue;
        expect(sameAvatar(heroAvatar(a.id, 'wolf'), heroAvatar(b.id, 'wolf'), 'wolf'), `${a.id} vs ${b.id}`).toBe(false);
      }
      for (const rank of RANK_IDS) {
        expect(sameAvatar(heroAvatar(a.id, rank), defaultAvatar(rank), rank), `${a.id} vs ${rank} default`).toBe(false);
      }
    }
    // One of each size, so the three tiles are easy to tell apart.
    expect(HEROES.map((hero) => hero.look.build).sort()).toEqual(['regular', 'small', 'tall']);
  });

  it('has no gender in the names or the blurbs', () => {
    const text = HEROES.flatMap((hero) => words(`${hero.name} ${hero.blurb}`.toLowerCase().replace(/[^a-z ]/g, '')));
    for (const banned of ['boy', 'girl', 'male', 'female', 'man', 'woman', 'he', 'she', 'his', 'her']) {
      expect(text).not.toContain(banned);
    }
  });
});

describe('findHero', () => {
  it.each(HERO_IDS)('finds %s', (id) => {
    expect(findHero(id)?.id).toBe(id);
    expect(findHero(id)).toBe(HEROES.find((hero) => hero.id === id));
  });

  it('is undefined for an id the game does not know', () => {
    expect(findHero('nope')).toBeUndefined();
    expect(findHero('')).toBeUndefined();
    expect(findHero('Explorer')).toBeUndefined(); // ids, not names
  });
});

describe('heroAvatar', () => {
  const pairs = RANK_IDS.flatMap((rank) => HERO_IDS.map((id) => [rank, id] as const));

  it.each(pairs)('%s %s: keeps the rank neckerchief, wears the hero shirt as its body color, and uses no earned option', (rank, id) => {
    const look = heroAvatar(id, rank);
    const hero = findHero(id)!;
    expect(look.neckerchief).toBe(defaultAvatar(rank).neckerchief);
    expect(look.bodyColor).toBe(hero.look.shirt);
    expect(look.bodyColor).toBe(look.shirt);
    expect(look).toMatchObject(hero.look);
    // A hero never needs an earned option, so an empty unlocks list changes nothing.
    expect(fillAvatar(look, rank, [])).toEqual(look);
    expect(fillAvatar(look, rank)).toEqual(look);
  });

  it('has every field of a default Scout filled in', () => {
    for (const rank of RANK_IDS) {
      for (const id of HERO_IDS) {
        expect(Object.keys(heroAvatar(id, rank)).sort(), `${rank} ${id}`).toEqual(Object.keys(defaultAvatar(rank)).sort());
      }
    }
  });

  it('only the neckerchief changes from one rank to the next', () => {
    for (const id of HERO_IDS) {
      const wolf = heroAvatar(id, 'wolf');
      const bear = heroAvatar(id, 'bear');
      expect(bear.neckerchief).not.toBe(wolf.neckerchief);
      expect({ ...bear, neckerchief: wolf.neckerchief }).toEqual(wolf);
    }
  });

  it('returns a fresh object each time, so a change to one look never leaks into the hero', () => {
    const first = heroAvatar('explorer', 'wolf');
    first.skin = '#000000';
    first.hat = 'cap';
    const second = heroAvatar('explorer', 'wolf');
    expect(second.skin).toBe(findHero('explorer')!.look.skin);
    expect(second.hat).toBe('none');
    expect(findHero('explorer')!.look.skin).not.toBe('#000000');
  });
});

describe('heroOf', () => {
  const pairs = RANK_IDS.flatMap((rank) => HERO_IDS.map((id) => [rank, id] as const));

  it.each(pairs)('%s %s: a hero look is that hero', (rank, id) => {
    expect(heroOf(heroAvatar(id, rank), rank)).toBe(id);
  });

  it.each(RANK_IDS)('%s: a default Scout is no hero', (rank) => {
    expect(heroOf(defaultAvatar(rank), rank)).toBeUndefined();
    expect(heroOf({}, rank)).toBeUndefined();
  });

  it('fills in a partial look from the rank, so a hero look without neckerchief or body color still matches', () => {
    for (const hero of HEROES) {
      for (const rank of RANK_IDS) expect(heroOf(hero.look, rank), `${rank} ${hero.id}`).toBe(hero.id);
    }
  });

  it('is undefined once any single field of a hero look is changed', () => {
    const lists: Partial<Record<keyof FilledAvatar, readonly Choice[]>> = {
      build: BUILDS,
      hairStyle: HAIR_STYLES,
      eyes: EYE_STYLES,
      legs: LEG_STYLES,
      hat: HAT_STYLES,
    };
    /** A value that differs from the current one but is still a valid value for the field. */
    const changed = (key: keyof FilledAvatar, value: FilledAvatar[keyof FilledAvatar]): FilledAvatar[keyof FilledAvatar] => {
      if (typeof value === 'boolean') return !value;
      const list = lists[key];
      if (list) return list.find((choice) => choice.value !== value)!.value;
      return value === '#123456' ? '#654321' : '#123456'; // any other field is a color
    };
    for (const rank of RANK_IDS) {
      for (const id of HERO_IDS) {
        const look = heroAvatar(id, rank);
        for (const key of Object.keys(look) as Array<keyof FilledAvatar>) {
          const edited = { ...look, [key]: changed(key, look[key]) };
          expect(edited[key], `${rank} ${id} ${key} differs`).not.toBe(look[key]);
          expect(heroOf(edited, rank), `${rank} ${id} ${key}`).toBeUndefined();
        }
      }
    }
  });

  it('is undefined for a hero look worn by a Scout of another rank, whose neckerchief is different', () => {
    expect(heroOf(heroAvatar('explorer', 'wolf'), 'bear')).toBeUndefined();
    expect(heroOf(heroAvatar('explorer', 'bear'), 'wolf')).toBeUndefined();
  });

  it('is undefined for the second hero look with the first hero hair, and the other way round', () => {
    const blazer = heroAvatar('trail-blazer', 'wolf');
    const builder = heroAvatar('camp-builder', 'wolf');
    expect(heroOf({ ...blazer, hairStyle: builder.hairStyle }, 'wolf')).toBeUndefined();
    expect(heroOf({ ...builder, hairStyle: blazer.hairStyle }, 'wolf')).toBeUndefined();
  });
});

describe('optionIcon for a hero', () => {
  // The drawing's own stand-in colors for skin, hair and shirt: they must not be left on a hero tile.
  const STAND_IN = { skin: '#efbf99', hair: '#5a3a24', shirt: '#5b9bd5' };

  it.each(HEROES.map((hero) => [hero.id, hero] as const))('%s: draws head and shoulders in the hero own colors', (id, hero) => {
    const icon = optionIcon('hero', id);
    const markup = icon.outerHTML.toLowerCase();
    expect(icon.localName).toBe('svg');
    expect(icon.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(icon.getAttribute('aria-hidden')).toBe('true'); // decorative: the tile's word is the label
    expect(icon.getAttribute('class')).toBe('tq-opt__icon');
    expect(icon.childNodes.length).toBeGreaterThan(0);
    expect(markup).toContain(hero.look.shirt);
    expect(markup).toContain(hero.look.skin);
    // The cap covers the hair, so only a hero without a cap shows the hair color.
    if (hero.look.hat === 'none') expect(markup).toContain(hero.look.hairColor);
    // Where the hero differs from the stand-in colors, the stand-in is gone.
    if (hero.look.shirt !== STAND_IN.shirt) expect(markup).not.toContain(STAND_IN.shirt);
    if (hero.look.skin !== STAND_IN.skin) expect(markup).not.toContain(STAND_IN.skin);
    if (hero.look.hairColor !== STAND_IN.hair) expect(markup).not.toContain(STAND_IN.hair);
  });

  it('shows the hair color of the heroes without a cap, and hides the hair under the cap of the one with a cap', () => {
    const capped = HEROES.filter((hero) => hero.look.hat === 'cap');
    const bareHeaded = HEROES.filter((hero) => hero.look.hat === 'none');
    expect(capped.length).toBeGreaterThan(0);
    expect(bareHeaded.length).toBeGreaterThan(0);
    for (const hero of capped) {
      expect(optionIcon('hero', hero.id).outerHTML.toLowerCase(), hero.id).not.toContain(hero.look.hairColor);
    }
    for (const hero of bareHeaded) {
      expect(optionIcon('hero', hero.id).outerHTML.toLowerCase(), hero.id).toContain(hero.look.hairColor);
    }
  });

  it('puts the hat color on a hero who wears a hat, and leaves it off a hero who does not', () => {
    const capped = HEROES.filter((hero) => hero.look.hat === 'cap');
    const bareHeaded = HEROES.filter((hero) => hero.look.hat === 'none');
    expect(capped.length).toBeGreaterThan(0);
    expect(bareHeaded.length).toBeGreaterThan(0);
    for (const hero of capped) {
      expect(optionIcon('hero', hero.id).outerHTML.toLowerCase(), hero.id).toContain(hero.look.hatColor);
    }
    for (const hero of bareHeaded) {
      const { shirt, skin, hairColor, hatColor } = hero.look;
      // A hat color the hero's own clothes or hair happen to share would show up anyway, so skip those.
      if ([shirt, skin, hairColor].includes(hatColor)) continue;
      expect(optionIcon('hero', hero.id).outerHTML.toLowerCase(), hero.id).not.toContain(hatColor);
    }
  });

  it('draws a pair of glasses only on a hero who wears them', () => {
    const rings = (id: string): number => optionIcon('hero', id).querySelectorAll('circle[fill="none"]').length;
    expect(HEROES.some((hero) => hero.look.glasses)).toBe(true);
    expect(HEROES.some((hero) => !hero.look.glasses)).toBe(true);
    for (const hero of HEROES) expect(rings(hero.id), hero.id).toBe(hero.look.glasses ? 2 : 0);
  });

  it('makes the three pictures different, and a fresh element each time', () => {
    const markups = HERO_IDS.map((id) => optionIcon('hero', id).outerHTML);
    expect(new Set(markups).size).toBe(3);
    expect(optionIcon('hero', 'explorer')).not.toBe(optionIcon('hero', 'explorer'));
    expect(optionIcon('hero', 'explorer').outerHTML).toBe(optionIcon('hero', 'explorer').outerHTML);
  });

  it('draws an empty picture for an id the game does not know, and does not throw', () => {
    const icon = optionIcon('hero', 'nope');
    expect(icon.localName).toBe('svg');
    expect(icon.childNodes).toHaveLength(0);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
