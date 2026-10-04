// The event or fundraiser being created: its shape, what each step needs
// before Next, and how the server's field errors map back to the step that
// owns them.
//
// Dates are kept as ISO strings throughout, so the draft can be saved to the
// phone as JSON and picked up again.

// An event sells tickets on a date at a place; a fundraiser takes gifts of
// any amount toward a cause, and needs a document for Skylink's review.
const EVENT_STEPS = ['type', 'details', 'when', 'tickets', 'payout', 'visibility', 'review'];
const FUNDRAISER_STEPS = ['type', 'details', 'goal', 'document', 'payout', 'visibility', 'review'];
export const stepsFor = (kind) => (kind === 'fundraiser' ? FUNDRAISER_STEPS : EVENT_STEPS);
export const STEPS = EVENT_STEPS;
export const SUGGESTED_DEFAULT = ['500', '1000', '2000', '5000'];
export const GOAL_MIN = 100;
export const GIFT_MIN = 10;
export const GIFT_MAX = 250000;

export const MAX_LEVELS = 10;
export const TITLE_MAX = 160;
export const NAME_MAX = 80;

let seq = 0;
export const newLevel = (name = '') => ({ key: `l${Date.now().toString(36)}${(seq += 1)}`, name, price: '', quantity: '' });

export const emptyDraft = () => ({
  kind: null,            // 'event' | 'fundraiser', chosen first
  category: '',          // a fundraiser's cause
  goal: '',              // optional target, whole shillings
  suggested: [...SUGGESTED_DEFAULT],
  document: null,        // { uri, name, mimeType, size }: proof for review, never public
  showSupporters: false,
  showTotal: false,
  poster: null,          // { uri, width, height } — a local file, compressed
  title: '',
  description: '',
  venue: '',
  city: '',
  startsAt: null,
  endsAt: null,
  salesEndAt: null,
  levels: [newLevel('Regular')],
  till: null,            // a till id
});

/** "1,500" / " 1500 " → 1500; anything not a whole positive number → NaN. */
export const wholeNumber = (v) => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  return /^\d+$/.test(s) ? Number(s) : NaN;
};

const time = (iso) => (iso ? new Date(iso).getTime() : NaN);

/**
 * What stops a step, as `{ field: stringsKey }` (empty when it may go on).
 * Level problems are keyed `levels.<key>.<field>`.
 */
export const validateStep = (step, d, now = Date.now()) => {
  const e = {};
  if (step === 'type') {
    if (!d.kind) e.kind = 'tix.host.err.kind';
  }
  if (step === 'details') {
    if (!d.title.trim()) e.title = 'tix.host.err.title';
    if (d.kind === 'fundraiser' && !d.category) e.category = 'tix.host.err.category';
  }
  if (step === 'goal') {
    if (String(d.goal || '').trim() && !(wholeNumber(d.goal) >= GOAL_MIN)) e.goal = 'tix.host.err.goal';
    if (d.endsAt && time(d.endsAt) <= now) e.endsAt = 'tix.host.err.endPast';
    (d.suggested || []).forEach((v, i) => {
      if (!String(v).trim()) return;
      const n = wholeNumber(v);
      if (!(n >= GIFT_MIN && n <= GIFT_MAX)) e[`suggested.${i}`] = 'tix.host.err.suggested';
    });
  }
  if (step === 'document') {
    if (!d.document?.uri) e.document = 'tix.host.err.document';
  }
  if (step === 'when') {
    if (!d.venue.trim()) e.venue = 'tix.host.err.venue';
    if (!d.startsAt) e.startsAt = 'tix.host.err.start';
    else if (time(d.startsAt) <= now) e.startsAt = 'tix.host.err.startPast';
    if (d.endsAt && !(time(d.endsAt) > time(d.startsAt))) e.endsAt = 'tix.host.err.endBeforeStart';
    if (d.salesEndAt) {
      const last = d.endsAt || d.startsAt;
      if (time(d.salesEndAt) <= now) e.salesEndAt = 'tix.host.err.salesPast';
      else if (last && time(d.salesEndAt) > time(last)) e.salesEndAt = 'tix.host.err.salesAfterEnd';
    }
  }
  if (step === 'tickets') {
    if (!d.levels.length) e.levels = 'tix.host.err.noLevels';
    const seen = new Set();
    d.levels.forEach((l) => {
      const name = l.name.trim().toLowerCase();
      if (!name) e[`levels.${l.key}.name`] = 'tix.host.err.levelName';
      else if (seen.has(name)) e[`levels.${l.key}.name`] = 'tix.host.err.levelDuplicate';
      seen.add(name);
      if (!(wholeNumber(l.price) >= 1)) e[`levels.${l.key}.price`] = 'tix.host.err.price';
      if (!(wholeNumber(l.quantity) >= 1)) e[`levels.${l.key}.quantity`] = 'tix.host.err.quantity';
    });
  }
  if (step === 'payout') {
    if (!d.till) e.till = 'tix.host.err.till';
  }
  return e;
};

/** The first step with a problem, or null when the whole draft is ready. */
export const firstInvalidStep = (d, now = Date.now()) => (
  stepsFor(d.kind).find((s) => Object.keys(validateStep(s, d, now)).length) || null
);

// Which step shows each of the server's fields.
const FIELD_STEP = {
  kind: 'type',
  title: 'details', description: 'details', poster: 'details', category: 'details',
  venue: 'when', city: 'when', starts_at: 'when', ends_at: 'when', sales_end_at: 'when',
  goal_amount: 'goal', suggested_amounts: 'goal',
  supporting_document: 'document',
  till: 'payout',
  name: 'tickets', price: 'tickets', quantity: 'tickets',
};
// And the draft's name for it.
const FIELD_DRAFT = {
  starts_at: 'startsAt', ends_at: 'endsAt', sales_end_at: 'salesEndAt', goal_amount: 'goal',
  supporting_document: 'document',
};

/** The step a server error belongs to, and the errors in the draft's terms. */
export const serverErrorsByStep = (fields = {}, kind = 'event') => {
  const steps = stepsFor(kind);
  const out = { step: null, errors: {} };
  Object.entries(fields).forEach(([k, msg]) => {
    let step = FIELD_STEP[k];
    // A fundraiser's dates live on its goal step.
    if (kind === 'fundraiser' && step === 'when') step = 'goal';
    if (!step || !steps.includes(step)) return;
    if (!out.step || steps.indexOf(step) < steps.indexOf(out.step)) out.step = step;
    out.errors[FIELD_DRAFT[k] || k] = msg;
  });
  return out;
};

/** The suggested amounts as the server takes them: whole, in range, no blanks, no repeats. */
export const suggestedPayload = (list) => [...new Set((list || [])
  .map(wholeNumber).filter((n) => n >= GIFT_MIN && n <= GIFT_MAX))];

/** A draft saved by an older version of the app (events only) carries on as an event. */
export const upgradeDraft = (kept) => ({ ...emptyDraft(), kind: 'event', ...kept });

/** The levels as the server takes them, in the order shown. */
export const levelPayloads = (levels) => levels.map((l, position) => ({
  name: l.name.trim(),
  price: wholeNumber(l.price),
  quantity: wholeNumber(l.quantity),
  position,
}));

/** Lowest and highest price, for the review's "KES 500 – 5,000". */
export const priceRange = (levels) => {
  const prices = levels.map((l) => wholeNumber(l.price)).filter((n) => n >= 1);
  return prices.length ? [Math.min(...prices), Math.max(...prices)] : null;
};
