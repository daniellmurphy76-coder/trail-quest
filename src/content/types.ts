/**
 * TypeScript mirror of content/schema/rank.schema.json.
 * The schema is the source of truth; keep this file in step with it.
 */
import type { ActivitySpec, RankId, ReadingLevel, ZoneId } from '../activities/types';

export type AdventureCategory =
  | 'bobcat'
  | 'fitness'
  | 'outdoors'
  | 'citizenship'
  | 'family-reverence'
  | 'personal-safety'
  | 'elective';

export interface RankContent {
  rank: RankId;
  label: string;
  grade: number;
  ageRange: string;
  readingLevel: ReadingLevel;
  program: { name: string; year: number; indexUrl: string; fetchedOn: string };
  adventures: Adventure[];
  electives?: ElectiveSummary[];
}

export interface Adventure {
  id: string; // <rank>.<slug>
  name: string;
  category: AdventureCategory;
  required: boolean;
  sourceUrl: string;
  fetchedOn: string;
  summary: string;
  /** Present when the adventure says "do N of the following". */
  choose?: { count: number; from: string[] };
  requirements: Requirement[];
  unverified?: boolean;
}

export interface Requirement {
  id: string; // <adventure id>.<number>
  number: string;
  adultText: string;
  kidText: string;
  digital: boolean;
  optional?: boolean;
  activity: ActivitySpec;
  practice?: ActivitySpec;
  /**
   * Den Chief teaching shown before the learn activity: an optional `poster` (full text on one
   * screen, such as the whole Scout Oath or all twelve Scout Law points) and then short dialogue
   * `lines`. The poster is also offered as a peek during the activity.
   */
  lesson?: { lines: string[]; poster?: Poster; posters?: Poster[] };
  // `posters` shows one full text per screen in order (Oath, then Law). `poster` is the legacy
  // single form; use `lessonPosters()` from load.ts to read either.
  notes?: string;
  unverified?: boolean;
}

/** Full text a kid should see whole: a title and every line at once. */
export interface Poster {
  title: string;
  lines: string[];
}

export interface ElectiveSummary {
  id: string;
  name: string;
  sourceUrl: string;
  summary: string;
}

/** Which zone hosts an adventure category. Bobcat is taught by the Den Chief at Base Camp. */
export const ZONE_BY_CATEGORY: Record<AdventureCategory, ZoneId> = {
  bobcat: 'base-camp',
  fitness: 'fitness-field',
  outdoors: 'nature-trail',
  citizenship: 'town-square',
  'personal-safety': 'safety-station',
  'family-reverence': 'campfire-circle',
  elective: 'base-camp',
};

/** Knowledge activities re-enter the warm-up rotation; the rest do not. */
export const REVIEWABLE_TYPES = new Set<ActivitySpec['type']>(['quiz', 'sequence', 'sort']);
