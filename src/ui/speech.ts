export interface SpeakOptions {
  /** Speak even when read-aloud is off. A kid who taps a Read button always gets to hear it. */
  force?: boolean;
}

/** `ActivityContext.speak` is assignable to this, and this is assignable to `(text: string) => void`. */
export type Speak = (text: string, options?: SpeakOptions) => void;

function synth(): SpeechSynthesis | null {
  const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
  if (!g.speechSynthesis || typeof g.SpeechSynthesisUtterance !== 'function') return null;
  return g.speechSynthesis;
}

function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const voices = s.getVoices();
  return (
    voices.find((v) => v.lang === 'en-US') ??
    voices.find((v) => v.lang.replace('_', '-').toLowerCase() === 'en-us') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en'))
  );
}

/**
 * Returns a function that reads text aloud with the Web Speech API. It cancels anything
 * already being read first, and does nothing when `enabled()` is false (unless the caller
 * passes `{ force: true }`) or when speech is unavailable.
 */
export function createSpeaker(enabled: () => boolean): Speak {
  return (text, options) => {
    const s = synth();
    if (!s) return;
    if (!options?.force && !enabled()) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      s.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      const voice = pickVoice(s);
      if (voice) utterance.voice = voice;
      s.speak(utterance);
    } catch {
      // Speech is a nicety. Never let it break a quest.
    }
  };
}

/**
 * iPad Safari only lets speech start from inside a user gesture. On the first tap (or key
 * press) we speak a silent utterance, which unlocks later speech. Returns a function that
 * removes the listeners.
 */
export function prepareSpeechOnFirstGesture(): () => void {
  if (typeof document === 'undefined') return () => {};
  let done = false;
  const warm = (): void => {
    if (done) return;
    done = true;
    stop();
    const s = synth();
    if (!s) return;
    try {
      const utterance = new SpeechSynthesisUtterance('.');
      utterance.volume = 0;
      utterance.rate = 10;
      s.speak(utterance);
    } catch {
      // Ignore: speech just stays unavailable.
    }
  };
  const stop = (): void => {
    document.removeEventListener('pointerdown', warm, true);
    document.removeEventListener('keydown', warm, true);
  };
  document.addEventListener('pointerdown', warm, true);
  document.addEventListener('keydown', warm, true);
  return stop;
}
