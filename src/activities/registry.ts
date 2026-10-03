import { collectActivity } from './collect';
import { comingSoonActivity } from './comingSoon';
import { craftActivity } from './craft';
import { fieldMissionActivity } from './fieldMission';
import { navigateActivity } from './navigate';
import { quizActivity } from './quiz';
import { rhythmActivity } from './rhythm';
import { sequenceActivity } from './sequence';
import { sortActivity } from './sort';
import type { ActivityController, ActivityType } from './types';

export { comingSoonActivity };

/** The controllers that exist today. Add an entry here when a new activity type is built. */
const implemented: { [K in ActivityType]?: ActivityController<K> } = {
  quiz: quizActivity,
  sequence: sequenceActivity,
  sort: sortActivity,
  collect: collectActivity,
  navigate: navigateActivity,
  rhythm: rhythmActivity,
  craft: craftActivity,
  fieldMission: fieldMissionActivity,
};

const placeholders = new Map<ActivityType, ActivityController>();

/** True when the type has a real controller (not the coming-soon stand-in). */
export function isActivityImplemented(type: ActivityType): boolean {
  return implemented[type] !== undefined;
}

/**
 * Returns the controller for an activity type. Types that are not built yet get a friendly
 * "still being built" card, so a trail never dead-ends.
 */
export function getActivity<T extends ActivityType>(type: T): ActivityController<T> {
  const found = implemented[type];
  if (found) return found as ActivityController<T>;
  let placeholder = placeholders.get(type);
  if (!placeholder) {
    placeholder = comingSoonActivity(type);
    placeholders.set(type, placeholder);
  }
  return placeholder as ActivityController<T>;
}

/**
 * The activity types that have a real controller, derived from the table above so it can never
 * drift. Pass it to the trail planner (`PlanOptions.implemented`) so a trail never offers a stop
 * the game cannot run yet.
 */
export const IMPLEMENTED_TYPES: ReadonlySet<ActivityType> = new Set(
  (Object.keys(implemented) as ActivityType[]).filter((type) => implemented[type] !== undefined),
);
