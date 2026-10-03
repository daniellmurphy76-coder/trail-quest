import { h } from '../../ui/dom';
import { compassView, radiansToDegrees, type GroundPoint } from '../compass-math';
import { line } from '../lines';

export interface Compass {
  readonly root: HTMLElement;
  /** Where the arrow points now, or null when it has no target. */
  readonly target: GroundPoint | null;
  /**
   * Point the arrow at a spot on the ground, with a short name for it ("Den Chief"). Pass null
   * to hide the compass. A later zone can point it at a waypoint the same way.
   */
  setTarget(point: GroundPoint | null, label?: string): void;
  /** Turn the arrow. Call once per rendered frame with where the player is and where the camera looks. */
  update(playerPos: GroundPoint, cameraYaw: number): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An up-pointing arrow: green with a dark outline, drawn so it never depends on an emoji font. */
function arrowSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'tq-compass__arrow');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M20 3 L35 34 L20 27 L5 34 Z');
  svg.appendChild(path);
  return svg;
}

/**
 * The compass at the top of the screen: an arrow that turns toward the target, its name, and how
 * many steps away it is. It hides itself when there is no target or the target is within reach.
 * The strings come from lines.ts and read the same at both reading levels.
 */
export function createCompass(host: HTMLElement): Compass {
  const arrow = arrowSvg();
  const labelEl = h('span', { class: 'tq-compass__label' });
  const stepsEl = h('span', { class: 'tq-compass__steps', hidden: true });
  const root = h(
    'div',
    { class: 'tq-compass', hidden: true, attrs: { 'aria-hidden': 'true' } },
    arrow,
    h('span', { class: 'tq-compass__text' }, labelEl, stepsEl),
  );
  host.appendChild(root);

  let target: GroundPoint | null = null;
  let shown = false;
  let rotation = '';
  let stepsText: string | null = null;

  return {
    root,
    get target() {
      return target;
    },
    setTarget(point, label = '') {
      target = point ? { x: point.x, z: point.z } : null;
      if (labelEl.textContent !== label) labelEl.textContent = label;
      if (!target && shown) {
        shown = false;
        root.hidden = true;
      }
    },
    update(playerPos, cameraYaw) {
      const view = compassView(playerPos, target, cameraYaw);
      if (view.visible !== shown) {
        shown = view.visible;
        root.hidden = !shown;
      }
      if (!view.visible) return;

      const next = `rotate(${radiansToDegrees(view.angle).toFixed(1)}deg)`;
      if (next !== rotation) {
        rotation = next;
        arrow.style.transform = next;
      }
      const text =
        view.steps === null
          ? null
          : view.steps === 1
            ? line('compassStep', 'grade2')
            : line('compassSteps', 'grade2', { steps: view.steps });
      if (text !== stepsText) {
        stepsText = text;
        stepsEl.hidden = text === null;
        stepsEl.textContent = text ?? '';
      }
    },
  };
}
