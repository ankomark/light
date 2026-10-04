// The ticketing client: the server's conventions (errors, 429, pagination),
// money and phone formats, and the orders kept in secure storage.
const mockSecure = new Map();
jest.mock('../secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null)),
  setItemAsync: jest.fn(async (k, v) => { mockSecure.set(k, v); }),
  deleteItemAsync: jest.fn(async (k) => { mockSecure.delete(k); }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '9.9.9' } }));

const {
  fetchEvents, fetchEvent, createOrder, fetchOrder, lookupOrder, TicketsError,
  formatKes, normalizeKePhone, formatWhen, dateTile, isPast,
  saveReference, cacheOrder, readCachedOrder, listSavedOrders, refreshSavedOrders,
  readBuyer, saveBuyer, setTicketOwner, __resetTickets,
} = require('../tickets');
const { nextPage } = require('../../pages/tickets/TicketsHome');
const { closedReason } = require('../../pages/tickets/TicketEvent');
const { groupOrders } = require('../../pages/tickets/MyTickets');
const { isReceipt } = require('../../pages/tickets/TicketRecover');
const { ticketErrorText } = require('../../pages/tickets/ticketText');
const { qrRuns } = require('../../components/tickets/QRCode');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});
const MONTHS = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
const WEEKDAYS = 'Sun,Mon,Tue,Wed,Thu,Fri,Sat'.split(',');

beforeEach(() => {
  mockSecure.clear();
  __resetTickets(7);
  global.fetch = jest.fn();
});

describe('requests', () => {
  it('asks for public events with only the filters given, and no Streams token', async () => {
    global.fetch.mockResolvedValue(reply(200, { count: 0, next: null, results: [] }));
    await fetchEvents({ search: ' gospel night ', city: '', page: 2 });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}public/events/?search=gospel%20night&page=2`);
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['User-Agent']).toMatch(/^StreamsApp\/9\.9\.9 \(/);
  });

  it('posts an order in the shape the server takes', async () => {
    global.fetch.mockResolvedValue(reply(201, { reference: 'r1', status: 'pending' }));
    await createOrder({ ticketType: 7, quantity: 2, phone: ' 0712 345 678 ', name: '  ' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}public/orders/`);
    expect(init.method).toBe('POST');
    // An empty name is left out rather than sent blank.
    expect(JSON.parse(init.body)).toEqual({ ticket_type: 7, quantity: 2, phone: '0712 345 678', show_name: false });
  });

  it('escapes a slug and a reference in the path', async () => {
    global.fetch.mockResolvedValue(reply(200, {}));
    await fetchEvent('a b');
    await fetchOrder('x/y');
    expect(global.fetch.mock.calls.map((c) => c[0])).toEqual([
      `${API}public/events/a%20b/`, `${API}public/orders/x%2Fy/`,
    ]);
  });

  it('sends a receipt upper-cased for lookup', async () => {
    global.fetch.mockResolvedValue(reply(200, { reference: 'r1' }));
    await lookupOrder({ phone: '0712345678', receipt: ' sjk3h2l9qx ' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ phone: '0712345678', mpesa_receipt: 'SJK3H2L9QX' });
  });
});

