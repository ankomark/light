// The organiser session (sign up, log in, the rotating refresh token) and
// the calls that make an event, plus the draft's own rules.
const mockSecure = new Map();
jest.mock('../secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null)),
  setItemAsync: jest.fn(async (k, v) => { mockSecure.set(k, v); }),
  deleteItemAsync: jest.fn(async (k) => { mockSecure.delete(k); }),
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));

const org = require('../ticketsOrganiser');
const {
  validateStep, firstInvalidStep, serverErrorsByStep, levelPayloads, priceRange, wholeNumber, emptyDraft, newLevel,
} = require('../../pages/tickets/eventDraft');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
const stored = () => JSON.parse(mockSecure.get('tickets_org_tokens') || 'null');
const signIn = (access = 'a1', refresh = 'r1') => mockSecure.set('tickets_org_tokens', JSON.stringify({ access, refresh }));

beforeEach(() => {
  mockSecure.clear();
  org.__resetOrganiser();
  global.fetch = jest.fn();
});

describe('session', () => {
  it('has none until signed up, then keeps both tokens', async () => {
    expect(await org.hasSession()).toBe(false);
    expect(await org.fetchMe()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch.mockResolvedValue(reply(201, { user: { id: 1, email: 'a@b.co' }, access: 'a1', refresh: 'r1' }));
    await org.signUp({ email: ' a@b.co ', password: 'secret123', displayName: 'Amani Choir', phone: '' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ email: 'a@b.co', password: 'secret123', display_name: 'Amani Choir' });
    expect(stored()).toEqual({ access: 'a1', refresh: 'r1' });
    expect(await org.hasSession()).toBe(true);
  });

  it('sends the Bearer token on organiser calls', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(200, { id: 1 }));
    await org.fetchMe();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer a1');
  });

  it('on a 401, refreshes once, keeps the NEW pair, and replays', async () => {
    signIn();
    global.fetch
      .mockResolvedValueOnce(reply(401, { detail: 'expired' }))
      .mockResolvedValueOnce(reply(200, { access: 'a2', refresh: 'r2' }))
      .mockResolvedValueOnce(reply(200, { id: 1, email: 'a@b.co' }));
    expect(await org.fetchMe()).toEqual({ id: 1, email: 'a@b.co' });
    const [, refreshCall, replay] = global.fetch.mock.calls;
    expect(refreshCall[0]).toBe(`${API}auth/token/refresh/`);
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refresh: 'r1' });
    expect(replay[1].headers.Authorization).toBe('Bearer a2');
    expect(stored()).toEqual({ access: 'a2', refresh: 'r2' });
  });

  it('runs one refresh for many failing calls: a second would use a retired token', async () => {
    signIn();
    let refreshes = 0;
    global.fetch = jest.fn(async (url, init) => {
      if (url.endsWith('auth/token/refresh/')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return reply(200, { access: 'a2', refresh: 'r2' });
      }
      return init.headers.Authorization === 'Bearer a2' ? reply(200, { ok: true }) : reply(401, {});
    });
    const results = await Promise.all([org.fetchTills(), org.fetchMe(), org.fetchMe()]);
    expect(refreshes).toBe(1);
    expect(results[1]).toEqual({ ok: true });
  });

  it('ends the session when the refresh is refused', async () => {
    signIn();
    global.fetch
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(401, { detail: 'Token is blacklisted' }));
    expect(await org.fetchMe()).toBeNull();
    expect(mockSecure.has('tickets_org_tokens')).toBe(false);
    await expect(org.fetchTills()).rejects.toMatchObject({ code: 'signed_out' });
  });

  it('keeps the session when the refresh only failed to reach the server', async () => {
    signIn();
    global.fetch
      .mockResolvedValueOnce(reply(401, {}))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(org.fetchMe()).rejects.toMatchObject({ code: 'network' });
    expect(stored()).toEqual({ access: 'a1', refresh: 'r1' });
  });

  it('logs out on the phone even if the server cannot be told', async () => {
    signIn();
    global.fetch.mockRejectedValue(new TypeError('offline'));
    await org.logOut();
    expect(await org.hasSession()).toBe(false);
  });

  it('recognises "already registered" from the email field', () => {
    expect(org.isEmailTaken({ fields: { email: 'An account with this email already exists.' } })).toBe(true);
    expect(org.isEmailTaken({ fields: { email: 'Enter a valid email address.' } })).toBe(false);
    expect(org.isEmailTaken(null)).toBe(false);
  });
});

