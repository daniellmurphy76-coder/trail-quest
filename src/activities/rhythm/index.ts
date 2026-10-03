import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { cardHeader, emitComplete, emitTap, feedbackSlot } from '../shared';
import type { ActivityController, ActivityResult, RhythmParams } from '../types';
import {
  COUNT_IN_BEATS,
  beatPhase,
  bpmToIntervalMs,
  countInNumber,
  judgeTap,
  normalizeBpm,
  onBeatWindowMs,
  pulseScale,
  type TapJudgement,
} from './beat';
import { createTicker } from './ticker';
import './rhythm.css';

/** The tap pad is never shorter than this, so it stays easy to hit with a thumb. */
const PAD_MIN_HEIGHT_PX = 120;

type Phase = 'ready' | 'countin' | 'playing' | 'done';

const PAD_LABEL: Record<Exclude<Phase, 'done'>, string> = {
  ready: 'Ready? Tap to start',
  countin: 'Get ready...',
  playing: 'Tap!',
};

/**
 * A practice tool that mirrors an exercise; it never replaces doing the real thing.
 *
 * "Ready? Tap to start" waits for the first tap, then counts in 3, 2, 1 on the beat. After that
 * every tap on the big pad is one rep. A tap within the on-beat window says "On beat!"; any other
 * tap says "Close!" and still counts, so the kid always finishes. No fail, no timer that ends it.
 * Completes after `reps` taps with score = on-beat taps / reps.
 *
 * Timing reads `performance.now()` at the moment of the tap. The pulse is only drawing: it runs
 * on requestAnimationFrame (or setInterval when that is missing) and stops when the activity ends.
 */
