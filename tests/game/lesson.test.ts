import { describe, expect, it, vi } from 'vitest';
import { lessonPosters, listRankContent } from '../../src/content/load';
import { lessonPages, lessonPlan, playLesson, posterOf, REMIND_ME, type LessonPage } from '../../src/game/screens/lesson';

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

describe('lesson with a poster', () => {
  const POSTER = { title: 'The Test Poster', lines: ['Poster line one.', 'Poster line two.', 'Poster line three.'] };
  const source = { lesson: { lines: lines(2), poster: POSTER }, kidText: KID_TEXT };

  it('cleans the poster: trims lines, drops blanks, and has none when nothing is on it', () => {
    expect(posterOf({ lines: lines(1), poster: { title: '  Oath  ', lines: [' A ', '', '  ', 'B'] } })).toEqual({
      title: 'Oath',
      lines: ['A', 'B'],
    });
    expect(posterOf(undefined)).toBeUndefined();
    expect(posterOf({ lines: lines(1) })).toBeUndefined();
    expect(posterOf({ lines: lines(1), poster: { title: 'Empty', lines: [' '] } })).toBeUndefined();
    expect(posterOf({ lines: lines(1), poster: { title: 'Odd' } as never })).toBeUndefined();
  });

  it('keeps the plan as it was for a lesson without a poster', () => {
    const plan = lessonPlan({ lesson: { lines: lines(2) }, kidText: KID_TEXT }, 'grade2', false);
    expect(plan.poster).toBeUndefined();
    expect('poster' in plan).toBe(false);
  });

  it('puts the poster in the plan and keeps the intro and lesson lines as the pages', () => {
    const plan = lessonPlan(source, 'grade2', false);
    expect(plan.poster).toEqual(POSTER);
    expect(plan.pages.map((p) => p.text)).toEqual(['Let me show you something first.', ...lines(2)]);
  });

  it('shows the poster right after the intro and before the lesson lines', async () => {
    const events: string[] = [];
    const show = vi.fn(async (page: LessonPage) => {
      events.push(`page:${page.text}`);
      return 0;
    });
    const showPoster = vi.fn(async (poster: { title: string }) => {
      events.push(`poster:${poster.title}`);
    });
    const taught = await playLesson(show, lessonPlan(source, 'grade2', false), showPoster);
    expect(taught).toBe(true);
    expect(events).toEqual([
      'page:Let me show you something first.',
      'poster:The Test Poster',
      'page:Test lesson line 1.',
      'page:Test lesson line 2.',
    ]);
    expect(showPoster).toHaveBeenCalledWith(POSTER);
  });

  it('plays the lesson as before when there is no poster, or nothing to show it with', async () => {
    const showPoster = vi.fn(async () => {});
    const none = vi.fn(async () => 0);
    await playLesson(none, lessonPlan({ lesson: { lines: lines(2) }, kidText: KID_TEXT }, 'grade2', false), showPoster);
    expect(showPoster).not.toHaveBeenCalled();
    expect(none).toHaveBeenCalledTimes(3);

    const noPosterFn = vi.fn(async () => 0);
    await expect(playLesson(noPosterFn, lessonPlan(source, 'grade2', false))).resolves.toBe(true);
    expect(noPosterFn).toHaveBeenCalledTimes(3);
  });

  it('a review shows the poster and the lines after "Remind me", and neither after "I remember!"', async () => {
    const plan = lessonPlan(source, 'grade2', true);
    expect(plan.ask?.choices).toEqual(['Remind me', 'I remember!']);

    const remind: string[] = [];
    await playLesson(
      async (page) => {
        remind.push(page.text);
        return 0;
      },
      plan,
      async (poster) => {
        remind.push(`poster:${poster.title}`);
      },
    );
    expect(remind).toEqual([
      'Do you remember this one?',
      'Let me show you something first.',
      'poster:The Test Poster',
      ...lines(2),
    ]);

    const showPoster = vi.fn(async () => {});
    await expect(playLesson(async () => 1, plan, showPoster)).resolves.toBe(false);
    expect(showPoster).not.toHaveBeenCalled();
  });

  it('a lesson that is only a poster still gets the intro line, then the poster', async () => {
    const plan = lessonPlan({ lesson: { lines: [], poster: POSTER }, kidText: KID_TEXT }, 'grade5', false);
    expect(plan.pages).toEqual([{ text: 'Let me show you something first.' }]);
    const events: string[] = [];
    await playLesson(
      async (page) => {
        events.push(page.text);
        return 0;
      },
      plan,
      async (poster) => {
        events.push(`poster:${poster.title}`);
      },
    );
    expect(events).toEqual(['Let me show you something first.', 'poster:The Test Poster']);
  });
});

