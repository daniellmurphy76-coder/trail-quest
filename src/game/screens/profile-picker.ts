import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';

export interface PickerProfile {
  id: string;
  name: string;
  /** For example "Wolf". */
  rankLabel: string;
  streakDays: number;
}

export type PickerChoice = { kind: 'play'; profileId: string } | { kind: 'add' } | { kind: 'parent' };

export interface ProfilePickerOptions {
  profiles: readonly PickerProfile[];
}

export function streakText(days: number): string {
  return `\u{1F525} ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** One card per Scout with a big Play button, plus "Add a Scout" and a small "Parent" button. */
export function showProfilePicker(host: HTMLElement, options: ProfilePickerOptions): Promise<PickerChoice> {
  return new Promise<PickerChoice>((resolve) => {
    let finished = false;
    const finish = (choice: PickerChoice): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(choice);
    };
    const overlay = mountOverlay(host, { label: 'Who is playing?', cardClass: 'tq-picker' });

    const plays: HTMLButtonElement[] = [];
    const cards = options.profiles.map((profile) => {
      const play = button('Play', {
        variant: 'primary',
        icon: '▶',
        onClick: () => finish({ kind: 'play', profileId: profile.id }),
      });
      play.setAttribute('aria-label', `Play as ${profile.name}`);
      plays.push(play);
      return h(
        'li',
        { class: 'tq-profile' },
        h(
          'div',
          { class: 'tq-profile__info' },
          h('p', { class: 'tq-profile__name' }, profile.name),
          h('p', { class: 'tq-profile__rank' }, profile.rankLabel),
          h('p', { class: 'tq-profile__streak' }, streakText(profile.streakDays)),
        ),
        play,
      );
    });

    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, 'Who is playing?')),
      h('ul', { class: 'tq-profiles' }, ...cards),
      h(
        'div',
        { class: 'tq-picker__footer' },
        button('Add a Scout', { icon: '+', onClick: () => finish({ kind: 'add' }) }),
        button('Parent', {
          class: 'tq-btn--small',
          onClick: () => finish({ kind: 'parent' }),
        }),
      ),
    );
    overlay.setDefault(plays[0] ?? null);
    overlay.focus(plays[0]);
  });
}
