import { describe, expect, it } from 'vitest';
import {
  BUILDS,
  CLOTHES_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_COLORS,
  HAT_STYLES,
  LEG_STYLES,
  NECKERCHIEF_COLORS,
  RANK_IDS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
  cleanColor,
  defaultAvatar,
  fillAvatar,
  randomAvatar,
  sameAvatar,
  type Choice,
} from '../../src/player/avatar/options';
import { mulberry32 } from '../../src/engine/seed';

const HEX = /^#[0-9a-f]{6}$/;
const lists: Record<string, readonly Choice[]> = {
  SKIN_TONES,
  HAIR_COLORS,
  CLOTHES_COLORS,
  SHOE_COLORS,
  HAT_COLORS,
  NECKERCHIEF_COLORS,
  HAIR_STYLES,
  EYE_STYLES,
  HAT_STYLES,
  LEG_STYLES,
  BUILDS,
};

describe('option lists', () => {
  it('has the counts the editor needs', () => {
    expect(SKIN_TONES).toHaveLength(6);
    expect(HAIR_COLORS).toHaveLength(8);
    expect(CLOTHES_COLORS).toHaveLength(8);
    expect(SHOE_COLORS).toHaveLength(6);
    expect(HAIR_STYLES.map((c) => c.value)).toEqual(['none', 'buzz', 'short', 'spiky', 'curly', 'long', 'ponytail', 'braids']);
    expect(EYE_STYLES.map((c) => c.value)).toEqual(['round', 'happy', 'wink', 'star']);
    expect(HAT_STYLES.map((c) => c.value)).toEqual(['none', 'cap', 'bucket', 'beanie', 'scout']);
    expect(LEG_STYLES.map((c) => c.value)).toEqual(['shorts', 'pants', 'skort']);
    expect(BUILDS.map((c) => c.value)).toEqual(['small', 'regular', 'tall']);
  });

  it.each(Object.entries(lists))('%s: unique values, and one or two everyday words for each label', (_name, list) => {
    expect(new Set(list.map((c) => c.value)).size).toBe(list.length);
    expect(new Set(list.map((c) => c.label)).size).toBe(list.length); // color-blind kids tell options apart by name
    for (const { label } of list) {
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
      expect(label.split(' ').length).toBeLessThanOrEqual(2);
    }
  });

  it('every color is a lowercase #rrggbb', () => {
    for (const list of [SKIN_TONES, HAIR_COLORS, CLOTHES_COLORS, SHOE_COLORS, HAT_COLORS, NECKERCHIEF_COLORS]) {
      for (const { value } of list) expect(value).toMatch(HEX);
    }
  });

  it('has no gender anywhere in the labels', () => {
    const words = Object.values(lists).flatMap((list) => list.map((c) => c.label.toLowerCase()));
    for (const banned of ['boy', 'girl', 'male', 'female', 'man', 'woman']) expect(words).not.toContain(banned);
  });
});

describe('defaultAvatar', () => {
  it.each(RANK_IDS)('%s: every field is filled and every color is on the editor lists', (rank) => {
    const a = defaultAvatar(rank);
    for (const [key, value] of Object.entries(a)) expect(value, key).not.toBeUndefined();
    expect(a.shirt).toBe(a.bodyColor);
    const has = (list: readonly Choice[], v: string): boolean => list.some((c) => c.value === v);
    expect(has(SKIN_TONES, a.skin)).toBe(true);
    expect(has(HAIR_COLORS, a.hairColor)).toBe(true);
    expect(has(CLOTHES_COLORS, a.shirt)).toBe(true);
    expect(has(CLOTHES_COLORS, a.legColor)).toBe(true);
    expect(has(SHOE_COLORS, a.shoes)).toBe(true);
    expect(has(HAT_COLORS, a.hatColor)).toBe(true);
    expect(has(NECKERCHIEF_COLORS, a.neckerchief)).toBe(true);
  });

  it('dresses each rank in its uniform colors and neckerchief', () => {
    const neck = (rank: (typeof RANK_IDS)[number]): string => defaultAvatar(rank).neckerchief;
    expect(neck('lion')).toBe('#f2c230'); // yellow
    expect(neck('tiger')).toBe('#ea8a2c'); // orange
    expect(neck('wolf')).toBe('#c63d34'); // red
    expect(neck('bear')).toBe('#7ec8ea'); // light blue
    expect(neck('webelos')).toBe(neck('arrow-of-light')); // plaid, approximated as green
    expect(neck('webelos')).toBe('#2f7a46');
    // Blue shirts through Bear, tan from Webelos.
    expect(defaultAvatar('lion').shirt).toBe(defaultAvatar('tiger').shirt);
    expect(defaultAvatar('wolf').shirt).toBe(defaultAvatar('bear').shirt);
    expect(defaultAvatar('wolf').shirt).not.toBe(defaultAvatar('lion').shirt);
    expect(defaultAvatar('webelos').shirt).toBe('#c9a877');
    expect(defaultAvatar('arrow-of-light').shirt).toBe('#c9a877');
  });

  it('returns a fresh object each time', () => {
    const a = defaultAvatar('wolf');
    a.hat = 'cap';
    expect(defaultAvatar('wolf').hat).toBe('none');
  });
});

