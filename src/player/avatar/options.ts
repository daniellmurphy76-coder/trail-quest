/**
 * Avatar options: the lists the editor offers, the defaults for each rank, and helpers that fill
 * and clean an `AvatarConfig`. Pure data and functions: no Three.js, no DOM, so the save layer
 * can use them too.
 *
 * Every color is a lowercase `#rrggbb`. Every label is one or two everyday words, because the
 * labels are what a kid reads (and what a color-blind kid reads instead of the color).
 *
 * A handful of options are earned by playing (see COSMETIC_LOCKS). `fillAvatar` and `randomAvatar`
 * take the Scout's `unlocks` list and never hand back an option that Scout has not earned; with no
 * list they enforce nothing, which is what the rig and the Den Chief preset rely on.
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

/** The gold shirt: a bright color earned with XP. Not on the leg color list. */
export const GOLD_SHIRT = '#e0a82e';

/** Shirt colors: the shared clothes colors, then gold (locked until earned). */
export const SHIRT_COLORS: readonly Choice[] = [...CLOTHES_COLORS, { value: GOLD_SHIRT, label: 'Gold' }];

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

// ---- cosmetics that are earned --------------------------------------------------------------------

/** Which editor group an earned option sits in. */
export type CosmeticGroup = 'hat' | 'eyes' | 'backpack' | 'shirt';

/** Saved in `Profile.unlocks` as `cosmetic:<id>`; events and the lock table use the bare id. */
export const COSMETIC_PREFIX = 'cosmetic:';

export interface CosmeticLock {
  /** Bare id, for example 'hat-scout'. */
  id: string;
  group: CosmeticGroup;
  /** The option's value in its group ('scout', 'star', 'on' for the backpack, the hex for a shirt color). */
  value: string;
  /** What the summary and the toast call it. */
  label: string;
  /** Plain "how to earn it" line for the locked tile, in each reading level. One short sentence each. */
  earn: { grade2: string; grade5: string };
}

const sameEarn = (text: string): CosmeticLock['earn'] => ({ grade2: text, grade5: text });

/**
 * The options that have to be earned. Everything not listed here is free: braids and spiky hair, the
 * cap, every other color. The rules that unlock them live in src/game/rewards.ts (`evaluateUnlocks`).
 */
export const COSMETIC_LOCKS: readonly CosmeticLock[] = [
  { id: 'hat-scout', group: 'hat', value: 'scout', label: 'Scout hat', earn: sameEarn('Finish an adventure at Base Camp.') },
  { id: 'hat-beanie', group: 'hat', value: 'beanie', label: 'Beanie', earn: sameEarn('Earn 50 XP.') },
  { id: 'hat-bucket', group: 'hat', value: 'bucket', label: 'Bucket hat', earn: sameEarn('Finish an adventure away from Base Camp.') },
  {
    id: 'backpack',
    group: 'backpack',
    value: 'on',
    label: 'Backpack',
    earn: {
      grade2: 'Do a real mission. Your parent says yes.',
      grade5: 'Finish a field mission and get your parent to say yes.',
    },
  },
  {
    id: 'eyes-star',
    group: 'eyes',
    value: 'star',
    label: 'Star eyes',
    earn: { grade2: 'Play 3 days in a row.', grade5: 'Finish a trail 3 days in a row.' },
  },
  { id: 'shirt-gold', group: 'shirt', value: GOLD_SHIRT, label: 'Gold shirt', earn: sameEarn('Earn 500 XP.') },
];

/** The lock on one option, or undefined when the option is free. */
export function cosmeticLock(group: CosmeticGroup, value: string): CosmeticLock | undefined {
  return COSMETIC_LOCKS.find((lock) => lock.group === group && lock.value === value);
}

/** Every cosmetic as it is saved in `Profile.unlocks`. For tests, dev tools and the Den Chief. */
export const ALL_COSMETIC_UNLOCKS: readonly string[] = COSMETIC_LOCKS.map((lock) => `${COSMETIC_PREFIX}${lock.id}`);

/** The bare cosmetic ids in a profile's `unlocks` list (badges and anything else are ignored). */
export function earnedCosmetics(unlocks: readonly string[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const entry of unlocks ?? []) if (entry.startsWith(COSMETIC_PREFIX)) ids.add(entry.slice(COSMETIC_PREFIX.length));
  return ids;
}

