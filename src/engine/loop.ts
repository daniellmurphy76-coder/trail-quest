import * as THREE from 'three';
import { STEP, advanceAccumulator } from './loop-math';

export interface LoopCallbacks {
  /** Fixed 60 Hz simulation step. `dt` is always STEP (1/60 s). */
  onUpdate(dt: number): void;
  /**
   * Once per displayed frame. `alpha` in [0, 1) is how far we are between the last two
   * fixed steps (use it to interpolate visuals). `frameDt` is the real frame time in seconds.
   */
  onRender(alpha: number, frameDt: number): void;
}

/** requestAnimationFrame loop with a fixed-step accumulator. Pauses while the tab is hidden. */
export class GameLoop {
  private readonly timer = new THREE.Timer();
  private accumulator = 0;
  private handle = 0;
  private running = false;

  constructor(private readonly callbacks: LoopCallbacks) {
    this.timer.connect(document);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resume();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.timer.dispose();
  }

  private resume(): void {
    if (!this.running || this.handle !== 0 || document.hidden) return;
    this.accumulator = 0;
    this.timer.reset(); // no giant delta on the first frame back
    this.handle = requestAnimationFrame(this.frame);
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.handle);
      this.handle = 0;
    } else {
      this.resume();
    }
  };

  private readonly frame = (now: number): void => {
    this.handle = 0;
    if (!this.running || document.hidden) return;
    this.handle = requestAnimationFrame(this.frame);

    this.timer.update(now);
    const frameDt = this.timer.getDelta();
    const result = advanceAccumulator(this.accumulator, frameDt);
    this.accumulator = result.accumulator;
    for (let i = 0; i < result.steps; i++) this.callbacks.onUpdate(STEP);
    this.callbacks.onRender(this.accumulator / STEP, frameDt);
  };
}
