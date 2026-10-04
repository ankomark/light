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
const stored = () => JSON.parse(mockSecure.get('tickets_org_tokens_u7') || 'null');
const signIn = (access = 'a1', refresh = 'r1') => mockSecure.set('tickets_org_tokens_u7', JSON.stringify({ access, refresh }));

beforeEach(() => {
  mockSecure.clear();
  org.__resetOrganiser(7);
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

  it('is kept per Streams account: hidden on sign-out, back for the same account, never shown to another', async () => {
    signIn();
    expect(await org.hasSession()).toBe(true);
    org.setOrganiserOwner(null);              // signed out of Streams
    expect(await org.hasSession()).toBe(false);
    org.setOrganiserOwner(8);                 // someone else on the phone
    expect(await org.hasSession()).toBe(false);
    expect(await org.rememberedEmail()).toBe('');
    org.setOrganiserOwner(7);                 // back again
    expect(await org.hasSession()).toBe(true);
    expect(stored()).toEqual({ access: 'a1', refresh: 'r1' });
  });

  it("drops the old phone-wide session, whose owner can't be told", async () => {
    mockSecure.set('tickets_org_tokens', JSON.stringify({ access: 'x', refresh: 'y' }));
    org.__resetOrganiser();
    org.setOrganiserOwner(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSecure.has('tickets_org_tokens')).toBe(false);
    expect(await org.hasSession()).toBe(false);
  });

  it('remembers the email signed in with, for this account only', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(200, { access: 'a1', refresh: 'r1' }))
      .mockResolvedValueOnce(reply(200, { id: 1 }));
    await org.logIn({ email: ' Choir@Example.com ', password: 'pw' });
    expect(await org.rememberedEmail()).toBe('choir@example.com');
  });

  it('a refresh that lands after the Streams account changed keeps the tokens with their owner', async () => {
    signIn();
    let finish;
    global.fetch
      .mockResolvedValueOnce(reply(401, { detail: 'expired' }))
      .mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const call = org.fetchMe();
    await new Promise((r) => setTimeout(r, 0));
    org.setOrganiserOwner(8);
    finish(reply(200, { access: 'a2', refresh: 'r2' }));
    await call;
    expect(stored()).toEqual({ access: 'a2', refresh: 'r2' });           // still account 7's
    expect(mockSecure.has('tickets_org_tokens_u8')).toBe(false);
    expect(await org.hasSession()).toBe(false);
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
    expect(mockSecure.has('tickets_org_tokens_u7')).toBe(false);
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

  it('makes an event as JSON', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(201, { id: 9 }));
    await org.createEvent({ ...fields, kind: 'event', showSupporters: true });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}organiser/events/`);
    expect(JSON.parse(init.body)).toEqual({
      kind: 'event', title: 'Gospel Night', description: 'Worship.', venue: 'KICC', city: 'Nairobi',
      starts_at: '2026-11-14T15:00:00.000Z', ends_at: null, sales_end_at: null,
      show_supporters: true, show_total: false, till: 4,
    });
  });

  it('makes a fundraiser with a cause, a goal and suggested amounts, and no venue', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(201, { id: 10 }));
    await org.createEvent({
      kind: 'fundraiser', title: ' Fees for Baraka ', description: 'Form 3.', city: '', category: 'education',
      goal: '120000', suggested: [500, 1000, 5], till: 4, showTotal: true,
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      kind: 'fundraiser', title: 'Fees for Baraka', description: 'Form 3.', city: '', category: 'education',
      goal_amount: 120000, suggested_amounts: [500, 1000], ends_at: null, sales_end_at: null,
      show_supporters: false, show_total: true, till: 4,
    });
  });

  it('uploads the banner and the document as multipart, after', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(200, { id: 9 }));
    await org.uploadEventFiles(9, { poster: { uri: 'file:///banner.jpg' }, document: { uri: 'file:///letter.pdf', name: 'letter.pdf', mimeType: 'application/pdf' } });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${API}organiser/events/9/`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body.has('poster')).toBe(true);
    expect(init.body.has('supporting_document')).toBe(true);
  });

  it('changes who sees the list and the total, and nothing else', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(200, { id: 9 }));
    await org.updateVisibility(9, { showSupporters: true, showTotal: false });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ show_supporters: true, show_total: false });
  });

  it('clears optional dates when editing', async () => {
    signIn();
    global.fetch.mockResolvedValue(reply(200, { id: 9 }));
    await org.updateEvent(9, { ...fields });
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
    kind: 'event',
    title: 'Gospel Night', venue: 'KICC', startsAt: '2026-11-14T15:00:00Z', till: 4,
    levels: [{ ...newLevel('Regular'), price: '500', quantity: '200' }, { ...newLevel('VIP'), price: '2,000', quantity: '50' }],
  });

  it('is ready when every step is', () => {
    expect(firstInvalidStep(ready(), now)).toBeNull();
    expect(firstInvalidStep(emptyDraft(), now)).toBe('type');
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
