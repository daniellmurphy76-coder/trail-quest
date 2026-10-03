/**
 * Today's Trail contract: the 3 to 5 minute daily session.
 *
 * The planner is pure: profile + content + today's date in, a trail out. It never
 * touches storage or the DOM, so it is unit-testable with fixtures.
 */
import type { ActivitySpec, ZoneId } from '../activities/types';
import type { RankContent } from '../content/types';
import type { Profile, StopKind } from '../save/types';

export interface TrailStop {
  kind: StopKind;
  requirementId: string;
  adventureId: string;
  /** For 'warm-up' this is the requirement's own activity or its practice activity. */
  activity: ActivitySpec;
  zone: ZoneId;
  /** Short title the Den Chief says, at the profile's reading level. */
  title: string;
}

export interface TodaysTrail {
  date: string; // YYYY-MM-DD local
  profileId: string;
  stops: TrailStop[]; // 3 stops, plus an optional 4th 'bonus' appended after completion
  completedStops: number;
}

export interface TrailPlanner {
  /**
   * Build today's trail.
   * - warm-up: the most overdue review card, else the most recently completed reviewable item, else skipped.
   * - new-step: the first requirement in the active adventure whose status is 'available' or 'in-progress'.
   *   The active adventure is the first incomplete required adventure in content order (Bobcat first).
   * - field-check: a 'pending-approval' requirement if any, else the next field mission in the active adventure, else skipped.
   * A trail always has at least one stop; if everything is done it offers a bonus review.
   */
  plan(profile: Profile, content: RankContent, today: string): TodaysTrail;
}

/** XP awarded per completed stop kind. Field missions award on parent approval. */
export const XP_BY_STOP: Record<StopKind, number> = {
  'warm-up': 10,
  'new-step': 20,
  'field-check': 30,
  bonus: 10,
};
