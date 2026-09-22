// Pure list logic for the comment sheet: laying out comments with their
// expanded reply threads, and optimistic reactions. Kept out of the component
// so the fiddly cases (counts, toggles, the "view more" row) are unit-tested.

export const REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👏', '🔥', '🙌'];
export const LIKE = '❤️';
export const EMPTY_REACTIONS = { total: 0, top: [], mine: null };

/**
 * Flatten comments + their open threads into FlatList rows:
 *   { type: 'comment', comment, depth: 0 }
 *   { type: 'comment', comment, depth: 1 }          (a reply)
 *   { type: 'more', parent, label: 'view'|'more'|'hide', remaining }
 * `threads` is { [parentId]: { items, open, hasMore } }.
 */
export const buildRows = (comments, threads = {}) => {
  const rows = [];
  for (const c of comments) {
    rows.push({ key: `c_${c.id}`, type: 'comment', comment: c, depth: 0 });
    const total = c.replies_count || 0;
    const th = threads[c.id];
    const shown = th?.open ? th.items : [];
    for (const r of shown) rows.push({ key: `r_${r.id}`, type: 'comment', comment: r, depth: 1, parentId: c.id });
    if (total > 0 || shown.length) {
      const remaining = Math.max(0, total - shown.length);
      let label = 'view';
      if (th?.open && (th.hasMore || remaining > 0)) label = 'more';
      else if (th?.open) label = 'hide';
      rows.push({ key: `m_${c.id}`, type: 'more', parent: c, label, remaining: th?.open ? remaining : total });
    }
  }
  return rows;
};

/** What a reaction tap does to a summary — the same rules as the server:
 *  the same emoji again removes it, a different one replaces it. */
export const toggleReaction = (summary = EMPTY_REACTIONS, emoji) => {
  const s = { ...EMPTY_REACTIONS, ...summary };
  const removing = s.mine === emoji;
  let total = s.total;
  if (removing) total -= 1;
  else if (!s.mine) total += 1;
  const mine = removing ? null : emoji;
  let top = s.top.filter((e) => e !== s.mine || s.total - 1 > 0);
  if (mine && !top.includes(mine)) top = [mine, ...top].slice(0, 3);
  if (removing && total === 0) top = [];
  return { total: Math.max(0, total), top, mine };
};

/** Replace one comment (top-level or reply) wherever it lives. */
export const updateComment = (comments, threads, id, fn) => {
  const nextComments = comments.map((c) => (c.id === id ? fn(c) : c));
  let changedThreads = threads;
  for (const [pid, th] of Object.entries(threads)) {
    if (th.items.some((r) => r.id === id)) {
      changedThreads = { ...changedThreads, [pid]: { ...th, items: th.items.map((r) => (r.id === id ? fn(r) : r)) } };
    }
  }
  return { comments: nextComments, threads: changedThreads };
};

/** Add a reply to its thread (opening it) and bump the parent's count. */
export const addReply = (comments, threads, parentId, reply) => {
  const th = threads[parentId] || { items: [], open: true, hasMore: false };
  return {
    comments: comments.map((c) => (c.id === parentId ? { ...c, replies_count: (c.replies_count || 0) + 1 } : c)),
    threads: { ...threads, [parentId]: { ...th, open: true, items: [...th.items, reply] } },
  };
};

/** Merge a fetched page of replies into a thread without duplicates. */
export const mergeReplies = (existing = [], page = []) => {
  const have = new Set(existing.map((r) => r.id));
  return [...existing, ...page.filter((r) => !have.has(r.id))];
};
