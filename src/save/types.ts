/**
 * Save-file contract. Local only (localStorage), versioned, exportable as JSON.
 * Bump SAVE_VERSION and add a migration in src/save/migrations.ts for any breaking change.
 */
import type { RankId } from '../activities/types';

export const SAVE_VERSION = 1 as const;
export const STORAGE_KEY = 'trail-quest.save';

export interface SaveFile {
  version: typeof SAVE_VERSION;
  profiles: Profile[];
  activeProfileId?: string;
  parent: ParentSettings;
}

export interface ParentSettings {
  /** SHA-256 hex of `${pinSalt}:${pin}`. Absent until a parent sets a PIN. */
  pinHash?: string;
  pinSalt?: string;
}

export interface Profile {
  id: string;
  name: string;
  rank: RankId;
  /** Display name of the guide, default "Den Chief". */
  guideName: string;
  /** Unused since voice was removed; kept so v1 saves load. */
  readAloud: boolean;
  /** Sound effects on or off. Missing means on. */
  sound?: boolean;
  createdAt: string; // ISO date-time
  avatar: AvatarConfig;
  xp: number;
  streak: Streak;
  /** Keyed by requirement id. Missing key means 'locked'. */
  requirements: Record<string, RequirementProgress>;
  /** Keyed by adventure id. Present only once the adventure is complete. */
  adventures: Record<string, { completedAt: string }>;
  /** Spaced-repetition cards keyed by requirement id. Only reviewable activity types appear. */
  review: Record<string, ReviewCard>;
  /** Most recent 30 sessions, newest last. */
  sessions: SessionLog[];
  /** Cosmetic ids earned. */
  unlocks: string[];
}

/**
 * The Scout's look, built from blocky parts (think Roblox). Every field after `bodyColor`
 * is optional so v1 saves still load; `defaultAvatar(rank)` fills the gaps. Colors are hex.
 */
export interface AvatarConfig {
  /** Legacy v1 tint. Used as the shirt color when `shirt` is unset. */
  bodyColor: string;
  /** Hat style id: 'none' | 'cap' | 'bucket' | 'beanie' | 'scout'. */
  hat?: string;
  /** Neckerchief color; defaults to the rank's color. */
  neckerchief?: string;
  build?: 'small' | 'regular' | 'tall';
  skin?: string;
  hairStyle?: 'none' | 'buzz' | 'short' | 'spiky' | 'curly' | 'long' | 'ponytail' | 'braids';
  hairColor?: string;
  eyes?: 'round' | 'happy' | 'wink' | 'star';
  shirt?: string;
  legs?: 'shorts' | 'pants' | 'skort';
  legColor?: string;
  shoes?: string;
  hatColor?: string;
  glasses?: boolean;
  backpack?: boolean;
}

export interface Streak {
  current: number;
  best: number;
  /** Local calendar date YYYY-MM-DD of the last completed Today's Trail. */
  lastTrailDate?: string;
  /** Earned embers keep the campfire lit through a missed day. */
  embers: number;
}

export type RequirementStatus =
  | 'locked'
  | 'available'
  | 'in-progress'
  | 'pending-approval' // field mission done by the kid, awaiting parent PIN
  | 'done';

export interface RequirementProgress {
  status: RequirementStatus;
  attempts: number;
  bestScore?: number; // 0 to 1
  /**
   * Set when the requirement's "learn" activity has been completed in-game.
   * The learn activity is `activity` for digital requirements and `practice` for
   * field missions that have one. Learning does not complete a field mission;
   * the real-world part still goes handout -> check-in -> parent approval.
   */
  learnedAt?: string;
  completedAt?: string;
  approvedAt?: string;
}

/** Leitner boxes: 0 new, then due after 1, 3, 7, 14 days; box 4 is retired. */
export interface ReviewCard {
  box: 0 | 1 | 2 | 3 | 4;
  dueOn: string; // YYYY-MM-DD
  lastReviewedOn?: string;
}

export const LEITNER_INTERVAL_DAYS: Record<ReviewCard['box'], number> = {
  0: 1,
  1: 3,
  2: 7,
  3: 14,
  4: 30,
};

export interface SessionLog {
  date: string; // YYYY-MM-DD
  stops: { kind: StopKind; requirementId: string; completed: boolean }[];
  xpEarned: number;
  durationSec: number;
}

export type StopKind = 'warm-up' | 'new-step' | 'field-check' | 'bonus';
