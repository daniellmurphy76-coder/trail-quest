import type { RankId } from '../../activities/types';
import { isOptionalRequirement } from '../../content/load';
import type { RankContent } from '../../content/types';
import { exportSave, importSave, nextRank, promoteRank, removeProfile, resetProgress } from '../../save/store';
import type { Profile, SaveFile } from '../../save/types';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { PARENT_TEXT } from '../lines';
import { approveAndAward, pendingApprovals, requirementStatusWord, STATUS_ICONS } from '../parent';
import { adventureCounts, gradeLabel, summarizeScout } from '../parent-overview';
import { titleForXp } from '../rewards';
import { formatDate, showProgressSheet, type ProgressSheetHandle } from '../progress-sheet';
import { askConfirm } from './confirm';
import '../parent.css';

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
  /** Which Scout's card gets focus first. */
  startProfileId?: string;
  /** Opens the print dialog for the progress sheet. Defaults to `window.print()`; tests pass a spy. */
  print?: () => void;
}

export interface ParentModeResult {
  /** True when a save was imported, so profile ids may have changed. Every other field is then empty. */
  imported: boolean;
  /** Scouts whose data changed (approvals, reset, new rank) and still exist: refresh the HUD and trail for them. */
  changedProfileIds: string[];
  /** Scouts that were removed. */
  removedProfileIds: string[];
  /** True when the Scout who was active was removed: go back to the picker. `save.activeProfileId` is then unset. */
  removedActiveProfile: boolean;
}

type ToolKey = 'reset' | 'promote' | 'remove';

type View =
  | { kind: 'overview' }
  | { kind: 'details'; id: string }
  | { kind: 'tools'; id: string; confirming?: ToolKey };

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

