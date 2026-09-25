// What the Services directory is made of — its categories, the service tags
// in each, the web / social links a listing can carry, currencies — shared
// by the list, the card and the form. Plus a small "something changed"
// note so the list picks up a listing just saved or deleted.
export const CATEGORIES = [
  { key: 'media', labelKey: 'services.cat.media', icon: 'movie' },
  { key: 'hospitality', labelKey: 'services.cat.hospitality', icon: 'hotel' },
  { key: 'health', labelKey: 'services.cat.health', icon: 'favorite' },
  { key: 'professional', labelKey: 'services.cat.professional', icon: 'work' },
  { key: 'home', labelKey: 'services.cat.home', icon: 'handyman' },
];
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon]));

// Per-category service tags. Keys are stored (free-form) in service_types;
// labels are localised.
export const SERVICE_TYPES_BY_CATEGORY = {
  media: ['music_video', 'live_event', 'editing', 'recording', 'mixing', 'voice_over', 'podcast', 'documentary', 'other'],
  hospitality: ['hotel', 'lodge', 'restaurant', 'catering', 'event_venue', 'tours', 'transport', 'other'],
  health: ['clinic', 'counseling', 'dental', 'pharmacy', 'fitness', 'nutrition', 'home_care', 'other'],
  professional: ['legal', 'accounting', 'consulting', 'it_services', 'design', 'tutoring', 'translation', 'other'],
  home: ['plumbing', 'electrical', 'cleaning', 'carpentry', 'painting', 'gardening', 'moving', 'other'],
};
const ALL_TAGS = [...new Set(Object.values(SERVICE_TYPES_BY_CATEGORY).flat())];

export const serviceLabel = (key, t) => {
  const label = t(`services.type.${key}`);
  return label === `services.type.${key}` ? key : label;
};

/** The tags whose names (in the reader's language) contain what was typed —
 *  so "fundi wa bomba" or "plumber" finds `plumbing` on the server. */
export const tagsMatching = (query, t) => {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return ALL_TAGS.filter((k) => k !== 'other' && serviceLabel(k, t).toLowerCase().includes(q));
};

// Web + social presence: `key` is the listing's field; the brand colour tints its icon.
export const SOCIAL_LINKS = [
  { key: 'website_link', icon: 'globe-outline', color: '#0EA5E9', labelKey: 'services.link.website' },
  { key: 'facebook_link', icon: 'logo-facebook', color: '#1877F2', labelKey: 'services.link.facebook' },
  { key: 'instagram_link', icon: 'logo-instagram', color: '#E4405F', labelKey: 'services.link.instagram' },
  { key: 'tiktok_link', icon: 'logo-tiktok', color: '#8A8A8A', labelKey: 'services.link.tiktok' },
  { key: 'twitter_link', icon: 'logo-twitter', color: '#8A8A8A', labelKey: 'services.link.twitter' },
  { key: 'youtube_link', icon: 'logo-youtube', color: '#FF0000', labelKey: 'services.link.youtube' },
];

export const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'GHS', 'ZAR', 'TZS', 'UGX'];
export const CURRENCY_SYMBOL = {
  USD: '$', EUR: '€', GBP: '£', KES: 'KSh', NGN: '₦', GHS: 'GH₵', ZAR: 'R', TZS: 'TSh', UGX: 'USh',
};

// People type "instagram.com/foo" without a scheme; make it openable.
export const withScheme = (url) => (/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);

export const rateText = (s) => {
  if (!s?.service_rates) return null;
  const sym = CURRENCY_SYMBOL[s.currency] || s.currency || '';
  const amount = Number(s.service_rates);
  const shown = Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : s.service_rates;
  return `${sym} ${shown}${s.rate_description ? ` · ${s.rate_description}` : ''}`;
};

// ── "Something changed" (a listing saved or deleted elsewhere) ─────────────
let changedAt = 0;
let lastSaved = null;              // { item } | { deletedId }
export const noteServicesChanged = (change) => { changedAt = Date.now(); lastSaved = change || null; };
export const servicesChangedSince = (t) => (changedAt > t ? lastSaved || {} : null);
export const __resetServicesCatalog = () => { changedAt = 0; lastSaved = null; };
