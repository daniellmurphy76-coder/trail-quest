import { h } from './dom';

export interface OverlayOptions {
  /** Accessible name for the dialog. */
  label: string;
  /** 'dialog' puts the card low on the screen like a speech bubble. Default 'card' is centered. */
  variant?: 'card' | 'dialog';
  /** Extra class for the card, for example 'tq-pin'. */
  cardClass?: string;
  /** Called for keys the overlay does not handle itself. Return true if you handled the key. */
  onKey?: (event: KeyboardEvent) => boolean | void;
  /** Called when Escape is pressed. Omit to ignore Escape. */
  onEscape?: () => void;
}

export interface Overlay {
  root: HTMLDivElement;
  card: HTMLDivElement;
  /** The button Enter or Space presses when no button has focus. */
  setDefault(button: HTMLButtonElement | null): void;
  /** Focuses a control without scrolling the page. */
  focus(el: HTMLElement | null | undefined): void;
  close(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mounts a modal overlay with one centered card inside `host`. Handles Enter and Space (press
 * the focused button, or the default one), Tab trapping, and restoring focus on close.
 */
export function mountOverlay(host: HTMLElement, options: OverlayOptions): Overlay {
  const card = h('div', { class: `tq-card${options.cardClass ? ` ${options.cardClass}` : ''}` });
  const root = h(
    'div',
    {
      class: `tq-overlay${options.variant === 'dialog' ? ' tq-overlay--dialog' : ''}`,
      role: 'dialog',
      attrs: { 'aria-modal': 'true', 'aria-label': options.label },
    },
    card,
  );
  let defaultButton: HTMLButtonElement | null = null;
  let closed = false;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const isTop = (): boolean => {
    const overlays = Array.from(host.children).filter((c) => c.classList.contains('tq-overlay'));
    return overlays[overlays.length - 1] === root;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (closed) return;
    if (!root.isConnected) {
      // Someone cleared the host without calling close(): stop listening.
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      return;
    }
    if (!isTop()) return;

    if (event.key === 'Tab') {
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && root.contains(active);
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey && inside ? last : first).focus({ preventScroll: true });
      }
      return;
    }

    if (event.key === 'Escape' && options.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      const target =
        event.target instanceof HTMLElement && root.contains(event.target)
          ? event.target
          : document.activeElement;
      if (target instanceof HTMLButtonElement && root.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && !target.disabled) target.click();
        return;
      }
      // Space ticks a focused checkbox natively; leave it alone.
      if (target instanceof HTMLInputElement && root.contains(target) && event.key !== 'Enter') return;
      const fallback = defaultButton;
      if (fallback && fallback.isConnected && !fallback.disabled) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) fallback.click();
      }
      return;
    }

    if (options.onKey && options.onKey(event) === true) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  host.appendChild(root);

  return {
    root,
    card,
    setDefault(button) {
      defaultButton = button;
    },
    focus(el) {
      el?.focus({ preventScroll: true });
    },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      const hadFocus = root.contains(document.activeElement);
      root.remove();
      if (hadFocus && previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    },
  };
}
