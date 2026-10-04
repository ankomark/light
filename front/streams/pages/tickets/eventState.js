// Where an organiser's event stands, in one word they can act on.
//
// Three things decide whether an event sells, and they come from three
// people (the ticketing server's events/review.py): the organiser asked for
// it (`publish_requested`), Skylink approved it (`review_status`), and its
// till is linked (`till_status`). This folds them into one state, with the
// one thing to do next, so the organiser never has to work it out. Skylink
// can also pause an event or remove it for good; both outrank the rest.

/** True once the event is over (its end, or its start when it has none). */
export const isOver = (event, now = Date.now()) => {
  const end = new Date(event?.ends_at || event?.starts_at).getTime();
  return !Number.isNaN(end) && end < now;
};

/**
 * `{ key, tone, action }`:
 * - key: a strings key under tix.mine.state.* (and .body)
 * - tone: for the pill — paid (good), pending (waiting), failed (needs you), closed (quiet)
 * - action: what the main button does — 'publish' | 'unpublish' | 'edit' | null
 */
export const eventState = (event, now = Date.now()) => {
  if (!event) return { key: 'draft', tone: 'closed', action: null };
  if (event.removed_at) return { key: 'removed', tone: 'failed', action: null };
  if (event.status === 'cancelled') return { key: 'cancelled', tone: 'closed', action: null };
  if (isOver(event, now)) return { key: 'ended', tone: 'closed', action: null };
  if (event.paused_by_staff) return { key: 'paused', tone: 'failed', action: null };
  if (event.status === 'published') return { key: 'onSale', tone: 'paid', action: 'unpublish' };
  if (event.review_status === 'rejected') return { key: 'rejected', tone: 'failed', action: 'edit' };
  if (event.review_status === 'pending') return { key: 'inReview', tone: 'pending', action: null };
  if (event.review_status === 'approved') {
    if (!event.publish_requested) return { key: 'approved', tone: 'pending', action: 'publish' };
    if (event.till_status === 'rejected') return { key: 'tillRejected', tone: 'failed', action: null };
    return { key: 'waitingTill', tone: 'pending', action: null };
  }
  return { key: 'draft', tone: 'closed', action: 'publish' };
};

// The order of the list: what needs the organiser first, what's over last.
const GROUP_OF = {
  rejected: 'attention', tillRejected: 'attention', paused: 'attention',
  onSale: 'live',
  inReview: 'waiting', waitingTill: 'waiting', approved: 'waiting',
  draft: 'drafts',
  ended: 'past', cancelled: 'past', removed: 'past',
};
export const GROUPS = ['attention', 'live', 'waiting', 'drafts', 'past'];

/** `[{ key, data }]` in GROUPS order; within a group, soonest first (past: latest first). */
export const groupEvents = (events, now = Date.now()) => {
  const by = {};
  (events || []).forEach((e) => {
    const g = GROUP_OF[eventState(e, now).key];
    (by[g] = by[g] || []).push(e);
  });
  const time = (e) => new Date(e.starts_at).getTime() || 0;
  return GROUPS.filter((g) => by[g]?.length).map((g) => ({
    key: g,
    data: by[g].sort((a, b) => (g === 'past' ? time(b) - time(a) : time(a) - time(b))),
  }));
};

/** Skylink's words for the state it is in, if any: why it was rejected, paused or removed. */
export const staffNote = (event, key) => ({
  rejected: event?.review_note, paused: event?.pause_note, removed: event?.removed_note,
}[key] || '');

/** Sold and capacity across an event's levels. */
export const soldOf = (event) => (event?.ticket_types || []).reduce(
  (acc, tt) => ({ sold: acc.sold + (tt.sold || 0), quantity: acc.quantity + (tt.quantity || 0) }),
  { sold: 0, quantity: 0 },
);
