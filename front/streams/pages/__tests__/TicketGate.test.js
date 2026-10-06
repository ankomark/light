// The gate's offline memory (pages/tickets/gate.js): synced by the server's
// clock, and honest about a code it has never seen.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));
const mockFetchGate = jest.fn();
jest.mock('../../services/ticketsOrganiser', () => ({
  fetchGateTickets: (...a) => mockFetchGate(...a),
  checkIn: jest.fn(),
  organiserScope: () => 'u7',
}));
jest.mock('../tickets/TicketsHome', () => ({ nextPage: () => null }));

const { syncGate, scanOffline, emptyGate } = require('../tickets/gate');

test('the next sync asks from the server’s clock, not the phone’s', async () => {
  mockFetchGate.mockResolvedValue({
    results: [{ code: 'abc', ticket_type: 'Regular', buyer_name: 'Amani', checked_in_at: null }],
    next: null, server_time: '2026-10-07T10:00:00Z',
  });
  const phoneRunsFast = Date.parse('2026-10-07T10:30:00Z');
  const gate = await syncGate(5, emptyGate(), phoneRunsFast);
  expect(gate.syncedAt).toBe('2026-10-07T10:00:00Z');
  await syncGate(5, gate, phoneRunsFast);
  // From the server's time (less the overlap) - not half an hour in the future.
  expect(mockFetchGate.mock.calls[1][1].since).toBe('2026-10-07T09:58:00.000Z');
});

test('an older server without its clock: the phone’s, as before', async () => {
  mockFetchGate.mockResolvedValue({ results: [], next: null });
  const gate = await syncGate(5, emptyGate(), Date.parse('2026-10-07T10:00:00Z'));
  expect(gate.syncedAt).toBe('2026-10-07T10:00:00.000Z');
});

test('offline, a code not on the list is "not on this phone", not "invalid"', () => {
  const gate = { ...emptyGate(), tickets: { abc: { t: 'Regular', n: 'Amani', c: null } } };
  expect(scanOffline(gate, 'zzz').outcome.result).toBe('unknown_offline');
  expect(scanOffline(gate, 'abc').outcome.result).toBe('admitted_offline');
});

test('a queued offline check-in is sent with the time it was scanned', async () => {
  const org = require('../../services/ticketsOrganiser');
  org.checkIn.mockResolvedValue({ result: 'admitted' });
  const { flushQueue } = require('../tickets/gate');
  const gate = { ...emptyGate(), tickets: { abc: { t: 'Regular', n: 'Amani', c: '2026-10-07T09:00:00Z' } },
    queue: [{ code: 'abc', at: '2026-10-07T09:00:00Z' }] };
  const after = await flushQueue(5, gate);
  expect(org.checkIn).toHaveBeenCalledWith(5, 'abc', '2026-10-07T09:00:00Z');
  expect(after.queue).toEqual([]);
});
