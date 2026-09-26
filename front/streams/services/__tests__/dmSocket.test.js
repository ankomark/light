/**
 * The DM socket is one per person, shared by every screen that listens: it
 * opens with the first listener, closes with the last, and fans each event
 * out to all of them.
 */
const mockSockets = [];
jest.mock('../groupSocket', () => ({
  createSocket: jest.fn((path, handlers) => {
    const s = { path, handlers, sent: [], closed: false,
      send: jest.fn((o) => { s.sent.push(o); return true; }), close: jest.fn(() => { s.closed = true; }) };
    mockSockets.push(s);
    return s;
  }),
}));

const { subscribeDM, isDMOpen, sendDMTyping, announceDM, _resetDMSocket } = require('../dmSocket');

beforeEach(() => { _resetDMSocket(); mockSockets.length = 0; });

test('one socket for all listeners; closed with the last', () => {
  const a = jest.fn();
  const b = jest.fn();
  const offA = subscribeDM(a);
  const offB = subscribeDM(b);
  expect(mockSockets).toHaveLength(1);
  expect(mockSockets[0].path).toBe('ws/dm/');

  mockSockets[0].handlers.onEvent({ type: 'message', conversation_id: 3 });
  expect(a).toHaveBeenCalledWith({ type: 'message', conversation_id: 3 });
  expect(b).toHaveBeenCalledWith({ type: 'message', conversation_id: 3 });

  offA();
  expect(mockSockets[0].closed).toBe(false);
  offB();
  expect(mockSockets[0].closed).toBe(true);
  subscribeDM(a);
  expect(mockSockets).toHaveLength(2);           // a fresh one next time
});

test('open/closed is told to listeners, and typing goes out on it', () => {
  const a = jest.fn();
  subscribeDM(a);
  expect(isDMOpen()).toBe(false);
  mockSockets[0].handlers.onStatus('open');
  expect(isDMOpen()).toBe(true);
  expect(a).toHaveBeenCalledWith({ type: 'status', open: true });
  expect(sendDMTyping(9, true)).toBe(true);
  expect(mockSockets[0].sent).toEqual([{ type: 'typing', conversation_id: 9, is_typing: true }]);
});

test('a listener that throws does not stop the others; local events reach all', () => {
  const bad = jest.fn(() => { throw new Error('x'); });
  const good = jest.fn();
  subscribeDM(bad);
  subscribeDM(good);
  announceDM({ type: 'read', conversation_id: 1 });
  expect(good).toHaveBeenCalledWith({ type: 'read', conversation_id: 1 });
});

test('no socket, no typing', () => {
  expect(sendDMTyping(1, true)).toBe(false);
});
