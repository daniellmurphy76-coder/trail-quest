/**
 * Avatar options: the lists the editor offers, the defaults for each rank, and helpers that fill
 * and clean an `AvatarConfig`. Pure data and functions: no Three.js, no DOM, so the save layer
 * can use them too.
 *
 * Every color is a lowercase `#rrggbb`. Every label is one or two everyday words, because the
 * labels are what a kid reads (and what a color-blind kid reads instead of the color).
 */
import type { RankId } from '../../activities/types';
import type { AvatarConfig } from '../../save/types';

/** A config with every field present: what the rig and the editor work with. */
export type FilledAvatar = Required<AvatarConfig>;

export type Build = NonNullable<AvatarConfig['build']>;
export type HairStyle = NonNullable<AvatarConfig['hairStyle']>;
export type EyeStyle = NonNullable<AvatarConfig['eyes']>;
export type LegStyle = NonNullable<AvatarConfig['legs']>;
export type HatStyle = 'none' | 'cap' | 'bucket' | 'beanie' | 'scout';

/** One thing a kid can pick. `label` is what they read. */
export interface Choice<T extends string = string> {
  value: T;
  label: string;
}

const choices = <T extends string>(entries: ReadonlyArray<readonly [T, string]>): readonly Choice<T>[] =>
  entries.map(([value, label]) => ({ value, label }));

// ---- colors -------------------------------------------------------------------------------------

export const SKIN_TONES = choices([
  ['#f8d9c0', 'Light'],
  ['#efbf99', 'Peach'],
  ['#d9a070', 'Tan'],
  ['#a96e44', 'Brown'],
  ['#7a4a2c', 'Deep brown'],
  ['#4d2f1e', 'Dark brown'],
]);

export const HAIR_COLORS = choices([
  ['#2b2320', 'Black'],
  ['#5a3a24', 'Brown'],
  ['#94683c', 'Light brown'],
  ['#e6c36a', 'Blonde'],
  ['#c8652d', 'Ginger'],
  ['#b9b9b9', 'Gray'],
  ['#3f78d0', 'Blue'],
  ['#e46fa8', 'Pink'],
]);

/** Shirt colors and leg colors share one list. */
export const CLOTHES_COLORS = choices([
  ['#5b9bd5', 'Sky blue'],
  ['#2f5fa8', 'Blue'],
  ['#1f3557', 'Navy'],
  ['#c9a877', 'Tan'],
  ['#567a3a', 'Green'],
  ['#c63d34', 'Red'],
  ['#7a56b8', 'Purple'],
  ['#7d8590', 'Gray'],
]);

export const SHOE_COLORS = choices([
  ['#6b4a2f', 'Brown'],
  ['#2b2b30', 'Black'],
  ['#f2f2f2', 'White'],
  ['#c63d34', 'Red'],
  ['#2f5fa8', 'Blue'],
  ['#f2c230', 'Yellow'],
]);

export const HAT_COLORS = choices([
  ['#2f5fa8', 'Blue'],
  ['#c63d34', 'Red'],
  ['#f2c230', 'Yellow'],
  ['#ea8a2c', 'Orange'],
  ['#567a3a', 'Green'],
  ['#7a56b8', 'Purple'],
  ['#2b2b30', 'Black'],
  ['#c9a877', 'Tan'],
]);

/** The rank colors first (Lion to Arrow of Light), then a few extras. */
export const NECKERCHIEF_COLORS = choices([
  ['#f2c230', 'Yellow'],
  ['#ea8a2c', 'Orange'],
  ['#c63d34', 'Red'],
  ['#7ec8ea', 'Light blue'],
  ['#2f7a46', 'Green'],
  ['#7a56b8', 'Purple'],
  ['#1f3557', 'Navy'],
  ['#f2f2f2', 'White'],
]);

// ---- styles -------------------------------------------------------------------------------------

export const HAIR_STYLES = choices<HairStyle>([
  ['none', 'None'],
  ['buzz', 'Buzz'],
  ['short', 'Short'],
  ['spiky', 'Spiky'],
  ['curly', 'Curly'],
  ['long', 'Long'],
  ['ponytail', 'Ponytail'],
  ['braids', 'Braids'],
]);

export const EYE_STYLES = choices<EyeStyle>([
  ['round', 'Round'],
  ['happy', 'Happy'],
  ['wink', 'Wink'],
  ['star', 'Star'],
]);

export const HAT_STYLES = choices<HatStyle>([
  ['none', 'None'],
  ['cap', 'Cap'],
  ['bucket', 'Bucket'],
  ['beanie', 'Beanie'],
  ['scout', 'Scout'],
]);

export const LEG_STYLES = choices<LegStyle>([
  ['shorts', 'Shorts'],
  ['pants', 'Pants'],
  ['skort', 'Skort'],
]);

export const BUILDS = choices<Build>([
  ['small', 'Small'],
  ['regular', 'Medium'],
  ['tall', 'Tall'],
]);

// ---- defaults -----------------------------------------------------------------------------------

