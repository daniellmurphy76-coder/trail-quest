import { events } from '../game/events';
import { append, clear, h } from '../ui/dom';
import { mountOverlay } from '../ui/overlay';
import { posterLines, posterOverlay, type PosterText } from '../ui/poster';
import { button } from '../ui/widgets';
import type { ActivityContext } from './types';

// ---- sound and celebration events: activities only say what happened; they never play anything ----

/** A tap on a choice, tile, chip, bin or pad. */
export function emitTap(): void {
  events.emit({ type: 'ui-tap' });
}

/** The answer just tapped was right or wrong ("Not yet"). Sent after `ui-tap`. */
export function emitAnswer(right: boolean): void {
  events.emit({ type: right ? 'answer-right' : 'answer-wrong' });
}

/** The activity ended with `completed: true`. Never sent for a Back out. */
export function emitComplete(activityType: string): void {
  events.emit({ type: 'activity-complete', activityType });
}

/** Eyebrow line plus a "Back" button, the top row of an activity card. */
export function cardHeader(eyebrow: string, onBack?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'tq-header' },
    h('p', { class: 'tq-eyebrow' }, eyebrow),
    onBack ? button('Back', { icon: '←', onClick: onBack }) : null,
  );
}

/** The live region banners are shown in. Empty slots are hidden by CSS. */
export function feedbackSlot(): HTMLDivElement {
  return h('div', { class: 'tq-feedback', attrs: { 'aria-live': 'polite' } });
}

/** The words on the peek button. */
export const PEEK_LABEL = 'Show me';

/** What `peekButton` accepts: the context's `posters`, a single legacy `poster`, or nothing. */
export type PeekSource = readonly PosterText[] | PosterText | null | undefined;

/**
 * The posters a context carries, in order: `ctx.posters` when set, else the single `ctx.poster`.
 * Posters with no lines are left out. Empty when the stop has nothing to peek at.
 */
export function postersOf(ctx: Pick<ActivityContext, 'poster' | 'posters'>): PosterText[] {
  return normalizePosters(ctx.posters && ctx.posters.length > 0 ? ctx.posters : ctx.poster);
}

function normalizePosters(source: PeekSource): PosterText[] {
  if (source === null || source === undefined) return [];
  const list: readonly PosterText[] = 'lines' in source ? [source] : source;
  return list.filter((poster) => poster.lines.length > 0);
}

/** "Next: The Scout Law", or just "Next" when the poster has no title. */
function nextLabel(poster: PosterText): string {
  const title = poster.title.trim();
  return title === '' ? 'Next' : `Next: ${title}`;
}

/**
 * The peek for more than one poster (the Scout Oath, then the Scout Law): one card with the whole
 * text of one poster, a big "Next: {title of the next one}" button that moves on (and wraps around
 * to the first), and Back, which closes the peek. Escape closes it too. Everything underneath is
 * exactly as it was.
 */
function pagedPosterOverlay(host: HTMLElement, posters: readonly PosterText[]): Promise<void> {
  return new Promise<void>((resolve) => {
    let index = 0;
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve();
    };
    const overlay = mountOverlay(host, { label: 'Poster', cardClass: 'tq-poster', onEscape: done });

    function paint(): void {
      const poster = posters[index]!;
      overlay.root.setAttribute('aria-label', poster.title.trim() === '' ? 'Poster' : poster.title);
      const following = posters[(index + 1) % posters.length]!;
      const next = button(nextLabel(following), {
        variant: 'primary',
        icon: '→',
        onClick: () => {
          index = (index + 1) % posters.length;
          paint();
        },
      });
      const back = button('Back', { variant: 'secondary', icon: '←', onClick: done });
      clear(overlay.card);
      append(overlay.card, [
        poster.title.trim() === '' ? null : h('h2', { class: 'tq-poster__title' }, poster.title),
        h('p', { class: 'tq-poster__hint', attrs: { 'aria-live': 'polite' } }, `${index + 1} of ${posters.length}`),
        posterLines(poster.lines),
        h('div', { class: 'tq-actions tq-poster__actions' }, back, next),
      ]);
      overlay.setDefault(next);
      overlay.focus(next);
    }

    paint();
  });
}

/**
 * The "Show me" button: opens the poster (the whole Scout Oath, say) over the activity and goes back
 * to it, exactly as it was, when the Scout taps Back. With more than one poster (the Oath and the
 * Law) the peek is a pager: a "Next: {title}" button moves between them. Peeking is never penalized:
 * it touches no score and no count. Returns null when there is nothing to show, so an activity can
 * drop the result straight into its prompt row:
 * `h('div', { class: 'tq-prompt' }, h('h2', null, prompt), peekButton(host, postersOf(ctx)))`.
 * A single poster (the legacy `ctx.poster`) is accepted too.
 */
export function peekButton(host: HTMLElement, source: PeekSource): HTMLButtonElement | null {
  const posters = normalizePosters(source);
  if (posters.length === 0) return null;
  let open = false;
  const btn = button(PEEK_LABEL, {
    icon: '\u{1F440}',
    class: 'tq-peek',
    onClick: () => {
      if (open) return;
      open = true;
      const shown = posters.length > 1 ? pagedPosterOverlay(host, posters) : posterOverlay(host, posters[0]!);
      void shown.finally(() => {
        open = false;
      });
    },
  });
  btn.setAttribute('aria-haspopup', 'dialog');
  return btn;
}