/**
 * Is this option free, or has it been earned? `unlocks` is the Scout's `Profile.unlocks`; leave it
 * out to ask about nothing in particular (every option counts as open).
 */
export function isOptionOpen(group: CosmeticGroup, value: string, unlocks?: readonly string[]): boolean {
  if (unlocks === undefined) return true;
  const lock = cosmeticLock(group, value);
  return lock === undefined || earnedCosmetics(unlocks).has(lock.id);
}

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
 *
 * Pass the Scout's `unlocks` and any option that Scout has not earned (the scout hat, star eyes, the
 * backpack, the gold shirt...) falls back to the default instead. Without `unlocks` nothing is held
 * back, so the rig can draw whatever it is given.
 */
export function fillAvatar(
  partial: Partial<AvatarConfig> | null | undefined,
  rank: RankId = 'wolf',
  unlocks?: readonly string[],
): FilledAvatar {
  const base = defaultAvatar(rank);
  const p = partial ?? {};
  const open = (group: CosmeticGroup, value: string): boolean => isOptionOpen(group, value, unlocks);
  const wantedShirt = cleanColor(p.shirt) ?? cleanColor(p.bodyColor) ?? base.shirt;
  const shirt = open('shirt', wantedShirt) ? wantedShirt : base.shirt;
  const wantedBody = cleanColor(p.bodyColor) ?? shirt;
  const hat = pick<HatStyle>(p.hat, HAT_STYLES, 'none');
  const eyes = pick<EyeStyle>(p.eyes, EYE_STYLES, base.eyes);
  const backpack = typeof p.backpack === 'boolean' ? p.backpack : base.backpack;
  return {
    bodyColor: open('shirt', wantedBody) ? wantedBody : shirt,
    hat: open('hat', hat) ? hat : 'none',
    neckerchief: cleanColor(p.neckerchief) ?? base.neckerchief,
    build: pick<Build>(p.build, BUILDS, base.build),
    skin: cleanColor(p.skin) ?? base.skin,
    hairStyle: pick<HairStyle>(p.hairStyle, HAIR_STYLES, base.hairStyle),
    hairColor: cleanColor(p.hairColor) ?? base.hairColor,
    eyes: open('eyes', eyes) ? eyes : base.eyes,
    shirt,
    legs: pick<LegStyle>(p.legs, LEG_STYLES, base.legs),
    legColor: cleanColor(p.legColor) ?? base.legColor,
    shoes: cleanColor(p.shoes) ?? base.shoes,
    hatColor: cleanColor(p.hatColor) ?? base.hatColor,
    glasses: typeof p.glasses === 'boolean' ? p.glasses : base.glasses,
    backpack: backpack && open('backpack', 'on'),
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
 * Pass the Scout's `unlocks` and the surprise only uses what that Scout has earned.
 */
export function randomAvatar(
  rank: RankId,
  rng: () => number = Math.random,
  unlocks?: readonly string[],
): FilledAvatar {
  const base = defaultAvatar(rank);
  const open = <T extends string>(group: CosmeticGroup, list: readonly Choice<T>[]): readonly Choice<T>[] =>
    list.filter((c) => isOptionOpen(group, c.value, unlocks));
  const shirt = oneOf(open('shirt', SHIRT_COLORS), rng).value;
  return {
    ...base,
    bodyColor: shirt,
    shirt,
    skin: oneOf(SKIN_TONES, rng).value,
    build: oneOf(BUILDS, rng).value,
    hairStyle: oneOf(HAIR_STYLES, rng).value,
    hairColor: oneOf(HAIR_COLORS, rng).value,
    eyes: oneOf(open('eyes', EYE_STYLES), rng).value,
    legs: oneOf(LEG_STYLES, rng).value,
    legColor: oneOf(CLOTHES_COLORS, rng).value,
    shoes: oneOf(SHOE_COLORS, rng).value,
    hat: rng() < 0.5 ? 'none' : oneOf(open('hat', HAT_STYLES).filter((h) => h.value !== 'none'), rng).value,
    hatColor: oneOf(HAT_COLORS, rng).value,
    glasses: rng() < 0.25,
    backpack: rng() < 0.3 && isOptionOpen('backpack', 'on', unlocks),
  };
}
