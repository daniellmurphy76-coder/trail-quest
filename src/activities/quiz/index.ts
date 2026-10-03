import { clear, h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { cardHeader, feedbackSlot, peekButton } from '../shared';
import type { ActivityContext, ActivityController, ActivityResult, QuizParams } from '../types';

/**
 * One question at a time. A wrong tap shows "Not yet" and the same question stays, so the kid
 * can tap again; there are no lives and no fail. Completes when `passCount` (default all)
 * questions have been answered correctly. When the context carries a poster, a "Show me" button
 * peeks at it without touching the score or the question.
 */
function runQuiz(host: HTMLElement, params: QuizParams, ctx: ActivityContext): Promise<ActivityResult> {
  const questions = params.questions;
  if (questions.length === 0) return Promise.resolve({ completed: false, attempts: 0 });
  const needed = Math.min(Math.max(Math.floor(params.passCount ?? questions.length), 1), questions.length);

  return new Promise<ActivityResult>((resolve) => {
    let index = 0;
    let attempts = 0; // every tap on a choice
    let firstTry = 0; // questions right on the first tap
    let correct = 0;
    let finished = false;
    let pick: ((choice: number) => void) | null = null;

    const overlay = mountOverlay(host, {
      label: 'Quiz',
      onKey: (event) => {
        // 1 to 4 pick a choice on a laptop.
        if (!pick || event.ctrlKey || event.metaKey || event.altKey) return false;
        const n = Number(event.key);
        if (Number.isInteger(n) && n >= 1 && n <= 9) {
          pick(n - 1);
          return true;
        }
        return false;
      },
    });

    function finish(completed: boolean): void {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(completed ? { completed, attempts, score: firstTry / needed } : { completed, attempts });
    }

    function showQuestion(): void {
      const question = questions[index]!;
      const tried = new Set<number>();
      let solved = false;
      let missedThisOne = false;

      clear(overlay.card);
      const slot = feedbackSlot();
      const actions = h('div', { class: 'tq-actions' });
      const choiceButtons = question.choices.map((label, i) => {
        const mark = h('span', { class: 'tq-choice-mark', attrs: { 'aria-hidden': 'true' } });
        const note = h('span', { class: 'tq-sr' });
        const btn = button(label, { variant: 'choice', onClick: () => choose(i) });
        btn.prepend(mark);
        btn.append(note);
        return { btn, mark, note };
      });

      function choose(i: number): void {
        const entry = choiceButtons[i];
        if (!entry || solved || tried.has(i) || finished) return;
        attempts += 1;
        const text = question.explain ?? '';
        if (i === question.answer) {
          solved = true;
          correct += 1;
          if (!missedThisOne) firstTry += 1;
          choiceButtons.forEach(({ btn }) => {
            btn.classList.add('is-locked');
            btn.setAttribute('aria-disabled', 'true');
          });
          entry.btn.classList.add('is-right');
          entry.mark.textContent = '✔';
          entry.note.textContent = ' (the right answer)';
          showResultBanner(slot, 'yes', text);
          const last = correct >= needed;
          const next = button(last ? 'Finish' : 'Next', {
            variant: 'primary',
            onClick: () => {
              if (last) {
                finish(true);
              } else {
                index += 1;
                showQuestion();
              }
            },
          });
          actions.append(next);
          overlay.setDefault(next);
          overlay.focus(next);
        } else {
          tried.add(i);
          missedThisOne = true;
          entry.btn.classList.add('is-tried');
          entry.btn.setAttribute('aria-disabled', 'true');
          entry.mark.textContent = '✖';
          entry.note.textContent = ' (not this one)';
          showResultBanner(slot, 'notyet', text || 'Try another one.');
        }
      }

      pick = choose;
      overlay.setDefault(null);
      overlay.card.append(
        cardHeader(`Question ${index + 1} of ${needed}`, () => finish(false)),
        h('div', { class: 'tq-prompt' }, h('h2', null, question.prompt), peekButton(host, ctx.poster)),
        h('div', { class: 'tq-choices', role: 'group', attrs: { 'aria-label': 'Answers' } }, ...choiceButtons.map((c) => c.btn)),
        slot,
        actions,
      );
      overlay.focus(choiceButtons[0]?.btn);
    }

    showQuestion();
  });
}

export const quizActivity: ActivityController<'quiz'> = {
  type: 'quiz',
  run: runQuiz,
};
