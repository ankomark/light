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







  "continue the social feed video experience"





Full Cloudflare move with client-side processing, migrating everything — that's a clean end state. Here's the plan I'd propose, in dependency order:

Phase 0 — Cloudflare setup (dashboard, ~30 min)

- Create an R2 bucket (e.g. adventlife-media) and an S3 API token (access key + secret).
- Attach a custom domain on your Cloudflare zone (e.g. media.<yourdomain>) to the bucket. This is required — the free r2.dev URL is rate-limited and can't use transformations.
- Enable Image Transformations for that zone (this gives you f_auto/resize equivalents at the edge; free tier covers 5k unique transformations/month).
- New env vars for backend: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE.

Phase 1 — Backend: storage + presigned uploads

- Add django-storages[s3] + boto3, configure the S3 backend against the R2 endpoint (https://<account>.r2.cloudflarestorage.com), replace DEFAULT_FILE_STORAGE.
- Convert the ~9 CloudinaryFields in songs/models.py to FileField/ImageField with upload_to matching the existing folder names (one schema migration; existing rows keep their values until Phase 4 rewrites them).
- New presign endpoint replacing get_cloudinary_signature in views/common.py: validates type/size caps server-side, returns a presigned PUT URL + the final public URL/key.
- Keep the old Cloudinary signature endpoint alive — app versions already installed on phones will still call it until users update. This forces a transition window whether we like it or not.
- Swap destroy() calls (stories cleanup command, delete paths) to S3 DeleteObject.

Phase 2 — Frontend: upload path + client-side processing

- Replace services/cloudinary.js with a services/uploads.js: fetch presign → XHR PUT (progress bars keep working) → return key/URL, with width/height/duration now measured client-side before upload.
- Client-side processing to replace Cloudinary ingest transforms:
  - Images: already compressed client-side (resize 1080/q0.8) — nearly done.
  - Video trim + compress + thumbnail: the riskiest piece. ffmpeg-kit-react-native is retired (binaries pulled), so realistically react-native-compressor for compression + a trim library + expo-video-thumbnails for posters — I'd do a 1-day spike here first, since it gates everything video.
- Rewrite getOptimizedUrl to emit /cdn-cgi/image/w=1080,f=auto/... URLs; port the avatar (300×300 fill) and feed (1080 limit) presets.
- Update hardcoded res.cloudinary.com wallpaper URLs in App.js and the stale config.js block.

Phase 3 — Migrate historical assets

- A management command that walks every model/URL field, downloads from Cloudinary, uploads to R2 preserving folder structure, and rewrites DB references (public IDs → file paths; absolute URLs in media_url, song_audio_url, chat messages → new domain). Idempotent, --dry-run, failure log.
- Run against production during a quiet window; Cloudinary stays read-only as a fallback until spot-checks pass.

Phase 4 — Decommission

- After a retention window (old app versions gone, migration verified): remove cloudinary* packages, the signature endpoint, model imports, and Railway env vars; close the account.

Suggested order of attack: the video-processing spike (Phase 2's risk) first, then Phases 0–1 together, since everything else is low-risk plumbing.

Want me to start with the spike (evaluate the video trim/compress options concretely), or begin with Phase 0/1 backend work while you set up the R2 bucket?