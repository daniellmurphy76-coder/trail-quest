import './style.css';
import { startApp } from './game/app';
import { isYmd } from './quests/dates';

// Dev only: ?today=YYYY-MM-DD pins the date, so streaks can be tested without waiting a day.
const pinned = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('today') : null;
const app = startApp({ today: pinned !== null && isYmd(pinned) ? pinned : undefined });

// Dev-only handle so the browser tools can read draw calls, drive the player and the session.
if (import.meta.env.DEV) {
  const handle = { ...app.world, app };
  Object.defineProperty(handle, 'session', { get: () => app.session, enumerable: true });
  Object.assign(window, { __tq: handle });
}
