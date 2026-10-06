// Realtime group chat over WebSockets (Django Channels backend).
//
// REST is still the source of truth for sending/reading; this socket is the
// realtime fan-out: new messages, deletions, typing, and presence arrive here
// instantly instead of on the fallback poll. Auto-reconnects with backoff and
// authenticates by passing the JWT as a ?token= query param (RN can't set WS
// headers).
import { AppState } from 'react-native';
import { API_BASE, getAccessToken, refreshAccessToken } from './api';
import { onOnlineChange } from '../hooks/useOnline';

// Turned away for good (not a member, banned): asking again can't help.
const FORBIDDEN = 4403;
// Turned away for the sign-in: a fresh token first, then again.
const UNAUTHORIZED = 4401;
// Back from the background after this long: a fresh connection. A socket
// the phone suspended often never says it closed, and the app would wait on
// a dead line (messages arriving only at the slow catch-up poll).
const STALE_AFTER_MS = 10000;

// http(s)://host → ws(s)://host
const wsBase = () => API_BASE.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);

/**
 * Open a managed realtime socket for a given ws path (e.g. `ws/groups/<slug>/`).
 * Returns { sendTyping, close }. Handlers: onMessage(msg), onDeleted(id),
 * onEdited(msg), onPinned(evt), onTyping(evt), onPresence(evt),
 * onStatus('open'|'closed'). Auto-reconnects with backoff; auth via ?token=.
 */
export function createSocket(path, handlers = {}) {
  let ws = null;
  let closedByUs = false;
  let retry = 0;
  let reconnectTimer = null;
  let refreshNext = false;
  let backgroundAt = 0;

  const scheduleReconnect = () => {
    if (closedByUs) return;
    clearTimeout(reconnectTimer);
    const delay = Math.min(1000 * 2 ** retry, 15000); // 1s → 15s cap
    retry += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  async function connect() {
    if (closedByUs) return;
    let token;
    if (refreshNext) {
      refreshNext = false;
      try {
        token = await refreshAccessToken();
      } catch (e) {
        // Turned down by the server: signed out - nothing to reconnect to.
        if (e?.response) return;
        token = await getAccessToken();
      }
    } else {
      token = await getAccessToken();
    }
    // Closed while the token was being read: open nothing (it would be an
    // orphan, keeping them "online" and reconnecting for ever).
    if (closedByUs) return;
    if (!token) { scheduleReconnect(); return; }
    try {
      ws = new WebSocket(`${wsBase()}/${path}?token=${encodeURIComponent(token)}`);
    } catch {
      scheduleReconnect();
      return;
    }
    const mine = ws;
    ws.onopen = () => { retry = 0; handlers.onStatus?.('open'); };
    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      handlers.onEvent?.(data);
      switch (data.type) {
        case 'message': handlers.onMessage?.(data.message); break;
        case 'edited': handlers.onEdited?.(data.message); break;
        case 'deleted': handlers.onDeleted?.(data.id); break;
        case 'pinned': handlers.onPinned?.(data); break;
        case 'typing': handlers.onTyping?.(data); break;
        case 'presence': handlers.onPresence?.(data); break;
        default: break;
      }
    };
    ws.onclose = (e) => {
      if (ws !== mine) return;          // an old socket, replaced already
      handlers.onStatus?.('closed');
      if (closedByUs || e?.code === FORBIDDEN) return;
      if (e?.code === UNAUTHORIZED) refreshNext = true;
      scheduleReconnect();
    };
    ws.onerror = () => { try { mine.close(); } catch { /* noop */ } };
  }

  // Start again at once (not at the end of a back-off): the network came
  // back, or the app came back from a while away.
  const reconnectNow = () => {
    if (closedByUs) return;
    clearTimeout(reconnectTimer);
    retry = 0;
    const old = ws;
    ws = null;
    if (old) {
      old.onclose = null;
      old.onerror = null;
      try { old.close(); } catch { /* noop */ }
      handlers.onStatus?.('closed');
    }
    connect();
  };

  const appSub = AppState.addEventListener?.('change', (state) => {
    if (state === 'active') {
      if (backgroundAt && Date.now() - backgroundAt > STALE_AFTER_MS) reconnectNow();
      backgroundAt = 0;
    } else if (!backgroundAt) {
      backgroundAt = Date.now();
    }
  });
  const offOnline = onOnlineChange((online) => {
    if (online && !(ws && ws.readyState === 1)) reconnectNow();
  });

  const send = (obj) => {
    if (ws && ws.readyState === 1 /* OPEN */) {
      try { ws.send(JSON.stringify(obj)); return true; } catch { /* noop */ }
    }
    return false;
  };

  const sendTyping = (isTyping) => {
    if (ws && ws.readyState === 1 /* OPEN */) {
      try { ws.send(JSON.stringify({ type: 'typing', is_typing: !!isTyping })); } catch { /* noop */ }
    }
  };

  const close = () => {
    closedByUs = true;
    clearTimeout(reconnectTimer);
    appSub?.remove?.();
    offOnline?.();
    try { ws?.close(); } catch { /* noop */ }
    ws = null;
  };

  connect();
  return { send, sendTyping, close };
}

export function createGroupSocket(slug, handlers = {}) {
  return createSocket(`ws/groups/${encodeURIComponent(slug)}/`, handlers);
}
