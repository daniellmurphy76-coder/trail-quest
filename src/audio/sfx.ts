/**
 * Sound effects, all synthesized: soft sine and triangle notes with exponential envelopes and a
 * small low-pass, peaking around -12 dB. No square waves, no buzzers, no voice. Each effect is a
 * quiet no-op until the engine is unlocked by a gesture (or while muted), and a Web Audio error
 * never reaches the game.
 */
import type { AudioEngine, AudioGraph } from './engine';
import { SFX_PEAK, SILENCE, midiToHz, noiseBuffer, tone } from './synth';

export interface Sfx {
  /** Soft click, 30 ms. Rate-limited so rapid taps do not stack. */
  tap(): void;
  /** Two-note rising chime. */
  right(): void;
  /** One low soft boop. Never a buzzer. */
  wrong(): void;
  /** Tiny page tick for the next line of dialogue. */
  advance(): void;
  /** Three-note arpeggio when a stop is done. */
  stopComplete(): void;
  /** Short warm fanfare when the whole trail is done. */
  trailComplete(): void;
  /** Short warm fanfare for a new badge. */
  badge(): void;
  /** A few quick high notes for a new cosmetic or title. */
  unlock(): void;
  /** Pop for picking something up. */
  pickup(): void;
  /** Ding for reaching a waypoint. */
  waypoint(): void;
  /** Soft whoosh while walking to another zone. */
  travel(): void;
  /** Two warm notes when a parent approves a mission. */
  approved(): void;
}

export type SfxName = keyof Sfx;

export const SFX_NAMES: readonly SfxName[] = [
  'tap',
  'right',
  'wrong',
  'advance',
  'stopComplete',
  'trailComplete',
  'badge',
  'unlock',
  'pickup',
  'waypoint',
  'travel',
  'approved',
];

/** Fewest seconds between two taps (or two page ticks) on the audio clock. */
const MIN_GAP: Partial<Record<SfxName, number>> = { tap: 0.06, advance: 0.04 };

type Voice = (g: AudioGraph) => void;

function tap(g: AudioGraph): void {
  tone(g, { freq: 780, slideTo: 480, dur: 0.03, attack: 0.002, peak: SFX_PEAK * 0.7, lowpass: 2200 });
}

function right(g: AudioGraph): void {
  tone(g, { freq: midiToHz(79), dur: 0.32, bell: 0.3 });
  tone(g, { freq: midiToHz(84), at: 0.1, dur: 0.5, bell: 0.3 });
}

function wrong(g: AudioGraph): void {
  tone(g, { freq: 233, slideTo: 196, dur: 0.26, attack: 0.012, peak: SFX_PEAK * 0.9, lowpass: 700 });
}

function advance(g: AudioGraph): void {
  tone(g, { freq: 1500, slideTo: 1100, dur: 0.02, attack: 0.001, peak: SFX_PEAK * 0.4, lowpass: 3500, type: 'triangle' });
}

function stopComplete(g: AudioGraph): void {
  tone(g, { freq: midiToHz(72), dur: 0.28, bell: 0.25 });
  tone(g, { freq: midiToHz(76), at: 0.09, dur: 0.28, bell: 0.25 });
  tone(g, { freq: midiToHz(79), at: 0.18, dur: 0.55, bell: 0.25 });
}

function trailComplete(g: AudioGraph): void {
  const notes: [number, number, number][] = [
    [67, 0, 0.3],
    [72, 0.1, 0.3],
    [76, 0.2, 0.3],
    [79, 0.3, 0.35],
    [84, 0.42, 0.95],
  ];
  for (const [midi, at, dur] of notes) tone(g, { freq: midiToHz(midi), at, dur, type: 'triangle', bell: 0.35, lowpass: 2600 });
}

function badge(g: AudioGraph): void {
  const notes: [number, number, number][] = [
    [72, 0, 0.16],
    [72, 0.13, 0.16],
    [79, 0.26, 0.2],
    [84, 0.4, 0.95],
  ];
  for (const [midi, at, dur] of notes) tone(g, { freq: midiToHz(midi), at, dur, type: 'triangle', bell: 0.35, lowpass: 2600 });
  tone(g, { freq: midiToHz(88), at: 0.46, dur: 0.6, peak: SFX_PEAK * 0.35, lowpass: 5000 });
}

function unlock(g: AudioGraph): void {
  [93, 96, 100, 105].forEach((midi, i) => {
    tone(g, { freq: midiToHz(midi), at: i * 0.055, dur: 0.16, peak: SFX_PEAK * 0.45, lowpass: 6000 });
  });
}

function pickup(g: AudioGraph): void {
  tone(g, { freq: 330, slideTo: 760, dur: 0.09, attack: 0.004, lowpass: 2500 });
}

function waypoint(g: AudioGraph): void {
  tone(g, { freq: midiToHz(83), dur: 0.7, attack: 0.005, peak: SFX_PEAK * 0.8, bell: 0.35 });
}

/** Soft whoosh: noise through a band-pass that sweeps up and back down. */
function travel(g: AudioGraph): void {
  const { ctx, master } = g;
  const t0 = ctx.currentTime + 0.005;
  const dur = 0.9;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.setValueAtTime(0.9, t0);
  band.frequency.setValueAtTime(260, t0);
  band.frequency.exponentialRampToValueAtTime(1300, t0 + dur * 0.45);
  band.frequency.exponentialRampToValueAtTime(420, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(SILENCE, t0);
  env.gain.exponentialRampToValueAtTime(SFX_PEAK * 1.2, t0 + 0.35);
  env.gain.exponentialRampToValueAtTime(SILENCE, t0 + dur);
  src.connect(band);
  band.connect(env);
  env.connect(master);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
  src.onended = () => {
    src.disconnect();
    band.disconnect();
    env.disconnect();
  };
}

function approved(g: AudioGraph): void {
  tone(g, { freq: midiToHz(72), dur: 0.5, type: 'triangle', bell: 0.2, lowpass: 1800 });
  tone(g, { freq: midiToHz(79), at: 0.16, dur: 0.75, type: 'triangle', bell: 0.2, lowpass: 1800 });
}

const VOICES: Record<SfxName, Voice> = {
  tap,
  right,
  wrong,
  advance,
  stopComplete,
  trailComplete,
  badge,
  unlock,
  pickup,
  waypoint,
  travel,
  approved,
};

/** The effects, bound to an engine. Each call plays now, or does nothing if sound is not available. */
export function createSfx(engine: Pick<AudioEngine, 'graph'>): Sfx {
  const lastPlayed: Partial<Record<SfxName, number>> = {};
  let warned = false;

  function play(name: SfxName): void {
    const g = engine.graph();
    if (!g) return;
    const gap = MIN_GAP[name];
    if (gap !== undefined) {
      const now = g.ctx.currentTime;
      const last = lastPlayed[name];
      if (last !== undefined && now >= last && now - last < gap) return;
      lastPlayed[name] = now;
    }
    try {
      VOICES[name](g);
    } catch (error) {
      // Sound is a nicety: never let it break play.
      if (!warned) {
        warned = true;
        console.warn('sound effect failed', name, error);
      }
    }
  }

  const sfx = {} as Sfx;
  for (const name of SFX_NAMES) sfx[name] = () => play(name);
  return sfx;
}
