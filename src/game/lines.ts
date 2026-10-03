/**
 * Every line the Den Chief says, in two reading levels.
 *
 *   grade2  Wolf profile: sentences of 10 words or fewer.
 *   grade5  Arrow of Light profile: sentences of 15 words or fewer.
 *
 * A placeholder such as {name} counts as one word. tests/game/lines.test.ts checks both limits
 * and that every placeholder is one of LINE_VARS. Game code asks for a line by key, never writes
 * its own kid-facing sentence, and never hard-codes rank text.
 */
import type { ReadingLevel } from '../activities/types';
import { ZONE_LABELS } from '../world/zone-ids';

export type LineLevel = 'grade2' | 'grade5';

/** Reading levels below grade 4 use the grade2 wording; grade 4 and up use grade5. */
export function lineLevelOf(level: ReadingLevel): LineLevel {
  return level === 'grade4' || level === 'grade5' ? 'grade5' : 'grade2';
}

/** Values a line may mention. All optional; a missing one leaves the placeholder visible. */
export interface LineVars {
  name?: string;
  guide?: string;
  streak?: number;
  xp?: number;
  /** The stop or mission title (content text). */
  title?: string;
  /** An adventure name (content text). */
  adventure?: string;
  /** A zone label from ZONE_LABELS. */
  zone?: string;
  /** Stops finished on today's trail (HUD progress). */
  done?: number;
  /** Stops on today's trail (HUD progress). */
  total?: number;
  /** Distance to a compass target, in steps. */
  steps?: number;
}

export const LINE_VARS = ['name', 'guide', 'streak', 'xp', 'title', 'adventure', 'zone', 'done', 'total', 'steps'] as const;

interface Pair {
  grade2: string;
  grade5: string;
}
const same = (text: string): Pair => ({ grade2: text, grade5: text });

export const LINES = {
  // ---- greetings at Base Camp ----
  // The first greeting teaches the game: what a trail is, three stops, the campfire grows.
  greetFirst: {
    grade2: 'Hi {name}, I am {guide}! A trail is three quick stops. Do them all to grow your campfire!',
    grade5:
      'Hi {name}, I am {guide}! A trail is three quick stops: warm-up, new step, field check. ' +
      'Finish them all to make your campfire grow.',
  },
  greetStreak: {
    grade2: 'Welcome back, {name}! Your campfire is on Day {streak}. Ready to go?',
    grade5: "Welcome back, {name}! Your campfire is still lit on Day {streak}. Ready for today's trail?",
  },
  greetReturning: {
    grade2: 'Welcome back, {name}! Ready for your trail?',
    grade5: "Welcome back, {name}! Ready for today's trail?",
  },
  greetDone: {
    grade2: 'Your trail is done today. Want a bonus stop?',
    grade5: "You finished today's trail. Want to try a bonus stop?",
  },
  greetDoneNoBonus: {
    grade2: 'Your trail is done today. Great job! See you soon.',
    grade5: "You finished today's trail. Great work today, {name}! See you next time.",
  },
  greetNothing: {
    grade2: 'Hi {name}! I have no new stops today. Explore camp!',
    grade5: 'Hi {name}! I have nothing new for you today. Take a look around camp!',
  },

  // ---- the two choices on a greeting ----
  choiceGo: same("Let's go!"),
  choiceLook: same('Look around first'),

  // ---- the Start button at Base Camp and at the top of the trail panel ----
  startTrail: same("Start today's trail"),
  startBonus: same('Bonus stop'),

  // ---- the controls hint card. [X] is drawn as a key cap. ----
  hintWalkKeys: same('Walk: arrow keys or [W] [A] [S] [D].'),
  hintTalkKeys: same('Talk: [E]'),
  hintWalkTouch: same('Walk: drag the circle.'),
  hintTalkTouch: same('Talk: tap the big button.'),
  hintGotIt: same('Got it'),

  // ---- the HUD ----
  hudTrail: same("Today's Trail"),
  hudProgress: same('{done} of {total}'),
  hudProgressDone: same('✓ Done'),

  // ---- the compass arrow ----
  compassStep: same('1 step'),
  compassSteps: same('{steps} steps'),

  // ---- the trail panel when there is no list to show ----
  panelDone: {
    grade2: 'All done for today! Great job!',
    grade5: "Today's trail is done. Great job!",
  },
  panelEmpty: {
    grade2: 'No stops today. Explore camp!',
    grade5: 'No new stops today. Explore camp!',
  },

  // ---- the intro line before each stop (the stop title follows it) ----
  stopWarmUp: {
    grade2: "Warm-up time! Let's practice something you know.",
    grade5: "Warm-up! Let's review something you already learned.",
  },
  stopNewStep: {
    grade2: "A new step! Let's learn it.",
    grade5: 'New step! Here is something new to learn.',
  },
  stopFieldHandout: {
    grade2: 'Field check! Here is a real-life mission.',
    grade5: 'Field check! Here is a mission to do in real life.',
  },
  stopFieldCheckIn: {
    grade2: 'Field check! Did you do your mission?',
    grade5: 'Field check! Did you finish your mission?',
  },
  stopFieldApproval: {
    grade2: 'Field check! Time for your parent to approve.',
    grade5: 'Field check! Your mission is ready for parent approval.',
  },
  stopBonus: {
    grade2: 'Bonus stop! Just for fun.',
    grade5: 'Bonus stop! One more, just for fun.',
  },

  // ---- travel sign shown when a stop belongs to another zone ----
  travel: same('Walking to the {zone}…'),
  /** The "Back to camp" sign was used in the middle of a stop. */
  travelBusy: same('Tap Back to leave this stop.'),

  // ---- after a stop ----
  cheerXp: {
    grade2: 'Great job, {name}! You earned {xp} XP.',
    grade5: 'Nice work, {name}! You earned {xp} XP.',
  },
  cheerPlain: {
    grade2: 'Great job, {name}!',
    grade5: 'Nice work, {name}!',
  },
  cheerHandout: {
    grade2: 'Here is your mission. Go do it. Then tell me!',
    grade5: 'Here is your mission. Do it in real life, then check in with me.',
  },
  cheerWaiting: {
    grade2: 'Great job, {name}! Your parent can approve it later.',
    grade5: 'Nice work, {name}! Your parent can approve it later.',
  },
  backedOut: {
    grade2: 'That is okay! We can try again later.',
    grade5: 'That is okay, {name}. We can try this one again later.',
  },
  parentLater: {
    grade2: 'No problem. We will ask your parent next time.',
    grade5: 'No problem. We can ask your parent next time.',
  },
  badgeEarned: same('You earned the {adventure} badge!'),

  // ---- approval screen ----
  approvalTitle: same('Ask your parent to approve: {title}'),
  approvalHelp: {
    grade2: 'Give this screen to your parent.',
    grade5: 'Hand this screen to your parent. They will type a PIN.',
  },

  // ---- end of the session ----
  summaryTitle: {
    grade2: 'Great trail, {name}!',
    grade5: 'Trail complete, {name}!',
  },
  campfireLit: same('Your campfire is lit: Day {streak}.'),
  campfireNot: {
    grade2: 'Do all the stops to light your campfire.',
    grade5: 'Finish every stop to light your campfire.',
  },
  summaryBye: {
    grade2: 'Thanks for the help. See you soon!',
    grade5: 'Thanks for your help today, {name}. See you next time!',
  },
  bonusMore: {
    grade2: 'Great job! Want one more?',
    grade5: 'Nice! Want to try one more bonus stop?',
  },
  bonusNone: {
    grade2: 'That was the last one. Great job!',
    grade5: 'That was the last bonus stop. Great job today!',
  },
} as const satisfies Record<string, Pair>;

