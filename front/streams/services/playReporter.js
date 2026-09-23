// Sends listens to the server (POST /tracks/plays/) without ever getting in
// the way of playback.
//
// Every report lands in an outbox first — memory plus disk, per account — and
// is sent in batches a moment later. A report that fails (no signal, a
// downloaded song played offline, the server down) stays in the outbox and
// goes with the next batch: when another report comes in, when the phone
// reconnects, or when the app comes back to the foreground. The server dedupes
// on play_id, so sending the same listen twice is harmless.
//
// The outbox lives in the screen cache, so logging out clears it with
// everything else of that account's.
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { postPlays } from './api';
import { readCache, writeCache, userKey } from '../utils/screenCache';
import { mergeEvents } from '../utils/listenTracker';

const BATCH = 50;
const MAX_OUTBOX = 500;
const FLUSH_DELAY_MS = 1500;
const RETRY_MS = [15000, 60000, 300000];
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

let userId = null;
let outbox = new Map();      // play_id -> event
let loaded = null;           // Promise for the disk copy of this account's outbox
let timer = null;
let flushing = false;
let failures = 0;
let network = '';
let listening = false;

const key = () => userKey(userId, 'plays:outbox');

const persist = () => {
  if (userId == null) return;
  writeCache(key(), Array.from(outbox.values()));
};

const schedule = (ms) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(); }, ms);
};

function listen() {
  if (listening) return;
  listening = true;
  try {
    NetInfo.addEventListener((state) => {
      network = state?.type === 'wifi' ? 'wifi' : state?.type === 'cellular' ? 'cellular' : (state?.type || '');
      if (state?.isConnected && outbox.size) schedule(FLUSH_DELAY_MS);
    });
  } catch { /* no NetInfo (tests / web): reports still go on the timer */ }
  AppState.addEventListener?.('change', (s) => {
    if (s === 'active' && outbox.size) schedule(FLUSH_DELAY_MS);
  });
}

/** The connection type for the report ('wifi' | 'cellular' | ...). */
export const currentNetwork = () => network;

/** Switch the outbox to the signed-in account (null when signed out). */
export function setReporterUser(id) {
  const next = id ?? null;
  if (next === userId) return;
  userId = next;
  outbox = new Map();
  failures = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  if (userId == null) { loaded = null; return; }
  listen();
  const forUser = userId;
  loaded = readCache(key(), KEEP_MS).then((saved) => {
    if (forUser !== userId || !Array.isArray(saved)) return;
    for (const ev of saved) {
      if (ev?.play_id) outbox.set(ev.play_id, mergeEvents(outbox.get(ev.play_id), ev));
    }
    if (outbox.size) schedule(FLUSH_DELAY_MS);
  });
}

/** Queue one listen report (merged with any unsent one for the same listen). */
export function reportPlay(event) {
  if (userId == null || !event?.play_id) return;
  outbox.set(event.play_id, mergeEvents(outbox.get(event.play_id), event));
  if (outbox.size > MAX_OUTBOX) {
    // Oldest first out: a phone offline for weeks keeps its latest listens.
    const drop = outbox.size - MAX_OUTBOX;
    Array.from(outbox.keys()).slice(0, drop).forEach((k) => outbox.delete(k));
  }
  persist();
  schedule(FLUSH_DELAY_MS);
}

async function flush() {
  if (flushing || userId == null || !outbox.size) return;
  flushing = true;
  const forUser = userId;
  try {
    await loaded;
    const batch = Array.from(outbox.values()).slice(0, BATCH);
    await postPlays(batch);
    if (forUser !== userId) return;
    // Drop what was sent — unless it was updated while in flight (a listen
    // that ended meanwhile), which goes with the next batch.
    for (const ev of batch) {
      if (outbox.get(ev.play_id) === ev) outbox.delete(ev.play_id);
    }
    failures = 0;
    persist();
    if (outbox.size) schedule(FLUSH_DELAY_MS);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 400) {
      // The server can't read this batch; retrying won't change that.
      outbox = new Map();
      persist();
    } else {
      schedule(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
      failures += 1;
    }
  } finally {
    flushing = false;
  }
}

/** Send what's waiting now (e.g. before the app goes to the background). */
export const flushPlays = () => flush();
