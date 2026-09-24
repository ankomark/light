from .common import *  # noqa: F401,F403
from django.db.models import Exists, OuterRef, Subquery, IntegerField
from django.db.models.functions import Coalesce
from django.db import IntegrityError, transaction
import re
from collections import Counter
from django.db.models import F, Max
from django.utils.dateparse import parse_datetime
from rest_framework.throttling import ScopedRateThrottle
from ..models import Album, PlayEvent, PlaylistTrack
from ..serializers import AlbumSerializer, TrackCardSerializer
from django.db.models import BooleanField, Case, Value, When
from django.db.models import Sum
from django.db.models import Prefetch
from .. import discovery, audio_tags, charts, artists, rights
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
        # The row's genre: one query for the whole page, not one per song.
        .prefetch_related('categories')
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

        # ?genre=<slug>: a genre's page.
        genre = self.request.query_params.get('genre', '').strip()
        if genre:
            qs = qs.filter(categories__slug=genre)

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

    @action(detail=True, methods=['get'], url_path='state')
    def state(self, request, pk=None):
        """What Now Playing needs about the song playing, fresh: likes (and
        whether you liked it), comment count, and the waveform. Songs in the
        queue don't carry these — the heart showed "0, not liked" and a tap on
        a song you'd liked un-liked it (the like endpoint toggles)."""
        track = self.get_queryset().filter(pk=pk).first()
        if track is None:
            return Response({'error': 'Track not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'id': track.id,
            'likes_count': track.likes_total,
            'comments_count': track.comments_total,
            'is_liked': bool(getattr(track, 'liked_by_me', False)),
            'waveform': track.waveform or None,
        })

    @action(detail=True, methods=['get'], url_path='waveform')
    def waveform(self, request, pk=None):
        """The song's waveform for Now Playing's seek bar: ~100 peaks in 0..1,
        or null until the song is processed. Tiny and cacheable, like lyrics."""
        row = Track.objects.filter(is_removed=False, pk=pk).values('id', 'waveform', 'processing_status').first()
        if row is None:
            return Response({'error': 'Track not found'}, status=status.HTTP_404_NOT_FOUND)
        resp = Response({'id': row['id'], 'waveform': row['waveform'] or None})
        # Fixed once made; a song still processing is asked again later.
        if row['waveform']:
            resp['Cache-Control'] = 'private, max-age=86400'
        return resp

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
        # Straight onto one of your albums (an album upload sends each song's
        # place; without one it goes last).
        album_id, number = request.data.get('album_id'), request.data.get('track_number')
        if album_id not in (None, ''):
            if not str(album_id).isdigit() or not Album.objects.filter(pk=album_id, artist=request.user).exists():
                return Response({'album_id': ['Not one of your albums.']}, status=status.HTTP_400_BAD_REQUEST)
            try:
                number = int(number) if number not in (None, '') else None
            except (TypeError, ValueError):
                number = None
            if number is not None and not 1 <= number <= 999:
                number = None
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                track = serializer.save(artist=request.user, client_id=client_id)
                if album_id not in (None, ''):
                    self._put_on_album(track, album_id, number)
        except IntegrityError:
            existing = client_id and Track.objects.filter(artist=request.user, client_id=client_id).first()
            if not existing:
                raise
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return Response(self.get_serializer(track).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _put_on_album(track, album_id, number=None):
        # The album row is locked so two songs uploading at once don't both
        # take the same "next" place.
        album = Album.objects.select_for_update().get(pk=album_id)
        if number is None:
            last = Track.objects.filter(album_ref=album).exclude(pk=track.pk).aggregate(n=Max('track_number'))['n']
            number = (last or 0) + 1
        Track.objects.filter(pk=track.pk).update(album_ref=album, track_number=number, album=album.title)
        track.album_ref_id, track.track_number, track.album = album.id, number, album.title

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
                'country': _country(e.get('country')),
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
        # Everything decided in memory, then written in a few statements: a
        # batch of 20 listens used to be ~100 queries (a count and an update
        # per listen).
        day_ago = now - timedelta(days=1)
        today = dict(
            PlayEvent.objects.filter(user=user, counted=True, started_at__gte=day_ago, track_id__in=list(tracks))
            .values('track_id').annotate(n=Count('id')).values_list('track_id', 'n'))
        new_rows, changed, counted = [], [], Counter()
        lengths = {}
        for play_id, c in cleaned.items():
            track = tracks.get(c['track_id'])
            if track is None:
                continue
            ev = existing.get(play_id)
            if ev is None:
                ev = PlayEvent(user=user, track=track, play_id=play_id, source=c['source'],
                               network=c['network'], country=c['country'], started_at=c['started'])
                new_rows.append(ev)
            elif ev.track_id != track.id:
                continue
            else:
                changed.append(ev)
            ev.ms_played = max(ev.ms_played, c['ms'])
            ev.completed = ev.completed or c['completed']
            if c['ended']:
                ev.skipped = not ev.completed and ev.ms_played < PlayEvent.COUNT_AFTER_MS
            length = track.duration_ms or c['duration']
            heard_enough = ev.ms_played >= PlayEvent.COUNT_AFTER_MS or (
                ev.completed and length and length < PlayEvent.COUNT_AFTER_MS)
            if (heard_enough and not ev.counted and track.artist_id != user.id
                    and today.get(track.id, 0) < self.MAX_COUNTED_PLAYS_PER_DAY):
                ev.counted = True
                today[track.id] = today.get(track.id, 0) + 1
                counted[track.id] += 1
            if not track.duration_ms and 1000 <= c['duration'] <= 4 * 3600 * 1000:
                lengths[track.id] = c['duration']
        with transaction.atomic():
            # A listen sent twice at the same moment (the same play_id racing
            # itself) is stored once.
            PlayEvent.objects.bulk_create(new_rows, ignore_conflicts=True)
            PlayEvent.objects.bulk_update(changed, ['ms_played', 'completed', 'skipped', 'counted'])
            for tid, n in counted.items():
                Track.objects.filter(pk=tid).update(views=F('views') + n)
                # Read back under the row lock the update holds: exactly this
                # batch's before/after, however many listeners count at once,
                # so a milestone is crossed once — even when a batch jumps it.
                after = Track.objects.filter(pk=tid).values_list('views', flat=True).get()
                crossed = [m for m in artists.MILESTONES if after - n < m <= after]
                if crossed:
                    transaction.on_commit(lambda tid=tid, ms=crossed: artists.notify_milestones(tid, ms))
        for tid, ms in lengths.items():
            Track.objects.filter(pk=tid, duration_ms__isnull=True).update(duration_ms=ms)
        stored = len(new_rows) + len(changed)
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
        # ?quality=standard|high: the processed version for offline listening
        # (the phone-save path sends none and gets the original).
        url, filename, tagged = audio_tags.tagged_download(track, request.query_params.get('quality'))
        return Response({'download_url': url, 'filename': filename, 'tagged': tagged})
    # "Favorites" == liked tracks. Toggling a favorite is just toggle_like; this
    # endpoint lists the current user's liked tracks for the Favorites screen.
    @action(detail=False, methods=['get'], url_path='favorites')
    def get_favorites(self, request):
        # Reuse the list's optimized queryset (select_related artist__profile +
        # likes_total/liked_by_me annotations) so the Favorites screen isn't an
        # N+1 — the raw Track.objects.filter(...) here used to fire ~3 queries
        # per liked track (artist profile, like count, is-liked). Newest first.
        # Most recently liked first (it used to be the songs' upload order).
        liked_at = Like.objects.filter(track=OuterRef('pk'), user=request.user).values('created_at')[:1]
        favorites = (self.get_queryset().filter(liked_by_me=True)
                     .annotate(liked_at=Subquery(liked_at)).order_by('-liked_at'))
        serializer = self.get_serializer(favorites, many=True)
        return Response(serializer.data)



def playlist_items_prefetch():
    """The songs of each playlist, in order, with what the collage needs."""
    return Prefetch('items', queryset=PlaylistTrack.objects.select_related('track').order_by('position', 'id'))


def with_playlist_counts(qs):
    return (qs.annotate(tracks_total=Count('items', filter=Q(items__track__is_removed=False), distinct=True))
            .prefetch_related(playlist_items_prefetch()))


class PlaylistViewSet(viewsets.ModelViewSet):
    """Your playlists (the list), and any playlist you may open (detail): your
    own, or someone's public or unlisted one. Only the owner edits one —
    rename, describe, cover, visibility, add / remove / reorder songs."""
    queryset = Playlist.objects.all()
    serializer_class = PlaylistSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        qs = with_playlist_counts(Playlist.objects.select_related('user__profile')).order_by('-updated_at')
        if self.action == 'retrieve':
            # Someone else's: only if they shared it (public / unlisted), and
            # never across a block or from a deactivated account.
            others = (Q(visibility__in=[Playlist.PUBLIC, Playlist.UNLISTED])
                      & Q(user__is_deactivated=False)
                      & ~Q(user__in=Block.objects.filter(blocker=user).values('blocked'))
                      & ~Q(user__in=Block.objects.filter(blocked=user).values('blocker')))
            return qs.filter(Q(user=user) | others)
        return qs.filter(user=user)

    def get_serializer_class(self):
        if self.action == 'list':
            return PlaylistListSerializer
        return PlaylistSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def _ordered_tracks(self, playlist):
        ids = list(PlaylistTrack.objects.filter(playlist=playlist)
                   .order_by('position', 'id').values_list('track_id', flat=True))
        by_id = annotated_tracks(self.request.user).filter(id__in=ids).in_bulk()
        return [by_id[i] for i in ids if i in by_id]

    def _respond(self, playlist, status_code=status.HTTP_200_OK):
        # Re-read: counts and the collage change with the songs.
        fresh = with_playlist_counts(Playlist.objects.select_related('user__profile')).get(pk=playlist.pk)
        ctx = {**self.get_serializer_context(), 'ordered_tracks': self._ordered_tracks(fresh)}
        return Response(PlaylistSerializer(fresh, context=ctx).data, status=status_code)

    def retrieve(self, request, *args, **kwargs):
        return self._respond(self.get_object())

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._respond(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        playlist = self.get_object()
        serializer = self.get_serializer(playlist, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return self._respond(playlist)

    @action(detail=True, methods=['post'], url_path='add-track')
    def add_track(self, request, pk=None):
        playlist = self.get_object()  # owner check via IsOwnerOrReadOnly
        track = get_object_or_404(Track, id=request.data.get('track_id'), is_removed=False)
        with transaction.atomic():
            if not PlaylistTrack.objects.filter(playlist=playlist, track=track).exists():
                last = PlaylistTrack.objects.filter(playlist=playlist).aggregate(m=Max('position'))['m']
                PlaylistTrack.objects.create(playlist=playlist, track=track,
                                             position=0 if last is None else last + 1)
                Playlist.objects.filter(pk=playlist.pk).update(updated_at=timezone.now())
        return self._respond(playlist)

    @action(detail=True, methods=['post'], url_path='remove-track')
    def remove_track(self, request, pk=None):
        playlist = self.get_object()  # owner check via IsOwnerOrReadOnly
        PlaylistTrack.objects.filter(playlist=playlist, track_id=request.data.get('track_id')).delete()
        Playlist.objects.filter(pk=playlist.pk).update(updated_at=timezone.now())
        return self._respond(playlist)

    @action(detail=True, methods=['post'])
    def reorder(self, request, pk=None):
        """{"track_ids": [...]}: the playlist's songs in their new order —
        exactly the songs it has, each once."""
        playlist = self.get_object()  # owner check via IsOwnerOrReadOnly
        items = {i.track_id: i for i in PlaylistTrack.objects.filter(playlist=playlist)}
        try:
            ids = [int(i) for i in request.data.get('track_ids')]
        except (TypeError, ValueError):
            return Response({'error': 'track_ids must be a list of song ids'}, status=status.HTTP_400_BAD_REQUEST)
        if len(ids) != len(set(ids)) or set(ids) != set(items):
            return Response({'error': "track_ids must be exactly this playlist's songs"},
                            status=status.HTTP_400_BAD_REQUEST)
        for pos, tid in enumerate(ids):
            items[tid].position = pos
        PlaylistTrack.objects.bulk_update(list(items.values()), ['position'])
        Playlist.objects.filter(pk=playlist.pk).update(updated_at=timezone.now())
        return self._respond(playlist)


_COUNTRY = re.compile(r'^[A-Z]{2}$')


def _country(value):
    """A two-letter region code (the phone's), or ''."""
    code = str(value or '').strip().upper()
    return code if _COUNTRY.match(code) else ''


def card_tracks():
    """The query behind song cards: no per-row counts, and the lyrics text
    left in the database (only whether there are any comes back)."""
    has_lyrics = Case(When(Q(lyrics__isnull=True) | Q(lyrics=''), then=Value(False)), default=Value(True),
                      output_field=BooleanField())
    return (Track.objects.filter(is_removed=False).select_related('artist__profile')
            .defer('lyrics', 'waveform').annotate(has_lyrics_flag=has_lyrics))


def _rows(ids, user, context, extra=None):
    """Song cards for `ids`, in that order, in one query."""
    by_id = card_tracks().filter(id__in=ids).in_bulk()
    tracks = [by_id[i] for i in ids if i in by_id]
    data = TrackCardSerializer(tracks, many=True, context=context).data
    if extra:
        for row in data:
            row.update(extra.get(row['id'], {}))
    return data


class MusicHomeView(APIView):
    """The Music home in one request (it matters on a slow connection):

      recent        what you played last
      for_you       picked from what you like and listen to (with reasons)
      trending      the most played this week — in your country when it has
                    its own charts, else worldwide
      new_releases  uploaded in the last month
      following     new from the artists you follow
      top_country   Top 50 of your country (?country=, the phone's region),
                    first ten — null until it has enough listening
      top_world     worldwide Top 50, first ten
      genres        the genres that have songs, with a cover each
      libraries     artists (choirs) with albums, most played first
    """
    permission_classes = [IsAuthenticated]
    RAIL = 20
    CHART_PREVIEW = 10

    def get(self, request):
        me = request.user
        country = _country(request.query_params.get('country'))
        now = timezone.now()

        recent = list(
            PlayEvent.objects.filter(user=me, track__is_removed=False)
            .values('track_id').annotate(last=Max('started_at')).order_by('-last')
            .values_list('track_id', flat=True)[:self.RAIL])
        for_you, reasons = discovery.for_you(me)
        top_country = charts.read('top', country) if country else []
        top_world = charts.read('top')
        trending = [t for t, _ in (charts.read('trending', country) if top_country else [])] or \
            [t for t, _ in charts.read('trending')]
        new_releases = list(
            Track.objects.filter(is_removed=False, created_at__gte=now - timedelta(days=30))
            .exclude(artist=me).order_by('-created_at').values_list('id', flat=True)[:self.RAIL])
        following = list(
            Track.objects.filter(is_removed=False, artist__in=me.followed_by.all(),
                                 created_at__gte=now - timedelta(days=90))
            .order_by('-created_at').values_list('id', flat=True)[:self.RAIL])

        top_country = top_country[:self.CHART_PREVIEW]
        top_world = top_world[:self.CHART_PREVIEW]
        # One query for every song on the page.
        ids = list(dict.fromkeys(
            recent + for_you + trending[:self.RAIL] + new_releases + following
            + [t for t, _ in top_country] + [t for t, _ in top_world]))
        ctx = {'request': request}
        rows = {r['id']: r for r in _rows(ids, me, ctx)}
        pick = lambda tids: [rows[t] for t in tids if t in rows]  # noqa: E731

        def chart(entries, code):
            if not entries:
                return None
            return {'country': code, 'tracks': [
                {**rows[t], 'position': i + 1, 'plays': n} for i, (t, n) in enumerate(entries) if t in rows]}

        genres = (Category.objects.exclude(slug__isnull=True)
                  .annotate(track_count=Count('tracks', filter=Q(tracks__is_removed=False), distinct=True))
                  .filter(track_count__gt=0).order_by('position', 'name'))
        genre_rows = []
        for g in genres:
            cover = (g.tracks.filter(is_removed=False).exclude(cover_image__isnull=True).exclude(cover_image='')
                     .order_by('-views', '-created_at').values_list('cover_medium', 'cover_image').first())
            genre_rows.append({
                'slug': g.slug, 'name': g.name, 'track_count': g.track_count,
                'cover': media.resolve(cover[0] or cover[1]) if cover else None,
            })

        return Response({
            'recent': pick(recent),
            'for_you': [{**rows[t], 'reason': reasons.get(t)} for t in for_you if t in rows],
            'trending': pick(trending[:self.RAIL]),
            'new_releases': pick(new_releases),
            'following': pick(following),
            'top_country': chart(top_country, country),
            'top_world': chart(top_world, ''),
            'genres': genre_rows,
            'libraries': library_artists(me),
        })


class MusicChartView(APIView):
    """A whole chart: GET /music/charts/<trending|top>/?country=KE (no
    country: worldwide). Each row carries its position and plays."""
    permission_classes = [IsAuthenticated]

    def get(self, request, chart):
        if chart not in ('trending', 'top'):
            return Response({'error': 'Unknown chart'}, status=status.HTTP_404_NOT_FOUND)
        country = _country(request.query_params.get('country'))
        entries = charts.read(chart, country)
        info = {t: {'position': i + 1, 'plays': n} for i, (t, n) in enumerate(entries)}
        rows = _rows([t for t, _ in entries], request.user, {'request': request}, info)
        return Response({'chart': chart, 'country': country, 'tracks': rows})


def albums_with_counts(qs):
    live = Q(tracks__is_removed=False)
    first_cover = (Track.objects.filter(album_ref=OuterRef('pk'), is_removed=False)
                   .exclude(cover_image__isnull=True).exclude(cover_image='')
                   .order_by('track_number', 'id').values('cover_image')[:1])
    return qs.select_related('artist__profile').annotate(
        track_count=Count('tracks', filter=live, distinct=True),
        duration_total=Sum('tracks__duration_ms', filter=live),
        first_cover=Subquery(first_cover),
    # Spelled out: Django drops Meta.ordering from a query with aggregates.
    ).order_by(F('release_date').desc(nulls_last=True), '-created_at', '-id')


def _visible_artists(me):
    """Accounts whose music `me` may browse: not deactivated, no block either
    way, and public — or private but followed by `me` (or `me`)."""
    return (User.objects.filter(is_deactivated=False)
            .exclude(pk__in=Block.objects.filter(blocker=me).values('blocked'))
            .exclude(pk__in=Block.objects.filter(blocked=me).values('blocker'))
            # (A subquery, not a join on followers: that would repeat each
            # account once per follower and inflate the sums over it.)
            .filter(Q(profile__isnull=True) | Q(profile__is_public=True) | Q(pk=me.pk)
                    | Q(pk__in=me.followed_by.values('pk'))))


def library_artists(me, limit=20):
    """The Music home's Libraries: artists (choirs) with at least one album
    that has songs, most played first. [{id, username, profile_picture,
    verified, album_count, track_count, cover}]"""
    live = Q(albums__tracks__is_removed=False)
    artists_qs = (_visible_artists(me).filter(live).select_related('profile')
                  .annotate(album_count=Count('albums', filter=live, distinct=True),
                            track_count=Count('albums__tracks', filter=live, distinct=True),
                            plays=Sum('albums__tracks__views', filter=live))
                  .order_by("-plays", "-album_count", "id")[:limit])
    rows = list(artists_qs)
    # The newest album's cover stands in for an account without a picture.
    covers = {}
    for a in albums_with_counts(Album.objects.filter(artist__in=rows)).filter(track_count__gt=0):
        covers.setdefault(a.artist_id, a.cover_image or a.first_cover)
    out = []
    for u in rows:
        picture = media.resolve(u.profile.picture) if hasattr(u, 'profile') and u.profile.picture else None
        cover = covers.get(u.id)
        out.append({
            'id': u.id, 'username': u.username, 'profile_picture': picture,
            'verified': u.is_verified_artist, 'album_count': u.album_count,
            'track_count': u.track_count, 'cover': media.resolve(cover) if cover else picture,
        })
    return out


def artist_library(artist, me, context):
    """An artist's whole library: every album (newest first) and every album
    song in album order, for Play all / Shuffle across it."""
    albums = albums_with_counts(Album.objects.filter(artist=artist))
    if artist != me:
        albums = albums.filter(track_count__gt=0)
    albums = list(albums)
    rank = {a.id: i for i, a in enumerate(albums)}
    songs = sorted(
        Track.objects.filter(album_ref__in=albums, is_removed=False).values_list('id', 'album_ref_id', 'track_number'),
        key=lambda r: (rank[r[1]], r[2] is None, r[2] or 0, r[0]))
    tracks = _rows([r[0] for r in songs], me, context)
    return {
        'artist': SimpleUserSerializer(artist, context=context).data,
        'album_count': len(albums),
        'track_count': len(tracks),
        'duration_ms': sum(a.duration_total or 0 for a in albums),
        'albums': AlbumSerializer(albums, many=True, context=context).data,
        'tracks': tracks,
    }


class AlbumViewSet(viewsets.ModelViewSet):
    """Albums. ?artist=<id> lists an artist's (yours without it); anyone signed
    in can open one; only the artist edits it or sets its songs — which must
    be their own songs."""
    queryset = Album.objects.all()
    serializer_class = AlbumSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        me = self.request.user
        qs = albums_with_counts(Album.objects.all())
        # Never across a block or from a deactivated account (yours always).
        qs = qs.filter(Q(artist=me) | (Q(artist__is_deactivated=False)
                       & ~Q(artist__in=Block.objects.filter(blocker=me).values('blocked'))
                       & ~Q(artist__in=Block.objects.filter(blocked=me).values('blocker'))))
        if self.action == 'list':
            artist = self.request.query_params.get('artist')
            if artist and str(artist) != str(me.pk):
                qs = qs.filter(artist_id=artist, track_count__gt=0)   # others: only albums with songs
            else:
                qs = qs.filter(artist=me)
        return qs

    def perform_create(self, serializer):
        serializer.save(artist=self.request.user)

    def _songs(self, album):
        ids = list(Track.objects.filter(album_ref=album, is_removed=False)
                   .order_by('track_number', 'id').values_list('id', flat=True))
        by_id = annotated_tracks(self.request.user).filter(id__in=ids).in_bulk()
        return [by_id[i] for i in ids if i in by_id]

    def _respond(self, album, code=status.HTTP_200_OK):
        fresh = albums_with_counts(Album.objects.filter(pk=album.pk)).get()
        ctx = {**self.get_serializer_context(), 'album_tracks': self._songs(fresh)}
        return Response(AlbumSerializer(fresh, context=ctx).data, status=code)

    def retrieve(self, request, *args, **kwargs):
        return self._respond(self.get_object())

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._respond(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        album = self.get_object()
        serializer = self.get_serializer(album, data=request.data, partial=kwargs.pop('partial', False))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # The name shown on its songs follows the album's.
        Track.objects.filter(album_ref=album).update(album=album.title)
        return self._respond(album)

    def perform_destroy(self, album):
        Track.objects.filter(album_ref=album).update(album_ref=None, track_number=None, album=None)
        album.delete()

    @action(detail=True, methods=['post'], url_path='set-tracks')
    def set_tracks(self, request, pk=None):
        """{"track_ids": [...]}: the album's songs, in order — your own songs.
        Songs left out come off the album; a song on another of your albums
        moves to this one."""
        album = self.get_object()  # owner check via IsOwnerOrReadOnly
        try:
            ids = [int(i) for i in request.data.get('track_ids')]
        except (TypeError, ValueError):
            return Response({'error': 'track_ids must be a list of song ids'}, status=status.HTTP_400_BAD_REQUEST)
        if len(ids) != len(set(ids)):
            return Response({'error': 'a song can only be on an album once'}, status=status.HTTP_400_BAD_REQUEST)
        mine = set(Track.objects.filter(id__in=ids, artist=request.user, is_removed=False).values_list('id', flat=True))
        if mine != set(ids):
            return Response({'error': 'only your own songs can go on your album'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            Track.objects.filter(album_ref=album).exclude(id__in=ids).update(album_ref=None, track_number=None, album=None)
            for n, tid in enumerate(ids, start=1):
                Track.objects.filter(pk=tid).update(album_ref=album, track_number=n, album=album.title)
            Album.objects.filter(pk=album.pk).update(updated_at=timezone.now())
        return self._respond(album)


class TrackDisputeView(APIView):
    """POST /tracks/<id>/dispute/ {message, good_faith}: the uploader asks for
    their removed song to be reviewed (songs/rights.py)."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'disputes'

    def get_throttles(self):
        return [ScopedRateThrottle()]

    def post(self, request, pk):
        track = Track.objects.filter(pk=pk, artist=request.user).first()
        if track is None:
            return Response({'error': 'Song not found'}, status=status.HTTP_404_NOT_FOUND)
        appeal, error = rights.open_dispute(request.user, track, request.data.get('message'),
                                            bool(request.data.get('good_faith')))
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'id': appeal.id, 'status': appeal.status}, status=status.HTTP_201_CREATED)


class RemovedSongsView(APIView):
    """GET /studio/removed/: your removed songs, why, and your disputes."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(rights.removed_songs(request.user))


class StudioView(APIView):
    """Artist Studio: your streams, listeners, completion, likes, followers,
    daily streams, top songs, countries and where listens start, for the
    last ?days=7|28|90 (with change on the period before)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get('days', 28))
        except ValueError:
            days = 28
        return Response(artists.studio(request.user, days))


class LibraryView(APIView):
    """Everything the Library screen opens on, in one request (it matters on a
    slow connection): Liked Songs' count and covers, your playlists, and what
    you played last. Downloads live on the phone and aren't here."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        me = request.user
        liked = Track.objects.filter(is_removed=False, likes__user=me).order_by('-likes__created_at')
        covers = []
        for small, full in liked.values_list('cover_small', 'cover_image')[:12]:
            url = media.resolve(small or full) if (small or full) else None
            if url:
                covers.append(url)
            if len(covers) == 4:
                break
        playlists = with_playlist_counts(Playlist.objects.filter(user=me)).order_by('-updated_at')
        recent_ids = list(
            PlayEvent.objects.filter(user=me, track__is_removed=False)
            .values('track_id').annotate(last=Max('started_at')).order_by('-last')
            .values_list('track_id', flat=True)[:10]
        )
        by_id = card_tracks().filter(id__in=recent_ids).in_bulk()
        recent = [by_id[i] for i in recent_ids if i in by_id]
        ctx = {'request': request}
        return Response({
            'liked': {'count': liked.count(), 'covers': covers},
            'playlists': PlaylistListSerializer(playlists, many=True, context=ctx).data,
            'recent': TrackCardSerializer(recent, many=True, context=ctx).data,
        })


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



class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    """Music genres, for the upload picker and the Music home. Read-only:
    genres are managed in the admin (any signed-in user could create, rename
    or delete them through this endpoint before)."""
    queryset = Category.objects.all()  # names the route; get_queryset filters
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return Category.objects.exclude(slug__isnull=True).annotate(
            track_count=Count('tracks', filter=Q(tracks__is_removed=False), distinct=True),
        ).order_by('position', 'name')



class FavoriteTracksView(APIView):
    permission_classes = [IsAuthenticated]  # Ensure authentication is enforced

    def get(self, request):
        user = request.user
        favorite_tracks = Track.objects.filter(likes__user=user)  # Query for the user's favorites
        serializer = TrackSerializer(favorite_tracks, many=True, context={"request": request})
        return Response(serializer.data, status=200)

