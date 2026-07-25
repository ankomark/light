// Realtime group chat over WebSockets (Django Channels backend).
//
// REST is still the source of truth for sending/reading; this socket is the
// realtime fan-out: new messages, deletions, typing, and presence arrive here
// instantly instead of on the fallback poll. Auto-reconnects with backoff and
// authenticates by passing the JWT as a ?token= query param (RN can't set WS
// headers).
import { API_BASE, getAccessToken } from './api';

// http(s)://host → ws(s)://host
const wsBase = () => API_BASE.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);

/**
 * Open a managed realtime socket for a given ws path (e.g. `ws/groups/<slug>/`).
 * Returns { sendTyping, close }. Handlers: onMessage(msg), onDeleted(id),
 * onEdited(msg), onPinned(evt), onTyping(evt), onPresence(evt),
 * onStatus('open'|'closed'). Auto-reconnects with backoff; auth via ?token=.
 */
function createSocket(path, handlers = {}) {
  let ws = null;
  let closedByUs = false;
  let retry = 0;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (closedByUs) return;
    clearTimeout(reconnectTimer);
    const delay = Math.min(1000 * 2 ** retry, 15000); // 1s → 15s cap
    retry += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  async function connect() {
    if (closedByUs) return;
    const token = await getAccessToken();
    if (!token) { scheduleReconnect(); return; }
    try {
      ws = new WebSocket(`${wsBase()}/${path}?token=${encodeURIComponent(token)}`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => { retry = 0; handlers.onStatus?.('open'); };
    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
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
    ws.onclose = () => {
      handlers.onStatus?.('closed');
      if (!closedByUs) scheduleReconnect();
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  }

  const sendTyping = (isTyping) => {
    if (ws && ws.readyState === 1 /* OPEN */) {
      try { ws.send(JSON.stringify({ type: 'typing', is_typing: !!isTyping })); } catch { /* noop */ }
    }
  };

  const close = () => {
    closedByUs = true;
    clearTimeout(reconnectTimer);
    try { ws?.close(); } catch { /* noop */ }
    ws = null;
  };

  connect();
  return { sendTyping, close };
}

export function createGroupSocket(slug, handlers = {}) {
  return createSocket(`ws/groups/${encodeURIComponent(slug)}/`, handlers);
}

// Choir / church community chat. kind = 'choir' | 'church'.
export function createCommunitySocket(kind, communityId, handlers = {}) {
  return createSocket(`ws/community/${kind}/${encodeURIComponent(communityId)}/`, handlers);
}
