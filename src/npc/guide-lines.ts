/**
 * What the zone guides say, in the same two reading levels as the Den Chief (see
 * src/game/lines.ts): grade2 for Lion to Bear (sentences of 10 words or fewer, one- and two-syllable
 * everyday words) and grade5 for Webelos and Arrow of Light (15 words or fewer, everyday words).
 * A placeholder such as {name} counts as one word. tests/npc/guide-lines.test.ts checks every line.
 *
 * Guides are warm and a little playful and never lecture: a greeting, a line about the place, one
 * short tip. The tips are general good habits, never requirement text. The Den Chief stays the one
 * who starts the trail, so a guide only ever points the Scout back to camp.
 *
 * Placeholders a guide line may use: {name} (the Scout), {guide} (the Den Chief's name for this
 * Scout) and {role} (the guide's own role, filled in for you).
 */
import { fillLine, line, type LinePair, type LineLevel, type LineVars } from '../game/lines';
import { guideById, type GuideId } from './guide-types';

export interface GuideLineSet {
  /** Said when the Scout has already met this guide today. */
  greet: LinePair;
  /** Said the first time today. Mentions the Den Chief, who sent the Scout. */
  greetFirst: LinePair;
  /** What this place is for. */
  about: LinePair;
  /** Short tips. A talk gives one, and they take turns. */
  tips: readonly LinePair[];
  /** One line when the trail walks the Scout in, before the activity opens. They take turns too. */
  arrive: readonly LinePair[];
  /** Said while today's trail is still waiting with the Den Chief. */
  trailWaiting: LinePair;
  /** The goodbye, when there is nothing waiting. */
  bye: LinePair;
}

