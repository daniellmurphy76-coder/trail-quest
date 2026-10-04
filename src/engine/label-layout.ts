/**
 * Where the floating labels go on screen. Pure math, no DOM and no Three.js, so it is easy to test:
 * `WorldLabels` projects every label, measures it, and asks `layoutLabels` where each one lands.
 *
 * The rules, in the order they apply:
 * - A label never shrinks with distance, and is never left half see-through (hard to read). It is
 *   either fully shown or hidden: it comes into view within SHOW_RANGE world units of the camera and
 *   goes past HIDE_RANGE; the label CSS fades it in and out. Priority labels (the interact prompt,
 *   the objective arrow, pickups and markers) have no range.
 * - A label hides when its anchor is behind the camera or off the screen. Otherwise it is pushed
 *   inside the screen, EDGE_MARGIN pixels from every edge.
 * - HUD cards, the dock and the touch controls are obstacles: the label slides to the nearest clear
 *   spot, or hides when none is close by.
 * - Labels are placed priority first, then nearest first. One that lands on a label already placed
 *   moves up by its own height plus NUDGE_GAP, up to MAX_NUDGES times, then hides. A priority label
 *   is never hidden for being crowded: it keeps its spot (and may overlap).
 * - Hysteresis: a label that was hidden, or sat higher up last frame, needs HYSTERESIS pixels of
 *   spare room before it comes back, so a label on the border does not flicker.
 */

/** A box on screen, in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Type size floor: a laptop gets 20px, a touch screen (iPad) 22px. */
export const MIN_FONT_PX = 20;
export const COARSE_FONT_PX = 22;
/** A hidden label comes into view within this many world units of the camera (the fog starts at 26). */
export const SHOW_RANGE = 30;
/** A shown label stays until it is farther than this. The gap keeps a label on the border from flickering. */
export const HIDE_RANGE = 32;
/** Gap kept between a label and every screen edge. */
export const EDGE_MARGIN = 12;
/** Two labels, or a label and a HUD card, closer than this count as overlapping. */
export const OVERLAP_GAP = 4;
/** Space left between a label and the one it was moved up from. */
export const NUDGE_GAP = 6;
/** How many times a crowded label tries a higher spot before it hides. */
export const MAX_NUDGES = 2;
/** Spare room (pixels) a hidden or moved label needs before it returns to a spot. */
export const HYSTERESIS = 8;
/** The farthest a label slides to clear a HUD card. Past this it hides: the spot would be misleading. */
export const HUD_NUDGE_MAX = 72;

/** One label to place. */
export interface LabelInput {
  /** Where the world anchor lands on screen. The label's bottom centre hangs here. */
  x: number;
  y: number;
  /** Shift on screen after projecting (negative is up). Stacks a prompt over a name tag. */
  shiftY?: number;
  /** The measured size of the label box. */
  width: number;
  height: number;
  /** How far the anchor is from the camera along its view direction. Zero or less is behind it. */
  distance: number;
  /** Never hidden for being crowded and never faded by distance. */
  priority?: boolean;
  /** Skip this label: it is switched off or past its own range. */
  hidden?: boolean;
  /** What this label got last frame, for hysteresis. Leave it out for a label with no history. */
  previous?: Pick<LabelPlacement, 'visible' | 'nudge'> | null;
}

export interface LabelPlacement {
  visible: boolean;
  /** Top left of the label box. */
  left: number;
  top: number;
  /** 1 is fully shown, 0 is gone. */
  opacity: number;
  /** How many steps up the label was moved to clear another (0 to MAX_NUDGES). */
  nudge: number;
}

/** The type size for a label on this kind of screen. */
export function labelFontSize(coarsePointer: boolean): number {
  return coarsePointer ? COARSE_FONT_PX : MIN_FONT_PX;
}

/**
 * A guess at a label's box from its text, for when the page cannot measure it (a test, or a label
 * that is not on screen yet). Matches the label CSS: 4px by 12px padding, line height 1.3.
 */
export function estimateLabelSize(text: string, fontPx: number): { width: number; height: number } {
  return { width: Math.ceil(text.length * fontPx * 0.6) + 24, height: Math.ceil(fontPx * 1.3) + 8 };
}

/** Is a label this far away in range? One that was shown last frame keeps going out to HIDE_RANGE. */
export function inRange(distance: number, wasVisible: boolean): boolean {
  return distance <= (wasVisible ? HIDE_RANGE : SHOW_RANGE);
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}

function insideScreen(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.left >= EDGE_MARGIN &&
    rect.top >= EDGE_MARGIN &&
    rect.right <= viewport.width - EDGE_MARGIN &&
    rect.bottom <= viewport.height - EDGE_MARGIN
  );
}

function shifted(rect: Rect, dx: number, dy: number): Rect {
  return { left: rect.left + dx, top: rect.top + dy, right: rect.right + dx, bottom: rect.bottom + dy };
}

