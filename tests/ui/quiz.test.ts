// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { quizActivity } from '../../src/activities/quiz';
import type { QuizParams } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost, maybeButton, press } from './helpers';

const PARAMS: QuizParams = {
  questions: [
    { prompt: 'Zip has 3 carrots and eats 1. How many are left?', choices: ['1', '2', '3'], answer: 1, explain: 'Take away 1.' },
    { prompt: 'Which one can fly?', choices: ['A rock', 'A kite'], answer: 1, explain: 'A kite flies.' },
    { prompt: 'Which is a color?', choices: ['Blue', 'Hop', 'Soup'], answer: 0 },
  ],
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const choice = (text: string): HTMLButtonElement =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-btn--choice')).find((b) => b.textContent?.includes(text))!;

describe('quizActivity', () => {
  it('speaks each prompt when the question appears', async () => {
    const ctx = makeCtx();
    const result = quizActivity.run(host, PARAMS, ctx);
    expect(ctx.speak).toHaveBeenCalledTimes(1);
    expect(ctx.speak).toHaveBeenLastCalledWith(PARAMS.questions[0]!.prompt);
    choice('2').click();
    buttonByText(host, 'Next').click();
    expect(ctx.speak).toHaveBeenLastCalledWith(PARAMS.questions[1]!.prompt);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('shows one question at a time with big choice buttons', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    expect(host.textContent).toContain('Question 1 of 3');
    expect(host.querySelectorAll('.tq-btn--choice')).toHaveLength(3);
    expect(host.textContent).not.toContain('Which one can fly?');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('completes after every question is answered correctly and reports score and attempts', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('2').click();
    expect(host.textContent).toContain('Yes!');
    expect(host.textContent).toContain('Take away 1.');
    buttonByText(host, 'Next').click();
    choice('A kite').click();
    buttonByText(host, 'Next').click();
    choice('Blue').click();
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 3, score: 1 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('shows "Not yet", keeps the same question, and lets the kid tap again', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('3').click();
    expect(host.textContent).toContain('Not yet');
    expect(host.textContent).toContain('Question 1 of 3');
    expect(host.querySelector('.tq-banner--notyet')).not.toBeNull();
    expect(maybeButton(host, 'Next')).toBeNull(); // cannot move on until it is right
    choice('2').click();
    expect(host.textContent).toContain('Yes!');
    expect(host.querySelector('.tq-banner--yes')).not.toBeNull();
    expect(maybeButton(host, 'Next')).not.toBeNull();
    buttonByText(host, 'Back').click();
    await result;
  });

  it('scores only the questions right on the first try, and counts every tap as an attempt', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('1').click(); // wrong
    choice('2').click(); // right, but not first try
    buttonByText(host, 'Next').click();
    choice('A kite').click(); // first try
    buttonByText(host, 'Next').click();
    choice('Soup').click(); // wrong
    choice('Hop').click(); // wrong
    choice('Blue').click(); // right
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome.completed).toBe(true);
    expect(outcome.attempts).toBe(6);
    expect(outcome.score).toBeCloseTo(1 / 3);
  });

  it('completes after passCount correct answers when it is smaller than the question count', async () => {
    const result = quizActivity.run(host, { ...PARAMS, passCount: 2 }, makeCtx());
    expect(host.textContent).toContain('Question 1 of 2');
    choice('2').click();
    buttonByText(host, 'Next').click();
    choice('A kite').click();
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 2, score: 1 });
  });

  it('lets the player back out without completing', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('1').click();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('marks a wrong choice with an icon and words, not just color', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('3').click();
    expect(choice('3').textContent).toContain('✖');
    expect(choice('3').textContent).toContain('not this one');
    expect(host.querySelector('.tq-banner__icon')?.textContent).toBeTruthy();
    buttonByText(host, 'Back').click();
    await result;
  });

  it('picks a choice with number keys and Enter moves on', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    press(document, '2'); // the right answer to question 1
    expect(host.textContent).toContain('Yes!');
    press(document, 'Enter'); // Next is the default button
    expect(host.textContent).toContain('Question 2 of 3');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('gives every question text a Read button that speaks even if auto read-aloud is off', async () => {
    const ctx = makeCtx();
    const result = quizActivity.run(host, PARAMS, ctx);
    ctx.speak.mockClear();
    const read = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Read'))!;
    read.click();
    expect(ctx.speak).toHaveBeenCalledWith(PARAMS.questions[0]!.prompt, { force: true });
    buttonByText(host, 'Back').click();
    await result;
  });

  it('resolves immediately with nothing to ask', async () => {
    await expect(quizActivity.run(host, { questions: [] }, makeCtx())).resolves.toEqual({
      completed: false,
      attempts: 0,
    });
  });
});
