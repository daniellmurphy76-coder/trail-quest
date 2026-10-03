/**
 * Keeps the game's input off while any overlay is open.
 *
 * Every screen, dialog, PIN pad and activity mounts a `.tq-overlay` directly inside `#ui`. Rather
 * than ask each of them to tell the engine, this watches `#ui` and turns input off while at least
 * one overlay is there and back on when the last one closes. Returns a function that stops
 * watching. `onChange` (optional) hears the new overlay count after every change, so Base Camp's
 * own buttons can hide while anything is open.
 *
 * A panel marked `data-tq-nonmodal="true"` (the collect and navigate panels) is not an overlay: it
 * is not counted, so it never turns input off and never hides Base Camp's buttons.
 */
export interface InputSwitch {
  setEnabled(enabled: boolean): void;
}

/** Panels that sit over the world without taking it over (collect and navigate) carry this. */
export const NONMODAL_ATTR = 'data-tq-nonmodal';

/** True for a panel that leaves the world playable: it does not count as an open overlay. */
export function isNonModal(el: Element): boolean {
  return el.getAttribute(NONMODAL_ATTR) === 'true';
}

/** How many modal overlays are open. Non-modal panels (`data-tq-nonmodal="true"`) are not counted. */
export function overlayCount(host: HTMLElement): number {
  return Array.from(host.children).filter((child) => child.classList.contains('tq-overlay') && !isNonModal(child))
    .length;
}

export function watchOverlays(
  host: HTMLElement,
  input: InputSwitch,
  onChange?: (count: number) => void,
): () => void {
  const sync = (): void => {
    const count = overlayCount(host);
    input.setEnabled(count === 0);
    onChange?.(count);
  };
  const observer = new MutationObserver(sync);
  observer.observe(host, { childList: true });
  sync();
  return () => observer.disconnect();
}
