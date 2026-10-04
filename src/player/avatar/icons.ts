/**
 * Little flat pictures for the editor's option buttons: a hair style, a pair of eyes, a hat. They
 * are decorative (the button's word is the label), drawn as inline SVG so they stay sharp and need
 * no assets. Colors are fixed, friendly stand-ins; the real colors show in the live preview.
 */

import { findHero } from './heroes';

export type IconGroup = 'build' | 'hairStyle' | 'eyes' | 'glasses' | 'legs' | 'hat' | 'backpack' | 'hero';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#1f2a1f';
const SKIN = '#efbf99';
const HAIR = '#5a3a24';
const HAT = '#2f5fa8';
const HAT_DARK = '#244a85';
const PANTS = '#3c5a99';
const SHIRT = '#5b9bd5';
const SHOE = '#6b4a2f';
const PACK = '#7b5a3a';

type Attrs = Record<string, string | number>;

function node(tag: string, attrs: Attrs, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) el.appendChild(child);
  return el;
}

const circle = (cx: number, cy: number, r: number, fill: string, stroke = false): SVGElement =>
  node('circle', { cx, cy, r, fill, ...(stroke ? { stroke: INK, 'stroke-width': 2 } : {}) });
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string): SVGElement =>
  node('ellipse', { cx, cy, rx, ry, fill });
const rect = (x: number, y: number, width: number, height: number, fill: string, rx = 0): SVGElement =>
  node('rect', { x, y, width, height, rx, fill });
const path = (d: string, fill: string, extra: Attrs = {}): SVGElement => node('path', { d, fill, ...extra });
const stroke = (d: string, width = 2.8): SVGElement =>
  node('path', { d, fill: 'none', stroke: INK, 'stroke-width': width, 'stroke-linecap': 'round' });

function star(cx: number, cy: number, outer: number, inner: number): SVGElement {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return node('polygon', { points: points.join(' '), fill: INK });
}

function svg(...children: SVGElement[]): SVGSVGElement {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 48 48');
  root.setAttribute('class', 'tq-opt__icon');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  for (const child of children) root.appendChild(child);
  return root;
}

// ---- hair ---------------------------------------------------------------------------------------

/** Pieces drawn behind the head, then the head, then pieces drawn over it. */
function hairParts(style: string): { back: SVGElement[]; front: SVGElement[] } {
  const cap = path('M10 27 A14 14 0 0 1 38 27 L36 26 Q24 19 12 26 Z', HAIR);
  switch (style) {
    case 'buzz':
      return { back: [], front: [path('M11.5 26 A12.5 12.5 0 0 1 36.5 26 Q24 21 11.5 26 Z', HAIR)] };
    case 'short':
      return { back: [], front: [cap, rect(10, 24, 4, 7, HAIR, 1), rect(34, 24, 4, 7, HAIR, 1)] };
    case 'spiky':
      return { back: [], front: [node('polygon', { points: '11,26 11,12 17,19 21,7 26,18 32,9 35,20 37,12 37,26 24,21', fill: HAIR })] };
    case 'curly': {
      const puffs: Array<[number, number]> = [[14, 20], [20, 15], [28, 15], [34, 20], [24, 12], [11, 28], [37, 28]];
      return { back: [], front: puffs.map(([x, y]) => circle(x, y, 6, HAIR)) };
    }
    case 'long':
      return { back: [path('M10 27 A14 14 0 0 1 38 27 L38 45 L9 45 Z', HAIR)], front: [cap] };
    case 'ponytail':
      return { back: [ellipse(41, 30, 4.5, 9, HAIR)], front: [cap] };
    case 'braids':
      return {
        back: [circle(9, 34, 3.6, HAIR), circle(9, 40, 3.6, HAIR), circle(39, 34, 3.6, HAIR), circle(39, 40, 3.6, HAIR)],
        front: [cap],
      };
    default:
      return { back: [], front: [] };
  }
}

function hairIcon(style: string): SVGSVGElement {
  const { back, front } = hairParts(style);
  return svg(...back, circle(24, 29, 13, SKIN, true), ...front);
}

// ---- face ---------------------------------------------------------------------------------------

function faceIcon(eyes: string, withGlasses: boolean): SVGSVGElement {
  const smile = stroke('M17 32 Q24 38 31 32', 2.4);
  const round = (x: number): SVGElement => ellipse(x, 22, 3, 4.5, INK);
  const arc = (x: number): SVGElement => stroke(`M${x - 4.5} 25 Q${x} 17 ${x + 4.5} 25`);
  let pair: SVGElement[];
  switch (eyes) {
    case 'happy':
      pair = [arc(17), arc(31)];
      break;
    case 'wink':
      pair = [round(17), arc(31)];
      break;
    case 'star':
      pair = [star(17, 22, 6, 2.6), star(31, 22, 6, 2.6)];
      break;
    default:
      pair = [round(17), round(31)];
  }
  const rings = withGlasses
    ? [
        node('circle', { cx: 17, cy: 22, r: 7, fill: 'none', stroke: INK, 'stroke-width': 2 }),
        node('circle', { cx: 31, cy: 22, r: 7, fill: 'none', stroke: INK, 'stroke-width': 2 }),
        rect(23, 21, 2, 2, INK),
      ]
    : [];
  return svg(circle(24, 24, 18, SKIN, true), ...pair, ...rings, smile);
}

// ---- hat ----------------------------------------------------------------------------------------

