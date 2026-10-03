import type { RankId } from '../../activities/types';
import { isOptionalRequirement } from '../../content/load';
import type { RankContent } from '../../content/types';
import { exportSave, importSave } from '../../save/store';
import type { Profile, SaveFile } from '../../save/types';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import {
  adventureProgress,
  approveAndAward,
  pendingApprovals,
  requirementStatusWord,
  resetProfileProgress,
  STATUS_ICONS,
} from '../parent';
import { PARENT_TEXT } from '../lines';
import { askConfirm } from './confirm';

export interface ParentModeOptions {
  /** The live save. The screen edits it in place and calls `persist`. */
  save: SaveFile;
  today(): string;
  /** Write the save to storage. */
  persist(): void;
  /** Replace the contents of the live save with an imported one, then persist. */
  replaceSave(next: SaveFile): void;
  /** Ask for a new PIN and store it. True when the PIN was changed. */
  changePin(): Promise<boolean>;
  contentFor(rank: RankId): RankContent | undefined;
  rankLabel(rank: RankId): string;
  /** Which Scout to show first. */
  startProfileId?: string;
}

export interface ParentModeResult {
  /** True when a save was imported, so profile ids may have changed. */
  imported: boolean;
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parent mode (the caller has already asked for the PIN). Plain and readable: pick a Scout, see
 * every requirement's status in words, approve waiting missions, and manage the save.
 */
export function showParentMode(host: HTMLElement, options: ParentModeOptions): Promise<ParentModeResult> {
  return new Promise<ParentModeResult>((resolve) => {
    const { save } = options;
    let imported = false;
    let finished = false;
    let selectedId = options.startProfileId ?? save.profiles[0]?.id;
    const expanded = new Set<string>();

    const close = (): void => {
      if (finished) return;
      finished = true;
      fileInput.remove();
      overlay.close();
      resolve({ imported });
    };
    const overlay = mountOverlay(host, {
      label: 'Parent mode',
      cardClass: 'tq-parent',
      onEscape: close,
    });

    const message = h('p', { class: 'tq-parent__msg', role: 'status', tabIndex: -1 });
    const body = h('div', { class: 'tq-parent__body' });
    // Lives outside the card so it never takes part in the overlay's Tab loop.
    const fileInput = h('input', { type: 'file', hidden: true, attrs: { accept: 'application/json,.json' } });
    host.appendChild(fileInput);

    function say(text: string, focus = true): void {
      message.textContent = text;
      if (focus) message.focus({ preventScroll: true });
    }

    function selected(): Profile | undefined {
      return save.profiles.find((p) => p.id === selectedId) ?? save.profiles[0];
    }

    function replaceProfile(next: Profile): void {
      const index = save.profiles.findIndex((p) => p.id === next.id);
      if (index >= 0) save.profiles[index] = next;
      options.persist();
    }

    function scoutPicker(): HTMLElement {
      return h(
        'div',
        { class: 'tq-parent__scouts', role: 'group', attrs: { 'aria-label': 'Scouts' } },
        ...save.profiles.map((profile) => {
          const on = profile.id === selected()?.id;
          const btn = button(`${profile.name} · ${options.rankLabel(profile.rank)}`, {
            variant: on ? 'primary' : 'secondary',
            onClick: () => {
              selectedId = profile.id;
              render();
            },
          });
          btn.setAttribute('aria-pressed', String(on));
          return btn;
        }),
      );
    }

    function approvalsSection(profile: Profile, content: RankContent | undefined): HTMLElement {
      const pending = pendingApprovals(profile, content);
      const section = h('section', { class: 'tq-parent__section' }, h('h3', null, 'Waiting for your approval'));
      if (pending.length === 0 || !content) {
        section.append(h('p', null, 'Nothing is waiting.'));
        return section;
      }
      for (const item of pending) {
        const approve = button('Approve', {
          variant: 'primary',
          icon: '✓',
          onClick: () => {
            const result = approveAndAward(profile, content, item.requirementId, options.today());
            replaceProfile(result.profile);
            const badges = result.newBadges.length > 0 ? ` Badge earned: ${result.newBadges.join(', ')}.` : '';
            render();
            say(`Approved: ${item.title}.${badges}`);
          },
        });
        approve.setAttribute('aria-label', `Approve: ${item.title}`);
        section.append(
          h(
            'div',
            { class: 'tq-parent__approval' },
            h(
              'div',
              null,
              h('p', { class: 'tq-parent__approval-title' }, item.title),
              h('p', { class: 'tq-hint' }, item.adventureName),
              item.parentNote ? h('p', { class: 'tq-parent-note' }, `What to look for: ${item.parentNote}`) : null,
            ),
            approve,
          ),
        );
      }
      return section;
    }

    function adventuresSection(profile: Profile, content: RankContent | undefined): HTMLElement {
      const section = h('section', { class: 'tq-parent__section' }, h('h3', null, 'Adventures'));
      if (!content) {
        section.append(h('p', null, 'There are no adventures for this rank yet.'));
        return section;
      }
      for (const adventure of content.adventures) {
        const { done, total } = adventureProgress(adventure, profile);
        const open = expanded.has(adventure.id);
        const earned = profile.adventures[adventure.id] !== undefined;
        const toggle = button(
          `${adventure.name} — ${done} of ${total} done${earned ? ' (badge earned)' : ''}${adventure.required ? '' : ' (extra)'}`,
          {
            class: 'tq-parent__toggle',
            icon: open ? '▾' : '▸',
            onClick: () => {
              if (expanded.has(adventure.id)) expanded.delete(adventure.id);
              else expanded.add(adventure.id);
              render();
              body.querySelector<HTMLElement>(`[data-adventure="${adventure.id}"]`)?.focus({ preventScroll: true });
            },
          },
        );
        toggle.setAttribute('aria-expanded', String(open));
        toggle.dataset.adventure = adventure.id;
        const group = h('div', { class: 'tq-parent__adventure' }, toggle);
        if (open) {
          group.append(
            h(
              'ul',
              { class: 'tq-parent__reqs' },
              ...adventure.requirements.map((requirement) => {
                const word = requirementStatusWord(profile.requirements[requirement.id]);
                return h(
                  'li',
                  { class: 'tq-parent__req' },
                  h('span', { class: 'tq-parent__req-num' }, requirement.number),
                  h(
                    'span',
                    { class: 'tq-parent__req-text' },
                    requirement.adultText,
                    isOptionalRequirement(adventure, requirement) ? ' (optional)' : '',
                  ),
                  h(
                    'span',
                    { class: `tq-parent__req-status is-${word.toLowerCase().replace(/\s+/g, '-')}` },
                    h('span', { attrs: { 'aria-hidden': 'true' } }, `${STATUS_ICONS[word]} `),
                    word,
                  ),
                );
              }),
            ),
          );
        }
        section.append(group);
      }
      return section;
    }

    function resetSection(profile: Profile): HTMLElement {
      const reset = button(`Reset ${profile.name}`, {
        icon: '↺',
        onClick: () => {
          void (async () => {
            const yes = await askConfirm(host, {
              title: `Reset ${profile.name}?`,
              text: 'This erases XP, streak, badges and all progress for this Scout. The name and settings stay. It cannot be undone.',
              yes: 'Reset this Scout',
              no: 'Keep everything',
            });
            if (!yes) return;
            replaceProfile(resetProfileProgress(profile));
            render();
            say(`${profile.name} has been reset.`);
          })();
        },
      });
      reset.setAttribute('aria-label', `Reset this Scout: ${profile.name}`);
      return h('section', { class: 'tq-parent__section' }, h('h3', null, 'Reset this Scout'), reset);
    }

    function saveSection(): HTMLElement {
      return h(
        'section',
        { class: 'tq-parent__section' },
        h('h3', null, 'Save and PIN'),
        h('p', { class: 'tq-hint' }, 'The save lives only in this browser. Export it to keep a copy or move to another device.'),
        h(
          'div',
          { class: 'tq-actions' },
          button('Export save', {
            icon: '↓',
            onClick: () => {
              downloadJson(exportSave(save), `trail-quest-save-${options.today()}.json`);
              say('Save exported. Look in your downloads.');
            },
          }),
          button('Import save', { icon: '↑', onClick: () => fileInput.click() }),
          button('Change PIN', {
            onClick: () => {
              void options.changePin().then((changed) => {
                if (changed) say('PIN changed.');
              });
            },
          }),
        ),
      );
    }

    async function onFileChosen(): Promise<void> {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      let next: SaveFile;
      try {
        next = importSave(await file.text());
      } catch (error) {
        say(`✖ ${error instanceof Error ? error.message : 'That file could not be read.'}`);
        return;
      }
      const yes = await askConfirm(host, {
        title: 'Replace everything?',
        text: `This replaces every Scout and all progress on this device with the file (${next.profiles.length} ${
          next.profiles.length === 1 ? 'Scout' : 'Scouts'
        }). Export your current save first if you want a copy.`,
        yes: 'Replace everything',
        no: 'Keep what I have',
      });
      if (!yes) return;
      options.replaceSave(next);
      imported = true;
      selectedId = save.profiles[0]?.id;
      render();
      say('Save imported.');
    }
    fileInput.addEventListener('change', () => void onFileChosen());

    function render(): void {
      const profile = selected();
      body.replaceChildren();
      if (!profile) {
        body.append(h('p', null, 'There are no Scouts yet.'), saveSection());
        return;
      }
      const content = options.contentFor(profile.rank);
      body.append(
        scoutPicker(),
        approvalsSection(profile, content),
        adventuresSection(profile, content),
        resetSection(profile),
        saveSection(),
      );
    }

    overlay.card.append(
      h('div', { class: 'tq-header' }, h('h2', null, 'Parent mode'), button('Close', { variant: 'primary', onClick: close })),
      h('p', { class: 'tq-hint' }, PARENT_TEXT.approvalReminder),
      message,
      body,
    );
    render();
    overlay.focus(overlay.card.querySelector<HTMLElement>('.tq-btn--primary'));
  });
}
