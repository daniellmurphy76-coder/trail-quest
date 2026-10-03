import type { RankId } from '../../activities/types';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import type { Speak } from '../../ui/speech';
import { button, readButton, uid } from '../../ui/widgets';
import { createDefaultSave, createProfile, type NewProfileOptions } from '../../save/store';

export interface RankChoice {
  rank: RankId;
  /** From the rank content, for example "Wolf". */
  label: string;
  grade: number;
}

export interface ProfileSetupOptions {
  ranks: readonly RankChoice[];
  speak: Speak;
  /** Show a Back button. False on the very first run, when there is nowhere to go back to. */
  allowCancel: boolean;
}

export const DEFAULT_GUIDE_NAME = 'Den Chief';

/** Whether read-aloud starts on for a rank. Asked of createProfile, so the two never disagree. */
export function defaultReadAloud(rank: RankId): boolean {
  return createProfile(createDefaultSave(), { name: 'x', rank }).readAloud;
}

export function rankCardLabel(choice: RankChoice): string {
  return `${choice.label} · grade ${choice.grade}`;
}

/** "Who is playing?": name, rank, guide name and read-aloud. Resolves the new profile's options, or null on Back. */
export function showProfileSetup(host: HTMLElement, options: ProfileSetupOptions): Promise<NewProfileOptions | null> {
  return new Promise<NewProfileOptions | null>((resolve) => {
    let finished = false;
    const finish = (value: NewProfileOptions | null): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(value);
    };
    const overlay = mountOverlay(host, {
      label: 'Who is playing?',
      cardClass: 'tq-setup',
      onEscape: options.allowCancel ? () => finish(null) : undefined,
    });

    let rank: RankId | undefined;
    let readAloudTouched = false;

    const nameId = uid('tq-name');
    const guideId = uid('tq-guide');
    const rankLabelId = uid('tq-rank-label');
    const nameInput = h('input', {
      class: 'tq-input',
      id: nameId,
      type: 'text',
      name: 'scout-name',
      attrs: { maxlength: 24, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false' },
    });
    const guideInput = h('input', {
      class: 'tq-input',
      id: guideId,
      type: 'text',
      name: 'guide-name',
      value: DEFAULT_GUIDE_NAME,
      attrs: { maxlength: 24, autocomplete: 'off', spellcheck: 'false' },
    });
    const readAloud = h('input', { type: 'checkbox', id: uid('tq-read-aloud'), checked: false });
    const message = h('p', { class: 'tq-form__msg', role: 'alert' });

    const cards = options.ranks.map((choice) => {
      const mark = h('span', { class: 'tq-rank-card__mark', attrs: { 'aria-hidden': 'true' } });
      const card = h(
        'button',
        { class: 'tq-rank-card', type: 'button', attrs: { 'aria-pressed': 'false' } },
        h('span', { class: 'tq-rank-card__label' }, rankCardLabel(choice)),
        mark,
      );
      card.addEventListener('click', () => select(choice.rank));
      return { choice, card, mark };
    });

    function select(next: RankId): void {
      rank = next;
      for (const { choice, card, mark } of cards) {
        const on = choice.rank === next;
        card.setAttribute('aria-pressed', String(on));
        card.classList.toggle('is-selected', on);
        mark.textContent = on ? '✓ Picked' : '';
      }
      if (!readAloudTouched) readAloud.checked = defaultReadAloud(next);
      message.textContent = '';
    }

    readAloud.addEventListener('change', () => {
      readAloudTouched = true;
    });

    function submit(): void {
      const name = nameInput.value.trim();
      if (name === '') {
        message.textContent = '✖ Type your name first.';
        nameInput.focus({ preventScroll: true });
        return;
      }
      if (!rank) {
        message.textContent = '✖ Pick your rank.';
        cards[0]?.card.focus({ preventScroll: true });
        return;
      }
      finish({
        name,
        rank,
        guideName: guideInput.value.trim() || DEFAULT_GUIDE_NAME,
        readAloud: readAloud.checked,
      });
    }

    const start = button("Let's start", { variant: 'primary', icon: '→', onClick: submit });
    const back = options.allowCancel ? button('Back', { icon: '←', onClick: () => finish(null) }) : null;

    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, 'Who is playing?'), readButton('Who is playing?', options.speak)),
      h('div', { class: 'tq-field' }, h('label', { htmlFor: nameId }, 'Your name'), nameInput),
      h(
        'div',
        { class: 'tq-field' },
        h('p', { class: 'tq-field__label', id: rankLabelId }, 'Your rank'),
        h(
          'div',
          { class: 'tq-rank-grid', role: 'group', attrs: { 'aria-labelledby': rankLabelId } },
          ...cards.map((c) => c.card),
        ),
      ),
      h('div', { class: 'tq-field' }, h('label', { htmlFor: guideId }, 'Guide name'), guideInput),
      h(
        'label',
        { class: 'tq-check' },
        readAloud,
        h('span', null, 'Read to me'),
      ),
      message,
      h('div', { class: 'tq-actions' }, start, back),
    );
    overlay.setDefault(start);
    overlay.focus(nameInput);
  });
}
