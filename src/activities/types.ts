/**
 * Activity catalog contract.
 *
 * Every requirement in content/ranks/*.json names one activity `type` and a `params`
 * object. The params object must match the interface for that type below. Content
 * authors and activity implementers both code to this file. Changing a shape here is
 * a contract change: say so in your report.
 */

export type ActivityType =
  | 'quiz'
  | 'sequence'
  | 'sort'
  | 'collect'
  | 'navigate'
  | 'rhythm'
  | 'craft'
  | 'fieldMission';

export type ZoneId =
  | 'base-camp'
  | 'fitness-field'
  | 'nature-trail'
  | 'town-square'
  | 'safety-station'
  | 'campfire-circle';

/** One multiple-choice question. `answer` is the index into `choices`. */
export interface QuizQuestion {
  prompt: string;
  choices: string[]; // 2 to 4 short choices
  answer: number;
  /** Shown after answering, right or wrong. Kid reading level. */
  explain?: string;
}

/** NPC asks questions; player taps answers. Completes when `passCount` (default: all) are right. */
export interface QuizParams {
  questions: QuizQuestion[];
  passCount?: number;
}

/** Steps shown shuffled; player drags or taps them into the correct order given by `steps`. */
export interface SequenceParams {
  prompt: string;
  steps: string[]; // in correct order, 3 to 8 items
}

/** Player drags each item into the right bin. */
export interface SortParams {
  prompt: string;
  bins: { id: string; label: string }[]; // 2 to 4 bins
  items: { label: string; bin: string }[]; // bin references bins[].id
}

/** Player explores a zone and picks up tagged props. */
export interface CollectParams {
  prompt: string;
  zone: ZoneId;
  targets: { id: string; label: string; count: number; hint?: string }[];
}

/** Player follows a compass or map to waypoints in order. */
export interface NavigateParams {
  prompt: string;
  zone: ZoneId;
  waypoints: { id: string; label: string }[]; // 2 to 6, visited in order
  useCompass?: boolean; // default false: show a map marker instead
}

/** Timed button presses that mirror an exercise; a practice tool, never a substitute for the real thing. */
export interface RhythmParams {
  prompt: string;
  exercise: string; // e.g. "jumping jacks"
  reps: number; // 5 to 20
  bpm?: number; // default 80
}

/** Player combines the right ingredients at a bench to make `result`. */
export interface CraftParams {
  prompt: string;
  result: string;
  ingredients: { id: string; label: string }[]; // 2 to 8 required
  distractors?: { id: string; label: string }[]; // wrong items mixed in
}

/** Real-world task. Player reads the steps, does it offline, parent approves with PIN. */
export interface FieldMissionParams {
  title: string;
  kidSteps: string[]; // 1 to 6 steps at reading level
  /** Shown only in parent mode: what the parent should look for or help with. */
  parentNote?: string;
  /** 'checklist' shows kidSteps as tickable boxes before approval. Default 'none'. */
  evidence?: 'none' | 'checklist';
}

export interface ActivityParamsByType {
  quiz: QuizParams;
  sequence: SequenceParams;
  sort: SortParams;
  collect: CollectParams;
  navigate: NavigateParams;
  rhythm: RhythmParams;
  craft: CraftParams;
  fieldMission: FieldMissionParams;
}

/** Discriminated union used by content loaders and the activity runner. */
export type ActivitySpec = {
  [K in ActivityType]: { type: K; params: ActivityParamsByType[K] };
}[ActivityType];

export interface ActivityResult {
  completed: boolean;
  attempts: number;
  /** 0 to 1 where meaningful (quiz, sort). */
  score?: number;
  completedAt?: string; // ISO date-time
  approvedBy?: 'parent';
}

export type RankId = 'lion' | 'tiger' | 'wolf' | 'bear' | 'webelos' | 'arrow-of-light';
export type ReadingLevel = 'grade1' | 'grade2' | 'grade3' | 'grade4' | 'grade5';

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface WorldPlacedHandle {
  remove(): void;
}

export interface WorldPlaceOptions {
  /** Content id of the target or waypoint, e.g. "bird" or "footbridge". Used to pick a model. */
  id: string;
  label: string;
  position: WorldPoint;
  /** Ground distance at which the player reaches it. Default 1.5 for pickups, 2 for markers. */
  radius?: number;
  /** Fires once when the player first comes within `radius`. */
  onReach: () => void;
}

/**
 * What a world activity (collect, navigate) may do to the 3D scene. Implemented by the game
 * over the engine; absent in the activity harness and in tests, which use a fake host.
 */
export interface WorldActivityHost {
  zoneId(): ZoneId;
  playerPosition(): WorldPoint;
  /** Pre-authored walkable points in the current zone, in a stable order. May be empty. */
  openSpots(): WorldPoint[];
  /** Position of a named landmark in the current zone, if the zone defines it. */
  landmark(id: string): WorldPoint | undefined;
  /** Place a pickup (bobbing item with a name tag). */
  spawnPickup(opts: WorldPlaceOptions): WorldPlacedHandle;
  /** Place a waypoint beacon (tall marker with a name tag). */
  spawnMarker(opts: WorldPlaceOptions): WorldPlacedHandle;
  /** Point the HUD compass at a position, or clear it with null. */
  setCompassTarget(position: WorldPoint | null): void;
  /** Remove everything this activity placed and clear the compass. */
  clear(): void;
}

export interface ActivityContext {
  profileId: string;
  rank: RankId;
  readingLevel: ReadingLevel;
  /**
   * Always a no-op. The game has no voice: text is shown, never spoken. Kept on the
   * contract so existing activities compile; new code should not call it.
   */
  speak: (text: string) => void;
  /** Present only when a 3D world is running; collect and navigate need it. */
  world?: WorldActivityHost;
  /**
   * Full text the kid may peek at during the activity (the Scout Oath, the Scout Law). Activities
   * that teach memorized text show a "Show me" button when this is set. Peeking is never penalized.
   */
  poster?: { title: string; lines: string[] };
  /** All full texts for this stop, one per screen (Oath, then Law). Preferred over `poster`. */
  posters?: { title: string; lines: string[] }[];
  /**
   * Why this activity is running. 'new' is the default.
   * 'review' is a warm-up repeat of something already learned.
   * Field missions use 'handout' (show the card, resolve completed:false) and
   * 'check-in' (kid confirms it is done, resolve completed:true; parent approval follows).
   */
  stage?: 'new' | 'review' | 'handout' | 'check-in';
}

/** Each activity type exports one of these. The runner mounts it into the overlay. */
export interface ActivityController<T extends ActivityType = ActivityType> {
  type: T;
  /** Resolves when the player finishes or backs out. Never rejects for player error. */
  run(
    host: HTMLElement,
    params: ActivityParamsByType[T],
    ctx: ActivityContext,
  ): Promise<ActivityResult>;
}