export const GUIDE_LINES: Readonly<Record<GuideId, GuideLineSet>> = {
  ranger: {
    greet: {
      grade2: 'Hi again, {name}! Nice day for a hike.',
      grade5: 'Hi again, {name}! It is a great day for a hike.',
    },
    greetFirst: {
      grade2: 'Hi {name}! {guide} said you were coming! I am the Ranger.',
      grade5: 'Hi {name}! {guide} said you were coming. I am the Ranger, and this is my trail.',
    },
    about: {
      grade2: 'This is the Nature Trail. Come here to learn about the outdoors.',
      grade5: 'This is the Nature Trail. Here you learn to enjoy the outdoors and take care of it.',
    },
    tips: [
      {
        grade2: 'Stay on the trail. It keeps plants safe.',
        grade5: 'Stay on the trail. It keeps plants and tiny animals safe.',
      },
      {
        grade2: 'Leave rocks and plants where you find them.',
        grade5: 'Leave rocks and plants where you find them. The next hiker wants to see them!',
      },
      {
        grade2: 'Walk slow and look close. You might spot a frog!',
        grade5: 'Walk slowly and look closely. You might spot a frog or a bird!',
      },
    ],
    arrive: [
      {
        grade2: 'Welcome to the trail, {name}!',
        grade5: 'Welcome to the trail, {name}! Keep your eyes open out here.',
      },
      {
        grade2: 'Hi {name}! Watch for frogs and birds.',
        grade5: 'Hi {name}! Watch for frogs and birds as you go.',
      },
    ],
    trailWaiting: {
      grade2: '{guide} is waiting with your trail. Want to head back to camp?',
      grade5: "{guide} is waiting with today's trail. Want to head back to camp?",
    },
    bye: {
      grade2: 'Happy trails, {name}!',
      grade5: 'Happy trails, {name}! Come say hi any time.',
    },
  },

  firefighter: {
    greet: {
      grade2: 'Hi again, {name}! Stay safe out there.',
      grade5: 'Hi again, {name}! Good to see you. Stay safe out there.',
    },
    greetFirst: {
      grade2: 'Hi {name}! {guide} said you were coming! I am the Firefighter.',
      grade5: 'Hi {name}! {guide} said you were coming. I am the Firefighter here.',
    },
    about: {
      grade2: 'This is the Safety Station. Here we learn to stay safe.',
      grade5: 'This is the Safety Station. Here you learn to stay safe and help when someone is hurt.',
    },
    tips: [
      {
        grade2: 'Stay with your buddy. Two are safer than one.',
        grade5: 'Stay with your buddy. Two sets of eyes are safer than one.',
      },
      {
        grade2: 'If a smoke alarm beeps, tell a grown-up fast.',
        grade5: 'If a smoke alarm beeps, get outside and tell a grown-up.',
      },
      {
        grade2: 'Feel unsure? Tell a grown-up you trust.',
        grade5: 'If something feels wrong, tell a grown-up you trust right away.',
      },
    ],
    arrive: [
      {
        grade2: 'Welcome to the Safety Station, {name}!',
        grade5: 'Welcome to the Safety Station, {name}!',
      },
      {
        grade2: 'Hi {name}! Safety first, then fun.',
        grade5: 'Hi {name}! Safety first, then fun. That is my rule.',
      },
    ],
    trailWaiting: {
      grade2: '{guide} has your trail ready at camp. Want to go there now?',
      grade5: "{guide} has today's trail ready at camp. Want to go there now?",
    },
    bye: {
      grade2: 'Stay safe, {name}! Come back soon.',
      grade5: 'Stay safe, {name}! Come back any time.',
    },
  },

  mayor: {
    greet: {
      grade2: 'Hello again, {name}! Our town is glad you came.',
      grade5: 'Hello again, {name}! Our town is lucky to have you.',
    },
    greetFirst: {
      grade2: 'Hi {name}! {guide} said you were coming! I am the Mayor.',
      grade5: 'Hi {name}! {guide} said you were coming. I am the Mayor of this town.',
    },
    about: {
      grade2: 'This is Town Square. Neighbors meet here and help each other.',
      grade5: 'This is Town Square. Neighbors meet here to share ideas and help each other.',
    },
    tips: [
      {
        grade2: 'Say hi to your neighbors. A smile goes far.',
        grade5: 'Say hello to your neighbors. A smile goes a long way.',
      },
      {
        grade2: 'Pick up litter when you see it. Clean towns are happy towns.',
        grade5: 'Pick up litter when you see it. Clean towns are happy towns.',
      },
      {
        grade2: 'Every voice counts. Speak up, and listen too.',
        grade5: 'Every voice counts in a town. Speak up, and listen to others too.',
      },
    ],
    arrive: [
      {
        grade2: 'Welcome to Town Square, {name}!',
        grade5: 'Welcome to Town Square, {name}!',
      },
      {
        grade2: 'Hello, {name}! Look at our busy town.',
        grade5: 'Hello, {name}! Look at our busy town. It is a good one!',
      },
    ],
    trailWaiting: {
      grade2: 'Your trail is waiting with {guide}. Want to go back to camp?',
      grade5: "Today's trail is waiting with {guide}. Want me to send you back to camp?",
    },
    bye: {
      grade2: 'Goodbye, {name}! Come see us again.',
      grade5: 'Goodbye, {name}! Come visit our town again soon.',
    },
  },

  'camp-cook': {
    greet: {
      grade2: 'Hi again, {name}! Come sit by the fire.',
      grade5: 'Hi again, {name}! Come sit by the fire and get cozy.',
    },
    greetFirst: {
      grade2: 'Hi {name}! {guide} said you were coming! I am the Camp Cook.',
      grade5: 'Hi {name}! {guide} said you were coming. I am the Camp Cook here.',
    },
    about: {
      grade2: 'This is Campfire Circle. It is a calm place for family and friends.',
      grade5: 'This is Campfire Circle. It is a calm place to talk, share, and think about what matters.',
    },
    tips: [
      {
        grade2: 'Say thank you. It makes people feel warm.',
        grade5: 'Say thank you often. Kind words feel as warm as a fire.',
      },
      {
        grade2: 'Share a story with your family. Stories bring us close.',
        grade5: 'Share a story with your family. A good story brings people close.',
      },
      {
        grade2: 'Take a quiet moment. Think of something you are thankful for.',
        grade5: 'Take a quiet moment. Think of something you are thankful for.',
      },
    ],
    arrive: [
      {
        grade2: 'Welcome, {name}! Pull up a log.',
        grade5: 'Welcome, {name}! Pull up a log and get cozy.',
      },
      {
        grade2: 'Hi {name}! Something smells good here.',
        grade5: 'Hi {name}! Something smells good over here.',
      },
    ],
    trailWaiting: {
      grade2: 'Your trail is waiting with {guide}. I will save your seat here!',
      grade5: 'Your trail is waiting with {guide}. Go on, and I will save your seat here!',
    },
    bye: {
      grade2: 'See you soon, {name}! Stay warm.',
      grade5: 'See you soon, {name}! Come back for a warm seat by the fire.',
    },
  },

  coach: {
    greet: {
      grade2: 'Hey again, {name}! Ready to move?',
      grade5: 'Hey again, {name}! Ready to get moving?',
    },
    greetFirst: {
      grade2: 'Hi {name}! {guide} said you were coming! I am the Coach.',
      grade5: 'Hi {name}! {guide} said you were coming. I am the Coach around here.',
    },
    about: {
      grade2: 'This is the Fitness Field. We run, stretch, and play here.',
      grade5: 'This is the Fitness Field. We run, stretch, and play games to get strong.',
    },
    tips: [
      {
        grade2: 'Stretch first. Warm muscles feel better.',
        grade5: 'Stretch first. Warm muscles work better.',
      },
      {
        grade2: 'Sip water. Moving makes you thirsty.',
        grade5: 'Sip water often. Moving makes you thirsty fast.',
      },
      {
        grade2: 'Sleep helps you grow. Rest is part of the plan.',
        grade5: 'Sleep helps your body grow strong. Rest is part of the plan.',
      },
    ],
    arrive: [
      {
        grade2: "Welcome to the field, {name}! Let's move.",
        grade5: "Welcome to the field, {name}! Let's get moving.",
      },
      {
        grade2: 'Hi {name}! Shake out your arms and legs.',
        grade5: 'Hi {name}! Shake out your arms and legs first.',
      },
    ],
    trailWaiting: {
      grade2: 'Your trail is waiting with {guide}. Want to run back to camp?',
      grade5: 'Your trail is waiting with {guide}. Ready to hustle back to camp?',
    },
    bye: {
      grade2: 'Good work, {name}! Keep moving!',
      grade5: 'Good work, {name}! Keep moving and have fun.',
    },
  },
};

