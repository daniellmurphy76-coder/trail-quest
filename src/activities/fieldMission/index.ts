import { append, h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import type { ActivityContext, ActivityController, ActivityResult, FieldMissionParams } from '../types';

const NOTE = 'Do this in real life. Then come back and tell me!';

/**
 * A real-world mission card. `stage` 'handout' (the default) shows the card and resolves
 * `completed: false`. 'check-in' lets the kid say it is done (`completed: true`, attempts 1) or
 * not yet (`completed: false`, attempts 1). The PIN pad is not shown here: the session flow asks
 * for the parent PIN after a completed check-in.
 */
function runFieldMission(
  host: HTMLElement,
  params: FieldMissionParams,
  ctx: ActivityContext,
): Promise<ActivityResult> {
  const checkIn = ctx.stage === 'check-in';
  const useChecklist = checkIn && params.evidence === 'checklist';

  return new Promise<ActivityResult>((resolve) => {
    const overlay = mountOverlay(host, { label: `Field mission: ${params.title}` });
    let finished = false;
    const finish = (completed: boolean): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve({ completed, attempts: 1 });
    };

    const boxes: HTMLInputElement[] = [];
    const stepItems = params.kidSteps.map((step, i) => {
      if (!useChecklist) return h('li', null, h('span', null, step));
      const box = h('input', { type: 'checkbox', id: `tq-mission-step-${i}` });
      box.addEventListener('change', refresh);
      boxes.push(box);
      return h('li', null, h('label', null, box, h('span', null, step)));
    });
    const steps = h('ol', { class: `tq-steps${useChecklist ? ' tq-steps--check' : ''}` }, ...stepItems);

    const primary = checkIn
      ? button('I did it!', { variant: 'primary', icon: '✔', onClick: () => finish(true), disabled: useChecklist })
      : button('Got it!', { variant: 'primary', onClick: () => finish(false) });
    const notYet = checkIn
      ? button('Not yet', { variant: 'secondary', icon: '↻', onClick: () => finish(false) })
      : null;

    function refresh(): void {
      const ready = boxes.every((box) => box.checked);
      primary.disabled = !ready;
      overlay.setDefault(ready ? primary : null);
    }

    append(overlay.card, [
      h('div', { class: 'tq-header' }, h('p', { class: 'tq-eyebrow' }, checkIn ? 'Field mission check-in' : 'Field mission')),
      h('div', { class: 'tq-prompt' }, h('h2', null, params.title)),
      checkIn ? h('p', null, 'Did you do it?') : null,
      steps,
      useChecklist ? h('p', { class: 'tq-hint' }, 'Tick each step you did.') : null,
      h('p', { class: 'tq-note' }, NOTE),
      h('div', { class: 'tq-actions' }, primary, notYet),
    ]);

    refresh();
    overlay.focus(useChecklist ? boxes[0] : primary);
  });
}

export const fieldMissionActivity: ActivityController<'fieldMission'> = {
  type: 'fieldMission',
  run: runFieldMission,
};
