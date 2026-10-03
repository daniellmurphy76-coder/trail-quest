/**
 * Rewards that are earned by playing, never bought or timed: trail titles for XP, and avatar
 * cosmetics unlocked by badges, XP, field missions and streaks.
 *
 * Everything here is pure: no DOM, no storage, no clock. The session calls `evaluateUnlocks` after
 * every stop and approval and saves what it finds; the avatar editor reads the same table
 * (COSMETIC_LOCKS in src/player/avatar/options.ts) to draw locked tiles. A reward never takes
 * anything away: the lists only grow, and a Scout who already wears an option keeps it
 * (`wornButUnearned`).
 */
import { listRankContent, loadRankContent } from '../content/load';
import type { AdventureCategory, RankContent } from '../content/types';
import {
  COSMETIC_LOCKS,
  COSMETIC_PREFIX,
  earnedCosmetics,
  type CosmeticGroup,
  type CosmeticLock,
} from '../player/avatar/options';
import type { Profile } from '../save/types';
import type { LineKey } from './lines';

// ---- trail titles -----------------------------------------------------------------------------

export interface TrailTitle {
  /** XP needed. */
  xp: number;
  title: string;
}

/**
 * Kid-level titles for the trail, lowest first. They are about walking a trail, never real
 * Scouting rank names (no Bobcat, Tenderfoot, Eagle...), so nobody mistakes a game title for a
 * rank that a den leader records.
 */
export const TRAIL_TITLES: readonly TrailTitle[] = [
  { xp: 0, title: 'New Hiker' },
  { xp: 100, title: 'Trail Walker' },
  { xp: 250, title: 'Path Finder' },
  { xp: 500, title: 'Trail Blazer' },
  { xp: 1000, title: 'Peak Climber' },
  { xp: 2000, title: 'Trail Legend' },
];

/** The title for an XP total: the highest one whose threshold has been reached. */
export function titleForXp(xp: number): string {
  let current = TRAIL_TITLES[0]!.title;
  if (!Number.isFinite(xp)) return current;
  for (const step of TRAIL_TITLES) if (xp >= step.xp) current = step.title;
  return current;
}

/** The new title when going from `beforeXp` to `afterXp` crossed a threshold, else undefined. */
export function titleEarnedBetween(beforeXp: number, afterXp: number): string | undefined {
  const before = titleForXp(beforeXp);
  const after = titleForXp(afterXp);
  return after !== before && afterXp > beforeXp ? after : undefined;
}

// ---- cosmetic unlocks -------------------------------------------------------------------------

/** XP for the beanie and for the gold shirt. */
export const BEANIE_XP = 50;
export const GOLD_SHIRT_XP = 500;
/** Days in a row for the star eyes. */
export const STAR_EYES_STREAK = 3;

/** Which adventure category an adventure id belongs to, looking in the given content first. */
function categoryLookup(profile: Profile, content?: RankContent): (adventureId: string) => AdventureCategory | undefined {
  const sources: RankContent[] = [];
  if (content) sources.push(content);
  const own = loadRankContent(profile.rank);
  if (own) sources.push(own);
  sources.push(...listRankContent());
  return (adventureId) => {
    for (const source of sources) {
      const found = source.adventures.find((adventure) => adventure.id === adventureId);
      if (found) return found.category;
    }
    return undefined;
  };
}

interface UnlockFacts {
  xp: number;
  bestStreak: number;
  completedBobcat: boolean;
  completedOther: boolean;
  approvedMission: boolean;
}

function factsOf(profile: Profile, content?: RankContent): UnlockFacts {
  const categoryOf = categoryLookup(profile, content);
  let completedBobcat = false;
  let completedOther = false;
  for (const id of Object.keys(profile.adventures)) {
    const category = categoryOf(id);
    if (category === undefined) continue; // an adventure the game does not know counts for nothing
    if (category === 'bobcat') completedBobcat = true;
    else completedOther = true;
  }
  return {
    xp: profile.xp,
    bestStreak: Math.max(profile.streak.current, profile.streak.best),
    completedBobcat,
    completedOther,
    approvedMission: Object.values(profile.requirements).some((progress) => progress.approvedAt !== undefined),
  };
}

/** The rule for each earned cosmetic, by id. A test keeps this in step with COSMETIC_LOCKS. */
export const UNLOCK_RULES: Readonly<Record<string, (facts: UnlockFacts) => boolean>> = {
  'hat-scout': (f) => f.completedBobcat,
  'hat-beanie': (f) => f.xp >= BEANIE_XP,
  'hat-bucket': (f) => f.completedOther,
  backpack: (f) => f.approvedMission,
  'eyes-star': (f) => f.bestStreak >= STAR_EYES_STREAK,
  'shirt-gold': (f) => f.xp >= GOLD_SHIRT_XP,
};

/**
 * The cosmetic ids this Scout has earned and does not have yet, in table order. Calling it again
 * after saving them with `withCosmetics` returns an empty list. `content` (the rank being played)
 * tells a Bobcat adventure from any other; without it the bundled content is used.
 */
export function evaluateUnlocks(profile: Profile, content?: RankContent): string[] {
  const have = earnedCosmetics(profile.unlocks);
  const facts = factsOf(profile, content);
  return COSMETIC_LOCKS.filter((lock) => !have.has(lock.id) && UNLOCK_RULES[lock.id]?.(facts) === true).map(
    (lock) => lock.id,
  );
}

/** A copy of the profile with `cosmetic:<id>` added to `unlocks` for each id (no repeats). */
export function withCosmetics(profile: Profile, ids: readonly string[]): Profile {
  const unlocks = [...profile.unlocks];
  for (const id of ids) {
    const entry = `${COSMETIC_PREFIX}${id}`;
    if (!unlocks.includes(entry)) unlocks.push(entry);
  }
  return unlocks.length === profile.unlocks.length ? profile : { ...profile, unlocks };
}

/** True when the Scout's saved look wears this option. */
function wears(profile: Profile, lock: CosmeticLock): boolean {
  const avatar = profile.avatar;
  switch (lock.group) {
    case 'hat':
      return avatar.hat === lock.value;
    case 'eyes':
      return avatar.eyes === lock.value;
    case 'backpack':
      return avatar.backpack === true;
    case 'shirt':
      return (avatar.shirt ?? avatar.bodyColor)?.toLowerCase() === lock.value;
  }
}

/**
 * Cosmetics the Scout's saved look already wears but has not earned (a look made before rewards
 * existed). They are kept, not taken away: the app adds them to `unlocks` quietly.
 */
export function wornButUnearned(profile: Profile): string[] {
  const have = earnedCosmetics(profile.unlocks);
  return COSMETIC_LOCKS.filter((lock) => !have.has(lock.id) && wears(profile, lock)).map((lock) => lock.id);
}

/** What the unlock card and toast say for a kind of cosmetic. */
export const UNLOCK_LINE_BY_GROUP: Readonly<Record<CosmeticGroup, LineKey>> = {
  hat: 'unlockHat',
  eyes: 'unlockEyes',
  backpack: 'unlockBackpack',
  shirt: 'unlockShirt',
};

/** The lock for a bare cosmetic id. */
export function cosmeticById(id: string): CosmeticLock | undefined {
  return COSMETIC_LOCKS.find((lock) => lock.id === id);
}
