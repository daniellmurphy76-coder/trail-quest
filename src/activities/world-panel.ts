/**
 * The two pieces collect and navigate share:
 *
 *  - `mountWorldPanel`: a NON-MODAL panel. Unlike `mountOverlay` it does not dim or cover the
 *    world, trap focus, or ask the game to turn input off, so the Scout keeps walking while it is
 *    up. Its root carries `data-tq-nonmodal="true"`, which src/game/overlays.ts looks for.
 *  - `showNeedsCampCard`: the card shown when one of these stops runs with no 3D world.
 */
import { h } from '../ui/dom';
import { mountOverlay } from '../ui/overlay';
import { button } from '../ui/widgets';
import './world-panel.css';
import type { ActivityResult } from './types';

export const NEEDS_CAMP_TEXT = 'This stop needs the camp. Play it in the game!';

export interface WorldPanel {
  readonly root: HTMLElement;
  close(): void;
}

/**
 * Mount an empty non-modal panel in `host`. The caller fills `root`. It takes no focus and
 * installs no key handlers; Tab and Enter work on its buttons like on any page.
 */
export function mountWorldPanel(host: HTMLElement, label: string): WorldPanel {
  const root = h('section', {
    class: 'tq-world-panel',
    attrs: { 'aria-label': label },
    dataset: { tqNonmodal: 'true' },
  });
  host.appendChild(root);
  return { root, close: () => root.remove() };
}

/** A card that says this stop needs the camp, with a Back button. Resolves "not completed". */
export function showNeedsCampCard(host: HTMLElement, title: string): Promise<ActivityResult> {
  return new Promise<ActivityResult>((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve({ completed: false, attempts: 0 });
    };
    const overlay = mountOverlay(host, { label: title, onEscape: finish });
    const back = button('Back', { variant: 'primary', icon: '←', onClick: finish });
    overlay.card.append(h('p', { class: 'tq-eyebrow' }, title), h('h2', null, NEEDS_CAMP_TEXT), h('div', { class: 'tq-actions' }, back));
    overlay.setDefault(back);
    overlay.focus(back);
  });
}
