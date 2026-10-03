/**
 * Quiet background ambience, about -24 dB so it never competes with reading:
 *  - a campfire crackle (filtered noise with random short pops) at Base Camp and Campfire Circle,
 *  - occasional bird chirps (random short FM blips every 4 to 10 seconds) in the outdoor zones,
 *  - a very quiet distant hum at the Town Square and the Safety Station.
 * Changing zone crossfades. Nothing plays until the engine is unlocked by a gesture, while muted,
 * or while the tab is hidden: the engine tells us, and we build or tear down to match.
 */
import type { ZoneId } from '../activities/types';
import type { AudioEngine, AudioGraph } from './engine';
import { AMBIENCE_LEVEL, SILENCE, noiseBuffer } from './synth';

export interface AmbienceMix {
  crackle: boolean;
  birds: boolean;
  hum: boolean;
}

/** What each zone sounds like. */
export const ZONE_AMBIENCE: Record<ZoneId, AmbienceMix> = {
  'base-camp': { crackle: true, birds: true, hum: false },
  'fitness-field': { crackle: false, birds: true, hum: false },
  'nature-trail': { crackle: false, birds: true, hum: false },
  'town-square': { crackle: false, birds: false, hum: true },
  'safety-station': { crackle: false, birds: false, hum: true },
  'campfire-circle': { crackle: true, birds: false, hum: false },
};

export interface Ambience {
  /** Begin (or keep) the ambience for the current zone. Starts for real once sound is unlocked. */
  start(): void;
  /** Fade out and release everything, including timers. */
  stop(): void;
  /** Crossfade to a zone's ambience. Remembered while stopped or locked. */
  setZone(zone: ZoneId): void;
  /** The zone whose ambience is wanted. */
  zone(): ZoneId;
  /** The layers the current zone wants. */
  mix(): AmbienceMix;
  dispose(): void;
}

export interface AmbienceOptions {
  /** 0 to 1. Defaults to Math.random. Tests pass a fixed one. */
  random?: () => number;
}

/** Seconds: the time constant of a crossfade (about two seconds to settle). */
const FADE_TC = 0.6;
const FADE_OUT_MS = 2600;
const CHIRP_MIN_MS = 4000;
const CHIRP_MAX_MS = 10000;

interface Layer {
  gain: GainNode;
  /** Makes one random event (a pop, a chirp) and returns the milliseconds until the next. */
  event?: () => number;
  /** How long after the layer starts the first event comes, in milliseconds. */
  firstEventMs: () => number;
  timer?: ReturnType<typeof setTimeout>;
  fadeTimer?: ReturnType<typeof setTimeout>;
  /** True while the layer is audible or fading out, so its random events keep coming. */
  running: boolean;
}

interface Rig {
  ctx: AudioContext;
  bus: GainNode;
  sources: AudioScheduledSourceNode[];
  crackle: Layer;
  birds: Layer;
  hum: Layer;
}

