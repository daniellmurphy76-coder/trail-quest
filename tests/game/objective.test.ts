// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectiveCue } from '../../src/game/objective';
import { createCompass } from '../../src/game/screens/compass';
import { makeHost } from '../ui/helpers';

const GUIDE = { x: 3.4, z: -1.8 };
const BRIDGE = { x: -10, z: 4 };

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

function make(guide: { x: number; z: number } | null = GUIDE) {
  const marker = { visible: false };
  const compass = createCompass(host);
  const cue = new ObjectiveCue(marker, compass, guide, 'Den Chief');
  return { marker, compass, cue };
}

describe('objective cue', () => {
  it('shows the arrow and points the compass at the Den Chief, then lets go', () => {
    const { marker, compass, cue } = make();
    expect(cue.visible).toBe(false);
    cue.setVisible(true);
    expect(marker.visible).toBe(true);
    expect(compass.target).toEqual(GUIDE);
    compass.update({ x: 0, z: 9 }, Math.PI);
    expect(compass.root.textContent).toContain('Den Chief');

    cue.setVisible(false);
    expect(marker.visible).toBe(false);
    expect(compass.target).toBeNull();
  });

  it('does nothing when asked for the state it is already in', () => {
    const { compass, cue } = make();
    cue.setVisible(false);
    expect(compass.target).toBeNull();
    cue.setVisible(true);
    compass.setTarget(BRIDGE, 'Footbridge'); // an activity takes the compass
    cue.setVisible(true); // the app asks again on every screen change
    expect(compass.target).toEqual(BRIDGE);
  });

  it('never clears a waypoint that someone else pointed the compass at', () => {
    const { marker, compass, cue } = make();
    cue.setVisible(true);
    compass.setTarget(BRIDGE, 'Footbridge');
    cue.setVisible(false);
    expect(marker.visible).toBe(false);
    expect(compass.target).toEqual(BRIDGE);
    expect(compass.root.querySelector('.tq-compass__label')!.textContent).toBe('Footbridge');
  });

  it('follows a renamed guide only while the compass is on the guide', () => {
    const { compass, cue } = make();
    cue.setVisible(true);
    cue.setName('Captain Sam');
    expect(compass.root.querySelector('.tq-compass__label')!.textContent).toBe('Captain Sam');

    compass.setTarget(BRIDGE, 'Footbridge');
    cue.setName('Rex');
    expect(compass.root.querySelector('.tq-compass__label')!.textContent).toBe('Footbridge');

    cue.setVisible(false);
    cue.setVisible(true);
    expect(compass.root.querySelector('.tq-compass__label')!.textContent).toBe('Rex');
  });

  it('stays off in a zone with no guide', () => {
    const { marker, compass, cue } = make(null);
    cue.setVisible(true);
    expect(cue.visible).toBe(false);
    expect(marker.visible).toBe(false);
    expect(compass.target).toBeNull();
  });
});
