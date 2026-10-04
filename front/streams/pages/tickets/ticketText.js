// How a failed ticketing call is put to the buyer.
//
// The server's own `detail` is written for buyers ("Not enough tickets left"),
// so it is shown as it comes. What it cannot word — no connection, too many
// attempts — the app words, in the reader's language.

export const ticketErrorText = (err, t, fallbackKey = 'tix.genericError') => {
  if (!err) return t(fallbackKey);
  if (err.code === 'rate_limited') return t('tix.rateLimited', { s: err.retryAfter || 30 });
  if (err.code === 'network') return t('tix.networkError');
  return err.message || t(fallbackKey);
};