/** Fill a guide's line for a level. {role} is always this guide's own role. */
export function guideLine(guide: GuideId, pair: LinePair, level: LineLevel, vars: LineVars = {}): string {
  return fillLine(pair[level], { role: guideById(guide).role, ...vars });
}

/** One page of a guide's speech: the words, and the buttons if the page asks something. */
export interface GuideTalkPage {
  text: string;
  /** One button per choice; the first one takes the Scout back to camp. Omit for a single "Next". */
  choices?: string[];
}

export interface GuideTalkOptions {
  level: LineLevel;
  vars: LineVars;
  /** True the first time today this Scout meets this guide. */
  firstToday: boolean;
  /** Which tip to give. Any whole number; the tips take turns. */
  tipIndex: number;
  /** True while today's trail is not finished: the last page points back to the Den Chief. */
  trailWaiting: boolean;
}

/**
 * The pages of a free-roam talk: greeting, what the place is for, one tip, then either the trail is
 * waiting at camp (with "Take me to camp" and "Look around") or a goodbye.
 */
export function guideTalkPages(guide: GuideId, options: GuideTalkOptions): GuideTalkPage[] {
  const set = GUIDE_LINES[guide];
  const { level, vars } = options;
  const say = (pair: LinePair): string => guideLine(guide, pair, level, vars);
  const tip = set.tips[((options.tipIndex % set.tips.length) + set.tips.length) % set.tips.length]!;
  const last: GuideTalkPage = options.trailWaiting
    ? { text: say(set.trailWaiting), choices: [line('choiceToCamp', level), line('choiceLookAround', level)] }
    : { text: say(set.bye) };
  return [{ text: say(options.firstToday ? set.greetFirst : set.greet) }, { text: say(set.about) }, { text: say(tip) }, last];
}

/** The one line a guide says when the trail walks the Scout in. The lines take turns by `index`. */
export function guideArrivalLine(guide: GuideId, level: LineLevel, vars: LineVars = {}, index = 0): string {
  const lines = GUIDE_LINES[guide].arrive;
  const pair = lines[((index % lines.length) + lines.length) % lines.length]!;
  return guideLine(guide, pair, level, vars);
}
