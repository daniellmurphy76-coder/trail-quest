import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import type { Speak } from '../../ui/speech';
import { button, readButton } from '../../ui/widgets';
import { line, STOP_KIND_LABELS, TRAIL_STATUS_LABELS, type LineLevel } from '../lines';
import type { TrailView } from '../session';

export type TrailPanelChoice = 'close' | 'switch' | 'parent';

export interface TrailPanelOptions {
  view: TrailView;
  level: LineLevel;
  speak: Speak;
}

const TITLE = "Today's Trail";

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

/** What the Read button says: the list, one stop per sentence. */
function spokenText(view: TrailView, level: LineLevel): string {
  if (view.state !== 'ready') return `${TITLE}. ${line(view.state === 'done-today' ? 'panelDone' : 'panelEmpty', level)}`;
  const rows = view.items.map(
    (item) => `${STOP_KIND_LABELS[item.kind]}. ${item.title} ${TRAIL_STATUS_LABELS[item.status].word}.`,
  );
  return `${TITLE}. ${rows.join(' ')}`;
}

/**
 * Today's stops as a list. Each row carries an icon and a word (Done, Up next, Later), so status
 * is never color alone. Also the way to switch Scouts or open Parent mode.
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

    const close = button('Close', { variant: 'primary', onClick: () => finish('close') });
    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, TITLE), readButton(spokenText(view, level), options.speak)),
      body,
      h(
        'div',
        { class: 'tq-actions' },
        button('Switch Scout', { icon: '⇄', onClick: () => finish('switch') }),
        button('Parent', { onClick: () => finish('parent') }),
        close,
      ),
    );
    overlay.setDefault(close);
    overlay.focus(close);
  });
}