/** A progress bar with its numbers in the label; the caller writes the numbers beside it too. */
function bar(done: number, total: number, label: string): HTMLElement {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return h(
    'div',
    {
      class: 'tq-pdash__bar',
      role: 'progressbar',
      attrs: { 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
    },
    h('span', { class: 'tq-pdash__fill', style: `width:${percent}%` }),
  );
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Parent mode (the caller has already asked for the PIN). Plain and readable. After the PIN it opens
 * on an overview with a card for each Scout; from there a parent can see one Scout's details (every
 * requirement in words, and Approve for waiting missions), print a progress sheet, or open Tools
 * (reset progress, move to the next rank, remove the Scout), each behind a second confirm that
 * names the Scout. Export, import and Change PIN live under the cards. Resolves when Close is chosen.
 */
export function showParentMode(host: HTMLElement, options: ParentModeOptions): Promise<ParentModeResult> {
  return new Promise<ParentModeResult>((resolve) => {
    const { save } = options;
    let imported = false;
    let finished = false;
    let view: View = { kind: 'overview' };
    let sheet: ProgressSheetHandle | undefined;
    let removedActive = false;
    const changed = new Set<string>();
    const removed = new Set<string>();
    const expanded = new Set<string>();

    const close = (): void => {
      if (finished) return;
      finished = true;
      sheet?.close();
      fileInput.remove();
      overlay.close();
      resolve({
        imported,
        changedProfileIds: [...changed].filter((id) => !removed.has(id)),
        removedProfileIds: [...removed],
        removedActiveProfile: removedActive,
      });
    };
    const overlay = mountOverlay(host, {
      label: 'Parent mode',
      cardClass: 'tq-parent tq-pdash',
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

    function profileById(id: string): Profile | undefined {
      return save.profiles.find((p) => p.id === id);
    }

    function replaceProfile(next: Profile): void {
      const index = save.profiles.findIndex((p) => p.id === next.id);
      if (index >= 0) save.profiles[index] = next;
      changed.add(next.id);
      options.persist();
    }

    /** Switch views and put focus on the new view's title so screen readers announce it. */
    function go(next: View): void {
      view = next;
      render();
      body.scrollTop = 0;
      body.querySelector<HTMLElement>('.tq-pdash__title')?.focus({ preventScroll: true });
    }

    function title(text: string): HTMLElement {
      return h('h3', { class: 'tq-pdash__title', tabIndex: -1 }, text);
    }

    function backButton(): HTMLButtonElement {
      return button('Back to all Scouts', { icon: '←', onClick: () => go({ kind: 'overview' }) });
    }

    function printSheet(profile: Profile, content: RankContent): void {
      sheet?.close();
      sheet = showProgressSheet(host, profile, content, {
        today: options.today(),
        rankLabel: options.rankLabel(profile.rank),
        print: options.print,
      });
    }

    /** Details, Print progress sheet and Tools for one Scout. `skip` leaves out the button for the view you are in. */
    function actionRow(profile: Profile, content: RankContent | undefined, skip?: 'details' | 'tools'): HTMLElement {
      const row = h('div', { class: 'tq-pdash__actions' });
      if (skip !== 'details') {
        const details = button('Details', { variant: 'primary', onClick: () => go({ kind: 'details', id: profile.id }) });
        details.setAttribute('aria-label', `Details for ${profile.name}`);
        details.dataset.action = 'details';
        row.append(details);
      }
      if (content) {
        const print = button('Print progress sheet', { onClick: () => printSheet(profile, content) });
        print.setAttribute('aria-label', `Print progress sheet for ${profile.name}`);
        print.dataset.action = 'print';
        row.append(print);
      }
      if (skip !== 'tools') {
        const tools = button('Tools', { onClick: () => go({ kind: 'tools', id: profile.id }) });
        tools.setAttribute('aria-label', `Tools for ${profile.name}`);
        tools.dataset.action = 'tools';
        row.append(tools);
      }
      return row;
    }

    // ---- Overview ---------------------------------------------------------------------------------

    function scoutCard(profile: Profile): HTMLElement {
      const content = options.contentFor(profile.rank);
      const sum = summarizeScout(profile, content);
      const stat = (label: string, value: string): HTMLElement =>
        h('div', { class: 'tq-pdash__stat' }, h('dt', null, label), h('dd', null, value));
      const rank = options.rankLabel(profile.rank);
      const trail = titleForXp(profile.xp);

      const card = h(
        'article',
        { class: 'tq-pdash__card', attrs: { 'aria-label': profile.name }, dataset: { profile: profile.id } },
        h('div', null, h('h3', null, profile.name), h('p', { class: 'tq-hint' }, content ? `${rank} · ${gradeLabel(content.grade)}` : rank)),
        h(
          'dl',
          { class: 'tq-pdash__stats' },
          stat('Last played', sum.lastPlayed ? formatDate(sum.lastPlayed) : 'Not yet'),
          stat('Streak', plural(sum.streak, 'day', 'days')),
          stat('XP', String(sum.xp)),
          trail ? stat('Trail title', trail) : null,
          stat('Badges', content ? `${sum.badges} of ${sum.badgesTotal}` : 'None yet'),
        ),
      );

      if (!content) {
        card.append(h('p', null, 'There are no adventures for this rank yet.'));
      } else {
        card.append(
          h(
            'div',
            { class: 'tq-pdash__overall' },
            h('p', { class: 'tq-pdash__overall-text' }, `Overall: ${sum.done} of ${sum.total} requirements done (${sum.percent}%)`),
            bar(sum.done, sum.total, `Overall: ${sum.done} of ${sum.total} requirements done`),
          ),
          h(
            'ul',
            { class: 'tq-pdash__adventures' },
            ...sum.adventures.map((a) =>
              h(
                'li',
                { class: 'tq-pdash__adv', dataset: { adventure: a.id } },
                h('span', null, a.name),
                bar(a.done, a.total, `${a.name}: ${a.done} of ${a.total} requirements done`),
                h('span', { class: 'tq-pdash__adv-count' }, a.badge ? '✓ Badge' : `${a.done} of ${a.total}`),
              ),
            ),
          ),
        );
      }
      if (sum.pending > 0) {
        card.append(h('p', { class: 'tq-pdash__pending' }, `Pending approvals: ${sum.pending}`));
      }
      card.append(actionRow(profile, content));
      return card;
    }

    function overviewView(): HTMLElement[] {
      if (save.profiles.length === 0) {
        return [title('All Scouts'), h('p', null, 'There are no Scouts yet.'), saveSection()];
      }
      return [
        title('All Scouts'),
        h('div', { class: 'tq-pdash__list' }, ...save.profiles.map(scoutCard)),
        saveSection(),
      ];
    }

    // ---- Details ----------------------------------------------------------------------------------

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
        const { done, total } = adventureCounts(adventure, profile);
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
          if (adventure.choose) {
            group.append(
              h(
                'p',
                { class: 'tq-hint' },
                `Needs any ${adventure.choose.count} of the requirements marked optional, plus all the others.`,
              ),
            );
          }
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

    function detailsView(profile: Profile): HTMLElement[] {
      const content = options.contentFor(profile.rank);
      return [
        backButton(),
        title(`${profile.name} · ${options.rankLabel(profile.rank)}`),
        actionRow(profile, content, 'details'),
        approvalsSection(profile, content),
        adventuresSection(profile, content),
      ];
    }

    // ---- Tools ------------------------------------------------------------------------------------

    interface ToolSpec {
      key: ToolKey;
      heading: string;
      text: string;
      action: string;
      icon?: string;
      /** Why the tool cannot be used right now; the button is disabled and this is shown. */
      unavailable?: string;
      /** The question that names the Scout. */
      question: string;
      yes: string;
      run(): void;
    }

    function toolSection(profile: Profile, spec: ToolSpec): HTMLElement {
      const section = h('section', { class: 'tq-pdash__tool', dataset: { tool: spec.key } }, h('h3', null, spec.heading), h('p', null, spec.text));
      const confirming = view.kind === 'tools' && view.confirming === spec.key;
      if (confirming) {
        const no = button('No, keep it', { variant: 'primary', onClick: () => go({ kind: 'tools', id: profile.id }) });
        no.dataset.cancel = 'true';
        const yes = button(spec.yes, { onClick: spec.run });
        section.append(
          h(
            'div',
            { class: 'tq-pdash__confirm', role: 'group', attrs: { 'aria-label': `Confirm: ${spec.heading}` } },
            h('p', { class: 'tq-pdash__question' }, spec.question),
            h('div', { class: 'tq-actions' }, no, yes),
          ),
        );
        return section;
      }
      if (spec.unavailable) section.append(h('p', { class: 'tq-hint' }, spec.unavailable));
      const start = button(spec.action, {
        icon: spec.icon,
        disabled: spec.unavailable !== undefined,
        onClick: () => {
          view = { kind: 'tools', id: profile.id, confirming: spec.key };
          render();
          body.querySelector<HTMLElement>('[data-cancel]')?.focus({ preventScroll: true });
        },
      });
      start.dataset.tool = spec.key;
      section.append(start);
      return section;
    }

    function toolsView(profile: Profile): HTMLElement[] {
      const name = profile.name;
      const rankName = options.rankLabel(profile.rank);
      const next = nextRank(profile.rank);
      const nextName = next ? options.rankLabel(next) : '';
      let unavailable: string | undefined;
      if (!next) unavailable = `${rankName} is the last rank.`;
      else if (!options.contentFor(next)) unavailable = `${nextName} adventures are not in the game yet.`;
      const content = options.contentFor(profile.rank);

      const reset: ToolSpec = {
        key: 'reset',
        heading: 'Reset progress',
        text: `Erases ${name}'s XP, streak, badges and all requirement progress. The name, rank, look and sound setting stay.`,
        action: 'Reset progress',
        icon: '↺',
        question: `Reset ${name}'s progress? This cannot be undone.`,
        yes: `Yes, reset ${name}'s progress`,
        run() {
          replaceProfile(resetProgress(profile));
          go({ kind: 'tools', id: profile.id });
          say(`${name}'s progress was reset.`);
        },
      };
      const promote: ToolSpec = {
        key: 'promote',
        heading: 'Move to next rank',
        text: next
          ? `Moves ${name} from ${rankName} to ${nextName}. The look stays, and ${rankName} progress stays saved.`
          : `${name} is already in the last rank.`,
        action: next ? `Move to ${nextName}` : 'Move to next rank',
        icon: '↑',
        unavailable,
        question: `Move ${name} from ${rankName} to ${nextName}? ${rankName} progress stays saved.`,
        yes: `Yes, move ${name} to ${nextName}`,
        run() {
          if (!next) return;
          try {
            replaceProfile(promoteRank(profile, next, (rank) => options.contentFor(rank) !== undefined));
            go({ kind: 'tools', id: profile.id });
            say(`${name} is now in ${nextName}.`);
          } catch (error) {
            go({ kind: 'tools', id: profile.id });
            say(`✖ ${error instanceof Error ? error.message : 'That did not work.'}`);
          }
        },
      };
      const remove: ToolSpec = {
        key: 'remove',
        heading: 'Remove this Scout',
        text: `Deletes ${name} and all progress from this device. Export a save first if you want a copy.`,
        action: `Remove ${name}`,
        icon: '✖',
        question: `Remove ${name}? This deletes ${name} and all progress from this device. This cannot be undone.`,
        yes: `Yes, remove ${name}`,
        run() {
          const result = removeProfile(save, profile.id);
          if (!result.removed) return;
          options.persist();
          removed.add(profile.id);
          changed.delete(profile.id);
          if (result.wasActive) removedActive = true;
          go({ kind: 'overview' });
          say(`${name} was removed.`);
        },
      };

      return [
        backButton(),
        title(`Tools for ${name}`),
        actionRow(profile, content, 'tools'),
        toolSection(profile, reset),
        toolSection(profile, promote),
        toolSection(profile, remove),
      ];
    }

    // ---- Save and PIN -----------------------------------------------------------------------------

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
              void options.changePin().then((changedPin) => {
                if (changedPin) say('PIN changed.');
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
      // Ids in the old save mean nothing now.
      changed.clear();
      removed.clear();
      removedActive = false;
      go({ kind: 'overview' });
      say('Save imported.');
    }
    fileInput.addEventListener('change', () => void onFileChosen());

    // ---- Render -----------------------------------------------------------------------------------

    function render(): void {
      body.replaceChildren();
      if (view.kind !== 'overview') {
        const profile = profileById(view.id);
        if (!profile) view = { kind: 'overview' };
      }
      if (view.kind === 'overview') {
        body.append(...overviewView());
        return;
      }
      const profile = profileById(view.id)!;
      body.append(...(view.kind === 'details' ? detailsView(profile) : toolsView(profile)));
    }

    overlay.card.append(
      h('div', { class: 'tq-header' }, h('h2', null, 'Parent mode'), button('Close', { variant: 'primary', onClick: close })),
      h('p', { class: 'tq-hint' }, PARENT_TEXT.approvalReminder),
      message,
      body,
    );
    render();
    const startCard = Array.from(body.querySelectorAll<HTMLElement>('.tq-pdash__card')).find(
      (card) => card.dataset.profile === options.startProfileId,
    );
    overlay.focus(startCard?.querySelector<HTMLElement>('[data-action="details"]') ?? overlay.card.querySelector<HTMLElement>('.tq-btn--primary'));
  });
}
