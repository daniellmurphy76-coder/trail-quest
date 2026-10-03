import { daysBetween, isYmd } from '../quests/dates';
import type { Profile, Streak } from '../save/types';

/**
 * The streak to show today. The saved `current` only changes when a trail is finished, so a
 * streak that has lapsed would still read, say, 5. It shows as lit while the last trail was today
 * or yesterday, or two days ago when an ember will cover the gap (see `advanceStreak`). Beyond
 * that the campfire starts over, so it shows 0.
 */
export function activeStreak(streak: Streak, today: string): number {
  const last = streak.lastTrailDate;
  if (last === undefined || !isYmd(last) || !isYmd(today)) return 0;
  const gap = daysBetween(last, today);
  if (gap <= 1) return streak.current;
  if (gap === 2 && streak.embers > 0) return streak.current;
  return 0;
}

/** True when today's trail is already finished (the streak was advanced today). */
export function isTrailDoneToday(profile: Profile, today: string): boolean {
  return profile.streak.lastTrailDate === today;
}
