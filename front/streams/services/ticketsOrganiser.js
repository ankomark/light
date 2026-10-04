/**
 * The organiser's side of the ticketing server: an account, payout tills,
 * and events with their ticket levels.
 *
 * Organiser accounts belong to the ticketing server, not to Streams — a
 * separate email and password (prefilled from the Streams account where it
 * helps). The tokens it hands out live in secure storage only.
 *
 * Tokens, as the server's guide sets them:
 * - access lasts 30 minutes, refresh 30 days and ROTATES: every refresh
 *   returns a new refresh token and retires the old one;
 * - so only one refresh may run at a time. Requests that fail together wait
 *   on the same refresh; two refreshes with one token would log the user out;
 * - on a 401: refresh once, keep both new tokens, replay the request. If the
 *   refresh fails too, the session is over: tokens are cleared and callers get
 *   `code: 'signed_out'`, which the screens answer with the sign-in form.
 */
import * as secure from './secureStorage';
import { request, TicketsError } from './tickets';

const TOKENS_KEY = 'tickets_org_tokens';

let tokens;                 // undefined: not read yet; null: signed out
let refreshing = null;      // the one refresh in flight, shared

const readTokens = async () => {
  if (tokens !== undefined) return tokens;
  try {
    const raw = await secure.getItemAsync(TOKENS_KEY);
    const t = raw ? JSON.parse(raw) : null;
    tokens = t?.access && t?.refresh ? t : null;
  } catch {
    tokens = null;
  }
  return tokens;
};

const keepTokens = async (next) => {
  tokens = next?.access && next?.refresh ? { access: next.access, refresh: next.refresh } : null;
  try {
    if (tokens) await secure.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
    else await secure.deleteItemAsync?.(TOKENS_KEY);
  } catch { /* the in-memory copy still serves this session */ }
};

const signedOut = () => new TicketsError('', { status: 401, code: 'signed_out' });

