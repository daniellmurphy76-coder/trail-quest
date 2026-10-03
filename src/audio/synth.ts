/**
 * Shared Web Audio helpers for the sound effects and the ambience. Nothing here makes a sound by
 * itself and nothing loads a file: every sound is built from oscillators and filtered noise.
 */
import type { AudioGraph } from './engine';

/** Exponential ramps cannot reach 0, so envelopes start and end here (about -80 dB). */
export const SILENCE = 0.0001;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Effects peak around -12 dB: gentle, never startling. */
export const SFX_PEAK = dbToGain(-12);

/** Ambience sits at about -24 dB so it never competes with reading or the effects. */
export const AMBIENCE_LEVEL = dbToGain(-24);

/** Equal-tempered pitch: MIDI note 69 is A4 (440 Hz). */
export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export interface ToneSpec {
  /** Pitch in Hz. */
  freq: number;
  /** Seconds after now that the note starts. Default 0. */
  at?: number;
  /** Length in seconds. */
  dur: number;
  /** Peak gain, 0 to 1. Default SFX_PEAK. */
  peak?: number;
  /** Seconds to reach the peak. Default 8 ms. */
  attack?: number;
  /** Sine (default) or triangle. Never square or sawtooth: they sound harsh. */
  type?: 'sine' | 'triangle';
  /** Glide to this pitch over the length of the note. */
  slideTo?: number;
  /** Low-pass cutoff in Hz. Default 3200. */
  lowpass?: number;
  /** Level (0 to 1) of a quiet octave-above overtone that makes a note bell-like. Default none. */
  bell?: number;
}

/** One soft note: oscillator, exponential envelope, small low-pass, into `out` (the master by default). */
export function tone(g: AudioGraph, spec: ToneSpec, out: AudioNode = g.master): void {
  const { ctx } = g;
  const t0 = ctx.currentTime + 0.005 + (spec.at ?? 0);
  const end = t0 + spec.dur;
  const attack = Math.min(spec.attack ?? 0.008, spec.dur / 2);
  const peak = Math.max(spec.peak ?? SFX_PEAK, SILENCE * 2);

  const env = ctx.createGain();
  env.gain.setValueAtTime(SILENCE, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(SILENCE, end);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(spec.lowpass ?? 3200, t0);
  lp.Q.setValueAtTime(0.5, t0);
  lp.connect(env);
  env.connect(out);

  const voices: OscillatorNode[] = [];
  const addPartial = (multiple: number, level: number): void => {
    const osc = ctx.createOscillator();
    osc.type = spec.type ?? 'sine';
    osc.frequency.setValueAtTime(spec.freq * multiple, t0);
    if (spec.slideTo) osc.frequency.exponentialRampToValueAtTime(spec.slideTo * multiple, end);
    if (level === 1) {
      osc.connect(lp);
    } else {
      const trim = ctx.createGain();
      trim.gain.setValueAtTime(level, t0);
      osc.connect(trim);
      trim.connect(lp);
    }
    osc.start(t0);
    osc.stop(end + 0.03);
    voices.push(osc);
  };
  addPartial(1, 1);
  if (spec.bell) addPartial(2, spec.bell);

  // Let the nodes go once the last voice has finished.
  const last = voices[voices.length - 1]!;
  last.onended = () => {
    for (const voice of voices) voice.disconnect();
    lp.disconnect();
    env.disconnect();
  };
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once per context and shared by effects and ambience. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}