function runRhythm(host: HTMLElement, params: RhythmParams): Promise<ActivityResult> {
  const reps = Math.floor(params.reps);
  if (!(reps >= 1)) return Promise.resolve({ completed: false, attempts: 0 });
  const bpm = normalizeBpm(params.bpm);
  const interval = bpmToIntervalMs(bpm);

  return new Promise<ActivityResult>((resolve) => {
    let phase: Phase = 'ready';
    let startTime = 0; // when beat 0 lands, after the count-in
    let taps = 0;
    let onBeatTaps = 0;
    let finished = false;

    const motion =
      typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = (): boolean => motion?.matches === true;

    const overlay = mountOverlay(host, { label: 'Rhythm practice', cardClass: 'tq-rhythm' });
    const card = overlay.card;
    card.dataset.phase = phase;

    const countText = (): string => `${taps} of ${reps}`;
    const center = h('span', { class: 'tq-rhythm__center' }, '♪');
    const ring = h('div', { class: 'tq-rhythm__ring', attrs: { 'aria-hidden': 'true' } }, center);
    const countNum = h('span', { class: 'tq-rhythm__count-num' }, countText());
    const counter = h(
      'p',
      { class: 'tq-rhythm__count' },
      countNum,
      ' ',
      h('span', { class: 'tq-rhythm__count-unit' }, 'taps'),
    );
    const live = h('p', { class: 'tq-sr', attrs: { 'aria-live': 'polite' } });
    const slot = feedbackSlot();
    slot.classList.add('tq-rhythm__feedback');

    const padLabel = h('span', { class: 'tq-rhythm__pad-label' }, PAD_LABEL.ready);
    const pad = button(
      h(
        'span',
        { class: 'tq-rhythm__pad-text' },
        padLabel,
        h('span', { class: 'tq-rhythm__pad-hint' }, 'Space or Enter works too'),
      ),
      {
        variant: 'primary',
        class: 'tq-rhythm__pad',
        // A real pointer tap is counted on pointerdown (press time is the beat time). Its follow-up
        // click carries detail > 0 and is ignored. Keyboard and assistive clicks have detail 0.
        onClick: (event) => {
          if (event.detail === 0) tap();
        },
      },
    );
    pad.style.minHeight = `${PAD_MIN_HEIGHT_PX}px`;
    pad.addEventListener('pointerdown', (event) => {
      if (event.button === 0) tap();
    });

    let header = cardHeader('Rhythm', () => finish(false));
    const top = h(
      'div',
      { class: 'tq-rhythm__top' },
      header,
      h('div', { class: 'tq-prompt' }, h('h2', null, params.prompt)),
      h('p', { class: 'tq-rhythm__exercise' }, 'Move: ', h('strong', null, params.exercise)),
      h('div', { class: 'tq-rhythm__stage' }, ring),
      counter,
      slot,
      live,
    );

    function finish(completed: boolean): void {
      if (finished) return;
      finished = true;
      ticker.stop();
      overlay.close();
      if (completed) emitComplete('rhythm');
      resolve(
        completed ? { completed: true, attempts: taps, score: onBeatTaps / reps } : { completed: false, attempts: taps },
      );
    }

    function setPhase(next: Phase): void {
      phase = next;
      card.dataset.phase = next;
      if (next !== 'done') padLabel.textContent = PAD_LABEL[next];
    }

    /** Moves from count-in to playing once beat 0 has landed. */
    function sync(now: number): void {
      if (phase === 'countin' && now >= startTime) {
        setPhase('playing');
        live.textContent = 'Go! Tap on each beat.';
      }
    }

    /** Draws the pulse (or the text beat indicator under reduced motion) and the count-in number. */
    function render(now: number): void {
      if (phase !== 'countin' && phase !== 'playing') return;
      const phaseInBeat = beatPhase(now, startTime, bpm);
      const still = reduced();
      if (still) {
        ring.style.transform = '';
        ring.classList.remove('is-beat');
      } else {
        ring.style.transform = `scale(${pulseScale(phaseInBeat).toFixed(3)})`;
        ring.classList.toggle('is-beat', phaseInBeat < 0.2);
      }
      if (phase === 'countin') {
        center.textContent = String(countInNumber(now, startTime, bpm));
      } else {
        // Reduced motion: "tap... tap..." stands in for the pulse and still updates every beat.
        center.textContent = still ? (phaseInBeat < 0.4 ? 'tap' : '...') : '♪';
      }
    }

    function frame(): void {
      if (finished) return;
      if (!overlay.root.isConnected) {
        // Someone cleared the host without calling close(): do not leave a frame loop behind.
        finish(false);
        return;
      }
      const now = performance.now();
      sync(now);
      render(now);
    }

    const ticker = createTicker(frame);

    function showResult(verdict: TapJudgement): void {
      const on = verdict.onBeat;
      const note = on ? '' : verdict.timing === 'early' ? 'A little early.' : 'A little late.';
      slot.replaceChildren(
        h(
          'div',
          { class: `tq-banner tq-rhythm__result ${on ? 'tq-banner--yes' : 'tq-rhythm__result--close'}`, role: 'status' },
          h('span', { class: 'tq-banner__icon', attrs: { 'aria-hidden': 'true' } }, on ? '✔' : '≈'),
          h(
            'div',
            { class: 'tq-banner__body' },
            h('p', { class: 'tq-banner__word' }, on ? 'On beat!' : 'Close!'),
            note ? h('p', { class: 'tq-banner__text' }, note) : null,
          ),
        ),
      );
    }

    function showDone(): void {
      ticker.stop();
      setPhase('done');
      ring.style.transform = '';
      ring.classList.remove('is-beat');
      center.textContent = '★';
      live.textContent = 'All done!';

      const detail =
        onBeatTaps > 0 ? `${onBeatTaps} of ${reps} taps were on the beat.` : 'You kept going to the very end!';
      const finishBtn = button('Finish', { variant: 'primary', icon: '✔', onClick: () => finish(true) });
      pad.replaceWith(
        h(
          'div',
          { class: 'tq-rhythm__done' },
          h(
            'div',
            { class: 'tq-banner tq-banner--yes', role: 'status' },
            h('span', { class: 'tq-banner__icon', attrs: { 'aria-hidden': 'true' } }, '★'),
            h(
              'div',
              { class: 'tq-banner__body' },
              h('p', { class: 'tq-banner__word' }, 'Great job!'),
              h('p', { class: 'tq-banner__text' }, detail),
            ),
          ),
          h('p', { class: 'tq-note' }, 'This is just practice. Do the real thing too!'),
          h('div', { class: 'tq-actions' }, finishBtn),
        ),
      );
      // Finishing is the way out now, so the Back button (which would drop the result) goes away.
      const plain = cardHeader('Rhythm');
      header.replaceWith(plain);
      header = plain;
      overlay.setDefault(finishBtn);
      overlay.focus(finishBtn);
    }

    function record(now: number): void {
      emitTap(); // a rep: a tap that is only waiting out the count-in makes no sound
      const verdict = judgeTap(now, startTime, bpm);
      taps += 1;
      if (verdict.onBeat) onBeatTaps += 1;
      countNum.textContent = countText();
      showResult(verdict);
      pad.classList.remove('is-hit');
      void pad.offsetWidth; // restart the little press animation
      pad.classList.add('is-hit');
      if (taps >= reps) showDone();
    }

    function begin(now: number): void {
      emitTap();
      startTime = now + COUNT_IN_BEATS * interval;
      setPhase('countin');
      live.textContent = 'Get ready.';
      ticker.start();
      render(now);
    }

    function tap(): void {
      if (finished || phase === 'done') return;
      const now = performance.now();
      if (phase === 'ready') {
        begin(now);
        return;
      }
      sync(now);
      // During the count-in, wait for "Go". A tap just before beat 0 counts as an early first tap.
      if (phase === 'countin' && now < startTime - onBeatWindowMs(bpm)) return;
      record(now);
    }

    overlay.card.append(top, pad);
    overlay.setDefault(pad);
    overlay.focus(pad);
  });
}

export const rhythmActivity: ActivityController<'rhythm'> = {
  type: 'rhythm',
  run: runRhythm,
};
