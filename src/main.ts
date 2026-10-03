import './style.css';
import { startApp } from './game/app';
import { clearSavedGame, parseDevFlags, withoutParam } from './game/dev-flags';

// Dev only: ?today=YYYY-MM-DD pins the date, so streaks can be tested without waiting a day.
// ?reset=1 clears the save and reloads without the flag.
const flags = parseDevFlags(window.location.search, import.meta.env.DEV);

if (flags.reset) {
  try {
    clearSavedGame(window.localStorage);
  } catch {
    // Blocked storage: there is no save to clear.
  }
  window.location.replace(withoutParam(window.location.href, 'reset'));
} else {
  const app = startApp({ today: flags.today });

  // Dev-only handle so the browser tools can read draw calls, drive the player and the session.
  if (import.meta.env.DEV) {
    const handle = { ...app.world, app };
    Object.defineProperty(handle, 'session', { get: () => app.session, enumerable: true });
    Object.defineProperty(handle, 'idleSeconds', { get: () => app.world.idleSeconds, enumerable: true });
    Object.assign(window, { __tq: handle });
  }
}