describe('errors', () => {
  it("carries the server's detail and its first problem per field", async () => {
    global.fetch.mockResolvedValue(reply(400, { detail: 'Not enough tickets left', errors: { phone: ['Not a Safaricom number', 'x'] } }));
    const err = await createOrder({ ticketType: 1, quantity: 1, phone: '1' }).catch((e) => e);
    expect(err).toBeInstanceOf(TicketsError);
    expect(err.message).toBe('Not enough tickets left');
    expect(err.fields).toEqual({ phone: 'Not a Safaricom number' });
    expect(err.code).toBe('invalid');
  });

  it('falls back to the first field problem when there is no detail', async () => {
    global.fetch.mockResolvedValue(reply(400, { errors: { quantity: ['At most 10'] } }));
    const err = await createOrder({ ticketType: 1, quantity: 11, phone: '0712345678' }).catch((e) => e);
    expect(err.message).toBe('At most 10');
  });

  it('reads Retry-After on 429 and words it for the reader', async () => {
    global.fetch.mockResolvedValue(reply(429, { detail: 'Throttled' }, { 'Retry-After': '42' }));
    const err = await fetchEvents().catch((e) => e);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfter).toBe(42);
    const t = (k, p) => (p ? `${k}:${p.s}` : k);
    expect(ticketErrorText(err, t)).toBe('tix.rateLimited:42');
  });

  it('turns a dropped connection into a network error', async () => {
    global.fetch.mockRejectedValue(new TypeError('Network request failed'));
    const err = await fetchOrder('r').catch((e) => e);
    expect(err.code).toBe('network');
    expect(ticketErrorText(err, (k) => k)).toBe('tix.networkError');
  });

  it('marks a 404 as not found', async () => {
    global.fetch.mockResolvedValue(reply(404, { detail: 'Not found.' }));
    expect((await lookupOrder({ phone: '0712345678', receipt: 'AAAAAAAAAA' }).catch((e) => e)).code).toBe('not_found');
  });
});

describe('formats', () => {
  it('writes money as whole shillings with thousands', () => {
    expect(formatKes(1500)).toBe('KES 1,500');
    expect(formatKes(1234567)).toBe('KES 1,234,567');
    expect(formatKes(0)).toBe('KES 0');
    expect(formatKes(null)).toBe('KES 0');
  });

  it('accepts a Kenyan mobile number in any common shape', () => {
    for (const ok of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678', '0110 123 456']) {
      expect(normalizeKePhone(ok)).toMatch(/^254[17]\d{8}$/);
    }
    for (const bad of ['', '0812345678', '071234567', '07123456789', 'hello', '+1 415 555 0100']) {
      expect(normalizeKePhone(bad)).toBeNull();
    }
  });

  it("formats when in the phone's own time", () => {
    const local = new Date(2026, 10, 14, 18, 5);
    expect(formatWhen(local.toISOString(), { months: MONTHS, weekdays: WEEKDAYS })).toBe('Sat 14 Nov · 18:05');
    expect(dateTile(local.toISOString(), MONTHS)).toEqual({ day: '14', month: 'Nov' });
    expect(formatWhen('nonsense', { months: MONTHS, weekdays: WEEKDAYS })).toBe('');
  });

  it('reads the page number from a next link', () => {
    expect(nextPage('https://x/api/v1/public/events/?page=3&search=a')).toBe(3);
    expect(nextPage(null)).toBeNull();
  });

  it('knows an M-Pesa receipt code when it sees one', () => {
    expect(isReceipt('SJK3H2L9QX')).toBe(true);
    expect(isReceipt(' sjk3h2l9qx ')).toBe(true);
    expect(isReceipt('SJK3H2L9Q')).toBe(false);
    expect(isReceipt('SJK3H2L9Q!')).toBe(false);
  });
});

describe('events and orders', () => {
  it('says why an event cannot be bought', () => {
    expect(closedReason({ on_sale: true, status: 'published' })).toBeNull();
    expect(closedReason({ on_sale: false, status: 'cancelled' })).toBe('tix.cancelled');
    expect(closedReason({ on_sale: false, ticket_types: [{ remaining: 0 }, { remaining: 0 }] })).toBe('tix.soldOut');
    expect(closedReason({ on_sale: false, ticket_types: [{ remaining: 4 }] })).toBe('tix.salesClosed');
  });

  it('lists paid and pending orders, upcoming soonest first and past latest first', () => {
    const now = new Date(2026, 9, 4).getTime();
    const o = (reference, status, y, m, d) => ({ order: { reference, status, starts_at: new Date(y, m - 1, d).toISOString() } });
    const groups = groupOrders([
      o('later', 'paid', 2026, 12, 1), o('soon', 'pending', 2026, 10, 10), o('lost', 'failed', 2026, 10, 12),
      o('old', 'paid', 2026, 1, 1), o('recent', 'paid', 2026, 9, 1), { reference: 'blank', order: null },
    ], now);
    expect(groups.map((g) => [g.key, g.data.map((x) => x.reference)])).toEqual([
      ['tix.upcoming', ['soon', 'later']],
      ['tix.past', ['recent', 'old']],
    ]);
    expect(isPast(new Date(2026, 9, 3).toISOString(), now)).toBe(true);
  });
});