/** The label box hung from its anchor, moved up `level` steps, then pushed inside the screen. */
function anchoredRect(input: LabelInput, viewport: Viewport, level: number): Rect {
  const { width, height } = input;
  const left = input.x - width / 2;
  const top = input.y + (input.shiftY ?? 0) - height - level * (height + NUDGE_GAP);
  const clampedLeft = Math.max(EDGE_MARGIN, Math.min(left, viewport.width - EDGE_MARGIN - width));
  const clampedTop = Math.max(EDGE_MARGIN, Math.min(top, viewport.height - EDGE_MARGIN - height));
  return { left: clampedLeft, top: clampedTop, right: clampedLeft + width, bottom: clampedTop + height };
}

/**
 * Slide a label off every obstacle it touches. Each pass takes the shortest of four moves (below,
 * above, right or left of the obstacle) that stays on screen and within `maxShift` pixels. Returns
 * null when there is no way out.
 */
function clearOfObstacles(
  rect: Rect,
  obstacles: readonly Rect[],
  viewport: Viewport,
  gap: number,
  maxShift: number,
): Rect | null {
  let current = rect;
  for (let pass = 0; pass < 4; pass++) {
    const hit = obstacles.find((o) => overlaps(current, o, gap));
    if (!hit) return current;
    const moves: Array<[number, number]> = [
      [0, hit.bottom + gap - current.top],
      [0, hit.top - gap - current.bottom],
      [hit.right + gap - current.left, 0],
      [hit.left - gap - current.right, 0],
    ];
    let best: Rect | null = null;
    let bestShift = maxShift;
    for (const [dx, dy] of moves) {
      const shift = Math.abs(dx) + Math.abs(dy);
      if (shift > bestShift) continue;
      const option = shifted(current, dx, dy);
      if (!insideScreen(option, viewport)) continue;
      best = option;
      bestShift = shift;
    }
    if (!best) return null;
    current = best;
  }
  return obstacles.some((o) => overlaps(current, o, gap)) ? null : current;
}

function place(
  input: LabelInput,
  viewport: Viewport,
  obstacles: readonly Rect[],
  placed: readonly Rect[],
): { rect: Rect; nudge: number } | null {
  const was = input.previous ?? null;
  // A label that was hidden needs a little room inside the screen edge to come back.
  const edge = was && !was.visible ? HYSTERESIS : 0;
  if (input.x < edge || input.x > viewport.width - edge || input.y < edge || input.y > viewport.height - edge) return null;

  const maxShift = input.priority ? Infinity : HUD_NUDGE_MAX;
  for (let level = 0; level <= MAX_NUDGES; level++) {
    // Coming back from hidden, or down from a higher step, needs spare room so it does not flip.
    const spare = was && (!was.visible || level < was.nudge) ? HYSTERESIS : 0;
    const rect = clearOfObstacles(anchoredRect(input, viewport, level), obstacles, viewport, OVERLAP_GAP + spare, maxShift);
    if (rect && !placed.some((p) => overlaps(rect, p, OVERLAP_GAP + spare))) return { rect, nudge: level };
  }
  if (!input.priority) return null;
  // Never drop a priority label: keep its own spot, clear of the HUD when it can be.
  const base = anchoredRect(input, viewport, 0);
  return { rect: clearOfObstacles(base, obstacles, viewport, OVERLAP_GAP, Infinity) ?? base, nudge: 0 };
}

/**
 * Place every label. Returns one placement per input, in the same order. A placement with
 * `visible: false` means the label should be hidden (its other fields are then meaningless).
 */
export function layoutLabels(
  inputs: readonly LabelInput[],
  viewport: Viewport,
  obstacles: readonly Rect[] = [],
): LabelPlacement[] {
  const out: LabelPlacement[] = inputs.map(() => ({ visible: false, left: 0, top: 0, opacity: 0, nudge: 0 }));

  // Priority first, then nearest first; a tie keeps the input order.
  const order: number[] = [];
  inputs.forEach((input, i) => {
    if (!input.hidden && input.distance > 0) order.push(i);
  });
  order.sort((a, b) => {
    const pa = inputs[a]!.priority ? 0 : 1;
    const pb = inputs[b]!.priority ? 0 : 1;
    return pa - pb || inputs[a]!.distance - inputs[b]!.distance || a - b;
  });

  const placed: Rect[] = [];
  for (const i of order) {
    const input = inputs[i]!;
    if (!input.priority && !inRange(input.distance, input.previous?.visible ?? false)) continue;
    const spot = place(input, viewport, obstacles, placed);
    if (!spot) continue;
    placed.push(spot.rect);
    const result = out[i]!;
    result.visible = true;
    result.left = spot.rect.left;
    result.top = spot.rect.top;
    result.opacity = 1;
    result.nudge = spot.nudge;
  }
  return out;
}
