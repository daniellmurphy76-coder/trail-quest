# Trail Quest

A browser 3D RPG that helps Cub Scouts of every rank (Lion K, Tiger 1, Wolf 2, Bear 3, Webelos 4, Arrow of Light 5) learn the requirements of their rank adventures through quests and mini-games. The first players are a Wolf and an Arrow of Light. Personal project, public repo, deployed to GitHub Pages at https://daniellmurphy76-coder.github.io/trail-quest/.

Not affiliated with or endorsed by Scouting America. In-game approvals are not official sign-offs; den leaders record completion in Scoutbook Plus.

## Stack and commands

- Vite + TypeScript (strict) + Three.js. DOM-overlay UI in plain TypeScript, no UI framework. Vitest for tests.
- `npm run dev` | `npm run build` | `npm run preview` | `npm run test` | `npm run typecheck` | `npm run lint:content`
- **Acceptance for every change:** `npm run typecheck && npm run test && npm run build` all pass.
- Deploy: push to `main` runs `.github/workflows/deploy.yml`, which builds and publishes `dist/` to Pages. `vite.config.ts` sets `base: '/trail-quest/'`.
- Dev preview for the Claude browser tool: `.claude/launch.json`, configuration `dev`, port 5173.

## Architecture rules

1. **Content-driven.** Requirements live in `content/ranks/*.json` and validate against `content/schema/rank.schema.json`. Adding or changing a requirement is a JSON change, never a code change. Game code never hard-codes rank text.
2. **Activity catalog.** Every requirement maps to one activity type from `src/activities/types.ts`: `quiz`, `sequence`, `sort`, `collect`, `navigate`, `rhythm`, `craft`, `fieldMission`. A new mechanic is a new activity type with its own params interface, unit test, and test page under `src/activities/<type>/`.
3. **Field missions** are real-world tasks approved with a parent PIN. A field mission may carry an optional in-game `practice` activity. The PIN guards against accidental taps; it is not security.
4. **Save data** is local only: versioned JSON in `localStorage`, one record per profile, with export and import. No runtime network calls except static assets.
5. **No server, no accounts, no analytics, no third-party scripts, no cookies.**
6. Zones are keyed by adventure category: `base-camp` (hub), `fitness-field`, `nature-trail` (outdoors), `town-square` (citizenship), `safety-station`, `campfire-circle` (family and reverence).

## Core loop: Today's Trail

The game is built around a 3 to 5 minute daily session, Duolingo-style, not open-ended wandering. Free roam exists but is dessert, not dinner.

- **The Den Chief** is the main guide: an older Scout who helps the den, friendly and a little goofy, never a lecturer. The Den Chief waits at Base Camp, hands out Today's Trail, cheers each stop, and closes the session. Zone NPCs (ranger, firefighter, mayor, camp cook) are specialists the Den Chief introduces. The guide's display name is per profile; default "Den Chief".
- **Today's Trail** is three stops, each about a minute: **Warm-up** (a review item from something already learned, chosen by spaced repetition), **New step** (the next incomplete requirement in the active adventure), and **Field check** (confirm a pending field mission with the parent PIN, or hand out a new field mission card). When the three are done the Scout may **keep going**: the game plans the next set of stops, as many times as they like. The streak counts once a day; XP and progress keep accruing.
- **Teach before you test.** Every learnable requirement carries a `lesson`: two to six short Den Chief lines at the reading level, shown as dialogue pages before the activity. A quiz never appears without its lesson first; a review may offer "Remind me" instead.
- **Make your Scout.** The player is a blocky, customizable character (body, skin, hair, eyes, shirt, shorts or pants or skort, shoes, hat, glasses, backpack, neckerchief), chosen at setup and changeable any time. Never a gender field; offer looks, not labels.
- Every activity instance fits in 60 to 90 seconds: quizzes 2 or 3 questions, sequences 6 steps or fewer, collect targets within 20 seconds of walking. Walking between stops is capped at about 15 seconds; the trail map offers a one-tap hop to each zone.
- **Progress map:** the required adventures are laid out as a winding trail of stops, like a language-app path, so a kid can always see the next stop and what has been earned.
- **Motivation, kid version:** daily streak shown as a campfire that stays lit; XP; badges for completed adventures; cosmetics for the avatar and campsite. Earned "embers" keep the fire lit through a missed day. No penalties, no lives, no loss of progress, ever.
- **Spaced repetition:** knowledge activities (quiz, sequence, sort) re-enter the warm-up rotation on a simple Leitner schedule (1, 3, 7, 14 days). Field missions are never reviewed.
- Session end always says what was earned, shows the streak, and says goodbye. Reminders are a parent's job; the game never nags and has no notifications.
- **Rewards are earned by playing, never bought or timed.** Cosmetics unlock from badges, XP and streaks; locked tiles say how to earn them in kid words. Celebrations are short: a cheer, confetti on a badge, a toast for an unlock.
- **Sound is effects only, never voice.** Short synthesized sounds (soft tap, chime, gentle "not yet", fanfare) plus quiet ambience, all behind one mute button remembered per Scout. Audio starts only after a user gesture. Features talk through `src/game/events.ts`, not by importing each other.

