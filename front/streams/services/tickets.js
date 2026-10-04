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
  constructor(message, { status = 0, code = 'error', fields = {}, retryAfter = 0 } = {}) {
    super(message);
    this.name = 'TicketsError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * One call to the ticketing server. `token` adds the organiser's Bearer
 * token (public calls send none); `form` sends multipart FormData instead of
 * JSON — only for a poster upload. Exported for services/ticketsOrganiser.js.
 */
export const request = async (path, { method = 'GET', body, form, token, timeout = TIMEOUT_MS } = {}) => {
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
  });
};

const query = (params) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

/** Published events, soonest first. `{count, next, previous, results}` */
export const fetchEvents = ({ search, city, page } = {}) => (
  request(`public/events/${query({ search: search?.trim(), city, page })}`)
);

/** One event with its ticket types (`id, name, price, remaining`). */
export const fetchEvent = (slug) => request(`public/events/${encodeURIComponent(slug)}/`);

/**
 * Sends the M-Pesa prompt to `phone`. Comes back `pending` at once; the
 * order is then polled until `paid`, `failed` or `expired`.
 */
export const createOrder = ({ ticketType, quantity, phone, name }) => request('public/orders/', {
  method: 'POST',
  timeout: ORDER_TIMEOUT_MS,
  body: { ticket_type: ticketType, quantity, phone: phone.trim(), ...(name?.trim() ? { name: name.trim() } : {}) },
});

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

const REFS_KEY = 'tickets_refs';
// Secure-store keys allow letters, digits, ".", "-" and "_".
const orderKey = (reference) => `tickets_order_${String(reference).replace(/[^A-Za-z0-9._-]/g, '_')}`;

let refsCache = null;                // [reference], newest first
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn());

// One write at a time, so two orders saved together cannot drop each other.
let queue = Promise.resolve();
const serial = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

const readRefs = async () => {
  if (refsCache) return refsCache;
  try {
    const raw = await secure.getItemAsync(REFS_KEY);
    const list = JSON.parse(raw || '[]');
    refsCache = Array.isArray(list) ? list.filter((r) => typeof r === 'string') : [];
  } catch {
    refsCache = [];
  }
  return refsCache;
};

/**
 * Keep a reference — called the moment an order is created, before anything
 * else, so a crash or a closed app cannot lose a paid ticket.
 */
export const saveReference = (reference) => serial(async () => {
  if (!reference) return;
  const refs = await readRefs();
  if (refs.includes(reference)) return;
  refsCache = [reference, ...refs];
  await secure.setItemAsync(REFS_KEY, JSON.stringify(refsCache));
  announce();
});

/** Keep the latest copy of an order, so its tickets open with no network. */
export const cacheOrder = async (order) => {
  if (!order?.reference) return;
  await saveReference(order.reference);
  try { await secure.setItemAsync(orderKey(order.reference), JSON.stringify(order)); } catch { /* best effort */ }
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
export const refreshSavedOrders = async () => {
  const saved = await listSavedOrders();
  for (const { reference } of saved) {
    try { await cacheOrder(await fetchOrder(reference)); } catch { /* keep the copy we have */ }
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
// only, in secure storage, like everything else here.
const BUYER_KEY = 'tickets_buyer';
export const readBuyer = async () => {
  try { return JSON.parse((await secure.getItemAsync(BUYER_KEY)) || 'null') || {}; } catch { return {}; }
};
export const saveBuyer = async ({ phone, name }) => {
  try { await secure.setItemAsync(BUYER_KEY, JSON.stringify({ phone: phone || '', name: name || '' })); } catch { /* convenience only */ }
};

/** Tests only: forget what was read, as a fresh launch would. */
export const __resetTickets = () => { refsCache = null; queue = Promise.resolve(); };
