/**
 * Numbers for Parent mode's overview: pure helpers over a profile and its rank content. The DOM
 * lives in src/game/screens/parent.ts. "Required" here means what it takes to earn the badge: every
 * requirement that is not optional, plus as many of an adventure's "choose" requirements as it asks for.
 */
import { isOptionalRequirement } from '../content/load';
import type { Adventure, RankContent } from '../content/types';
import type { Profile } from '../save/types';
import { pendingApprovals } from './parent';

export interface AdventureCount {
  id: string;
  name: string;
  /** Requirements done toward the badge. */
  done: number;
  /** Requirements the badge needs. */
  total: number;
  /** The badge is earned (the game marked the adventure complete). */
  badge: boolean;
}

export interface ScoutOverview {
  /** Date (YYYY-MM-DD) of the latest session, if the Scout has played one. */
  lastPlayed?: string;
  streak: number;
  bestStreak: number;
  xp: number;
  /** Badges earned out of the required adventures. */
  badges: number;
  badgesTotal: number;
  /** Requirements done out of those the required adventures need. */
  done: number;
  total: number;
  /** done / total as a whole percent; 0 when there is nothing to do. */
  percent: number;
  /** Field missions waiting for a parent. */
  pending: number;
  /** One entry per required adventure, in content order. */
  adventures: AdventureCount[];
}

/** "Kindergarten" for grade 0, otherwise "Grade N". */
export function gradeLabel(grade: number): string {
  return grade <= 0 ? 'Kindergarten' : `Grade ${grade}`;
}

/** How many requirements the badge needs and how many of those are done. */
export function adventureCounts(adventure: Adventure, profile: Profile): { done: number; total: number } {
  const isDone = (id: string): boolean => profile.requirements[id]?.status === 'done';
  const fixed = adventure.requirements.filter((requirement) => !isOptionalRequirement(adventure, requirement));
  let done = fixed.filter((requirement) => isDone(requirement.id)).length;
  let total = fixed.length;
  if (adventure.choose) {
    const need = Math.min(adventure.choose.count, adventure.choose.from.length);
    total += need;
    done += Math.min(need, adventure.choose.from.filter(isDone).length);
  }
  return { done, total };
}

/** Everything the overview card shows for one Scout. Without content the progress numbers are zero. */
export function summarizeScout(profile: Profile, content: RankContent | undefined): ScoutOverview {
  const required = content?.adventures.filter((adventure) => adventure.required) ?? [];
  const adventures: AdventureCount[] = required.map((adventure) => ({
    id: adventure.id,
    name: adventure.name,
    ...adventureCounts(adventure, profile),
    badge: profile.adventures[adventure.id] !== undefined,
  }));
  const done = adventures.reduce((sum, a) => sum + a.done, 0);
  const total = adventures.reduce((sum, a) => sum + a.total, 0);
  const dates = profile.sessions.map((session) => session.date).sort();
  return {
    lastPlayed: dates[dates.length - 1],
    streak: profile.streak.current,
    bestStreak: profile.streak.best,
    xp: profile.xp,
    badges: adventures.filter((a) => a.badge).length,
    badgesTotal: adventures.length,
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    pending: pendingApprovals(profile, content).length,
    adventures,
  };
}
