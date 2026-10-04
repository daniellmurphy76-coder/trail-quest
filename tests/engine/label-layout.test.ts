import { describe, expect, it } from 'vitest';
import {
  COARSE_FONT_PX,
  EDGE_MARGIN,
  estimateLabelSize,
  HIDE_RANGE,
  HYSTERESIS,
  inRange,
  labelFontSize,
  layoutLabels,
  MAX_NUDGES,
  MIN_FONT_PX,
  NUDGE_GAP,
  OVERLAP_GAP,
  SHOW_RANGE,
  type LabelInput,
  type LabelPlacement,
  type Rect,
} from '../../src/engine/label-layout';

const VIEW = { width: 1280, height: 720 };
const H = 34; // a 20px label: line height 26 plus 4px padding top and bottom

/** A label hung from the middle of the screen. `y` is where its bottom edge hangs. */
function label(over: Partial<LabelInput> = {}): LabelInput {
  return { x: 640, y: 400, width: 120, height: H, distance: 10, ...over };
}

function one(input: LabelInput, obstacles: Rect[] = []): LabelPlacement {
  return layoutLabels([input], VIEW, obstacles)[0]!;
}

const box = (p: LabelPlacement, input: LabelInput): Rect => ({
  left: p.left,
  top: p.top,
  right: p.left + input.width,
  bottom: p.top + input.height,
});

describe('type size', () => {
  it('is 20px on a laptop and 22px on a touch screen, never below 20', () => {
    expect(MIN_FONT_PX).toBe(20);
    expect(labelFontSize(false)).toBe(20);
    expect(labelFontSize(true)).toBe(22);
    expect(COARSE_FONT_PX).toBeGreaterThanOrEqual(MIN_FONT_PX);
  });

  it('guesses a box from the text that grows with the type size', () => {
    const small = estimateLabelSize('Footbridge', 20);
    const big = estimateLabelSize('Footbridge', 22);
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
    expect(estimateLabelSize('Safe meeting spot', 20).width).toBeGreaterThan(small.width);
  });

  it('never shrinks a label with distance: the box lands the same near and far', () => {
    const near = one(label({ distance: 3 }));
    const far = one(label({ distance: 25 }));
    expect(far.left).toBe(near.left);
    expect(far.top).toBe(near.top);
    expect(far.opacity).toBe(1);
  });
});

describe('distance range', () => {
  it('comes into view within SHOW_RANGE, and once shown stays out to HIDE_RANGE', () => {
    expect(SHOW_RANGE).toBe(30);
    expect(HIDE_RANGE).toBe(32);
    expect(inRange(1, false)).toBe(true);
    expect(inRange(30, false)).toBe(true);
    expect(inRange(31, false)).toBe(false);
    expect(inRange(31, true)).toBe(true);
    expect(inRange(32, true)).toBe(true);
    expect(inRange(32.5, true)).toBe(false);
  });

  it('is fully shown or hidden, never left half see-through (hard to read)', () => {
    for (const distance of [1, 10, 26, 29, 30]) expect(one(label({ distance })), String(distance)).toMatchObject({ visible: true, opacity: 1 });
    expect(one(label({ distance: 31 })).visible).toBe(false);
    expect(one(label({ distance: 31, previous: { visible: true, nudge: 0 } }))).toMatchObject({ visible: true, opacity: 1 });
    expect(one(label({ distance: 33, previous: { visible: true, nudge: 0 } })).visible).toBe(false);
    expect(one(label({ distance: 60 })).visible).toBe(false);
  });

  it('leaves priority labels at full strength at any distance', () => {
    expect(one(label({ distance: 200, priority: true }))).toMatchObject({ visible: true, opacity: 1 });
  });
});

describe('hiding', () => {
  it('hides a label whose anchor is behind the camera', () => {
    for (const distance of [-4, 0, Number.NaN]) expect(one(label({ distance })).visible, String(distance)).toBe(false);
    expect(one(label({ distance: -4, priority: true })).visible).toBe(false);
  });

  it('hides a label that is switched off, and gives one placement per input in order', () => {
    const out = layoutLabels([label({ hidden: true }), label({ x: 300 }), label({ distance: -1 })], VIEW);
    expect(out.map((p) => p.visible)).toEqual([false, true, false]);
  });

  it('hides a label whose anchor is off the screen', () => {
    expect(one(label({ x: -5 })).visible).toBe(false);
    expect(one(label({ x: VIEW.width + 5 })).visible).toBe(false);
    expect(one(label({ y: -1 })).visible).toBe(false);
    expect(one(label({ y: VIEW.height + 1 })).visible).toBe(false);
  });
});

