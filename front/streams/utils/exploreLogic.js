// Pure list logic behind Explore (kept out of the screen so it's testable).

/** Put a search term at the top of the recent list: trimmed, no case-only
 *  duplicates, capped. Terms under 2 characters aren't worth remembering. */
export const pushRecent = (list, term, max = 12) => {
  const q = (term || '').trim();
  if (q.length < 2) return list;
  return [q, ...list.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, max);
};

/** Append a page of posts, skipping ones already shown (the ranking can shift
 *  between pages, so a post may come back). */
export const mergePage = (prev, rows) => {
  const have = new Set(prev.map((p) => p.id));
  return [...prev, ...(rows || []).filter((p) => !have.has(p.id))];
};

/** True when a search answer has anything to show. */
export const RESULT_SECTIONS = ['tracks', 'artists', 'albums', 'playlists', 'books', 'genres', 'users', 'hashtags', 'groups', 'posts'];
export const hasResults = (res) => !!res?.top || RESULT_SECTIONS
  .some((k) => Array.isArray(res?.[k]) && res[k].length > 0);
