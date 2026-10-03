import { comingSoonActivity } from './comingSoon';
import { fieldMissionActivity } from './fieldMission';
import { quizActivity } from './quiz';
import { sequenceActivity } from './sequence';
import type { ActivityController, ActivityType } from './types';

export { comingSoonActivity };

/** The controllers that exist today. Add an entry here when a new activity type is built. */
const implemented: { [K in ActivityType]?: ActivityController<K> } = {
  quiz: quizActivity,
  sequence: sequenceActivity,
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
