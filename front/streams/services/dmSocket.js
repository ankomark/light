// Direct messages, live: one socket per signed-in person (`ws/dm/`), shared
// by every screen that listens — the inbox, an open chat, the unread badge.
// It opens with the first listener and closes with the last. REST stays the
// source of truth; the socket only tells (new message, edited, deleted,
// reaction, read, typing, presence), so screens poll slowly while it's open
// and quickly while it isn't.
import { createSocket } from './groupSocket';

let socket = null;
let open = false;
const listeners = new Set();

const emit = (evt) => {
  listeners.forEach((fn) => { try { fn(evt); } catch { /* one screen's bug isn't another's */ } });
};

/**
 * Listen to DM events: fn({type, ...}). Also gets {type: 'status', open}
 * when the socket opens or drops. Returns the unsubscribe.
 */
export function subscribeDM(fn) {
  listeners.add(fn);
  if (!socket) {
    socket = createSocket('ws/dm/', {
      onEvent: emit,
      onStatus: (s) => { open = s === 'open'; emit({ type: 'status', open }); },
    });
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && socket) {
      socket.close();
      socket = null;
      open = false;
    }
  };
}

/** Is the live socket up (so polling can slow down)? */
export const isDMOpen = () => open;

/** Tell the other person in this chat I'm typing (or stopped). */
export function sendDMTyping(conversationId, isTyping) {
  return socket ? socket.send({ type: 'typing', conversation_id: conversationId, is_typing: !!isTyping }) : false;
}

/** Tell this device's screens something that happened here (I read a chat,
 * I sent, I muted) — the server only tells the other side. */
export const announceDM = (evt) => emit(evt);

/** Tests: forget everything. */
export function _resetDMSocket() {
  if (socket) socket.close();
  socket = null;
  open = false;
  listeners.clear();
}
