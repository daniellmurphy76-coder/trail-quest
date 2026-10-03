import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { line, type LineLevel, type LineVars } from '../lines';

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'and', 'with', 'for', 'at']);

/**
 * Initials for the placeholder badge: the first letters of the first three words that are not
 * small words ("Paws on the Path" gives "PP"). A single word gives its first two letters.
 */
export function badgeInitials(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => /[a-z0-9]/i.test(w));
  const big = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const use = (big.length > 0 ? big : words).slice(0, 3);
  if (use.length === 0) return '?';
  if (use.length === 1) return use[0]!.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  return use.map((w) => w.replace(/[^a-z0-9]/gi, '').charAt(0)).join('').toUpperCase();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * An original placeholder badge: a round disc with the adventure's initials. Plain shapes only,
 * no emblems or artwork from any organization. Drawn with the overlay color tokens.
 */
export function badgeSvg(adventureName: string): SVGSVGElement {
  const root = svg('svg', {
    viewBox: '0 0 120 120',
    width: 160,
    height: 160,
    role: 'img',
    'aria-label': `${adventureName} badge`,
    class: 'tq-badge',
  });
  root.append(
    svg('circle', { cx: 60, cy: 60, r: 56, class: 'tq-badge__rim' }),
    svg('circle', { cx: 60, cy: 60, r: 44, class: 'tq-badge__face' }),
    svg(
      'text',
      {
        x: 60,
        y: 60,
        class: 'tq-badge__initials',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      },
      badgeInitials(adventureName),
    ),
  );
  return root;
}

export interface BadgeCardOptions {
  adventureName: string;
  level: LineLevel;
  vars: LineVars;
}

/** "You earned the {adventure} badge!" with the placeholder badge. Resolves when the kid taps Great. */
export function showBadgeCard(host: HTMLElement, options: BadgeCardOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;
    const text = line('badgeEarned', options.level, { ...options.vars, adventure: options.adventureName });
    const overlay = mountOverlay(host, { label: text, cardClass: 'tq-badge-card' });
    const done = button('Great!', {
      variant: 'primary',
      onClick: () => {
        if (finished) return;
        finished = true;
        overlay.close();
        resolve();
      },
    });
    overlay.card.append(
      badgeSvg(options.adventureName),
      h('div', { class: 'tq-prompt' }, h('h2', null, text)),
      h('div', { class: 'tq-actions' }, done),
    );
    overlay.setDefault(done);
    overlay.focus(done);
  });
}
