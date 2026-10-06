/**
 * Events and tickets, from the ticketing server (tickets.smartbillsolution.com).
 *
 * This file is the buyer's side: browse, pay with an M-Pesa prompt, keep the
 * tickets. A buyer has no account there — the order `reference` the server
 * returns is the key to their tickets, so it is kept in secure storage and
 * treated like a password (never logged, never sent anywhere else).
 *
 * Plain `fetch`, not the app's axios client: that client attaches the
 * Streams token, and this is a different server that has no use for it.
 *
 * The full reference is the server's own: /api/docs/ (OpenAPI at /api/schema/).
 * Conventions it fixes, and this file follows:
 * - errors are `{detail, errors: {field: [...]}}`; 429 carries Retry-After;
 * - lists are `{count, next, previous, results}`;
 * - money is whole Kenyan shillings; times are ISO 8601 with an offset.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as secure from './secureStorage';

const ORIGIN = 'https://tickets.smartbillsolution.com';
const BASE = `${ORIGIN}/api/v1`;

// A slow network should not leave a screen spinning forever. The order call
// waits on Safaricom's side before answering, so it gets longer.
const TIMEOUT_MS = 15000;
const ORDER_TIMEOUT_MS = 30000;

// How the waiting screen polls an order: every 3 s, for up to 2 minutes —
// the server settles any paid order within about that long.
export const POLL_MS = 3000;
export const POLL_LIMIT_MS = 2 * 60 * 1000;

// Per order, as the server allows.
export const MAX_QUANTITY = 10;

// So the server's logs can tell this app's builds apart.
const USER_AGENT = (() => {
  let version = '1.0.0';
  try { version = Constants?.expoConfig?.version || version; } catch { /* default */ }
  return `StreamsApp/${version} (${Platform.OS})`;
})();

/**
 * What every failed call throws. `message` is the server's own `detail` when
 * it sent one (it is written for buyers); `fields` maps a form field to its
 * first problem; `code` says what kind of failure it was, for the screens
 * that word it themselves.
 */
