import type { GroundPoint } from './compass-math';
import type { Compass } from './screens/compass';

/** The bobbing arrow over the guide. Only its visibility is needed here. */
export interface ObjectiveMarker {
  visible: boolean;
}

/**
 * The "go here" cues for the Den Chief: the bobbing arrow over their head and the compass
 * pointing at them. The compass is shared (a later activity may point it at a waypoint), so this
 * only takes it over when it turns on, and lets go only if the compass is still pointing at the
 * guide when it turns off. It acts on changes, not on every call, so the app can ask for the
 * current state as often as it likes without clobbering a waypoint.
 */
export class ObjectiveCue {
  private on = false;

  constructor(
    private readonly marker: ObjectiveMarker,
    private readonly compass: Compass,
    /** Where the guide stands, or null when this zone has no guide. */
    private readonly guide: GroundPoint | null,
    private name: string,
  ) {}

  get visible(): boolean {
    return this.on;
  }

  setVisible(visible: boolean): void {
    const next = visible && this.guide !== null;
    if (next === this.on) return;
    this.on = next;
    this.marker.visible = next;
    if (next && this.guide) this.compass.setTarget(this.guide, this.name);
    else if (this.compassOnGuide()) this.compass.setTarget(null);
  }

  /** The guide was renamed: the compass label follows while it is pointing at them. */
  setName(name: string): void {
    this.name = name;
    if (this.guide && this.compassOnGuide()) this.compass.setTarget(this.guide, name);
  }

  private compassOnGuide(): boolean {
    const target = this.compass.target;
    return target !== null && this.guide !== null && target.x === this.guide.x && target.z === this.guide.z;
  }
}