describe('orders kept on the phone', () => {
  it('keeps references newest first, once each, through concurrent saves', async () => {
    await Promise.all([saveReference('a'), saveReference('b'), saveReference('a')]);
    await saveReference('c');
    expect(JSON.parse(mockSecure.get('tickets_refs_u7'))).toEqual(['c', 'b', 'a']);
  });

  it('keeps each order under its own key, safe for the Keychain', async () => {
    await cacheOrder({ reference: 'ab/c+d', status: 'paid', tickets: [{ code: 'T1' }] });
    expect(mockSecure.has('tickets_order_u7_ab_c_d')).toBe(true);
    expect((await readCachedOrder('ab/c+d')).tickets[0].code).toBe('T1');
    expect(await listSavedOrders()).toEqual([{ reference: 'ab/c+d', order: expect.objectContaining({ status: 'paid' }) }]);
  });

  it('reads the list back after a restart', async () => {
    await saveReference('r1');
    __resetTickets(7);
    expect((await listSavedOrders()).map((s) => s.reference)).toEqual(['r1']);
  });

  it('asks again about every kept order, keeping the old copy when one fails', async () => {
    await cacheOrder({ reference: 'p', status: 'pending' });
    await cacheOrder({ reference: 'q', status: 'paid' });
    global.fetch
      .mockResolvedValueOnce(reply(200, { reference: 'q', status: 'paid', tickets: [{ code: 'T', checked_in: true }] }))
      .mockRejectedValueOnce(new TypeError('offline'));
    const list = await refreshSavedOrders();
    expect(list.find((s) => s.reference === 'q').order.tickets[0].checked_in).toBe(true);
    expect(list.find((s) => s.reference === 'p').order.status).toBe('pending');
  });

  it('remembers the buyer for next time', async () => {
    expect(await readBuyer()).toEqual({});
    await saveBuyer({ phone: '0712345678', name: 'Amani' });
    expect(await readBuyer()).toEqual({ phone: '0712345678', name: 'Amani' });
  });

  it("never shows one account's tickets, or phone, to another on the same phone", async () => {
    await cacheOrder({ reference: 'mine', status: 'paid', tickets: [{ code: 'T1' }] });
    await saveBuyer({ phone: '0712345678', name: 'Amani' });

    setTicketOwner(8);
    expect(await listSavedOrders()).toEqual([]);
    expect(await readCachedOrder('mine')).toBeNull();
    expect(await readBuyer()).toEqual({});
    await cacheOrder({ reference: 'theirs', status: 'paid' });

    setTicketOwner(7);
    expect((await listSavedOrders()).map((s) => s.reference)).toEqual(['mine']);
  });

  it('signed out: nothing listed, nothing kept', async () => {
    await saveReference('mine');
    setTicketOwner(null);
    expect(await listSavedOrders()).toEqual([]);
    await cacheOrder({ reference: 'x', status: 'paid' });
    expect([...mockSecure.keys()].some((k) => k.includes('_x'))).toBe(false);
  });

  it("drops the old phone-wide list, whose owner can't be told", async () => {
    mockSecure.set('tickets_refs', JSON.stringify(['old']));
    mockSecure.set('tickets_order_old', '{"reference":"old"}');
    mockSecure.set('tickets_buyer', '{"phone":"0700000000"}');
    __resetTickets();
    setTicketOwner(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(await listSavedOrders()).toEqual([]);
    expect([...mockSecure.keys()]).toEqual([]);
  });
});

describe('QR', () => {
  it('draws a code as runs of dark modules', () => {
    const { count, rows } = qrRuns('TK-7F3A9C2B1E');
    expect(count).toBe(21);
    expect(rows).toHaveLength(21);
    // The top-left finder pattern: seven dark modules, then a light one.
    expect(rows[0][0]).toEqual([0, 7]);
    rows.flat().forEach(([start, length]) => {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start + length).toBeLessThanOrEqual(count);
    });
  });
});