export class TicketsError extends Error {
  constructor(message, { status = 0, code = 'error', fields = {}, retryAfter = 0, body = null } = {}) {
    super(message);
    this.name = 'TicketsError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
    // The server's whole answer, for the calls where an error status still
    // carries facts (a ticket already used says when).
    this.body = body;
  }
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * One call to the ticketing server. `token` adds the organiser's Bearer
 * token (public calls send none); `form` sends multipart FormData instead of
 * JSON — only for a poster upload; `raw` returns the body as text (a CSV
 * export). Exported for services/ticketsOrganiser.js.
 */
export const request = async (path, { method = 'GET', body, form, token, raw, timeout = TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        // FormData sets its own multipart boundary; naming the type here
        // would drop it.
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form || (body ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch {
    throw new TicketsError('', { code: 'network' });
  } finally {
    clearTimeout(timer);
  }

  if (raw && res.ok) return res.text();
  let data = null;
  try { data = await res.json(); } catch { /* an empty or non-JSON body */ }
  if (res.ok) return data;

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers?.get?.('Retry-After'), 10) || 0;
    throw new TicketsError(data?.detail || '', { status: 429, code: 'rate_limited', retryAfter });
  }
  const fields = {};
  Object.entries(data?.errors || {}).forEach(([k, v]) => { fields[k] = firstOf(v); });
  throw new TicketsError(data?.detail || firstOf(Object.values(fields)) || '', {
    status: res.status,
    code: res.status === 404 ? 'not_found' : res.status >= 500 ? 'server' : 'invalid',
    fields,
    body: data,
  });
};

const query = (params) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

/**
 * Published events and fundraisers, soonest first. `kind`: 'event' or
 * 'fundraiser' (both when absent). `{count, next, previous, results}`
 */
export const fetchEvents = ({ search, city, page, kind, category } = {}) => (
  request(`public/events/${query({ search: search?.trim(), city, page, kind, category })}`)
);

/**
 * Who has paid in, newest first, when the organiser made the list public:
 * `{ name, phone, ticket_type, quantity, amount, paid_at }` — name and phone
 * (071****678) only for supporters who agreed; null for everyone else.
 */
export const fetchSupporters = (slug, page) => (
  request(`public/events/${encodeURIComponent(slug)}/supporters/${query({ page })}`)
);

/** One event with its ticket types (`id, name, price, remaining`). */
export const fetchEvent = (slug) => request(`public/events/${encodeURIComponent(slug)}/`);

/**
 * Sends the M-Pesa prompt to `phone`. Comes back `pending` at once; the
 * order is then polled until `paid`, `failed` or `expired`.
 */
export const createOrder = ({ ticketType, quantity, phone, name, showName = false, clientKey }) => request('public/orders/', {
  method: 'POST',
  timeout: ORDER_TIMEOUT_MS,
  body: {
    ticket_type: ticketType, quantity, phone: phone.trim(), show_name: !!showName,
    ...(name?.trim() ? { name: name.trim() } : {}),
    ...(clientKey ? { client_key: clientKey } : {}),
  },
});

/**
 * A one-time key for a checkout. Sent with the order and again on a retry:
 * the server answers a repeat with the same order, so a connection lost
 * while M-Pesa was prompting can be retried without a second charge - and
 * the buyer still gets the reference (their tickets).
 */
export const newCheckoutKey = () => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = `co-${Date.now().toString(36)}-`;
  for (let i = 0; i < 24; i += 1) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/**
 * Give to a fundraiser: any whole-shilling amount, the same M-Pesa prompt,
 * and a receipt instead of tickets. `showName`: the giver agreed to appear by
 * name on the public supporters list.
 */
export const createDonation = ({ slug, amount, phone, name, showName = false, clientKey }) => request('public/orders/', {
  method: 'POST',
  timeout: ORDER_TIMEOUT_MS,
  body: {
    fundraiser: slug, amount: Number(amount), phone: phone.trim(), show_name: !!showName,
    ...(name?.trim() ? { name: name.trim() } : {}),
    ...(clientKey ? { client_key: clientKey } : {}),
  },
});

// What a fundraiser offers as one tap when its organiser set none.
export const DEFAULT_SUGGESTED = [500, 1000, 2000, 5000];
export const MIN_GIFT = 10;
export const MAX_GIFT = 250000;

/** The order and, once paid, its tickets. */
export const fetchOrder = (reference) => request(`public/orders/${encodeURIComponent(reference)}/`);

/** Tickets on a new phone: the number that paid and the receipt from the SMS. */
export const lookupOrder = ({ phone, receipt }) => request('public/orders/lookup/', {
  method: 'POST',
  body: { phone: phone.trim(), mpesa_receipt: receipt.trim().toUpperCase() },
});

// ── Formatting ─────────────────────────────────────────────────────────────

/** 1500 → "KES 1,500". Whole shillings, as the server sends them. */
export const formatKes = (amount) => {
  const n = Math.round(Number(amount) || 0);
  return `KES ${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

/**
 * A Kenyan mobile number in any common shape ("0712 345 678", "+254712…",
 * "254712…", "712…") as 2547XXXXXXXX / 2541XXXXXXXX, or null when it is not
 * one. Only to check the field before sending; the server takes any format.
 */
export const normalizeKePhone = (input) => {
  const digits = String(input || '').replace(/[^\d]/g, '');
  const local = digits.startsWith('254') ? digits.slice(3)
    : digits.startsWith('0') ? digits.slice(1)
    : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * "Sat 14 Nov · 18:00" in the phone's own time, with day and month names
 * from strings.js (Hermes may not know Swahili's).
 */
export const formatWhen = (iso, { months, weekdays }) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${weekdays[d.getDay()] || ''} ${d.getDate()} ${months[d.getMonth()] || ''} · ${pad(d.getHours())}:${pad(d.getMinutes())}`.trim();
};

/** The day and month alone, for a date tile: `{ day: "14", month: "Nov" }`. */
export const dateTile = (iso, months) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? { day: '', month: '' } : { day: String(d.getDate()), month: months[d.getMonth()] || '' };
};

