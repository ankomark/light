// Group and community chats kept warm in the background, so opening one paints
// the newest messages at once — as if you never left — and the network only
// has to say what's new since.
//
// Two ways a chat learns something happened while you were elsewhere:
//  - live: the person's own socket tells about new messages in their groups
//    (up to 200 members); the new rows are fetched (`after` the newest held —
//    a few rows, not a page) and saved to that chat's cache;
//  - on start and on coming back to the app: the person's groups and
//    communities are listed, and any chat whose last message is newer than
//    what's held is caught up the same way (big communities aren't told live).
//
// Only the newest messages are kept per chat (GROUP_CACHE_SIZE); older history
// loads when scrolled to. A chat that's open does its own fetching.
import { AppState } from 'react-native';
import { subscribeDM } from './dmSocket';
import {
  fetchGroups, fetchCommunities, fetchGroupPosts, fetchGroupPostsAfter,
} from './api';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import {
  groupChatKey, cacheableGroupMessages, mergeMessages, freshPage, isTemp,
} from '../utils/groupChat';
import { isOnline } from '../hooks/useOnline';

const WARM_MAX = 8;              // chats per kind kept warm from the lists
const SOON_MS = 1500;            // a burst of messages is one fetch
const SWEEP_EVERY_MS = 60000;    // the lists aren't asked again sooner than this

// Chats on screen, counted: a chat opened over another (a sub-group) closing
// mustn't leave the one beneath unclaimed.
const openChats = new Map();
const isOpen = (slug) => (openChats.get(slug) || 0) > 0;
const SIGNED_OUT = 'signed-out';
let activeMe = null;             // whose chats are kept (SIGNED_OUT once stopped)
const timers = new Map();        // slug -> pending live catch-up
const busy = new Set();          // slugs being fetched
const again = new Set();         // told again while fetching: one more pass

/** The chat on screen (it fetches for itself); returns the "closed" call. */
export const setOpenGroupChat = (slug) => {
  openChats.set(slug, (openChats.get(slug) || 0) + 1);
  return () => {
    const n = (openChats.get(slug) || 1) - 1;
    if (n > 0) openChats.set(slug, n); else openChats.delete(slug);
  };
};

const newestId = (list) => {
  for (let i = (list?.length ?? 0) - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!isTemp(m) && typeof m.id === 'number') return m.id;
  }
  return null;
};

/**
 * Bring one chat's cache up to date: what's new after the newest message held,
 * or (nothing held, or too far behind) the newest page. Never throws.
 */
export async function catchUpChat(meId, slug, group = null) {
  if (!meId || !slug || isOpen(slug) || !isOnline()) return false;
  if (busy.has(slug)) { again.add(slug); return false; }
  busy.add(slug);
  try {
    const key = groupChatKey(meId, slug);
    const kept = peekCache(key) ?? (await readCache(key));
    const held = Array.isArray(kept?.messages) ? kept.messages : [];
    const newest = newestId(held);
    let messages = null;
    if (newest != null) {
      const res = await fetchGroupPostsAfter(slug, newest);
      if (!res?.has_more) {
        const newer = res?.results ?? [];
        if (!newer.length) return false;              // nothing new
        messages = mergeMessages(held, newer);
      }
    }
    if (!messages) {                                  // nothing held, or far behind
      const res = await fetchGroupPosts(slug, 1);
      messages = freshPage(held, (res?.results ?? []).slice().reverse());
    }
    // Opened meanwhile (that screen writes it itself), or signed out.
    if (isOpen(slug) || (activeMe != null && activeMe !== meId)) return false;
    writeCache(key, {
      ...(kept || {}),
      group: group || kept?.group || null,
      messages: cacheableGroupMessages(messages),
    });
    return true;
  } catch {
    return false;                                     // the chat fetches when opened
  } finally {
    busy.delete(slug);
    if (again.delete(slug) && activeMe === meId) soon(meId, slug);
  }
}

function soon(meId, slug) {
  clearTimeout(timers.get(slug));
  timers.set(slug, setTimeout(() => { timers.delete(slug); catchUpChat(meId, slug); }, SOON_MS));
}

/**
 * The rows of a list just loaded: catch up the chats (the first few the person
 * belongs to) whose last message is newer than what's held, or not held at all.
 */
export async function warmChats(rows, meId, max = WARM_MAX) {
  const mine = (rows || []).filter((g) => g?.is_member && g.slug).slice(0, max);
  for (const g of mine) {
    const key = groupChatKey(meId, g.slug);
    const kept = peekCache(key) ?? (await readCache(key));
    const held = newestId(kept?.messages);
    const last = g.last_message?.id;
    const behind = !kept?.messages?.length ? !!last : (typeof last === 'number' && last > (held ?? 0));
    // One at a time: a cold start shouldn't open eight requests at once.
    if (behind) await catchUpChat(meId, g.slug, g); // eslint-disable-line no-await-in-loop
  }
}

let lastSweep = 0;
async function sweep(meId) {
  if (!isOnline() || Date.now() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = Date.now();
  const lists = await Promise.all([
    fetchGroups({ scope: 'mine' }).catch(() => null),
    fetchCommunities({ scope: 'mine' }).catch(() => null),
  ]);
  for (const res of lists) {
    const rows = res?.results ?? (Array.isArray(res) ? res : []);
    await warmChats(rows, meId); // eslint-disable-line no-await-in-loop
  }
}

/**
 * Start keeping this person's chats warm; returns the stop. Called once
 * signed in (App), stopped on sign-out.
 */
export function startGroupChatSync(meId) {
  if (!meId) return () => {};
  activeMe = meId;
  const unsub = subscribeDM((e) => {
    if (e?.type === 'group_message' && e.group_slug && !isOpen(e.group_slug)) soon(meId, e.group_slug);
    // Back online after a drop: whatever was missed meanwhile.
    else if (e?.type === 'status' && e.open) sweep(meId);
  });
  const sub = AppState.addEventListener?.('change', (s) => { if (s === 'active') sweep(meId); });
  // A moment after start, so the first screen's own requests go first.
  const first = setTimeout(() => sweep(meId), 4000);
  return () => {
    unsub();
    sub?.remove?.();
    clearTimeout(first);
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    lastSweep = 0;
    if (activeMe === meId) activeMe = SIGNED_OUT;
  };
}

/** Tests: forget everything. */
export function _resetGroupChatSync() {
  timers.forEach((id) => clearTimeout(id));
  timers.clear();
  busy.clear();
  again.clear();
  openChats.clear();
  activeMe = null;
  lastSweep = 0;
}
