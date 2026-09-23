from .common import *  # noqa: F401,F403
from django.db.models import Exists, OuterRef, Subquery, IntegerField
from django.db.models.functions import Coalesce
from django.db import IntegrityError, transaction
from django.db.models import F, Max
from django.utils.dateparse import parse_datetime
from rest_framework.throttling import ScopedRateThrottle
from ..models import PlayEvent
from .. import discovery, audio_tags
from ..comments import (
    create_comment, set_reaction, reaction_summaries, TRACK as TRACK_COMMENTS,
    REACTIONS as COMMENT_REACTIONS, LIKE as COMMENT_LIKE,
)
from .. import r2


class R2SignView(APIView):
    """Presigned direct-to-R2 uploads â€” the Cloudinary signer's successor.

    Same `type` vocabulary as CloudinarySignView so the app's upload service
    swaps providers without re-mapping. Key differences the client must honor:
    - upload is a plain HTTP PUT of the raw bytes to `upload_url` (no multipart)
    - the Content-Type sent on the PUT must match `content_type` exactly
    - trim/compress/thumbnails happen client-side before upload (R2 stores
      bytes verbatim; there is no ingest transformation)
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        upload_type = request.data.get('type', 'image')
        if upload_type not in r2.FOLDER_MAP:
            return Response({'error': f'Unknown upload type: {upload_type}'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not r2.is_configured():
            return Response({'error': 'R2 not configured'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        content_type = (request.data.get('content_type') or '').strip().lower()
        if not content_type:
            return Response({'error': 'content_type is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not r2.content_type_allowed(upload_type, content_type):
            return Response(
                {'error': f'content_type {content_type} not allowed for {upload_type}'},
                status=status.HTTP_400_BAD_REQUEST)

        return Response(r2.presign_put(
            upload_type, content_type, filename=request.data.get('filename'),
        ))


class AvatarUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        """Alternative endpoint for avatar uploads"""
        if not hasattr(request.user, 'profile'):
            return Response(
                {'error': 'Profile does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        serializer = AvatarUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Straight to R2. Sizing/cropping is the client's job now (it
            # already compresses before upload); R2 stores bytes verbatim.
            url = r2.upload_file(serializer.validated_data['avatar'], 'profile_images')

            profile = request.user.profile
            profile.picture = url
            profile.save()
            
            return Response(
                ProfileSerializer(profile, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Avatar upload failed: {str(e)}")
            return Response(
                {'error': 'Failed to process image upload'},
                status=status.HTTP_400_BAD_REQUEST
            )



class TrackUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TrackUploadSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # Straight to R2; the stored reference is the public URL.
                audio_url = r2.upload_file(
                    serializer.validated_data['audio_file'], 'audio_uploads')

                cover_url = None
                if 'cover_image' in serializer.validated_data:
                    cover_url = r2.upload_file(
                        serializer.validated_data['cover_image'], 'cover_images')

                # Create track
                track_data = {
                    'title': request.data.get('title', 'Untitled Track'),
                    'artist': request.user.id,
                    'audio_file': audio_url,
                    'cover_image': cover_url,
                    'album': request.data.get('album', ''),
                    'lyrics': request.data.get('lyrics', '')
                }
                
                track_serializer = TrackSerializer(data=track_data, context={'request': request})
                if track_serializer.is_valid():
                    track = track_serializer.save()
                    return Response(track_serializer.data, status=status.HTTP_201_CREATED)
                return Response(track_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            except Exception as e:
                logger.error(f"Track upload to R2 failed: {e}", exc_info=True)
                return Response(
                    {'error': 'Upload failed. Please try again.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



def annotated_tracks(user):
    """Live tracks with the counts and flags a track row draws (likes,
    comments, liked-by-me), each one annotation instead of a query per row.
    Shared by the library list and a profile's Music tab."""
    # likes_total as a correlated subquery, not Count('likes'): an aggregate
    # over the artist/profile join forces a LEFT JOIN + GROUP BY across every
    # selected column, which is what made a page of tracks slow. The subquery
    # reads the likes index once per row and leaves the outer query flat.
    like_count = (
        Like.objects.filter(track=OuterRef('pk'))
        .order_by().values('track')
        .annotate(n=Count('id')).values('n')[:1]
    )
    # Same shape for comments. The row's comment button used to get its
    # number by fetching that track's ENTIRE comment list on mount — one
    # request per visible row — so the count has to ride along here.
    comment_count = (
        Comment.objects.filter(track=OuterRef('pk'), is_removed=False)
        .order_by().values('track')
        .annotate(n=Count('id')).values('n')[:1]
    )
    qs = (
        Track.objects
        .filter(is_removed=False)  # hide moderator takedowns
        .select_related('artist__profile')
        .annotate(
            likes_total=Coalesce(
                Subquery(like_count, output_field=IntegerField()), 0),
            comments_total=Coalesce(
                Subquery(comment_count, output_field=IntegerField()), 0),
        )
    )
    if user and user.is_authenticated:
        qs = qs.annotate(
            liked_by_me=Exists(
                Like.objects.filter(track=OuterRef('pk'), user=user)
            )
        )
    return qs


