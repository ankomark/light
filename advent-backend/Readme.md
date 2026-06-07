# activate virtual env = .\venv\Scripts\activate
The picture — what's already built
  - HomePage → auth gate → SocialFeed (1,353 lines, the core).
  - SocialFeed: Stories bar on top, search box, a FlatList of posts. Each post = header (tappable avatar/username → profile, FollowButton) · PostMedia (image/video) · footer (Like /  Comment / Download / Save + caption/location/date). Pull-to-refresh, infinite scroll, and posts can carry an attached song that auto-plays on image posts.
  - CreatePost (822 lines): image or short video, image compression (resize 1080/q0.8), 60s video limit + a trim UI, Cloudinary upload, sends content_type/width/height/duration.
  Genuinely solid.
  - PostDetail, PostActions (edit caption / delete / report), Stories (StoriesBar/StoryViewer/CreateStoryScreen, 24h).
  - Backend: SocialPostViewSet + like/comment/save actions, plus unused trending_posts, trending_hashtags, and search actions; a stories feed.

  Bugs & issues found (prioritized)

  🔴 Correctness
  1. The "Following" feed is fake. fetchSocialPosts(page, 'following') sends feed=following, but SocialPostViewSet.get_queryset (social.py:22) ignores it and returns all posts from
  everyone, newest-first. There's no real following filter and no For-You/Following distinction.

  🔴 Performance (same N+1 class we fixed for music)
  2. The feed get_queryset only prefetches user. But SocialPostSerializer computes likes_count/comments_count via .count(), is_liked/is_saved via .filter().exists(), and the avatar
  via obj.profile.picture with no user__profile prefetch → ~5 queries per post × 20 ≈ 100 queries/page. Worse: the likes_count/comments_count annotations it does compute are ignored
  by the serializer.
  3. Dead/overwritten queryset at social.py:6–18 — an optimized queryset is built, then immediately overwritten by SocialPost.objects.all().

  🟠 UX professionalism
  4. 2-minute polling wholesale-replaces the feed (setPosts(processed)), resetting scroll and interrupting whatever you're watching. Pro feeds prepend behind a "new posts" pill.
  5. Videos don't autoplay/pause on scroll (shouldPlay={false} + native controls); onViewableItemsChanged only handles attached-song audio. No muted-autoplay, no mute toggle — not
  what a short-video feed should feel like.
  6. Two independent audio systems — the feed's playSong uses its own expo-av sound, separate from the global PlayerContext mini-player → they can play over each other.
  7. Client-side search only — filters loaded posts; the backend search action goes unused (same as the track bug we fixed).
  8. Media is letterboxed — PostMedia uses resizeMode="contain" in a fixed-height box and ignores the post's width/height aspect ratio.

  🟡 Cleanliness
  9. ~145 lines of commented-out dead code atop SocialFeed, stray styles in PostActions, etc.
  10. Hardcoded, off-theme colors throughout (#1DA1F2, #102E50, #ccc); the edit-post modal is white/light — inconsistent with the now-polished music + nav surfaces.
  11. No real empty states (and once the following feed is fixed, new users who follow no one will see a blank screen → need a discovery fallback).

  Improvement map (phased)

  Phase 1 — Backend correctness + performance (highest value)
  - Make get_queryset honor feed: following = posts from followed users + self; default = "For You" (all/recency or trending). Add proper
  prefetch_related('user__profile','likes','comments','saves') + Exists/Count annotations, and make the serializer read them (kills the N+1). Lock it with query-count tests like we
  did for tracks.
  - Wire the existing search action for server-side post search.

  Phase 2 — Feed feels professional (frontend)
  - Replace the disruptive poll with a "new posts" pill (or just pull/focus refresh).
  - Video autoplay-muted on view, pause off-view, with a tap-to-unmute; coordinate with the global player so audio never overlaps.
  - Aspect-ratio-correct media; theme-token migration for SocialFeed/PostActions/PostMedia/edit modal.
  - Feed tabs: For You / Following + real empty states (e.g., "Follow people or explore").

  Phase 3 — Polish
  - Delete dead code; double-tap-to-like; optimistic like/save consistency; live comment counts; a11y labels.

  Phase 4 — Tests
  - Backend: following-filter correctness, feed query-count guard, search. Frontend: extract any pure logic + a post-card render test.

  My recommendation

  Start with Phase 1 — it fixes a real correctness bug (the fake following feed), removes the biggest performance liability, and is fully testable on the backend (where we already
  have the harness). It's the highest professional-impact, lowest-risk slice.