/** Uniform look per rank: shirt, legs, neckerchief (Webelos and Arrow of Light plaid is approximated as green). */
const RANK_LOOK: Readonly<Record<RankId, { shirt: string; legColor: string; neckerchief: string; hatColor: string }>> = {
  lion: { shirt: '#5b9bd5', legColor: '#1f3557', neckerchief: '#f2c230', hatColor: '#2f5fa8' },
  tiger: { shirt: '#5b9bd5', legColor: '#1f3557', neckerchief: '#ea8a2c', hatColor: '#2f5fa8' },
  wolf: { shirt: '#2f5fa8', legColor: '#1f3557', neckerchief: '#c63d34', hatColor: '#2f5fa8' },
  bear: { shirt: '#2f5fa8', legColor: '#1f3557', neckerchief: '#7ec8ea', hatColor: '#2f5fa8' },
  webelos: { shirt: '#c9a877', legColor: '#567a3a', neckerchief: '#2f7a46', hatColor: '#c9a877' },
  'arrow-of-light': { shirt: '#c9a877', legColor: '#567a3a', neckerchief: '#2f7a46', hatColor: '#c9a877' },
};

export const RANK_IDS: readonly RankId[] = ['lion', 'tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light'];

/** A fresh Scout in the rank's uniform colors. Never gendered: the looks are just looks. */
export function defaultAvatar(rank: RankId): FilledAvatar {
  const look = RANK_LOOK[rank] ?? RANK_LOOK.wolf;
  return {
    bodyColor: look.shirt,
    hat: 'none',
    neckerchief: look.neckerchief,
    build: 'regular',
    skin: SKIN_TONES[1]!.value,
    hairStyle: 'short',
    hairColor: HAIR_COLORS[1]!.value,
    eyes: 'round',
    shirt: look.shirt,
    legs: 'shorts',
    legColor: look.legColor,
    shoes: SHOE_COLORS[0]!.value,
    hatColor: look.hatColor,
    glasses: false,
    backpack: false,
  };
}

// ---- cleaning -----------------------------------------------------------------------------------

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** `#rrggbb` (lowercase) for a valid hex color, else undefined. Accepts `#rgb` too. */
export function cleanColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (HEX6.test(v)) return v.toLowerCase();
  if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return undefined;
}

function pick<T extends string>(value: unknown, list: readonly Choice<T>[], fallback: T): T {
  return list.some((c) => c.value === value) ? (value as T) : fallback;
}

/**
 * Fill every missing field from the rank's defaults and drop anything the game does not know
 * (a bad color, an old style id), so the rig never has to cope with odd values. A v1 save has only
 * `bodyColor`, which becomes the shirt color. `rank` decides the default neckerchief and uniform.
 */
export function fillAvatar(partial: Partial<AvatarConfig> | null | undefined, rank: RankId = 'wolf'): FilledAvatar {
  const base = defaultAvatar(rank);
  const p = partial ?? {};
  const shirt = cleanColor(p.shirt) ?? cleanColor(p.bodyColor) ?? base.shirt;
  return {
    bodyColor: cleanColor(p.bodyColor) ?? shirt,
    hat: pick<HatStyle>(p.hat, HAT_STYLES, 'none'),
    neckerchief: cleanColor(p.neckerchief) ?? base.neckerchief,
    build: pick<Build>(p.build, BUILDS, base.build),
    skin: cleanColor(p.skin) ?? base.skin,
    hairStyle: pick<HairStyle>(p.hairStyle, HAIR_STYLES, base.hairStyle),
    hairColor: cleanColor(p.hairColor) ?? base.hairColor,
    eyes: pick<EyeStyle>(p.eyes, EYE_STYLES, base.eyes),
    shirt,
    legs: pick<LegStyle>(p.legs, LEG_STYLES, base.legs),
    legColor: cleanColor(p.legColor) ?? base.legColor,
    shoes: cleanColor(p.shoes) ?? base.shoes,
    hatColor: cleanColor(p.hatColor) ?? base.hatColor,
    glasses: typeof p.glasses === 'boolean' ? p.glasses : base.glasses,
    backpack: typeof p.backpack === 'boolean' ? p.backpack : base.backpack,
  };
}

/** Same look? Compares the filled forms, so a v1 avatar equals its filled twin. */
export function sameAvatar(a: Partial<AvatarConfig>, b: Partial<AvatarConfig>, rank: RankId = 'wolf'): boolean {
  const x = fillAvatar(a, rank);
  const y = fillAvatar(b, rank);
  return (Object.keys(x) as Array<keyof FilledAvatar>).every((key) => x[key] === y[key]);
}

// ---- random -------------------------------------------------------------------------------------

function oneOf<T>(list: readonly T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

/**
 * A surprise look for the Random button. The neckerchief stays the rank's color, so a Scout is
 * still a Wolf or a Bear whatever the rest looks like. Pass a seeded `rng` for a repeatable result.
 */
export function randomAvatar(rank: RankId, rng: () => number = Math.random): FilledAvatar {
  const base = defaultAvatar(rank);
  const shirt = oneOf(CLOTHES_COLORS, rng).value;
  return {
    ...base,
    bodyColor: shirt,
    shirt,
    skin: oneOf(SKIN_TONES, rng).value,
    build: oneOf(BUILDS, rng).value,
    hairStyle: oneOf(HAIR_STYLES, rng).value,
    hairColor: oneOf(HAIR_COLORS, rng).value,
    eyes: oneOf(EYE_STYLES, rng).value,
    legs: oneOf(LEG_STYLES, rng).value,
    legColor: oneOf(CLOTHES_COLORS, rng).value,
    shoes: oneOf(SHOE_COLORS, rng).value,
    hat: rng() < 0.5 ? 'none' : oneOf(HAT_STYLES.filter((h) => h.value !== 'none'), rng).value,
    hatColor: oneOf(HAT_COLORS, rng).value,
    glasses: rng() < 0.25,
    backpack: rng() < 0.3,
  };
}