class TrackViewSet(viewsets.ModelViewSet):
    queryset = Track.objects.all().order_by('-created_at')
    serializer_class = TrackSerializer
    permission_classes = [IsAuthenticated, IsNotSuspended]
    pagination_class = StandardPagination

    def get_throttles(self):
        # Play reports come from every listener's phone, often as a flushed
        # offline backlog: their own, generous bucket.
        if self.action == 'plays':
            self.throttle_scope = 'plays'
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def get_serializer_class(self):
        # The list drops `lyrics` (see TrackListSerializer) — retrieve, create
        # and update keep the full payload, so editing a track still round-trips
        # its lyrics untouched.
        if self.action == 'list':
            return TrackListSerializer
        return TrackSerializer

    def get_queryset(self):
        """Optimized track list.

        - select_related('artist__profile') so the serializer's artist +
          avatar don't trigger a query per row.
        - annotate likes_total (one COUNT instead of a query per row) and
          liked_by_me (per-user, avoids the is_liked N+1).
        - optional ?search= over title / album / artist username.
        """
        qs = annotated_tracks(self.request.user)

        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(album__icontains=search)
                | Q(artist__username__icontains=search)
            )

        return qs.order_by('-created_at')

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only edit your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only delete your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        title = serializer.validated_data.get('title')
        slug = slugify(title)
        base_slug = slug
        counter = 1
        while Track.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        serializer.save(artist=self.request.user, slug=slug)

    # A capped random sample is enough to seed a "shuffle my library" session and
    # keeps the payload bounded no matter how big the library grows.
    SHUFFLE_DEFAULT = 200
    SHUFFLE_MAX = 500

    @action(detail=False, methods=['get'], url_path='shuffle')
    def shuffle(self, request):
        """Return a random sample of tracks (lean payload) to seed a shuffled
        queue in one request. `?limit=` (default 200, capped at 500). Optional
        `?search=` narrows the pool the same way the list does."""
        try:
            limit = int(request.query_params.get('limit', self.SHUFFLE_DEFAULT))
        except (TypeError, ValueError):
            limit = self.SHUFFLE_DEFAULT
        limit = max(1, min(limit, self.SHUFFLE_MAX))

        qs = Track.objects.filter(is_removed=False).select_related('artist__profile')
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(album__icontains=search)
                | Q(artist__username__icontains=search)
            )
        # order_by('?') = DB-side random; the LIMIT keeps it to `limit` rows.
        tracks = qs.order_by('?')[:limit]
        data = TrackQueueSerializer(tracks, many=True, context={'request': request}).data
        return Response({'results': data, 'count': len(data)})

    @action(detail=True, methods=['get'], url_path='lyrics')
    def lyrics(self, request, pk=None):
        """This track's lyrics, fetched when someone actually opens them.

        Paired with `has_lyrics` on the list payload: the row knows whether to
        show the button without the text, and the text arrives only for the one
        song being read. Deliberately tiny and cacheable — no annotations, no
        joins, one indexed column read.
        """
        try:
            row = Track.objects.filter(is_removed=False).values('id', 'lyrics').get(pk=pk)
        except Track.DoesNotExist:
            return Response({'error': 'Track not found'}, status=status.HTTP_404_NOT_FOUND)
        resp = Response({'id': row['id'], 'lyrics': row['lyrics'] or ''})
        # Lyrics change only when the owner edits the track, so let the client
        # hold onto them rather than re-asking every time the sheet opens.
        resp['Cache-Control'] = 'private, max-age=3600'
        return resp

    @action(detail=False, methods=['post'], url_path='upload')
    def upload_track(self, request):
        # The background uploader retries (and resumes after the app is killed)
        # with the same client_id; the first attempt that landed wins.
        client_id = (request.data.get('client_id') or '').strip()[:64] or None
        if client_id:
            existing = Track.objects.filter(artist=request.user, client_id=client_id).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                serializer.save(artist=request.user, client_id=client_id)
        except IntegrityError:
            existing = client_id and Track.objects.filter(artist=request.user, client_id=client_id).first()
            if not existing:
                raise
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _ordered_rows(self, ids, reasons):
        by_id = {t.id: t for t in self.get_queryset().filter(id__in=ids)}
        rows = [by_id[i] for i in ids if i in by_id]
        data = TrackListSerializer(rows, many=True, context=self.get_serializer_context()).data
        for row, track in zip(data, rows):
            row['reason'] = reasons.get(track.id)
        return data

    @action(detail=False, methods=['get'], url_path='for_you')
    def for_you(self, request):
        """Tracks picked for the viewer from what they (and people like them)
        have liked, each tagged with why: fans_also_like / from_artist / popular."""
        ids, reasons = discovery.for_you(request.user)
        return Response(self._ordered_rows(ids, reasons))

    @action(detail=True, methods=['get'])
    def similar(self, request, pk=None):
        """'More like this' for one track."""
        ids, reasons = discovery.similar(self.get_object(), request.user)
        return Response(self._ordered_rows(ids, reasons))

    # A listener counts toward a track's plays at most this many times a day,
    # so a song left on repeat can't farm its number.
    MAX_COUNTED_PLAYS_PER_DAY = 10
    MAX_PLAY_EVENTS = 50

    @action(detail=False, methods=['post'])
    def plays(self, request):
        """Ingest listens: {"events": [{"play_id", "track", "ms_played",
        "duration_ms"?, "completed"?, "ended"?, "source"?, "network"?,
        "started_at"?}]}.

        The app sends a listen at 30s and again when it ends, under the same
        play_id, and keeps unsent ones in an outbox (offline listening of
        downloads included) — so each event is an idempotent upsert: the
        longest ms_played wins and `completed` never un-sets. A listen of 30s+
        adds one to the track's play count, once; the artist's own listens
        don't count. The track's length is learned here if it's unknown."""
        events = request.data.get('events')
        if not isinstance(events, list):
            return Response({'error': 'events must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        now = timezone.now()

        cleaned = {}
        for e in events[:self.MAX_PLAY_EVENTS]:
            if not isinstance(e, dict):
                continue
            play_id = str(e.get('play_id') or '')[:64]
            try:
                track_id = int(e.get('track'))
                ms = max(0, min(int(e.get('ms_played') or 0), 6 * 3600 * 1000))
                duration = int(e.get('duration_ms') or 0)
            except (TypeError, ValueError):
                continue
            if not play_id:
                continue
            started = parse_datetime(str(e.get('started_at') or '')) if e.get('started_at') else None
            if started is None or timezone.is_naive(started) or not (now - timedelta(days=30) <= started <= now + timedelta(minutes=5)):
                started = now
            prev = cleaned.get(play_id)
            cleaned[play_id] = {
                'track_id': track_id,
                'ms': max(ms, prev['ms']) if prev else ms,
                'duration': duration,
                'completed': bool(e.get('completed')) or bool(prev and prev['completed']),
                'ended': bool(e.get('ended')) or bool(prev and prev['ended']),
                'source': str(e.get('source') or '')[:24],
                'network': str(e.get('network') or '')[:12],
                'started': started,
            }
        if not cleaned:
            return Response({'stored': 0})

        tracks = Track.objects.filter(
            id__in={c['track_id'] for c in cleaned.values()}, is_removed=False,
        ).only('id', 'artist_id', 'duration_ms').in_bulk()
        existing = {
            ev.play_id: ev for ev in
            PlayEvent.objects.filter(user=user, play_id__in=list(cleaned))
        }
        day_ago = now - timedelta(days=1)
        stored = 0
        for play_id, c in cleaned.items():
            track = tracks.get(c['track_id'])
            if track is None:
                continue
            with transaction.atomic():
                ev = existing.get(play_id)
                if ev is None:
                    try:
                        with transaction.atomic():
                            ev = PlayEvent.objects.create(
                                user=user, track=track, play_id=play_id,
                                source=c['source'], network=c['network'], started_at=c['started'],
                            )
                    except IntegrityError:  # the same listen, racing itself
                        ev = PlayEvent.objects.get(user=user, play_id=play_id)
                elif ev.track_id != track.id:
                    continue
                ev.ms_played = max(ev.ms_played, c['ms'])
                ev.completed = ev.completed or c['completed']
                if c['ended']:
                    ev.skipped = not ev.completed and ev.ms_played < PlayEvent.COUNT_AFTER_MS
                length = track.duration_ms or c['duration']
                heard_enough = ev.ms_played >= PlayEvent.COUNT_AFTER_MS or (
                    ev.completed and length and length < PlayEvent.COUNT_AFTER_MS)
                if (heard_enough and not ev.counted and track.artist_id != user.id
                        and PlayEvent.objects.filter(
                            user=user, track=track, counted=True, started_at__gte=day_ago,
                        ).count() < self.MAX_COUNTED_PLAYS_PER_DAY):
                    ev.counted = True
                    Track.objects.filter(pk=track.pk).update(views=F('views') + 1)
                ev.save()
            if not track.duration_ms and 1000 <= c['duration'] <= 4 * 3600 * 1000:
                Track.objects.filter(pk=track.pk, duration_ms__isnull=True).update(duration_ms=c['duration'])
                track.duration_ms = c['duration']
            stored += 1
        return Response({'stored': stored})

    @action(detail=False, methods=['get'])
    def recent(self, request):
        """Recently played: the viewer's last listened tracks, most recent
        first, each once (?limit=, up to 50)."""
        try:
            limit = max(1, min(int(request.query_params.get('limit', 20)), 50))
        except ValueError:
            limit = 20
        ids = list(
            PlayEvent.objects.filter(user=request.user, track__is_removed=False)
            .values('track_id').annotate(last=Max('started_at')).order_by('-last')
            .values_list('track_id', flat=True)[:limit]
        )
        return Response(self._ordered_rows(ids, {}))

    @action(detail=False, methods=['get'])
    def trending_sounds(self, request):
        """Library tracks people are putting on posts right now: most used on
        public posts over the last two weeks. On a quiet week it falls back to
        the most-liked tracks, so the picker's first tab is never empty."""
        since = timezone.now() - timedelta(days=14)
        uses = (
            SocialPost.objects
            .filter(song=OuterRef('pk'), is_removed=False, created_at__gte=since,
                    visibility=SocialPost.VISIBILITY_PUBLIC)
            .order_by().values('song').annotate(n=Count('id')).values('n')[:1]
        )
        base = self.get_queryset().annotate(
            recent_uses=Coalesce(Subquery(uses, output_field=IntegerField()), 0))
        rows = list(base.filter(recent_uses__gt=0).order_by('-recent_uses', '-created_at')[:20])
        if not rows:
            rows = list(base.order_by('-likes_total', '-created_at')[:20])
        data = TrackListSerializer(rows, many=True, context=self.get_serializer_context()).data
        for row, track in zip(data, rows):
            row['recent_uses'] = track.recent_uses
        return Response(data)




    
    @action(detail=True, methods=['post'])
    def like(self, request, pk=None):
        track = self.get_object()
        user = request.user
        # One like per (track, user), enforced by the unique_together on Like.
        # get_or_create rather than exists()-then-create so a double-tap whose
        # two requests overlap loses the duplicate instead of hitting the
        # constraint and 500-ing.
        _like, created = Like.objects.get_or_create(user=user, track=track)
        if not created:
            return Response({"error": "You have already liked this track."}, status=400)
        discovery.forget_for_you(user.id)

    # Return the updated like count
        likes_count = Like.objects.filter(track=track).count()
        return Response({"status": "Track liked", "likes_count": likes_count})



    @action(detail=True, methods=['post'], url_path='toggle-like')
    def toggle_like(self, request, pk=None):
        track = self.get_object()
        user = request.user

        # See `like` above: get_or_create keeps overlapping double-taps off the
        # unique constraint, and the loser reads as the toggle-off it looks like.
        like, created = Like.objects.get_or_create(user=user, track=track)
        # Likes are the taste signal "For you" is built from.
        discovery.forget_for_you(user.id)
        if not created:
            like.delete()
            likes_count = track.likes.count()
            return Response({
                "status": "Track unliked",
                "likes_count": likes_count,
                "is_liked": False
            })
        likes_count = track.likes.count()
        msg = f"{user.username} liked your track {track.title}"
        Notification.objects.create(
            recipient=track.artist,
            sender=user,
            message=msg,
            notification_type='like',
            track=track
        )
        notify_user(track.artist, 'like', msg)
        return Response({
            "status": "Track liked",
            "likes_count": likes_count,
            "is_liked": True
        })
    
  
    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        track = self.get_object()
        if not track.audio_file:
            return Response({'error': 'Audio file not found'}, status=404)
        # The app calls this when it saves a track (to the phone or for offline
        # listening); the counter existed but nothing ever incremented it.
        Track.objects.filter(pk=track.pk).update(downloads=F('downloads') + 1)
        # A copy with the title, artist, album and cover written into the file,
        # so the phone's music player shows the song as it looks in the app.
        url, filename, tagged = audio_tags.tagged_download(track)
        return Response({'download_url': url, 'filename': filename, 'tagged': tagged})
    # "Favorites" == liked tracks. Toggling a favorite is just toggle_like; this
    # endpoint lists the current user's liked tracks for the Favorites screen.
    @action(detail=False, methods=['get'], url_path='favorites')
    def get_favorites(self, request):
        # Reuse the list's optimized queryset (select_related artist__profile +
        # likes_total/liked_by_me annotations) so the Favorites screen isn't an
        # N+1 — the raw Track.objects.filter(...) here used to fire ~3 queries
        # per liked track (artist profile, like count, is-liked). Newest first.
        favorites = self.get_queryset().filter(likes__user=request.user).order_by('-created_at')
        serializer = self.get_serializer(favorites, many=True)
        return Response(serializer.data)



class PlaylistViewSet(viewsets.ModelViewSet):
    queryset = Playlist.objects.all()
    serializer_class = PlaylistSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Playlist.objects.none()
        qs = (
            Playlist.objects
            .filter(user=user)
            .select_related('user__profile')
            .annotate(tracks_total=Count('tracks', distinct=True))
            .order_by('-created_at')
        )
        # The list only renders a count + up to 4 cover thumbnails, so it
        # prefetches just the tracks; detail nests the full track payload
        # (artist + avatar) and needs the deeper prefetch.
        if self.action == 'list':
            return qs.prefetch_related('tracks')
        return qs.prefetch_related('tracks__artist__profile')

    def get_serializer_class(self):
        if self.action == 'list':
            return PlaylistListSerializer
        return PlaylistSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def _serialize_fresh(self, playlist):
        # Re-fetch a plain instance: the object from get_queryset() carries a
        # tracks_total annotation captured before the M2M change, which would
        # make track_count stale in the response.
        fresh = Playlist.objects.get(pk=playlist.pk)
        return Response(
            PlaylistSerializer(fresh, context=self.get_serializer_context()).data
        )

    @action(detail=True, methods=['post'], url_path='add-track')
    def add_track(self, request, pk=None):
        playlist = self.get_object()  # owner check via IsOwnerOrReadOnly
        track = get_object_or_404(Track, id=request.data.get('track_id'))
        playlist.tracks.add(track)
        return self._serialize_fresh(playlist)

    @action(detail=True, methods=['post'], url_path='remove-track')
    def remove_track(self, request, pk=None):
        playlist = self.get_object()  # owner check via IsOwnerOrReadOnly
        track = get_object_or_404(Track, id=request.data.get('track_id'))
        playlist.tracks.remove(track)
        return self._serialize_fresh(playlist)



class CommentViewSet(viewsets.ModelViewSet):
    """A track's comments — the same section as a post's: top comments first,
    reply threads, reactions and @mentions (see songs/comments.py)."""
    queryset = Comment.objects.all()
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = self.request.user
        qs = (Comment.objects.select_related('user', 'user__profile', 'reply_to', 'reply_to__profile')
              .filter(is_removed=False, track__is_removed=False))
        track_id = self.kwargs.get('track_pk')
        if track_id:
            qs = qs.filter(track_id=track_id)
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        if self.action == 'list':
            qs = qs.filter(parent__isnull=True).order_by('-reactions_count', '-created_at', '-id')
        else:
            qs = qs.order_by('-created_at')
        return qs

    def _page_response(self, queryset):
        page = self.paginate_queryset(queryset)
        rows = list(page if page is not None else queryset)
        ctx = self.get_serializer_context()
        ctx['reaction_summaries'] = reaction_summaries([c.id for c in rows], self.request.user, TRACK_COMMENTS)
        data = CommentSerializer(rows, many=True, context=ctx).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    def list(self, request, *args, **kwargs):
        return self._page_response(self.filter_queryset(self.get_queryset()))

    @action(detail=True, methods=['get'])
    def replies(self, request, pk=None, track_pk=None):
        parent = self.get_object()
        blocked = blocked_ids_for(request.user)
        qs = (parent.replies.filter(is_removed=False)
              .select_related('user', 'user__profile', 'reply_to', 'reply_to__profile')
              .order_by('created_at', 'id'))
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        return self._page_response(qs)

    @action(detail=True, methods=['post', 'delete'], permission_classes=[IsAuthenticated])
    def react(self, request, pk=None, track_pk=None):
        comment = self.get_object()
        if request.method == 'DELETE':
            emoji = None
        else:
            emoji = request.data.get('emoji') or COMMENT_LIKE
            if emoji not in COMMENT_REACTIONS:
                return Response({'error': 'Unsupported reaction.'}, status=status.HTTP_400_BAD_REQUEST)
        mine = set_reaction(request.user, comment, emoji, TRACK_COMMENTS)
        summary = reaction_summaries([comment.id], request.user, TRACK_COMMENTS)[comment.id]
        return Response({'reactions': summary, 'mine': mine})

    def create(self, request, *args, **kwargs):
        track = get_object_or_404(Track, id=self.kwargs.get('track_pk'), is_removed=False)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = None
        parent_id = request.data.get('parent')
        if parent_id not in (None, '', 0, '0'):
            try:
                parent = (Comment.objects.select_related('user', 'parent')
                          .filter(pk=int(parent_id), track=track, is_removed=False).first())
            except (TypeError, ValueError):
                parent = None
            if parent is None:
                raise ValidationError({'parent': 'That comment no longer exists.'})
        comment = create_comment(TRACK_COMMENTS, request.user, track, serializer.validated_data['content'], parent)
        return Response(self.get_serializer(comment).data, status=status.HTTP_201_CREATED)



class LikeViewSet(viewsets.ModelViewSet):
    queryset = Like.objects.all()
    serializer_class = LikeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)



class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]



class FavoriteTracksView(APIView):
    permission_classes = [IsAuthenticated]  # Ensure authentication is enforced

    def get(self, request):
        user = request.user
        favorite_tracks = Track.objects.filter(likes__user=user)  # Query for the user's favorites
        serializer = TrackSerializer(favorite_tracks, many=True, context={"request": request})
        return Response(serializer.data, status=200)

