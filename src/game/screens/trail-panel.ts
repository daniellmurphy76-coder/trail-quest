import type { ZoneId } from '../../activities/types';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { ZONE_IDS, ZONE_LABELS } from '../../world/zone-ids';
import { line, STOP_KIND_LABELS, TRAIL_STATUS_LABELS, type LineLevel } from '../lines';
import type { TrailView } from '../session';

/** What the Scout picked. `{ travel }` is a free-roam hop from the Places section. */
export type TrailPanelChoice = 'close' | 'switch' | 'parent' | 'start' | { travel: ZoneId };

export interface TrailPanelOptions {
  view: TrailView;
  level: LineLevel;
  /** The Start button at the top of the panel, with its words. Omit when there is nothing to start. */
  start?: { label: string };
  /**
   * The Places section: one button per zone for a free-roam hop. `current` is the zone the Scout
   * is in (its button says "You are here" and does nothing). Omit to leave the section out.
   */
  places?: { current: ZoneId };
  /**
   * Adds a "Change my look" button. The panel stays open underneath: call the avatar editor from
   * here. If the function returns a promise, the button waits (disabled) until it settles, so a
   * double tap never opens two editors. Omit to leave the button out.
   */
  onEditAvatar?: () => void | Promise<void>;
}

export const CHANGE_LOOK_LABEL = 'Change my look';
export const PLACES_TITLE = 'Places';
export const PLACES_HERE = 'You are here';

function placesSection(current: ZoneId, onPick: (zone: ZoneId) => void): HTMLElement {
  return h(
    'section',
    { class: 'tq-places', attrs: { 'aria-label': PLACES_TITLE } },
    h('h3', { class: 'tq-places__title' }, PLACES_TITLE),
    h(
      'div',
      { class: 'tq-places__grid' },
      ...ZONE_IDS.map((zone) => {
        const here = zone === current;
        const btn = button(here ? `${ZONE_LABELS[zone]} (${PLACES_HERE})` : ZONE_LABELS[zone], {
          icon: here ? '\u{1F4CD}' : '→',
          class: 'tq-place',
          disabled: here,
          onClick: () => onPick(zone),
        });
        btn.dataset.zone = zone;
        if (here) btn.setAttribute('aria-current', 'location');
        return btn;
      }),
    ),
  );
}

const TITLE = "Today's Trail";

/** The "Change my look" button: runs `onEdit`, and stays disabled while it is still working. */
function lookButton(onEdit: () => void | Promise<void>): HTMLButtonElement {
  const btn = button(CHANGE_LOOK_LABEL, {
    icon: '\u{1F3A8}',
    onClick: () => {
      if (btn.disabled) return;
      let result: void | Promise<void>;
      try {
        result = onEdit();
      } catch (err) {
        console.error(err);
        return;
      }
      if (result && typeof result.then === 'function') {
        btn.disabled = true;
        result
          .catch((err: unknown) => console.error(err))
          .finally(() => {
            btn.disabled = false;
          });
      }
    },
  });
  return btn;
}

function itemRows(items: TrailView['items']): HTMLElement {
  return h(
    'ol',
    { class: 'tq-trail-list' },
    ...items.map((item) => {
      const status = TRAIL_STATUS_LABELS[item.status];
      return h(
        'li',
        { class: `tq-trail-item is-${item.status}` },
        h(
          'span',
          { class: 'tq-trail-item__status' },
          h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, status.icon),
          h('span', null, status.word),
        ),
        h(
          'span',
          { class: 'tq-trail-item__what' },
          h('span', { class: 'tq-trail-item__kind' }, STOP_KIND_LABELS[item.kind]),
          h('span', { class: 'tq-trail-item__title' }, item.title),
        ),
      );
    }),
  );
}

/**
 * Today's stops as a list. Each row carries an icon and a word (Done, Up next, Later), so status
 * is never color alone. The same Start button as Base Camp sits at the top (resolves 'start'). Also
 * the way to switch Scouts or open Parent mode.
 */
export function showTrailPanel(host: HTMLElement, options: TrailPanelOptions): Promise<TrailPanelChoice> {
  return new Promise<TrailPanelChoice>((resolve) => {
    let finished = false;
    const finish = (choice: TrailPanelChoice): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(choice);
    };
    const overlay = mountOverlay(host, {
      label: TITLE,
      cardClass: 'tq-trail-panel',
      onEscape: () => finish('close'),
    });

    const { view, level } = options;
    const body = h('div', { class: 'tq-trail-body' });
    if (view.state !== 'ready') {
      body.append(h('p', { class: 'tq-trail-empty' }, line(view.state === 'done-today' ? 'panelDone' : 'panelEmpty', level)));
    }
    if (view.items.length > 0) body.append(itemRows(view.items));

    const startButton = options.start
      ? button(options.start.label, {
          variant: 'primary',
          icon: '▶',
          class: 'tq-start tq-start--panel',
          onClick: () => finish('start'),
        })
      : null;
    const close = button('Close', { variant: startButton ? 'secondary' : 'primary', onClick: () => finish('close') });
    const editLook = options.onEditAvatar ? lookButton(options.onEditAvatar) : null;
    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, TITLE)),
      ...(startButton ? [startButton] : []),
      body,
      ...(options.places ? [placesSection(options.places.current, (zone) => finish({ travel: zone }))] : []),
      h(
        'div',
        { class: 'tq-actions' },
        editLook,
        button('Switch Scout', { icon: '⇄', onClick: () => finish('switch') }),
        button('Parent', { onClick: () => finish('parent') }),
        close,
      ),
    );
    const first = startButton ?? close;
    overlay.setDefault(first);
    overlay.focus(first);
  });
}