export type LineKey = keyof typeof LINES;

/** Words for the zones, used by the travel sign and the Places buttons. Defined with the zone ids. */
export { ZONE_LABELS };

/** Short names for the kinds of stops, shown in the trail panel. */
export const STOP_KIND_LABELS = {
  'warm-up': 'Warm-up',
  'new-step': 'New step',
  'field-check': 'Field check',
  bonus: 'Bonus',
} as const;

/** Words for what the kid sees in the trail panel (an icon always comes with the word). */
export const TRAIL_STATUS_LABELS = {
  done: { icon: '✓', word: 'Done' },
  next: { icon: '→', word: 'Up next' },
  later: { icon: '·', word: 'Later' },
} as const;

/**
 * Text for the parent, not the Scout: plain sentences with no reading-level limit. Kept here so
 * the wording lives in one file.
 */
export const PARENT_TEXT = {
  newPinTitle: 'Parent: choose a PIN',
  newPinSubtitle:
    'Pick 4 digits. The PIN stops accidental approvals when your Scout taps around. ' +
    'You will type it to approve field missions and to open Parent mode. It is not a security lock.',
  newPinConfirmTitle: 'Type the PIN again',
  enterPinTitle: 'Parent PIN',
  approvePinSubtitle: 'Type your 4 digits to approve this mission.',
  parentPinSubtitle: 'Type your 4 digits to open Parent mode.',
  approvalReminder:
    'In-game approval is not an official sign-off. Your den leader records completion in Scoutbook Plus.',
} as const;

/** Fill {placeholders} in a template. Unknown placeholders are left as they are. */
export function fillLine(template: string, vars: LineVars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = (vars as Record<string, string | number | undefined>)[key];
    return value === undefined ? whole : String(value);
  });
}

/** One Den Chief line, in the wording for `level`, with its placeholders filled. */
export function line(key: LineKey, level: LineLevel, vars: LineVars = {}): string {
  return fillLine(LINES[key][level], vars);
}
