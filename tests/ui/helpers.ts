import { vi, type Mock } from 'vitest';
import type { ActivityContext } from '../../src/activities/types';

/** A fresh `#ui` host attached to the document (key handling listens on document). */
export function makeHost(): HTMLElement {
  document.body.replaceChildren();
  const host = document.createElement('div');
  host.id = 'ui';
  document.body.appendChild(host);
  return host;
}

export type SpeakMock = Mock<(text: string) => void>;

export function makeCtx(overrides: Partial<ActivityContext> = {}): ActivityContext & { speak: SpeakMock } {
  const speak: SpeakMock = vi.fn<(text: string) => void>();
  return { profileId: 'test', rank: 'wolf', readingLevel: 'grade2', speak, ...overrides } as ActivityContext & {
    speak: SpeakMock;
  };
}

/** Finds a button whose visible text contains `text` (case-insensitive). Throws if there is none. */
export function buttonByText(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => {
    const content = b.textContent ?? '';
    return typeof text === 'string' ? content.toLowerCase().includes(text.toLowerCase()) : text.test(content);
  });
  if (!found) throw new Error(`No button matching ${String(text)}. Page text: ${root.textContent ?? ''}`);
  return found;
}

export function maybeButton(root: ParentNode, text: string | RegExp): HTMLButtonElement | null {
  try {
    return buttonByText(root, text);
  } catch {
    return null;
  }
}

export function press(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Lets pending promise callbacks run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
