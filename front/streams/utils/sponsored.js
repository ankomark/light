// Where paid promotions sit among the feed's posts (songs/promotions.py serve).

// After the 3rd post and after the 14th.
export const SPONSORED_AT = [3, 14];

/** The feed's rows with the promotions placed in: a promoted post as the post
 *  itself (prepared like any feed post by `prepare`, marked sponsored; its
 *  organic copy, if any, dropped), anything else as a sponsored card row.
 *  A list too short for a slot just doesn't get that promotion. */
export const withSponsored = (posts, sponsored, prepare = (p) => p) => {
  // Only what can be drawn: a promoted post needs its post, the rest their card.
  sponsored = (sponsored || []).filter((s) => (s.kind === 'post' ? !!s.post
    : !!(s.profile || s.product || s.service || s.book)));
  if (!sponsored.length) return posts;
  let out = posts.slice();
  sponsored.forEach((s, i) => {
    const at = SPONSORED_AT[i];
    if (at == null) return;
    // The organic copy of a promoted post goes only once its sponsored copy
    // has a place: a short feed must never lose the post altogether.
    const rest = s.post ? out.filter((p) => p.id !== s.post.id) : out;
    if (rest.length < at) return;
    const row = s.post
      ? { ...prepare({ ...s.post }), sponsored: { promotion_id: s.promotion_id } }
      : { id: `sp-${s.promotion_id}`, sponsoredCard: s };
    out = [...rest.slice(0, at), row, ...rest.slice(at)];
  });
  return out;
};
