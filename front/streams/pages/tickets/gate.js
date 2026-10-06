// The gate scanner's memory: every valid ticket for the event, kept on the
// phone so the gate keeps working when the network doesn't.
//
// The server is the final word (its check-in admits a ticket once, even with
// two gates scanning together). Offline, the phone decides from its own list
// and queues the check-in; when the network is back the queue goes to the
// server, and a ticket it says was already used — another gate let it in
// while this one was offline — is flagged for staff rather than hidden.
//
// Kept in AsyncStorage, per Streams account and event: a few thousand short
// rows. The codes admit people, so the list is filed under the signed-in
// account (another on the same phone never reads it), dropped with
// forgetGate, and with everything else when the organiser signs out.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchGateTickets, checkIn, organiserScope } from '../../services/ticketsOrganiser';
import { nextPage } from './TicketsHome';

const key = (eventId) => {
  const scope = organiserScope();
  return scope ? `tix:gate:${scope}:${eventId}` : null;
};
// The server's clock and the phone's may differ; sync from a little earlier
// than the last sync, so nothing issued in between is missed.
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

export const emptyGate = () => ({ tickets: {}, syncedAt: null, queue: [], flags: [] });

export const loadGate = async (eventId) => {
  const k = key(eventId);
  if (!k) return emptyGate();
  try {
    const raw = await AsyncStorage.getItem(k);
    const kept = raw ? JSON.parse(raw) : null;
    return kept?.tickets ? { ...emptyGate(), ...kept } : emptyGate();
  } catch {
    return emptyGate();
  }
};

export const saveGate = async (eventId, gate) => {
  const k = key(eventId);
  if (k) await AsyncStorage.setItem(k, JSON.stringify(gate)).catch(() => {});
};

export const forgetGate = async (eventId) => {
  const k = key(eventId);
  if (k) await AsyncStorage.removeItem(k).catch(() => {});
};

/** Admitted and total, from the list on the phone. */
export const gateCounts = (gate) => {
  const all = Object.values(gate.tickets);
  return { admitted: all.filter((t) => t.c).length, total: all.length };
};

/**
 * Bring the list up to date: everything the first time, then only what was
 * issued or checked in since the last sync. Throws when the server can't be
 * reached (the list on the phone stays as it was).
 */
export const syncGate = async (eventId, gate, now = Date.now()) => {
  const since = gate.syncedAt ? new Date(new Date(gate.syncedAt).getTime() - SYNC_OVERLAP_MS).toISOString() : null;
  const tickets = { ...gate.tickets };
  let page = null;
  let serverTime = null;
  do {
    const res = await fetchGateTickets(eventId, { since, page });
    // The server's clock, from the first page: the phone's (used before)
    // could run fast, and tickets bought just before a sync were then never
    // fetched - their holders turned away as "not a ticket".
    if (!serverTime && res.server_time) serverTime = res.server_time;
    (res.results || []).forEach((t) => {
      const mine = tickets[t.code];
      // A check-in made on this phone and not yet sent stays checked in.
      tickets[t.code] = { t: t.ticket_type, n: t.buyer_name, c: t.checked_in_at || mine?.c || null };
    });
    page = nextPage(res.next);
  } while (page);
  return { ...gate, tickets, syncedAt: serverTime || new Date(now).toISOString() };
};

/**
 * A scan with no network: decided from the list, the check-in queued.
 * `{ gate, outcome: { result: 'admitted_offline' | 'already_used' | 'unknown_offline', ticket } }`
 */
export const scanOffline = (gate, code, now = Date.now()) => {
  const ticket = gate.tickets[code];
  // Not on this phone's list - which may only be older than the ticket.
  // Online, the server would have said; offline, it can't be called invalid.
  if (!ticket) return { gate, outcome: { result: 'unknown_offline' } };
  if (ticket.c) return { gate, outcome: { result: 'already_used', ticket, checkedInAt: ticket.c } };
  const at = new Date(now).toISOString();
  return {
    gate: {
      ...gate,
      tickets: { ...gate.tickets, [code]: { ...ticket, c: at } },
      queue: [...gate.queue, { code, at }],
    },
    outcome: { result: 'admitted_offline', ticket },
  };
};

/** The server admitted (or refused) a scan: keep the list in step with it. */
export const recordOnline = (gate, code, result, now = Date.now()) => {
  const ticket = gate.tickets[code];
  if (!ticket || result.result === 'invalid') return gate;
  return { ...gate, tickets: { ...gate.tickets, [code]: { ...ticket, c: ticket.c || result.checked_in_at || new Date(now).toISOString() } } };
};

/**
 * Send queued check-ins. Admitted: done. Already used or not valid: someone
 * got in on a ticket another gate had already taken — flagged for staff.
 * Stops at the first network failure, keeping the rest for next time.
 */
export const flushQueue = async (eventId, gate) => {
  let next = gate;
  for (const item of gate.queue) {
    let result;
    try {
      result = await checkIn(eventId, item.code, item.at);
    } catch {
      break;
    }
    next = { ...next, queue: next.queue.filter((q) => q.code !== item.code) };
    if (result.result !== 'admitted') {
      const ticket = next.tickets[item.code];
      next = {
        ...next,
        flags: [...next.flags, {
          code: item.code, at: item.at, reason: result.result, earlier: result.checked_in_at || null,
          type: ticket?.t || '', name: ticket?.n || '',
        }],
      };
    }
  }
  return next;
};

/** A code as scanned or typed: the QR holds the ticket code and nothing else. */
export const cleanCode = (raw) => String(raw || '').trim();

/** The end of a code, enough for staff to tell tickets apart without showing it whole. */
export const codeTail = (code) => `…${String(code).slice(-6)}`;
