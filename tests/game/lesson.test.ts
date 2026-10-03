import { describe, expect, it, vi } from 'vitest';
import { lessonPages, lessonPlan, playLesson, REMIND_ME, type LessonPage } from '../../src/game/screens/lesson';

const KID_TEXT = 'Test step one. This second sentence is extra.';

const lines = (n: number): string[] => Array.from({ length: n }, (_, i) => `Test lesson line ${i + 1}.`);

describe('lesson pages', () => {
  it('falls back to a single page made from the kidText when there is no lesson', () => {
    expect(lessonPages({ kidText: KID_TEXT }, 'grade2')).toEqual([{ text: KID_TEXT }]);
    // An empty or blank lesson counts as no lesson at all.
    expect(lessonPages({ lesson: { lines: [] }, kidText: KID_TEXT }, 'grade2')).toEqual([{ text: KID_TEXT }]);
    expect(lessonPages({ lesson: { lines: ['  ', ''] }, kidText: KID_TEXT }, 'grade5')).toEqual([{ text: KID_TEXT }]);
  });

  it('has no pages when there is neither a lesson nor any kidText', () => {
    expect(lessonPages({ kidText: '  ' }, 'grade2')).toEqual([]);
  });

  it('shows the intro, then a lesson of one line as one page of its own', () => {
    const pages = lessonPages({ lesson: { lines: ['Only line.'] }, kidText: KID_TEXT }, 'grade2');
    expect(pages).toEqual([{ text: 'Let me show you something first.' }, { text: 'Only line.' }]);
  });

  it('shows one page per line for a lesson of six, in order, each with the plain Next button', () => {
    const pages = lessonPages({ lesson: { lines: lines(6) }, kidText: KID_TEXT }, 'grade5');
    expect(pages).toHaveLength(7);
    expect(pages[0]!.text).toBe('Let me show you something first.');
    expect(pages.slice(1).map((p) => p.text)).toEqual(lines(6));
    // No choices: the dialogue box draws a single Next button.
    for (const page of pages) expect(page.choices).toBeUndefined();
    // The kidText is not repeated once there is a real lesson.
    expect(pages.some((p) => p.text.includes('second sentence'))).toBe(false);
  });

  it('trims the lines it is given', () => {
    const pages = lessonPages({ lesson: { lines: ['  Padded line.  '] }, kidText: KID_TEXT }, 'grade2');
    expect(pages[1]!.text).toBe('Padded line.');
  });
});

describe('lesson plan', () => {
  const source = { lesson: { lines: lines(2) }, kidText: KID_TEXT };

  it('for a new step is just the pages, with no question first', () => {
    const plan = lessonPlan(source, 'grade2', false);
    expect(plan.ask).toBeUndefined();
    expect(plan.pages.map((p) => p.text)).toEqual(['Let me show you something first.', ...lines(2)]);
  });

  it('for a review asks "Remind me" or "I remember!" first, with the pages held back', () => {
    const plan = lessonPlan(source, 'grade2', true);
    expect(plan.ask).toEqual({ text: 'Do you remember this one?', choices: ['Remind me', 'I remember!'] });
    expect(plan.pages).toHaveLength(3);
    expect(REMIND_ME).toBe(0);
  });

  it('for a review with no lesson still asks, and a reminder is the kidText page', () => {
    const plan = lessonPlan({ kidText: KID_TEXT }, 'grade5', true);
    expect(plan.ask?.choices).toEqual(['Remind me', 'I remember!']);
    expect(plan.ask?.text).toBe('Do you remember this one, or want a quick reminder?');
    expect(plan.pages).toEqual([{ text: KID_TEXT }]);
  });
});

describe('playing a lesson', () => {
  const shower = (choose: (page: LessonPage) => number = () => 0) => {
    const shown: LessonPage[] = [];
    const show = vi.fn(async (page: LessonPage) => {
      shown.push(page);
      return choose(page);
    });
    return { show, shown };
  };

  it('walks every page of a new step in order and reports it taught', async () => {
    const { show, shown } = shower();
    const taught = await playLesson(show, lessonPlan({ lesson: { lines: lines(3) }, kidText: KID_TEXT }, 'grade2', false));
    expect(taught).toBe(true);
    expect(shown.map((p) => p.text)).toEqual(['Let me show you something first.', ...lines(3)]);
  });

  it('shows the lesson on a review only after "Remind me"', async () => {
    const plan = lessonPlan({ lesson: { lines: lines(2) }, kidText: KID_TEXT }, 'grade2', true);

    const remind = shower(() => 0);
    await expect(playLesson(remind.show, plan)).resolves.toBe(true);
    expect(remind.shown).toHaveLength(1 + 3); // the question, then the three pages

    const remember = shower(() => 1);
    await expect(playLesson(remember.show, plan)).resolves.toBe(false);
    expect(remember.shown).toHaveLength(1); // only the question
    expect(remember.shown[0]!.choices).toEqual(['Remind me', 'I remember!']);
  });

  it('shows nothing and reports false when there is nothing to say', async () => {
    const { show } = shower();
    await expect(playLesson(show, lessonPlan({ kidText: '' }, 'grade2', false))).resolves.toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});
