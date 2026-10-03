/**
 * Teach before you test: the dialogue pages the Den Chief shows before a learn activity.
 *
 * Everything here is pure (no DOM, no storage). The session asks `lessonPlan` what to say and
 * `playLesson` walks the pages through whatever shows a Den Chief dialogue (the app's showDialog).
 * A page has the same shape the dialogue box takes, minus the speaker, which the app adds:
 * `{ text, choices? }`. One line of teaching is one page with the single "Next" button.
 *
 *   new step     "Let me show you something first." then each lesson line, one page each.
 *   poster       when the lesson has a poster (the whole Scout Oath, all twelve Scout Law points), it
 *                is shown as one full page right after the intro line and before the lesson lines.
 *   review       a two-choice page, "Remind me" or "I remember!". Only "Remind me" shows the pages
 *                (and the poster).
 *   no lesson    one page made from the requirement's kidText, so content without lessons yet
 *                still plays (and nothing regresses).
 */
import type { Poster } from '../../content/types';
import { line, type LineLevel } from '../lines';

/** One Den Chief dialogue page. `choices` is omitted for the single "Next" button. */
export interface LessonPage {
  text: string;
  choices?: string[];
}

/** What a requirement offers to teach from. Both fields come straight from the content. */
export interface LessonSource {
  lesson?: { lines: readonly string[]; poster?: Poster };
  kidText: string;
}

export interface LessonPlan {
  /** Reviews only: the "Remind me" or "I remember!" page. Resolves 0 for "Remind me". */
  ask?: LessonPage;
  /** The teaching pages. Shown for a new step, or after "Remind me" on a review. */
  pages: LessonPage[];
  /**
   * The full-text poster, when the lesson has one. It is shown after the first page (the intro
   * line) and before the rest, so `pages[0]` is always the intro whenever this is set.
   */
  poster?: Poster;
}

/** The index of "Remind me" on the ask page; "I remember!" is the other one. */
export const REMIND_ME = 0;

/** The teaching lines of a lesson, trimmed, with blank ones dropped. Empty when there is no lesson. */
function lessonLines(source: LessonSource): string[] {
  return (source.lesson?.lines ?? []).map((text) => text.trim()).filter((text) => text !== '');
}

/**
 * The lesson's poster with its text trimmed and blank lines dropped, or undefined when there is no
 * poster or nothing on it. The title may be empty (the poster then shows no heading).
 */
export function posterOf(lesson: LessonSource['lesson']): Poster | undefined {
  const poster = lesson?.poster;
  if (!poster || !Array.isArray(poster.lines)) return undefined;
  const lines = poster.lines.map((text) => String(text).trim()).filter((text) => text !== '');
  if (lines.length === 0) return undefined;
  return { title: typeof poster.title === 'string' ? poster.title.trim() : '', lines };
}

/**
 * The pages to show. With a lesson (or just a poster): the intro page, then one page per line.
 * Without one: a single page with the requirement's kidText. Never empty unless the kidText is
 * empty too. The poster itself is not a page: see `LessonPlan.poster`.
 */
export function lessonPages(source: LessonSource, level: LineLevel): LessonPage[] {
  const lines = lessonLines(source);
  if (lines.length > 0 || posterOf(source.lesson)) {
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
  const poster = posterOf(source.lesson);
  if (poster) plan.poster = poster;
  if (review) {
    plan.ask = { text: line('remindAsk', level), choices: [line('remindMe', level), line('iRemember', level)] };
  }
  return plan;
}

/**
 * Walk a plan through `show` (which resolves with the choice made, 0 for "Next"). The poster, if
 * the plan has one, goes through `showPoster` right after the intro page. Resolves true when the
 * teaching pages were shown, false when a review's "I remember!" skipped them.
 */
export async function playLesson(
  show: (page: LessonPage) => Promise<number>,
  plan: LessonPlan,
  showPoster?: (poster: Poster) => Promise<void>,
): Promise<boolean> {
  if (plan.ask && (await show(plan.ask)) !== REMIND_ME) return false;
  for (let i = 0; i < plan.pages.length; i += 1) {
    await show(plan.pages[i]!);
    if (i === 0 && plan.poster && showPoster) await showPoster(plan.poster);
  }
  return plan.pages.length > 0;
}