export const isPast = (iso, now = Date.now()) => {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < now;
};

// ── The buyer's orders, kept on the phone ─────────────────────────────────
//
// In secure storage (Keychain / Keystore): the references open the tickets,
// and the tickets' codes get people through the gate. Each order is its own
// entry, so no single value outgrows what the Keychain will hold.
//
// Kept per Streams account, never per phone: a ticket's code is as good as
// the ticket, so someone else signing in on the same phone must not see it.
// Tickets can be bought without signing in: those are the phone's "guest"
// list, kept apart from every account's (and an account's from it).

// Secure-store keys allow letters, digits, ".", "-" and "_".
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

const GUEST = '\u0000guest';         // no account id can be this
let owner = GUEST;                   // the signed-in account's id, as a string
const scope = () => (owner === GUEST ? 'guest' : `u${safe(owner)}`);
const refsKey = () => `tickets_refs_${scope()}`;
const orderKey = (reference) => `tickets_order_${scope()}_${safe(reference)}`;

let refsCache = null;                // { owner, refs: [reference] newest first }
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn());

// Before accounts: one list for the whole phone. Whose it was cannot be told,
// so it is dropped rather than shown to whoever signs in next. A paid order
// comes back through "Recover tickets" with the M-Pesa receipt.
const LEGACY_REFS = 'tickets_refs';
let legacyGone = null;
const forgetLegacy = () => {
  if (!legacyGone) {
    legacyGone = (async () => {
      try {
        const refs = JSON.parse((await secure.getItemAsync(LEGACY_REFS)) || '[]');
        for (const r of Array.isArray(refs) ? refs : []) {
          await secure.deleteItemAsync(`tickets_order_${safe(r)}`).catch(() => {});
        }
        await secure.deleteItemAsync(LEGACY_REFS);
        await secure.deleteItemAsync('tickets_buyer');
      } catch { /* nothing kept, or nothing to drop */ }
    })();
  }
  return legacyGone;
};

/**
 * Whose tickets this phone shows: the signed-in Streams account's id, or null
 * once they sign out (the guest list). Set by the auth provider; every
 * screen re-reads.
 */
export const setTicketOwner = (id) => {
  const next = id == null || id === '' ? GUEST : String(id);
  forgetLegacy();
  if (next === owner) return;
  owner = next;
  refsCache = null;
  announce();
};

// One write at a time, so two orders saved together cannot drop each other.
let queue = Promise.resolve();
const serial = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

const readRefs = async () => {
  if (refsCache?.owner === owner) return refsCache.refs;
  const whose = owner;
  let refs = [];
  try {
    const list = JSON.parse((await secure.getItemAsync(refsKey())) || '[]');
    refs = Array.isArray(list) ? list.filter((r) => typeof r === 'string') : [];
  } catch { /* none kept */ }
  // Signed out or switched while reading: these are not the new account's.
  if (whose !== owner) return readRefs();
  refsCache = { owner, refs };
  return refs;
};

/**
 * Keep a reference — called the moment an order is created, before anything
 * else, so a crash or a closed app cannot lose a paid ticket.
 */
export const saveReference = (reference) => serial(async () => {
  if (!reference) return;
  const refs = await readRefs();
  if (refs.includes(reference)) return;
  refsCache = { owner, refs: [reference, ...refs] };
  await secure.setItemAsync(refsKey(), JSON.stringify(refsCache.refs));
  announce();
});

/** Keep the latest copy of an order, so its tickets open with no network. */
export const cacheOrder = async (order) => {
  if (!order?.reference) return;
  await saveReference(order.reference);
  // When it was last heard of: how long a failed one has been kept.
  // Since when it has been as it is: kept across refreshes that bring no
  // change (a failed order is asked about for two days from when it failed,
  // not from its latest refresh).
  const before = await readCachedOrder(order.reference);
  const since = before && before.status === order.status && before.cached_at ? before.cached_at : null;
  const kept = { ...order, cached_at: since || order.cached_at || new Date().toISOString() };
  try { await secure.setItemAsync(orderKey(order.reference), JSON.stringify(kept)); } catch { /* best effort */ }
  announce();
};

