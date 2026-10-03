import { mulberry32 } from '../../engine/seed';

/** FNV-1a, 32 bit. Same text always gives the same number. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Shuffles the steps with a PRNG seeded from the step text, so the same sequence always shows
 * in the same jumbled order (stable tests, no surprise between reloads). The result is never
 * the correct order, unless every step is identical.
 */
export function shuffleSteps(steps: readonly string[]): string[] {
  const out = [...steps];
  const rand = mulberry32(hashText(steps.join('\u0000')));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((step, i) => step === steps[i])) {
    out.push(out.shift()!); // already in order: rotate by one
  }
  return out;
}
