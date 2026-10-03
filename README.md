# Trail Quest

Trail Quest is a browser 3D adventure for two Cub Scouts, a Wolf and an Arrow of Light. Players explore camp zones, talk to guides, and play small mini-games that teach the requirements of their rank adventures. Real-world tasks are approved by a parent, and everything saves locally in the browser.

**Play:** https://daniellmurphy76-coder.github.io/trail-quest/

Not affiliated with or endorsed by Scouting America. In-game approvals are not official sign-offs; den leaders record completion in Scoutbook Plus.

## Local dev

```
npm install
npm run dev          # http://127.0.0.1:5173
npm run typecheck
npm run lint:content
npm test
npm run build
npm run preview
```

## How content works

Requirements are data, not code. Each rank is one JSON file in `content/ranks/`, validated against `content/schema/rank.schema.json` by `npm run lint:content`. Every requirement names one activity type and its params, which are defined in `src/activities/types.ts`. Adding or changing a requirement is a JSON change. Requirement text is paraphrased, never copied.

## License and credits

Code is MIT: see [LICENSE](LICENSE). Asset sources and licenses are listed in [CREDITS.md](CREDITS.md).