export function createAmbience(engine: AudioEngine, options: AmbienceOptions = {}): Ambience {
  const random = options.random ?? Math.random;
  const between = (low: number, high: number): number => low + random() * (high - low);

  let wanted = false;
  let zone: ZoneId = 'base-camp';
  let rig: Rig | null = null;
  /** Oscillators made while building a rig that still need starting (and stopping at teardown). */
  let pendingOscillators: OscillatorNode[] = [];

  // ---- Layers ------------------------------------------------------------------------------

  function makeLayer(ctx: AudioContext, bus: GainNode, firstEventMs: () => number): Layer {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    return { gain, firstEventMs, running: false };
  }

  /** Crackle: a low fire bed, plus short random pops (sometimes two or three in a row). */
  function buildCrackle(ctx: AudioContext, bus: GainNode, noise: AudioBufferSourceNode): Layer {
    const layer = makeLayer(ctx, bus, () => between(60, 300));

    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 500;
    const bed = ctx.createGain();
    bed.gain.value = 0.18;
    noise.connect(bedFilter);
    bedFilter.connect(bed);
    bed.connect(layer.gain);

    const popFilter = ctx.createBiquadFilter();
    popFilter.type = 'bandpass';
    popFilter.Q.value = 1.2;
    popFilter.frequency.value = 2500;
    const pops = ctx.createGain();
    pops.gain.value = 0;
    noise.connect(popFilter);
    popFilter.connect(pops);
    pops.connect(layer.gain);

    const pop = (at: number): void => {
      const dur = between(0.008, 0.03);
      popFilter.frequency.setValueAtTime(between(1400, 4800), at);
      pops.gain.setValueAtTime(SILENCE, at);
      pops.gain.exponentialRampToValueAtTime(between(0.25, 0.9), at + 0.003);
      pops.gain.exponentialRampToValueAtTime(SILENCE, at + 0.003 + dur);
    };

    layer.event = () => {
      const now = ctx.currentTime + 0.005;
      pop(now);
      if (random() < 0.3) {
        pop(now + between(0.02, 0.05));
        if (random() < 0.4) pop(now + between(0.06, 0.1));
        // Leave room for the whole cluster before the next event schedules more pops.
        return between(220, 520);
      }
      return between(90, 480);
    };
    return layer;
  }

  /** Birds: a short trill of two to four FM blips, now and then. */
  function buildBirds(ctx: AudioContext, bus: GainNode): Layer {
    const layer = makeLayer(ctx, bus, () => between(1200, 3500));

    const chirp = (): void => {
      const blips = 2 + Math.floor(random() * 3);
      const base = between(2200, 4000);
      let at = ctx.currentTime + 0.02;
      for (let i = 0; i < blips; i += 1) {
        const dur = between(0.05, 0.09);
        const from = base * between(0.9, 1.1);
        const to = from * between(0.8, 1.4);
        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(from, at);
        carrier.frequency.exponentialRampToValueAtTime(to, at + dur);
        // The FM: a quick wobble on the pitch makes a blip sound like a bird, not a beep.
        const wobble = ctx.createOscillator();
        wobble.type = 'sine';
        wobble.frequency.setValueAtTime(between(30, 70), at);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(between(120, 320), at);
        wobble.connect(depth);
        depth.connect(carrier.frequency);
        const env = ctx.createGain();
        env.gain.setValueAtTime(SILENCE, at);
        env.gain.exponentialRampToValueAtTime(0.5, at + 0.008);
        env.gain.exponentialRampToValueAtTime(SILENCE, at + dur);
        const soften = ctx.createBiquadFilter();
        soften.type = 'lowpass';
        soften.frequency.value = 6000;
        carrier.connect(soften);
        soften.connect(env);
        env.connect(layer.gain);
        carrier.start(at);
        wobble.start(at);
        carrier.stop(at + dur + 0.03);
        wobble.stop(at + dur + 0.03);
        carrier.onended = () => {
          carrier.disconnect();
          wobble.disconnect();
          depth.disconnect();
          soften.disconnect();
          env.disconnect();
        };
        at += dur + between(0.04, 0.08);
      }
    };

    layer.event = () => {
      chirp();
      return between(CHIRP_MIN_MS, CHIRP_MAX_MS);
    };
    return layer;
  }

  /** Hum: two soft low sines and a band of noise, swelling very slowly. No random events. */
  function buildHum(ctx: AudioContext, bus: GainNode, noise: AudioBufferSourceNode): Layer {
    const layer = makeLayer(ctx, bus, () => 0);
    const swell = ctx.createGain();
    swell.gain.value = 0.7;
    swell.connect(layer.gain);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.12;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.2;
    lfo.connect(lfoDepth);
    lfoDepth.connect(swell.gain);
    pendingOscillators.push(lfo);

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 220;
    band.Q.value = 0.7;
    const bandLevel = ctx.createGain();
    bandLevel.gain.value = 0.6;
    noise.connect(band);
    band.connect(bandLevel);
    bandLevel.connect(swell);

    for (const freq of [110, 165]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const level = ctx.createGain();
      level.gain.value = 0.25;
      osc.connect(level);
      level.connect(swell);
      pendingOscillators.push(osc);
    }
    return layer;
  }

  function build(g: AudioGraph): Rig {
    const { ctx, master } = g;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(AMBIENCE_LEVEL, ctx.currentTime, 0.4);
    bus.connect(master);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;

    pendingOscillators = [];
    const crackle = buildCrackle(ctx, bus, noise);
    const birds = buildBirds(ctx, bus);
    const hum = buildHum(ctx, bus, noise);

    const sources: AudioScheduledSourceNode[] = [noise, ...pendingOscillators];
    pendingOscillators = [];
    for (const source of sources) source.start();
    return { ctx, bus, sources, crackle, birds, hum };
  }

  // ---- Mixing ------------------------------------------------------------------------------

  function runEvents(layer: Layer): void {
    const event = layer.event;
    if (!event || layer.timer !== undefined) return;
    const step = (): void => {
      layer.timer = undefined;
      if (!layer.running || !rig || !engine.graph()) return;
      layer.timer = setTimeout(step, event());
    };
    layer.timer = setTimeout(step, layer.firstEventMs());
  }

  function setLayer(layer: Layer, on: boolean, ctx: AudioContext): void {
    const now = ctx.currentTime;
    layer.gain.gain.cancelScheduledValues(now);
    layer.gain.gain.setTargetAtTime(on ? 1 : 0, now, FADE_TC);
    if (layer.fadeTimer !== undefined) {
      clearTimeout(layer.fadeTimer);
      layer.fadeTimer = undefined;
    }
    if (on) {
      layer.running = true;
      runEvents(layer);
    } else if (layer.running) {
      // Its random events keep coming while it fades out, so a crossfade is a real crossfade.
      layer.fadeTimer = setTimeout(() => {
        layer.fadeTimer = undefined;
        layer.running = false;
      }, FADE_OUT_MS);
    }
  }

  function applyMix(): void {
    if (!rig) return;
    const mix = ZONE_AMBIENCE[zone];
    setLayer(rig.crackle, mix.crackle, rig.ctx);
    setLayer(rig.birds, mix.birds, rig.ctx);
    setLayer(rig.hum, mix.hum, rig.ctx);
  }

  function clearTimers(r: Rig): void {
    for (const layer of [r.crackle, r.birds, r.hum]) {
      layer.running = false;
      if (layer.timer !== undefined) clearTimeout(layer.timer);
      if (layer.fadeTimer !== undefined) clearTimeout(layer.fadeTimer);
      layer.timer = undefined;
      layer.fadeTimer = undefined;
    }
  }

  function teardown(): void {
    if (!rig) return;
    const old = rig;
    rig = null;
    clearTimers(old);
    try {
      const now = old.ctx.currentTime;
      old.bus.gain.cancelScheduledValues(now);
      old.bus.gain.setTargetAtTime(0, now, 0.05);
      for (const source of old.sources) {
        source.stop(now + 0.5);
        source.onended = () => source.disconnect();
      }
    } catch {
      // The context is already gone.
    }
    setTimeout(() => old.bus.disconnect(), 800);
  }

  /** Make the running rig match what is wanted and what the engine allows right now. */
  function reconcile(): void {
    const g = engine.graph();
    if (!wanted || !g) {
      teardown();
      return;
    }
    if (rig && rig.ctx !== g.ctx) teardown();
    if (!rig) rig = build(g);
    applyMix();
  }

  const unsubscribe = engine.onChange(reconcile);

  return {
    start() {
      wanted = true;
      reconcile();
    },
    stop() {
      wanted = false;
      teardown();
    },
    setZone(next) {
      zone = next;
      reconcile();
    },
    zone: () => zone,
    mix: () => ZONE_AMBIENCE[zone],
    dispose() {
      wanted = false;
      unsubscribe();
      teardown();
    },
  };
}