describe('making an event', () => {
  const fields = {
    title: ' Gospel Night ', description: ' Worship. ', venue: ' KICC ', city: 'Nairobi',
    startsAt: '2026-11-14T15:00:00.000Z', endsAt: null, salesEndAt: null, till: 4,
  };

  it('sends JSON without a poster', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(201, { id: 9 }));
    await org.createEvent({ ...fields, poster: null });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}organiser/events/`);
    expect(JSON.parse(init.body)).toEqual({
      title: 'Gospel Night', description: 'Worship.', venue: 'KICC', city: 'Nairobi', starts_at: '2026-11-14T15:00:00.000Z', till: 4,
    });
  });

  it('sends multipart with the poster as `poster`', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(201, { id: 9 }));
    await org.createEvent({ ...fields, poster: { uri: 'file:///banner.jpg' } });
    const init = global.fetch.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body.get('title')).toBe('Gospel Night');
    expect(init.body.has('poster')).toBe(true);
  });

  it('clears optional dates when editing without a new poster', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(200, { id: 9 }));
    await org.updateEvent(9, { ...fields, poster: null });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}organiser/events/9/`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toMatchObject({ ends_at: null, sales_end_at: null });
  });

  it('adds a ticket level and publishes', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(201, { id: 1 }));
    await org.addTicketType(9, { name: ' VIP ', price: 2000, quantity: 50, position: 1 });
    await org.publishEvent(9);
    await org.createTill({ tillNumber: '512 3456', businessName: ' Amani Choir ' });
    const calls = global.fetch.mock.calls.map(([u, i]) => [u.replace(API, ''), i.method, i.body && JSON.parse(i.body)]);
    expect(calls).toEqual([
      ['organiser/events/9/ticket-types/', 'POST', { name: 'VIP', price: 2000, quantity: 50, position: 1 }],
      ['organiser/events/9/publish/', 'POST', undefined],
      ['organiser/tills/', 'POST', { till_number: '5123456', business_name: 'Amani Choir' }],
    ]);
  });
});

describe('the draft', () => {
  const now = new Date('2026-10-04T09:00:00Z').getTime();
  const ready = () => ({
    ...emptyDraft(),
    title: 'Gospel Night', venue: 'KICC', startsAt: '2026-11-14T15:00:00Z', till: 4,
    levels: [{ ...newLevel('Regular'), price: '500', quantity: '200' }, { ...newLevel('VIP'), price: '2,000', quantity: '50' }],
  });

  it('is ready when every step is', () => {
    expect(firstInvalidStep(ready(), now)).toBeNull();
    expect(firstInvalidStep(emptyDraft(), now)).toBe('details');
  });

  it('needs a title, a venue and a start in the future', () => {
    expect(validateStep('details', { ...ready(), title: '  ' }, now)).toEqual({ title: 'tix.host.err.title' });
    expect(validateStep('when', { ...ready(), venue: '', startsAt: null }, now))
      .toEqual({ venue: 'tix.host.err.venue', startsAt: 'tix.host.err.start' });
    expect(validateStep('when', { ...ready(), startsAt: '2026-10-01T09:00:00Z' }, now))
      .toEqual({ startsAt: 'tix.host.err.startPast' });
  });

  it('keeps the end after the start, and sales closing before the end', () => {
    expect(validateStep('when', { ...ready(), endsAt: '2026-11-14T14:00:00Z' }, now)).toEqual({ endsAt: 'tix.host.err.endBeforeStart' });
    expect(validateStep('when', { ...ready(), salesEndAt: '2026-11-15T00:00:00Z' }, now)).toEqual({ salesEndAt: 'tix.host.err.salesAfterEnd' });
    expect(validateStep('when', { ...ready(), endsAt: '2026-11-15T03:00:00Z', salesEndAt: '2026-11-15T00:00:00Z' }, now)).toEqual({});
    expect(validateStep('when', { ...ready(), salesEndAt: '2026-10-01T00:00:00Z' }, now)).toEqual({ salesEndAt: 'tix.host.err.salesPast' });
  });

  it('checks every level: a name, unique, a price and a quantity', () => {
    const d = ready();
    d.levels = [
      { key: 'a', name: 'VIP', price: '0', quantity: '10' },
      { key: 'b', name: ' vip ', price: '100', quantity: '' },
      { key: 'c', name: '', price: 'abc', quantity: '5' },
    ];
    expect(validateStep('tickets', d, now)).toEqual({
      'levels.a.price': 'tix.host.err.price',
      'levels.b.name': 'tix.host.err.levelDuplicate',
      'levels.b.quantity': 'tix.host.err.quantity',
      'levels.c.name': 'tix.host.err.levelName',
      'levels.c.price': 'tix.host.err.price',
    });
    expect(validateStep('tickets', { ...d, levels: [] }, now)).toEqual({ levels: 'tix.host.err.noLevels' });
  });

  it('needs a till', () => {
    expect(validateStep('payout', { ...ready(), till: null }, now)).toEqual({ till: 'tix.host.err.till' });
  });

  it('sends levels in order, prices as whole shillings', () => {
    expect(levelPayloads(ready().levels)).toEqual([
      { name: 'Regular', price: 500, quantity: 200, position: 0 },
      { name: 'VIP', price: 2000, quantity: 50, position: 1 },
    ]);
    expect(priceRange(ready().levels)).toEqual([500, 2000]);
    expect(priceRange([newLevel('x')])).toBeNull();
    expect(wholeNumber(' 1,500 ')).toBe(1500);
    expect(wholeNumber('1.5')).toBeNaN();
  });

  it("sends a server error to the step that shows it, in the draft's terms", () => {
    expect(serverErrorsByStep({ till: 'Not your till', starts_at: 'Must be in the future', zzz: 'x' })).toEqual({
      step: 'when', errors: { till: 'Not your till', startsAt: 'Must be in the future' },
    });
    expect(serverErrorsByStep({})).toEqual({ step: null, errors: {} });
  });
});