function hatIcon(style: string): SVGSVGElement {
  const head = circle(24, 31, 13, SKIN, true);
  switch (style) {
    case 'cap':
      return svg(head, path('M11.5 29 A12.5 12.5 0 0 1 36.5 29 Z', HAT), path('M30 27 L45 30 Q45 33 36 32 L30 31 Z', HAT_DARK));
    case 'bucket':
      return svg(head, path('M14 29 L16 13 L32 13 L34 29 Z', HAT), ellipse(24, 29, 20, 4, HAT_DARK));
    case 'beanie':
      return svg(head, path('M12 29 Q12 11 24 11 Q36 11 36 29 Z', HAT), rect(11, 24, 26, 6, HAT_DARK, 2), circle(24, 9, 4, HAT_DARK));
    case 'scout':
      return svg(head, ellipse(24, 28, 21, 4.5, HAT_DARK), path('M15 28 L17 13 Q24 10 31 13 L33 28 Z', HAT), rect(15.5, 22, 17, 4, HAT_DARK));
    default:
      return svg(head);
  }
}

// ---- legs ---------------------------------------------------------------------------------------

function legsIcon(style: string): SVGSVGElement {
  const shoes = [rect(11, 39, 12, 5, SHOE, 2), rect(25, 39, 12, 5, SHOE, 2)];
  switch (style) {
    case 'pants':
      return svg(rect(13, 8, 22, 6, PANTS, 2), rect(13, 12, 10, 28, PANTS, 2), rect(25, 12, 10, 28, PANTS, 2), ...shoes);
    case 'skort':
      return svg(
        rect(15, 28, 7, 11, SKIN),
        rect(26, 28, 7, 11, SKIN),
        ...shoes,
        node('polygon', { points: '14,8 34,8 41,28 7,28', fill: PANTS }),
      );
    default:
      return svg(
        rect(15, 26, 7, 13, SKIN),
        rect(26, 26, 7, 13, SKIN),
        ...shoes,
        rect(13, 8, 22, 6, PANTS, 2),
        rect(13, 12, 10, 16, PANTS, 2),
        rect(25, 12, 10, 16, PANTS, 2),
      );
  }
}

// ---- build and backpack -------------------------------------------------------------------------

function personParts(): SVGElement[] {
  return [
    rect(18, 29, 5, 13, PANTS, 1),
    rect(25, 29, 5, 13, PANTS, 1),
    rect(16, 15, 16, 15, SHIRT, 3),
    rect(11, 16, 5, 12, SKIN, 2),
    rect(32, 16, 5, 12, SKIN, 2),
    circle(24, 9.5, 5.5, SKIN, true),
  ];
}

function buildIcon(build: string): SVGSVGElement {
  const scale = build === 'small' ? 0.66 : build === 'tall' ? 1 : 0.84;
  const group = node('g', { transform: `translate(24 44) scale(${scale}) translate(-24 -44)` }, ...personParts());
  return svg(group, rect(6, 44, 36, 2, INK, 1));
}

function backpackIcon(on: boolean): SVGSVGElement {
  const pack = on ? [rect(28, 14, 14, 18, PACK, 4), rect(30, 22, 10, 6, '#94704a', 2)] : [];
  return svg(...pack, ...personParts());
}

/** The picture for one option. `value` is the option's value (glasses and backpack use 'on' and 'off'). */
export function optionIcon(group: IconGroup, value: string): SVGSVGElement {
  switch (group) {
    case 'build':
      return buildIcon(value);
    case 'hairStyle':
      return hairIcon(value);
    case 'eyes':
      return faceIcon(value, false);
    case 'glasses':
      return faceIcon('round', value === 'on');
    case 'legs':
      return legsIcon(value);
    case 'hat':
      return hatIcon(value);
    case 'backpack':
      return backpackIcon(value === 'on');
    case 'hero':
      return heroIcon(value);
  }
}

// ---- hero ---------------------------------------------------------------------------------------

/**
 * A hero's head and shoulders in the hero's own colors (unlike the other pictures, which use stand-in
 * colors), so the three tiles look like the three heroes.
 */
function heroIcon(id: string): SVGSVGElement {
  const hero = findHero(id);
  if (!hero) return svg();
  const look = hero.look;
  const hairColor = (el: SVGElement): SVGElement => {
    if (el.getAttribute('fill') === HAIR) el.setAttribute('fill', look.hairColor);
    return el;
  };
  const hair = look.hairStyle === 'none' ? { back: [], front: [] } : hairParts(look.hairStyle);
  const eye = (x: number): SVGElement =>
    look.eyes === 'happy' || (look.eyes === 'wink' && x > 24)
      ? stroke(`M${x - 3} 31 Q${x} 26 ${x + 3} 31`, 2.2)
      : ellipse(x, 29.5, 1.8, 2.6, INK);
  const glasses = look.glasses
    ? [
        node('circle', { cx: 19, cy: 29.5, r: 4.4, fill: 'none', stroke: INK, 'stroke-width': 1.6 }),
        node('circle', { cx: 29, cy: 29.5, r: 4.4, fill: 'none', stroke: INK, 'stroke-width': 1.6 }),
      ]
    : [];
  const cap =
    look.hat === 'cap'
      ? [path('M11.5 26 A12.5 12.5 0 0 1 36.5 26 Z', look.hatColor), path('M30 24 L45 27 Q45 30 36 29 L30 28 Z', look.hatColor)]
      : [];
  return svg(
    ...hair.back.map(hairColor),
    path('M6 48 Q6 40 16 39 L32 39 Q42 40 42 48 Z', look.shirt),
    circle(24, 29, 13, look.skin, true),
    eye(19),
    eye(29),
    ...glasses,
    stroke('M20 35 Q24 38 28 35', 2),
    ...(look.hat === 'cap' ? [] : hair.front.map(hairColor)),
    ...cap,
  );
}