const refresh = () => {
  if (!refreshing) {
    refreshing = (async () => {
      const current = await readTokens();
      if (!current) throw signedOut();
      try {
        const next = await request('auth/token/refresh/', { method: 'POST', body: { refresh: current.refresh } });
        await keepTokens({ access: next.access, refresh: next.refresh || current.refresh });
        return tokens.access;
      } catch (err) {
        // A refresh the server refused ends the session. One that never
        // reached it (no network) does not: the tokens may still be good.
        if (err?.code !== 'network') { await keepTokens(null); throw signedOut(); }
        throw err;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
};

/** A call as the signed-in organiser, refreshing once on a 401. */
const authed = async (path, options = {}) => {
  const current = await readTokens();
  if (!current) throw signedOut();
  // A refresh already under way: wait for its token rather than send a stale one.
  const access = refreshing ? await refresh() : current.access;
  try {
    return await request(path, { ...options, token: access });
  } catch (err) {
    if (err?.status !== 401) throw err;
    const fresh = await refresh();
    return request(path, { ...options, token: fresh });
  }
};

// ── Account ────────────────────────────────────────────────────────────────

/** Whether this phone holds an organiser session at all (no network needed). */
export const hasSession = async () => !!(await readTokens());

/**
 * The organiser signed in on this phone, or null when there is none (or it
 * has ended). Network failures throw, so a screen can tell "not signed in"
 * from "can't tell right now".
 */
export const fetchMe = async () => {
  if (!(await readTokens())) return null;
  try {
    return await authed('auth/me/');
  } catch (err) {
    if (err?.code === 'signed_out') return null;
    throw err;
  }
};

/** A new organiser account; signed in on success. */
export const signUp = async ({ email, password, displayName, phone }) => {
  const res = await request('auth/register/', {
    method: 'POST',
    body: {
      email: email.trim(),
      password,
      ...(displayName?.trim() ? { display_name: displayName.trim() } : {}),
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
    },
  });
  await keepTokens(res);
  return res.user;
};

export const logIn = async ({ email, password }) => {
  const res = await request('auth/login/', { method: 'POST', body: { email: email.trim(), password } });
  await keepTokens(res);
  return fetchMe();
};

/** Signed out on this phone even when the server cannot be told. */
export const logOut = async () => {
  const current = await readTokens();
  await keepTokens(null);
  if (current) request('auth/logout/', { method: 'POST', body: { refresh: current.refresh } }).catch(() => {});
};

/**
 * Whether a sign-up failure means the email already has an account — the
 * cue to offer Log in instead. Read from the field error, whatever its words.
 */
export const isEmailTaken = (err) => /exist|already|taken|registered/i.test(err?.fields?.email || '');

// ── Tills ─────────────────────────────────────────────────────────────────

/** The organiser's payout tills (`pending`, `submitted`, `active`, `rejected`). */
export const fetchTills = async () => (await authed('organiser/tills/?page_size=100')).results || [];

/** A new till starts `pending` until Skylink has Safaricom link it. */
export const createTill = ({ tillNumber, businessName }) => authed('organiser/tills/', {
  method: 'POST',
  body: { till_number: String(tillNumber).replace(/\s/g, ''), business_name: businessName.trim() },
});

// ── Events ────────────────────────────────────────────────────────────────

/**
 * A new event, a draft until published. With a poster it goes as multipart
 * (the field is `poster`: JPEG, PNG or WebP, at most 5 MB); without, as JSON.
 */
/**
 * An event's or a fundraiser's fields as the server takes them. A fundraiser
 * has no venue and may have no start (it opens when published); it has a
 * category, an optional goal and the amounts offered as one tap.
 */
const eventBody = (d) => {
  const fundraiser = d.kind === 'fundraiser';
  return {
    kind: fundraiser ? 'fundraiser' : 'event',
    title: d.title.trim(),
    description: (d.description || '').trim(),
    city: (d.city || '').trim(),
    ...(fundraiser ? {
      category: d.category,
      goal_amount: d.goal ? Number(d.goal) : null,
      suggested_amounts: (d.suggested || []).map(Number).filter((n) => n >= 10),
      ...(d.startsAt ? { starts_at: d.startsAt } : {}),
    } : {
      venue: (d.venue || '').trim(),
      starts_at: d.startsAt,
    }),
    ends_at: d.endsAt || null,
    sales_end_at: d.salesEndAt || null,
    show_supporters: !!d.showSupporters,
    show_total: !!d.showTotal,
    till: d.till,
  };
};

/**
 * A new event or fundraiser, a draft until published — as JSON. Its banner
 * and supporting document go up after, with uploadEventFiles: two calls, so
 * a failed upload on a phone can be tried again without making it twice.
 */
export const createEvent = (fields) => authed('organiser/events/', { method: 'POST', body: eventBody(fields) });

/** Change an event's fields. Clearing an optional date sends null. */
export const updateEvent = (id, fields) => authed(`organiser/events/${id}/`, { method: 'PATCH', body: eventBody(fields) });

/**
 * The banner (`poster`: a local JPEG) and/or a fundraiser's supporting
 * document (`document`: { uri, name, mimeType }), as multipart.
 */
export const uploadEventFiles = (id, { poster, document }) => {
  const form = new FormData();
  if (poster?.uri) form.append('poster', { uri: poster.uri, name: 'poster.jpg', type: 'image/jpeg' });
  if (document?.uri) {
    form.append('supporting_document', {
      uri: document.uri, name: document.name || 'document.pdf', type: document.mimeType || 'application/pdf',
    });
  }
  // An upload on mobile data takes longer than a JSON call.
  return authed(`organiser/events/${id}/`, { method: 'PATCH', form, timeout: 90000 });
};

/** Who sees the supporters list and the running total. Not reviewed: no content changes. */
export const updateVisibility = (id, { showSupporters, showTotal }) => authed(`organiser/events/${id}/`, {
  method: 'PATCH', body: { show_supporters: !!showSupporters, show_total: !!showTotal },
});

/** One ticket level: a name, its price in whole shillings, how many there are. */
export const addTicketType = (eventId, { name, price, quantity, position }) => authed(
  `organiser/events/${eventId}/ticket-types/`,
  { method: 'POST', body: { name: name.trim(), price: Number(price), quantity: Number(quantity), position } },
);

/** On sale. Refused (with a clear `detail`) until the till is active and a ticket type exists. */
export const publishEvent = (eventId) => authed(`organiser/events/${eventId}/publish/`, { method: 'POST' });

// ── Running events ────────────────────────────────────────────────────────

/** Totals across all the organiser's events: collected, sold, live, tills waiting. */
export const fetchOverview = () => authed('organiser/overview/');

/** The organiser's events, newest first (one page holds them all for now). */
export const fetchMyEvents = async () => (await authed('organiser/events/?page_size=100')).results || [];

export const fetchMyEvent = (id) => authed(`organiser/events/${id}/`);

/**
 * One event's dashboard: collected, tickets sold and left, checked in,
 * failed attempts, and sales per ticket type and per day.
 */
export const fetchEventSummary = (id) => authed(`organiser/events/${id}/summary/`);

/** Who paid, newest first: name, masked phone, type, amount, receipt. */
export const fetchPayments = (id, { search, page } = {}) => {
  const q = [search?.trim() && `search=${encodeURIComponent(search.trim())}`, page && `page=${page}`]
    .filter(Boolean).join('&');
  return authed(`organiser/events/${id}/payments/${q ? `?${q}` : ''}`);
};

/** Every payment as CSV text, for the phone's share sheet. */
export const exportPaymentsCsv = (id) => authed(`organiser/events/${id}/payments/export/`, { raw: true, timeout: 60000 });

/** Off sale, back to a draft. Everything sold stays sold. */
export const unpublishEvent = (id) => authed(`organiser/events/${id}/unpublish/`, { method: 'POST' });

/** Cancelled for good. Tickets already sold are not refunded by this. */
export const cancelEvent = (id) => authed(`organiser/events/${id}/cancel/`, { method: 'POST' });

/** Change a level: its name, its price (only before anyone buys), how many (never below sold). */
export const updateTicketType = (eventId, typeId, patch) => authed(
  `organiser/events/${eventId}/ticket-types/${typeId}/`, { method: 'PATCH', body: patch },
);

/** Remove a level nobody has bought. */
export const deleteTicketType = (eventId, typeId) => authed(
  `organiser/events/${eventId}/ticket-types/${typeId}/`, { method: 'DELETE' },
);

// ── At the gate ───────────────────────────────────────────────────────────

/**
 * The event's valid tickets, a page at a time (up to 500), for the scanner
 * to keep: `{ code, ticket_type, buyer_name, checked_in_at }`. `since`: only
 * tickets issued or checked in after that ISO time.
 */
export const fetchGateTickets = (id, { since, page } = {}) => {
  const q = ['page_size=500', since && `since=${encodeURIComponent(since)}`, page && `page=${page}`]
    .filter(Boolean).join('&');
  return authed(`organiser/events/${id}/tickets/?${q}`);
};

/**
 * Check a ticket in. Resolves `{ result: 'admitted' | 'already_used' |
 * 'invalid', ... }` for all three: 409 and 404 are answers here, not errors.
 */
export const checkIn = async (id, code) => {
  try {
    return await authed(`organiser/events/${id}/checkin/`, { method: 'POST', body: { code } });
  } catch (err) {
    if (err?.status === 409) return { result: 'already_used', ...(err.body || {}) };
    if (err?.status === 404 && err?.body?.result === 'invalid') return { result: 'invalid', ...err.body };
    throw err;
  }
};

/** Tests only: forget the session read, as a fresh launch would. */
export const __resetOrganiser = () => { tokens = undefined; refreshing = null; };