describe('screen edges', () => {
  it('keeps the whole box inside the screen with the margin, on every side', () => {
    expect(EDGE_MARGIN).toBe(12);
    const wide = { width: 220 };
    const right = one(label({ ...wide, x: VIEW.width - 4 }));
    expect(right.left + 220).toBe(VIEW.width - EDGE_MARGIN);
    const left = one(label({ ...wide, x: 4 }));
    expect(left.left).toBe(EDGE_MARGIN);
    const top = one(label({ y: 15 }));
    expect(top.top).toBe(EDGE_MARGIN);
    const bottom = one(label({ y: VIEW.height - 2 }));
    expect(bottom.top + H).toBe(VIEW.height - EDGE_MARGIN);
  });

  it('centres the box on its anchor when there is room', () => {
    const p = one(label({ x: 500, y: 300, width: 100 }));
    expect(p.left).toBe(450);
    expect(p.top).toBe(300 - H);
  });

  it('applies the screen shift after projecting (a prompt stacked over a name tag)', () => {
    const p = one(label({ y: 400, shiftY: -52 }));
    expect(p.top).toBe(400 - 52 - H);
  });
});

describe('HUD obstacles', () => {
  const hud: Rect = { left: 0, top: 0, right: 340, bottom: 160 };

  it('slides a label that touches a HUD card to just clear of it', () => {
    const input = label({ x: 100, y: 170 }); // box 136 to 170 tall: its top edge is under the card
    const p = one(input, [hud]);
    expect(p.visible).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(hud.bottom + OVERLAP_GAP);
    expect(p.top - hud.bottom).toBeLessThan(40); // a short slide, not a jump
  });

  it('hides a label that is deep under the card, where no short slide clears it', () => {
    expect(one(label({ x: 100, y: 100 }), [hud]).visible).toBe(false);
  });

  it('leaves a label that is clear of the card alone', () => {
    const input = label({ x: 700, y: 300 });
    const p = one(input, [hud]);
    expect(p.top).toBe(300 - H);
  });

  it('slides a priority label clear however far it takes, and never hides it', () => {
    const input = label({ x: 100, y: 100, priority: true });
    const p = one(input, [hud]);
    expect(p.visible).toBe(true);
    const b = box(p, input);
    expect(b.top >= hud.bottom || b.left >= hud.right).toBe(true);
    // Covered everywhere: it stays, rather than vanishing.
    const everything: Rect = { left: 0, top: 0, right: VIEW.width, bottom: VIEW.height };
    expect(one(label({ priority: true }), [everything]).visible).toBe(true);
    expect(one(label(), [everything]).visible).toBe(false);
  });

  it('avoids more than one obstacle', () => {
    const second: Rect = { left: 0, top: 166, right: 340, bottom: 230 };
    const input = label({ x: 100, y: 170 });
    const p = one(input, [hud, second]);
    if (p.visible) {
      const b = box(p, input);
      for (const o of [hud, second]) expect(b.bottom <= o.top || b.top >= o.bottom || b.left >= o.right || b.right <= o.left).toBe(true);
    }
  });
});

