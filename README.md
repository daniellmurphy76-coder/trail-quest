# Trail Quest

Trail Quest is a browser 3D game for two Cub Scouts, a Wolf and an Arrow of Light. A friendly Den Chief hands out a short daily trail of three stops that teach the requirements of their rank adventures through small mini-games. Real-world tasks become "field missions" that a parent approves with a PIN. Everything saves locally in the browser; there is no server, no account, and no tracking.

**Play:** https://daniellmurphy76-coder.github.io/trail-quest/ (laptop keyboard or iPad touch)

Not affiliated with or endorsed by Scouting America. In-game approvals are not official sign-offs; den leaders record completion in Scoutbook Plus.

## How a day works

1. Pick your Scout and walk to the Den Chief at Base Camp.
2. **Today's Trail** is three stops, about a minute each: a **warm-up** review of something already learned, a **new step** from the current adventure, and a **field check** that hands out or confirms a real-world mission.
3. Each stop is one activity: a quiz, putting steps in order, sorting into bins, tapping to a beat, packing the right items, or a field mission card.
4. The session ends with XP, badges for finished adventures, and a campfire streak. Missing a day never loses progress.

Parents open **Parent mode** from the Scout picker or the Trail panel to approve field missions, see every requirement's status, export or import the save file, and change the PIN.

## Local dev

```
npm install
npm run dev          # http://127.0.0.1:5173/trail-quest/
npm run typecheck
npm run lint:content
npm test
npm run build
npm run preview
```

The activity harness at `/trail-quest/dev/activities.html` runs each activity with sample data outside the game. In dev mode, `?today=YYYY-MM-DD` on the game URL overrides the date for streak testing.

## How content works

Requirements are data, not code. Each rank is one JSON file in `content/ranks/`, validated against `content/schema/rank.schema.json` by `npm run lint:content`. Every requirement names one activity type and its params, defined in `src/activities/types.ts`; a field mission may also carry a `practice` activity that the kid learns in-game before doing the real thing. Requirement text is paraphrased, never copied, and each adventure links to its official source page.

## License and credits

Code is MIT: see [LICENSE](LICENSE). Asset sources and licenses are listed in [CREDITS.md](CREDITS.md).
