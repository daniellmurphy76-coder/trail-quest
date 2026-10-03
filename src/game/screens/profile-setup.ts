import type { RankId } from '../../activities/types';
import { defaultAvatar } from '../../player/avatar/options';
import type { NewProfileOptions } from '../../save/store';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button, uid } from '../../ui/widgets';
import { AVATAR_EDITOR_TITLE, showAvatarEditor } from './avatar-editor';

export interface RankChoice {
  rank: RankId;
  /** From the rank content, for example "Wolf". */
  label: string;
  grade: number;
}

export interface ProfileSetupOptions {
  ranks: readonly RankChoice[];
  /** Show a Back button. False on the very first run, when there is nowhere to go back to. */
  allowCancel: boolean;
}

export const DEFAULT_GUIDE_NAME = 'Den Chief';

/** "K" for kindergarten (grade 0), else the number. */
export function gradeLabel(grade: number): string {
  return grade === 0 ? 'K' : String(grade);
}

export function rankCardLabel(choice: RankChoice): string {
  return `${choice.label} · grade ${gradeLabel(choice.grade)}`;
}

/**
 * "Who is playing?": name, rank and guide name, then "Make your Scout" (the avatar editor).
 * Resolves the new profile's options with the chosen avatar, or null on Back. Back inside the
 * editor returns to this form with everything still filled in.
 */
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
      message.textContent = '';
    }

    let editing = false;

    async function submit(): Promise<void> {
      if (editing) return;
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
      editing = true;
      const avatar = await showAvatarEditor(host, {
        initial: defaultAvatar(rank),
        rank,
        title: AVATAR_EDITOR_TITLE,
        cancelLabel: 'Back',
      });
      editing = false;
      if (finished) return;
      if (!avatar) {
        overlay.focus(start);
        return;
      }
      finish({
        name,
        rank,
        guideName: guideInput.value.trim() || DEFAULT_GUIDE_NAME,
        avatar,
      });
    }

    const start = button("Let's start", {
      variant: 'primary',
      icon: '→',
      onClick: () => {
        submit().catch((err: unknown) => {
          editing = false;
          console.error(err);
        });
      },
    });
    const back = options.allowCancel ? button('Back', { icon: '←', onClick: () => finish(null) }) : null;

    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, 'Who is playing?')),
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
      message,
      h('div', { class: 'tq-actions' }, start, back),
    );
    overlay.setDefault(start);
    overlay.focus(nameInput);
  });
}
