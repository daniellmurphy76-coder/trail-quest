import { h } from '../../ui/dom';

/**
 * The strip along the bottom centre of the screen at Base Camp. The Start button and the
 * controls hint stack inside it, hint above button, so they never cover each other. On touch it is
 * narrowed in CSS to sit between the joystick on the left and the action button on the right.
 */
export function createDock(host: HTMLElement): HTMLElement {
  const dock = h('div', { class: 'tq-dock' });
  host.appendChild(dock);
  return dock;
}
