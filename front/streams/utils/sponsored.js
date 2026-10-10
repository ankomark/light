// Where paid promotions sit among the feed's posts (songs/promotions.py serve).

// After the 3rd post and after the 14th.
export const SPONSORED_AT = [3, 14];

/** The feed's rows with the promotions placed in: a promoted post as the post
 *  itself (prepared like any feed post by `prepare`, marked sponsored; its
 *  organic copy, if any, dropped), anything else as a sponsored card row.
 *  A list too short for a slot just doesn't get that promotion. */
export const withSponsored = (posts, sponsored, prepare = (p) => p) => {
  if (!sponsored?.length) return posts;
  const promotedIds = new Set(sponsored.filter((s) => s.post).map((s) => s.post.id));
  const out = posts.filter((p) => !promotedIds.has(p.id));
  sponsored.forEach((s, i) => {
    const at = SPONSORED_AT[i];
    if (at == null || out.length < at) return;
    const row = s.post
      ? { ...prepare({ ...s.post }), sponsored: { promotion_id: s.promotion_id } }
      : { id: `sp-${s.promotion_id}`, sponsoredCard: s };
    out.splice(at, 0, row);
  });
  return out;
};
