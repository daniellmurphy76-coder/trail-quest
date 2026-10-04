// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectActivity } from '../../src/activities/collect';
import { navigateActivity } from '../../src/activities/navigate';
import { createFakeWorldHost } from '../../src/activities/world-fake';
import { isNonModal, NONMODAL_ATTR, overlayCount, watchOverlays } from '../../src/game/overlays';
import { burstConfetti } from '../../src/game/effects';
import { showDialog } from '../../src/ui/dialog';
import { showToast } from '../../src/ui/toast';
import { buttonByText, flush, makeCtx, makeHost } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

function input() {
  return { setEnabled: vi.fn<(enabled: boolean) => void>() };
}

describe('non-modal panels and game input', () => {
  it('overlayCount counts modal overlays and skips anything marked data-tq-nonmodal="true"', () => {
    expect(NONMODAL_ATTR).toBe('data-tq-nonmodal');
    const modal = document.createElement('div');
    modal.className = 'tq-overlay';
    const flagged = document.createElement('div');
    flagged.className = 'tq-overlay';
    flagged.setAttribute('data-tq-nonmodal', 'true');
    const plain = document.createElement('div'); // not an overlay at all
    host.append(modal, flagged, plain);
    expect(isNonModal(flagged)).toBe(true);
    expect(isNonModal(modal)).toBe(false);
    expect(overlayCount(host)).toBe(1);
  });

  it('keeps input enabled while a collect panel is up', async () => {
    const sw = input();
    watchOverlays(host, sw);
    expect(sw.setEnabled).toHaveBeenLastCalledWith(true);

    const world = createFakeWorldHost();
    const result = collectActivity.run(
      host,
      { prompt: 'Find it.', zone: 'nature-trail', targets: [{ id: 'a', label: 'A', count: 1 }] },
      makeCtx({ world }),
    );
    await flush(); // the observer runs after the panel is added
    expect(host.querySelector('[data-tq-nonmodal="true"]')).not.toBeNull();
    expect(sw.setEnabled).toHaveBeenLastCalledWith(true);
    expect(sw.setEnabled).not.toHaveBeenCalledWith(false);

    buttonByText(host, 'Back').click();
    await result;
    await flush();
    expect(sw.setEnabled).not.toHaveBeenCalledWith(false);
  });

  it('keeps input enabled while a navigate panel is up', async () => {
    const sw = input();
    watchOverlays(host, sw);
    const world = createFakeWorldHost({ landmarks: { x: { x: 5, y: 0, z: 5 } } });
    const result = navigateActivity.run(
      host,
      { prompt: 'Go.', zone: 'nature-trail', waypoints: [{ id: 'x', label: 'X' }] },
      makeCtx({ world }),
    );
    await flush();
    expect(sw.setEnabled).not.toHaveBeenCalledWith(false);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('still turns input off for a real modal overlay, even with a panel up, and back on when it closes', async () => {
    const sw = input();
    watchOverlays(host, sw);
    const world = createFakeWorldHost();
    void collectActivity.run(
      host,
      { prompt: 'Find it.', zone: 'nature-trail', targets: [{ id: 'a', label: 'A', count: 1 }] },
      makeCtx({ world }),
    );
    const dialog = showDialog(host, { speaker: 'Zip', text: 'A test dialog.' });
    await flush();
    expect(sw.setEnabled).toHaveBeenLastCalledWith(false);
    expect(overlayCount(host)).toBe(1);

    buttonByText(host, 'Next').click();
    await dialog;
    await flush();
    expect(sw.setEnabled).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('[data-tq-nonmodal="true"]')).not.toBeNull(); // the panel stayed
  });

  it('a toast and a confetti burst are never overlays: they leave game input alone', async () => {
    const sw = input();
    watchOverlays(host, sw);
    const context = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as never);
    try {
      const removeToast = showToast(host, 'You earned a new hat!');
      const endConfetti = burstConfetti(host);
      expect(host.querySelector('.tq-toast')).not.toBeNull();
      expect(host.querySelector('canvas.tq-confetti')).not.toBeNull();
      expect(overlayCount(host)).toBe(0);
      await flush(); // the observer runs after the nodes are added
      expect(sw.setEnabled).not.toHaveBeenCalledWith(false);
      expect(sw.setEnabled).toHaveBeenLastCalledWith(true);

      removeToast();
      endConfetti?.();
      await flush();
      expect(sw.setEnabled).not.toHaveBeenCalledWith(false);
    } finally {
      getContext.mockRestore();
    }
  });

  it('the panel is not a dialog: no tq-overlay class, no aria-modal, and it holds no focus', async () => {
    const world = createFakeWorldHost();
    const before = document.activeElement;
    void collectActivity.run(
      host,
      { prompt: 'Find it.', zone: 'nature-trail', targets: [{ id: 'a', label: 'A', count: 1 }] },
      makeCtx({ world }),
    );
    const panel = host.querySelector<HTMLElement>('[data-tq-nonmodal="true"]')!;
    expect(panel.classList.contains('tq-overlay')).toBe(false);
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('Collect');
    expect(document.activeElement).toBe(before);
  });
});
