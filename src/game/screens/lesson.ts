/**
 * Teach before you test: the dialogue pages the Den Chief shows before a learn activity.
 *
 * Everything here is pure (no DOM, no storage). The session asks `lessonPlan` what to say and
 * `playLesson` walks the pages through whatever shows a Den Chief dialogue (the app's showDialog).
 * A page has the same shape the dialogue box takes, minus the speaker, which the app adds:
 * `{ text, choices? }`. One line of teaching is one page with the single "Next" button.
 *
 *   new step     "Let me show you something first." then each lesson line, one page each.
 *   posters      when the lesson has posters (the whole Scout Oath; all twelve Scout Law points), each
 *                one is its own full page, in order, right after the intro line and before the lesson
 *                lines. The Oath and the Law are never on one screen.
 *   review       a two-choice page, "Remind me" or "I remember!". Only "Remind me" shows the pages
 *                (and the posters).
 *   no lesson    one page made from the requirement's kidText, so content without lessons yet
 *                still plays (and nothing regresses).
 */
import { lessonPosters } from '../../content/load';
import type { Poster } from '../../content/types';
import { line, type LineLevel } from '../lines';

/** One Den Chief dialogue page. `choices` is omitted for the single "Next" button. */
export interface LessonPage {
  text: string;
  choices?: string[];
}

/** What a requirement offers to teach from. Both fields come straight from the content. */
export interface LessonSource {
  lesson?: { lines: readonly string[]; poster?: Poster; posters?: readonly Poster[] };
  kidText: string;
}

export interface LessonPlan {
  /** Reviews only: the "Remind me" or "I remember!" page. Resolves 0 for "Remind me". */
  ask?: LessonPage;
  /** The teaching pages. Shown for a new step, or after "Remind me" on a review. */
  pages: LessonPage[];
  /**
   * The full-text posters, one page each, when the lesson has any. They are shown after the first
   * page (the intro line) and before the rest, so `pages[0]` is always the intro whenever this is set.
   */
  posters?: Poster[];
  /** The first of `posters`, kept for callers that only know about a single poster. */
  poster?: Poster;
}

/** The index of "Remind me" on the ask page; "I remember!" is the other one. */
export const REMIND_ME = 0;

/** The teaching lines of a lesson, trimmed, with blank ones dropped. Empty when there is no lesson. */
function lessonLines(source: LessonSource): string[] {
  return (source.lesson?.lines ?? []).map((text) => text.trim()).filter((text) => text !== '');
}

/**
 * The lesson's first poster with its text trimmed and blank lines dropped, or undefined when there
 * is none or nothing on it. The title may be empty (the poster then shows no heading). For every
 * poster use `lessonPosters` from content/load.
 */
export function posterOf(lesson: LessonSource['lesson']): Poster | undefined {
  return lessonPosters({ lesson })[0];
}

/**
 * The pages to show. With a lesson (or just a poster): the intro page, then one page per line.
 * Without one: a single page with the requirement's kidText. Never empty unless the kidText is
 * empty too. The poster itself is not a page: see `LessonPlan.poster`.
 */
export function lessonPages(source: LessonSource, level: LineLevel): LessonPage[] {
  const lines = lessonLines(source);
  if (lines.length > 0 || lessonPosters({ lesson: source.lesson }).length > 0) {
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
  const plan: LessonPlan = { pages };
  const posters = lessonPosters({ lesson: source.lesson });
  if (posters.length > 0) {
    plan.posters = posters;
    plan.poster = posters[0];
  }
  if (review) {
    plan.ask = { text: line('remindAsk', level), choices: [line('remindMe', level), line('iRemember', level)] };
  }
  return plan;
}

/**
 * Walk a plan through `show` (which resolves with the choice made, 0 for "Next"). The posters, if
 * the plan has any, go through `showPoster` one page each, in order, right after the intro page.
 * Resolves true when the teaching pages were shown, false when a review's "I remember!" skipped them.
 */
export async function playLesson(
  show: (page: LessonPage) => Promise<number>,
  plan: LessonPlan,
  showPoster?: (poster: Poster) => Promise<void>,
): Promise<boolean> {
  if (plan.ask && (await show(plan.ask)) !== REMIND_ME) return false;
  const posters = plan.posters ?? (plan.poster ? [plan.poster] : []);
  for (let i = 0; i < plan.pages.length; i += 1) {
    await show(plan.pages[i]!);
    if (i === 0 && showPoster) for (const poster of posters) await showPoster(poster);
  }
  return plan.pages.length > 0;
}