describe('lessonPosters (the content helper)', () => {
  const OATH = { title: 'The Test Oath', lines: ['Oath line one.', 'Oath line two.'] };
  const LAW = { title: 'The Test Law', lines: ['Law point one.', 'Law point two.'] };

  it('is empty when the requirement has no lesson, or a lesson with no poster', () => {
    expect(lessonPosters(undefined)).toEqual([]);
    expect(lessonPosters({})).toEqual([]);
    expect(lessonPosters({ lesson: {} })).toEqual([]);
  });

  it('returns the single legacy poster as a list of one', () => {
    expect(lessonPosters({ lesson: { poster: OATH } })).toEqual([OATH]);
  });

  it('returns `posters` in order, and prefers them to the legacy poster', () => {
    expect(lessonPosters({ lesson: { posters: [OATH, LAW] } })).toEqual([OATH, LAW]);
    expect(lessonPosters({ lesson: { poster: LAW, posters: [OATH] } })).toEqual([OATH]);
  });

  it('falls back to the legacy poster when `posters` is empty or has nothing on it', () => {
    expect(lessonPosters({ lesson: { poster: LAW, posters: [] } })).toEqual([LAW]);
    expect(lessonPosters({ lesson: { poster: LAW, posters: [{ title: 'Blank', lines: [' '] }] } })).toEqual([LAW]);
  });

  it('trims titles and lines, drops blank lines, and leaves out posters with nothing on them', () => {
    expect(
      lessonPosters({
        lesson: {
          posters: [
            { title: '  The Test Oath  ', lines: [' A ', '', '  ', 'B'] },
            { title: 'Empty', lines: ['  '] },
            { title: 'Odd' } as never,
            LAW,
          ],
        },
      }),
    ).toEqual([{ title: 'The Test Oath', lines: ['A', 'B'] }, LAW]);
  });

  it('does not change what it is given', () => {
    const lesson = { posters: [{ title: ' Padded ', lines: [' x '] }] };
    lessonPosters({ lesson });
    expect(lesson.posters[0]).toEqual({ title: ' Padded ', lines: [' x '] });
  });

  it('reads the real content: no poster is titled for the Oath and the Law together, or for two codes at once', () => {
    let seen = 0;
    for (const content of listRankContent()) {
      for (const adventure of content.adventures) {
        for (const requirement of adventure.requirements) {
          for (const poster of lessonPosters(requirement)) {
            seen += 1;
            const name = poster.title.toLowerCase();
            expect(/oath/.test(name) && /law/.test(name), `${requirement.id}: ${poster.title}`).toBe(false);
            expect(/outdoor code/.test(name) && /leave no trace/.test(name), `${requirement.id}: ${poster.title}`).toBe(false);
            expect(poster.lines.length, requirement.id).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('lesson with two posters (the Oath, then the Law)', () => {
  const OATH = { title: 'The Test Oath', lines: ['Oath line one.', 'Oath line two.'] };
  const LAW = { title: 'The Test Law', lines: ['Law point one.', 'Law point two.', 'Law point three.'] };
  const source = { lesson: { lines: lines(2), posters: [OATH, LAW] }, kidText: KID_TEXT };

  it('puts both in the plan, in order, with the first also as `poster`', () => {
    const plan = lessonPlan(source, 'grade2', false);
    expect(plan.posters).toEqual([OATH, LAW]);
    expect(plan.poster).toEqual(OATH);
    expect(plan.pages.map((p) => p.text)).toEqual(['Let me show you something first.', ...lines(2)]);
  });

  it('shows each as its own page, in order, right after the intro and before the lesson lines', async () => {
    const events: string[] = [];
    const show = vi.fn(async (page: LessonPage) => {
      events.push(`page:${page.text}`);
      return 0;
    });
    const showPoster = vi.fn(async (poster: { title: string }) => {
      events.push(`poster:${poster.title}`);
    });
    await expect(playLesson(show, lessonPlan(source, 'grade2', false), showPoster)).resolves.toBe(true);
    expect(events).toEqual([
      'page:Let me show you something first.',
      'poster:The Test Oath',
      'poster:The Test Law',
      'page:Test lesson line 1.',
      'page:Test lesson line 2.',
    ]);
    expect(showPoster).toHaveBeenCalledTimes(2);
    expect(showPoster).toHaveBeenNthCalledWith(1, OATH);
    expect(showPoster).toHaveBeenNthCalledWith(2, LAW);
  });

  it('waits for the first poster to be dismissed before it shows the second', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const showPoster = vi.fn(async (poster: { title: string }) => {
      order.push(`open:${poster.title}`);
      if (poster.title === OATH.title) await new Promise<void>((resolve) => (release = resolve));
      order.push(`close:${poster.title}`);
    });
    const done = playLesson(async () => 0, lessonPlan(source, 'grade2', false), showPoster);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['open:The Test Oath']);
    release();
    await done;
    expect(order).toEqual(['open:The Test Oath', 'close:The Test Oath', 'open:The Test Law', 'close:The Test Law']);
  });

  it('a lesson of only posters still gets the intro line, then each poster', async () => {
    const plan = lessonPlan({ lesson: { lines: [], posters: [OATH, LAW] }, kidText: KID_TEXT }, 'grade5', false);
    expect(plan.pages).toEqual([{ text: 'Let me show you something first.' }]);
    const events: string[] = [];
    await playLesson(
      async (page) => {
        events.push(page.text);
        return 0;
      },
      plan,
      async (poster) => {
        events.push(`poster:${poster.title}`);
      },
    );
    expect(events).toEqual(['Let me show you something first.', 'poster:The Test Oath', 'poster:The Test Law']);
  });

  it('a review shows both posters after "Remind me", and neither after "I remember!"', async () => {
    const plan = lessonPlan(source, 'grade2', true);
    const shown: string[] = [];
    await playLesson(async () => 0, plan, async (poster) => {
      shown.push(poster.title);
    });
    expect(shown).toEqual(['The Test Oath', 'The Test Law']);

    const showPoster = vi.fn(async () => {});
    await expect(playLesson(async () => 1, plan, showPoster)).resolves.toBe(false);
    expect(showPoster).not.toHaveBeenCalled();
  });

  it('keeps `posterOf` as the first poster for callers that only know about one', () => {
    expect(posterOf(source.lesson)).toEqual(OATH);
  });
});