/** The kept copy of an order, or null. */
export const readCachedOrder = async (reference) => {
  try {
    const raw = await secure.getItemAsync(orderKey(reference));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Every kept order, newest first: `[{ reference, order | null }]`. */
export const listSavedOrders = async () => {
  const refs = await readRefs();
  return Promise.all(refs.map(async (reference) => ({ reference, order: await readCachedOrder(reference) })));
};

/**
 * Ask again about every kept order that was still waiting for M-Pesa — the
 * app may have closed mid-wait — and about the rest, so a ticket scanned at
 * the gate shows as used. Never throws.
 */
// A failed or expired order is kept a week (so its screen can say what went
// wrong), then let go; one paid for an event long over isn't asked about
// again (nothing about it changes) but stays, as the buyer's record.
const DROP_UNPAID_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SETTLED_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const REFRESH_AT_ONCE = 4;

const LATE_MONEY_MS = 2 * 24 * 60 * 60 * 1000;

const stillChanging = (order, now) => {
  if (!order) return true;                                   // never fetched: ask
  if (order.status === 'pending') return true;
  // Failed or expired is not final at once: the server honours money that
  // arrives late (a slow M-Pesa), turning the order paid - so it is asked
  // about for two days, or the buyer would never see the tickets they paid for.
  if (order.status !== 'paid') {
    return now - Date.parse(order.cached_at || 0) < LATE_MONEY_MS;
  }
  const when = Date.parse(order.starts_at || '');
  return Number.isNaN(when) || now - when < SETTLED_AFTER_MS;   // a gate may yet scan it
};

const dropOldUnpaid = (saved, now) => serial(async () => {
  const gone = saved.filter(({ order }) => order && (order.status === 'failed' || order.status === 'expired')
    && now - Date.parse(order.cached_at || order.starts_at || 0) > DROP_UNPAID_AFTER_MS)
    .map(({ reference }) => reference);
  if (!gone.length) return;
  const refs = (await readRefs()).filter((r) => !gone.includes(r));
  refsCache = { owner, refs };
  await secure.setItemAsync(refsKey(), JSON.stringify(refs)).catch(() => {});
  await Promise.all(gone.map((r) => secure.deleteItemAsync(orderKey(r)).catch(() => {})));
  announce();
});

export const refreshSavedOrders = async (now = Date.now()) => {
  const saved = await listSavedOrders();
  await dropOldUnpaid(saved, now);
  // Only what can still change, a few at a time: one by one, every saved
  // order on every visit, was slow on a slow line and grew without end.
  const ask = saved.filter(({ order }) => stillChanging(order, now)).map(({ reference }) => reference);
  for (let i = 0; i < ask.length; i += REFRESH_AT_ONCE) {
    await Promise.all(ask.slice(i, i + REFRESH_AT_ONCE).map(async (reference) => {
      try { await cacheOrder(await fetchOrder(reference)); } catch { /* keep the copy we have */ }
    }));
  }
  return listSavedOrders();
};

/** The kept orders, re-read whenever one is saved or changes. */
export const useSavedOrders = () => {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => listSavedOrders().then((list) => { if (live) setOrders(list); });
    listeners.add(load);
    load();
    return () => { live = false; listeners.delete(load); };
  }, []);
  return orders;
};

// The details last paid with, so a second purchase is two taps. On the phone
// only, in secure storage, and per account like the orders.
const buyerKey = () => `tickets_buyer_${scope()}`;
export const readBuyer = async () => {
  try { return JSON.parse((await secure.getItemAsync(buyerKey())) || 'null') || {}; } catch { return {}; }
};
export const saveBuyer = async ({ phone, name }) => {
  try { await secure.setItemAsync(buyerKey(), JSON.stringify({ phone: phone || '', name: name || '' })); } catch { /* convenience only */ }
};

/** Tests only: forget what was read, as a fresh launch would, signed in as `who`. */
export const __resetTickets = (who = null) => {
  refsCache = null; queue = Promise.resolve(); owner = who == null ? GUEST : String(who); legacyGone = null;
};
