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

export interface PlanOptions {
  /**
   * Activity types the game can run right now. When given, the planner treats a learn
   * activity of any other type as if the requirement had no learn activity: it is never
   * offered as a new-step or review, and a field mission whose practice is unavailable
   * counts as ready for handout. Omit to allow every type.
   */
  implemented?: ReadonlySet<ActivitySpec['type']>;
}

export interface TrailPlanner {
  /**
   * Build today's trail.
   * - warm-up: the most overdue review card, else the most recently learned reviewable item, else skipped.
   * - new-step: the first requirement in the active adventure with a learn activity that has not
   *   been learned yet. The learn activity is `activity` for digital requirements and `practice`
   *   for field missions. The active adventure is the first incomplete required adventure in
   *   content order (Bobcat first).
   * - field-check: a 'pending-approval' requirement if any, else the next field mission in the
   *   active adventure, preferring ones already learned, else skipped.
   * If there is nothing new at all, the trail is a single bonus review.
   */
  plan(profile: Profile, content: RankContent, today: string, options?: PlanOptions): TodaysTrail;
}

/** XP awarded per completed stop kind. Field missions award on parent approval. */
export const XP_BY_STOP: Record<StopKind, number> = {
  'warm-up': 10,
  'new-step': 20,
  'field-check': 30,
  bonus: 10,
};