## Players and reading level

- **Wolf profile, age 7 to 8.** Sentences of 10 words or fewer. Common one- and two-syllable words. Present tense, second person. One instruction per line.
- **Arrow of Light profile, age 10 to 11.** Sentences of 15 words or fewer. Scouting terms allowed with a plain definition on first use.
- **Vocabulary, not just sentence length.** Every kid-facing string (kidText, quiz prompts, choices and explanations, sequence steps, sort and craft labels, mission steps, Den Chief lines) uses words a kid of that age says out loud. Wolf: one- and two-syllable everyday words. Arrow of Light: everyday words a 10-year-old uses; never school-report words such as benefit, method, participate, demonstrate, appropriate, obtain, prior, sufficient, assess, individual, specific. Say "good thing" not "benefit", "join in" not "participate", "show" not "demonstrate", "right" not "appropriate", "enough" not "sufficient", "check" not "assess". A Scouting term (patrol, Code of Conduct, the SAFE checklist words) may appear only with a plain definition in the same text. `npm run lint:content` flags long or rare words in kid-facing strings; fix the wording rather than widening the allowlist, and add a Scouting term to the allowlist only when the content defines it.
- **No voice, ever.** No speech synthesis, no Read buttons, no read-aloud setting. Words appear in a dialogue box with a quick typewriter reveal that a tap or key press skips. Minimum type size 20px on laptop, 22px on iPad.
- No fail states, no death, no timers that end a quest. Retry is always free and friendly.
- Status is never color-only; pair color with an icon or a word.

## Platforms and input

- Targets: laptop Chrome/Edge with keyboard and mouse, and iPad Safari with touch. Gamepad is optional.
- Every interaction must work with keyboard, pointer, and touch. Touch gets a virtual joystick and one action button. No hover-only UI. Tap targets 44px or larger.
- iPad: audio and speech may start only after a user gesture. Test at Safari viewports 1024x768 and 1180x820. Viewport meta disables pinch zoom; `viewport-fit=cover`.
- Performance budget: 60 fps on an M1 iPad and a mid-range laptop, 150 draw calls or fewer per zone, instanced props, under 2 MB of glTF per zone.

## Content and licensing

- Scouting America owns requirement text and rank emblems. **Paraphrase; never paste requirement text verbatim.** Each adventure records its official source URL and fetch date.
- No Scouting America or BSA logos, rank emblems, or trademarks in art. Badge art is original.
- Models and audio are CC0 only (Kenney, Quaternius, CC0 sounds). Every asset appears in `CREDITS.md` with source URL and license.
- Code license: MIT.

## Repo layout

```
content/ranks/            one JSON file per rank (wolf.json, arrow-of-light.json)
content/schema/           JSON Schema for rank files
src/main.ts               entry point (thin; calls startApp)
src/game/                 app boot, world wiring, Today's Trail session, Den Chief lines, screens, parent mode
src/engine/               renderer, loop, input, assets, camera
src/world/                zones, terrain, props
src/player/               controller, animation
src/npc/                  guides, dialog
src/quests/               quest state machine driven by content JSON
src/activities/           activity catalog, one folder per type
src/ui/                   DOM overlay: HUD, dialog, quest log, badge book, parent mode
src/save/                 profiles, storage, migrations, export/import
src/audio/                music and sfx
public/assets/            models, audio, badges (CC0 or original)
tests/                    vitest
scripts/                  content lint, asset manifest
```

## Working agreements for agents

- Read this file and the relevant `types.ts` before writing code. Code to the contract. If a contract must change, say so in your report rather than silently editing it.
- Verify with typecheck, tests, build, and console or page text. Do not take screenshots unless asked.
- Report format: what you built (file list), how you verified it, anything unresolved. Under 20 lines. No file dumps.
- Do not `git commit` or `git push`; the orchestrator does. Do not download binary assets without approval.
- Personal project: do not pull in code, assets, or conventions from any work repository.
