/**
 * Keeps the game's input off while any overlay is open.
 *
 * Every screen, dialog, PIN pad and activity mounts a `.tq-overlay` directly inside `#ui`. Rather
 * than ask each of them to tell the engine, this watches `#ui` and turns input off while at least
 * one overlay is there and back on when the last one closes. Returns a function that stops
 * watching.
 */
export interface InputSwitch {
  setEnabled(enabled: boolean): void;
}

export function overlayCount(host: HTMLElement): number {
  return Array.from(host.children).filter((child) => child.classList.contains('tq-overlay')).length;
}

export function watchOverlays(host: HTMLElement, input: InputSwitch): () => void {
  const sync = (): void => input.setEnabled(overlayCount(host) === 0);
  const observer = new MutationObserver(sync);
  observer.observe(host, { childList: true });
  sync();
  return () => observer.disconnect();
}