describe('fillAvatar', () => {
  it.each(RANK_IDS)('%s: an empty config becomes the rank default', (rank) => {
    expect(fillAvatar({} as never, rank)).toEqual(defaultAvatar(rank));
  });

  it('turns a v1 avatar (bodyColor only) into a full one, with bodyColor as the shirt', () => {
    const filled = fillAvatar({ bodyColor: '#E07A5F' }, 'bear');
    expect(filled.shirt).toBe('#e07a5f');
    expect(filled.bodyColor).toBe('#e07a5f');
    expect(filled.neckerchief).toBe(defaultAvatar('bear').neckerchief);
    expect(filled.hairStyle).toBe('short');
  });

  it('keeps what is set and fills the rest', () => {
    const filled = fillAvatar({ bodyColor: '#2f5fa8', hat: 'bucket', glasses: true, build: 'tall', shirt: '#c63d34' }, 'wolf');
    expect(filled).toMatchObject({ hat: 'bucket', glasses: true, build: 'tall', shirt: '#c63d34', backpack: false });
  });

  it('drops values the game does not know instead of passing them on', () => {
    const filled = fillAvatar(
      {
        bodyColor: 'not a color',
        hat: 'tophat',
        hairStyle: 'mohawk' as never,
        eyes: 'laser' as never,
        build: 'giant' as never,
        legs: 'kilt' as never,
        skin: 'javascript:alert(1)',
        glasses: 'yes' as never,
      },
      'wolf',
    );
    expect(filled).toEqual(defaultAvatar('wolf'));
  });

  it('accepts short hex colors and tidies case', () => {
    expect(cleanColor('#ABC')).toBe('#aabbcc');
    expect(cleanColor(' #2F5FA8 ')).toBe('#2f5fa8');
    expect(cleanColor('blue')).toBeUndefined();
    expect(cleanColor(12)).toBeUndefined();
  });

  it('never fails on missing input', () => {
    expect(fillAvatar(undefined)).toEqual(defaultAvatar('wolf'));
    expect(fillAvatar(null)).toEqual(defaultAvatar('wolf'));
  });

  it('sameAvatar compares the filled forms', () => {
    expect(sameAvatar({ bodyColor: '#2f5fa8' }, defaultAvatar('wolf'))).toBe(true);
    expect(sameAvatar({ bodyColor: '#2f5fa8' }, { bodyColor: '#2f5fa8', hat: 'cap' })).toBe(false);
  });
});

describe('randomAvatar', () => {
  it('is repeatable for a seed and always picks from the lists', () => {
    expect(randomAvatar('wolf', mulberry32(7))).toEqual(randomAvatar('wolf', mulberry32(7)));
    for (let seed = 0; seed < 60; seed++) {
      const a = randomAvatar('bear', mulberry32(seed));
      expect(SKIN_TONES.map((c) => c.value)).toContain(a.skin);
      expect(HAIR_STYLES.map((c) => c.value)).toContain(a.hairStyle);
      expect(HAT_STYLES.map((c) => c.value)).toContain(a.hat);
      expect(SHIRT_COLORS.map((c) => c.value)).toContain(a.shirt);
      expect(a.bodyColor).toBe(a.shirt);
      expect(a.neckerchief).toBe(defaultAvatar('bear').neckerchief); // the rank color stays
      expect(fillAvatar(a, 'bear')).toEqual(a);
    }
  });

  it('actually varies', () => {
    const looks = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(randomAvatar('wolf', mulberry32(i)))));
    expect(looks.size).toBeGreaterThan(20);
  });
});
