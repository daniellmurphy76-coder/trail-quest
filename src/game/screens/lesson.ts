/**
 * Teach before you test: the dialogue pages the Den Chief shows before a learn activity.
 *
 * Everything here is pure (no DOM, no storage). The session asks `lessonPlan` what to say and
 * `playLesson` walks the pages through whatever shows a Den Chief dialogue (the app's showDialog).
 * A page has the same shape the dialogue box takes, minus the speaker, which the app adds:
 * `{ text, choices? }`. One line of teaching is one page with the single "Next" button.
 *
 *   new step     "Let me show you something first." then each lesson line, one page each.
 *   review       a two-choice page, "Remind me" or "I remember!". Only "Remind me" shows the pages.
 *   no lesson    one page made from the requirement's kidText, so content without lessons yet
 *                still plays (and nothing regresses).
 */
import { line, type LineLevel } from '../lines';

/** One Den Chief dialogue page. `choices` is omitted for the single "Next" button. */
export interface LessonPage {
  text: string;
  choices?: string[];
}

/** What a requirement offers to teach from. Both fields come straight from the content. */
export interface LessonSource {
  lesson?: { lines: readonly string[] };
  kidText: string;
}

export interface LessonPlan {
  /** Reviews only: the "Remind me" or "I remember!" page. Resolves 0 for "Remind me". */
  ask?: LessonPage;
  /** The teaching pages. Shown for a new step, or after "Remind me" on a review. */
  pages: LessonPage[];
}

/** The index of "Remind me" on the ask page; "I remember!" is the other one. */
export const REMIND_ME = 0;

/** The teaching lines of a lesson, trimmed, with blank ones dropped. Empty when there is no lesson. */
function lessonLines(source: LessonSource): string[] {
  return (source.lesson?.lines ?? []).map((text) => text.trim()).filter((text) => text !== '');
}

/**
 * The pages to show. With a lesson: the intro page, then one page per line. Without one: a single
 * page with the requirement's kidText. Never empty unless the kidText is empty too.
 */
export function lessonPages(source: LessonSource, level: LineLevel): LessonPage[] {
  const lines = lessonLines(source);
  if (lines.length > 0) {
    return [{ text: line('lessonIntro', level) }, ...lines.map((text) => ({ text }))];
  }
  const text = source.kidText.trim();
  return text === '' ? [] : [{ text }];
}

/**
 * What to say before a learn activity. A new step gets the pages. A review (a warm-up or bonus
 * stop) gets the ask page as well, and the caller shows the pages only when the Scout picks
 * "Remind me".
 */
export function lessonPlan(source: LessonSource, level: LineLevel, review: boolean): LessonPlan {
  const pages = lessonPages(source, level);
  if (!review) return { pages };
  return {
    ask: { text: line('remindAsk', level), choices: [line('remindMe', level), line('iRemember', level)] },
    pages,
  };
}

/**
 * Walk a plan through `show` (which resolves with the choice made, 0 for "Next"). Resolves true
 * when the teaching pages were shown, false when a review's "I remember!" skipped them.
 */
export async function playLesson(show: (page: LessonPage) => Promise<number>, plan: LessonPlan): Promise<boolean> {
  if (plan.ask && (await show(plan.ask)) !== REMIND_ME) return false;
  for (const page of plan.pages) await show(page);
  return plan.pages.length > 0;
}