describe('crowded labels', () => {
  it('lets the nearer label keep its spot and moves the farther one up, whatever the input order', () => {
    const near = label({ distance: 5 });
    const far = label({ distance: 15 });
    const [farP, nearP] = layoutLabels([far, near], VIEW) as [LabelPlacement, LabelPlacement];
    expect(nearP).toMatchObject({ visible: true, nudge: 0, top: 400 - H });
    expect(farP).toMatchObject({ visible: true, nudge: 1 });
    expect(farP.top).toBe(400 - H - (H + NUDGE_GAP)); // up by its own height plus the gap
  });

  it('tries up to two higher spots, then hides', () => {
    expect(MAX_NUDGES).toBe(2);
    const stack = [5, 6, 7, 8].map((distance) => label({ distance }));
    const out = layoutLabels(stack, VIEW);
    expect(out.map((p) => p.visible)).toEqual([true, true, true, false]);
    expect(out.map((p) => p.nudge).slice(0, 3)).toEqual([0, 1, 2]);
    expect(out[2]!.top).toBe(400 - H - 2 * (H + NUDGE_GAP));
  });

  it('does not touch labels that do not overlap', () => {
    const out = layoutLabels([label({ x: 300 }), label({ x: 900 })], VIEW);
    expect(out.map((p) => p.nudge)).toEqual([0, 0]);
  });

  it('places a priority label first even when it is farther, and the others move around it', () => {
    const normal = label({ distance: 3 });
    const priority = label({ distance: 90, priority: true });
    const [normalP, priorityP] = layoutLabels([normal, priority], VIEW) as [LabelPlacement, LabelPlacement];
    expect(priorityP).toMatchObject({ visible: true, nudge: 0, opacity: 1, top: 400 - H });
    expect(normalP).toMatchObject({ visible: true, nudge: 1 });
  });

  it('never hides a priority label for being crowded', () => {
    const pile = Array.from({ length: 6 }, (_, i) => label({ distance: 5 + i, priority: true }));
    const out = layoutLabels(pile, VIEW);
    expect(out.every((p) => p.visible)).toBe(true);
    expect(out.slice(0, 3).map((p) => p.nudge)).toEqual([0, 1, 2]);
    // The pile past the third sits where the first one does, rather than disappearing.
    expect(out[5]!.top).toBe(out[0]!.top);
  });

  it('keeps a priority label from being pushed by normal ones, which hide first', () => {
    const wall = Array.from({ length: 4 }, (_, i) => label({ distance: 4 + i }));
    const out = layoutLabels([...wall, label({ distance: 2, priority: true })], VIEW);
    expect(out[4]).toMatchObject({ visible: true, nudge: 0 });
    expect(out.slice(0, 4).map((p) => p.visible)).toEqual([true, true, false, false]); // the two nearest take the steps up
  });
});

describe('hysteresis', () => {
  // A blocker sits just under the label: `gap` pixels between its box and the blocker's box.
  const blocker = (gap: number): LabelInput => label({ y: 400 + gap + H, distance: 2, priority: true });

  it('keeps a label that was nudged up where it is while the way back down is only just clear', () => {
    const arrangement = (previous: LabelInput['previous']): number => {
      const out = layoutLabels([label({ previous }), blocker(OVERLAP_GAP + 1)], VIEW);
      return out[0]!.nudge;
    };
    expect(arrangement(undefined)).toBe(0); // clear by 1px more than the gap
    expect(arrangement({ visible: true, nudge: 0 })).toBe(0);
    expect(arrangement({ visible: true, nudge: 1 })).toBe(1); // stays up: level 0 has no spare room
  });

  it('comes back down once there is the spare room', () => {
    const out = layoutLabels(
      [label({ previous: { visible: true, nudge: 1 } }), blocker(OVERLAP_GAP + HYSTERESIS + 1)],
      VIEW,
    );
    expect(out[0]!.nudge).toBe(0);
  });

  it('does not flip a label back and forth while it hovers at the border of another', () => {
    const run = (useHistory: boolean): number[] => {
      let previous: LabelInput['previous'] = null;
      const nudges: number[] = [];
      for (let frame = 0; frame < 20; frame++) {
        const gap = frame % 2 === 0 ? OVERLAP_GAP - 1 : OVERLAP_GAP + 2; // touching, then just clear
        const p: LabelPlacement = layoutLabels([label({ previous }), blocker(gap)], VIEW)[0]!;
        nudges.push(p.nudge);
        if (useHistory) previous = { visible: p.visible, nudge: p.nudge };
      }
      return nudges;
    };
    expect(new Set(run(false)).size).toBe(2); // without history it jumps every frame
    expect(new Set(run(true)).size).toBe(1); // with it, it settles
  });

  it('needs a little room inside the screen edge to come back from hidden', () => {
    const at = (x: number, previous: LabelInput['previous']): boolean => one(label({ x, previous })).visible;
    expect(at(5, undefined)).toBe(true);
    expect(at(5, { visible: true, nudge: 0 })).toBe(true);
    expect(at(5, { visible: false, nudge: 0 })).toBe(false);
    expect(at(HYSTERESIS + 1, { visible: false, nudge: 0 })).toBe(true);
  });
});
