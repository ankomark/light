// A tiny app-wide event bus for "something changed elsewhere" signals that
// don't belong in React state — e.g. a background upload finishing while the
// feed is mounted three screens away. Listeners get the payload; `on` returns
// the unsubscribe function, so it drops straight into a useEffect cleanup.
const listeners = new Map();

export const on = (event, fn) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
};

export const emit = (event, payload) => {
  const set = listeners.get(event);
  if (!set) return;
  // Copy first: a listener that unsubscribes mid-emit must not skip a sibling.
  [...set].forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[appEvents] "${event}" listener failed`, e);
    }
  });
};

export const EVENTS = {
  POST_CREATED: 'post:created',
  TRACK_CREATED: 'track:created',
};
