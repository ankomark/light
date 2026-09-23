from .common import *  # noqa: F401,F403
from ..models import Album


class GenreField(serializers.Field):
    """A song's genre: written as the genre's slug ('' or null for none),
    read as {slug, name} (or null). Stored on the Category many-to-many,
    one genre per song."""

    def __init__(self, **kwargs):
        kwargs.setdefault('source', '*')
        kwargs.setdefault('required', False)
        kwargs.setdefault('allow_null', True)
        super().__init__(**kwargs)

    def to_representation(self, track):
        # Reads the prefetched categories when the view provided them.
        cats = [c for c in track.categories.all() if c.slug]
        if not cats:
            return None
        return {'slug': cats[0].slug, 'name': cats[0].name}

    def to_internal_value(self, data):
        if data in (None, ''):
            return {'genre': None}
        genre = Category.objects.filter(slug=str(data)).exclude(slug__isnull=True).first()
        if genre is None:
            raise serializers.ValidationError('Unknown genre.')
        return {'genre': genre}


class TrackSerializer(serializers.ModelSerializer):
     likes_count = serializers.SerializerMethodField()
     comments_count = serializers.SerializerMethodField()
     has_lyrics = serializers.SerializerMethodField()
     is_liked = serializers.SerializerMethodField()
     # Lightweight artist ref. The full UserSerializer caused infinite recursion
     # (track.artist -> social_posts -> post.song -> track.artist -> ...), and
     # DetailedUserSerializer still ran a followers COUNT per row (an N+1).
     # SimpleUserSerializer exposes exactly what clients read (id, username,
     # profile_picture) with no per-row queries.
     artist = SimpleUserSerializer(read_only=True)
     is_owner = serializers.SerializerMethodField() 
     audio_file = MediaReferenceField()
     cover_image = MediaReferenceField(required=False)
     # Processed versions (songs/audio_processing.py); null until ready, when
     # the app plays `audio_file`.
     audio_low = MediaReferenceField(read_only=True)
     audio_standard = MediaReferenceField(read_only=True)
     audio_high = MediaReferenceField(read_only=True)
     cover_small = MediaReferenceField(read_only=True)
     cover_medium = MediaReferenceField(read_only=True)
     genre = GenreField()
     # The album the song is on (see AlbumViewSet.set_tracks), and its place there.
     album_id = serializers.IntegerField(source='album_ref_id', read_only=True)
     class Meta:
        model = Track
        fields = [
            'id', 'title', 'artist', 'album', 'audio_file','is_owner',
            'cover_image', 'lyrics', 'has_lyrics', 'slug', 'duration_ms',
            'audio_low', 'audio_standard', 'audio_high', 'cover_small', 'cover_medium',
            'processing_status', 'waveform', 'genre', 'album_id', 'track_number',
            'views', 'downloads','likes_count','comments_count','is_liked',
            'created_at', 'updated_at'
        ]
        # `views` is the play count (listens of 30s+); see PlayEvent.
        # A song joins an album through the album (POST /albums/<id>/set-tracks/).
        read_only_fields = ['artist', 'slug', 'views', 'downloads', 'created_at', 'updated_at',
                            'processing_status', 'waveform', 'album_id', 'track_number']
        # extra_kwargs = {
        #     'title': {'required': True, 'max_length': 200},
        #     'lyrics': {'allow_blank': True}
        # }
     def validate_duration_ms(self, value):
        # The app measures the file before uploading it. Anything outside a
        # second to four hours is a bad reading; keep it unknown instead.
        if value is not None and not (1000 <= value <= 4 * 3600 * 1000):
            return None
        return value

     def create(self, validated_data):
        genre_given = 'genre' in validated_data
        genre = validated_data.pop('genre', None)
        track = super().create(validated_data)
        if genre_given and genre:
            track.categories.set([genre])
        return track

     def update(self, instance, validated_data):
        # Set once (upload, first play or backfill), never edited after.
        if instance.duration_ms:
            validated_data.pop('duration_ms', None)
        genre_given = 'genre' in validated_data
        genre = validated_data.pop('genre', None)
        track = super().update(instance, validated_data)
        if genre_given:
            track.categories.set([genre] if genre else [])
        return track

     def validate_title(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Title cannot be empty")
        return value.strip()
     def get_likes_count(self, obj):
        # Prefer the annotation set by TrackViewSet.get_queryset to avoid a
        # COUNT query per row; fall back to a live count for other call sites.
        count = getattr(obj, 'likes_total', None)
        return count if count is not None else obj.likes.count()
     def get_comments_count(self, obj):
        # Annotation from TrackViewSet.get_queryset. The count exists so the
        # row's comment button can show a number without the client fetching
        # the whole comment list per track just to call .length on it.
        count = getattr(obj, 'comments_total', None)
        return count if count is not None else obj.comments.filter(is_removed=False).count()

     def get_has_lyrics(self, obj):
        # Lets the list hide or show the lyrics button without shipping the
        # lyrics themselves — see TrackListSerializer.
        return bool((obj.lyrics or '').strip())

     def get_is_liked(self, obj):
        # Prefer the per-user annotation (liked_by_me) to avoid an N+1 query.
        liked = getattr(obj, 'liked_by_me', None)
        if liked is not None:
            return liked
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False
  
     def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.artist == request.user



class TrackListSerializer(TrackSerializer):
    """The library list payload: everything TrackSerializer has EXCEPT the
    lyrics themselves.

    Lyrics are a full song's text — commonly 1–3 KB each, and the single
    largest field on a track. Twenty of them per page is most of the response
    body, spent on text that is only read when someone actually opens the
    lyrics sheet for one song. The list carries `has_lyrics` instead, which is
    all the row needs to decide whether to show the button, and the text is
    fetched per-track on open (see TrackViewSet.lyrics).
    """

    class Meta(TrackSerializer.Meta):
        # Nor the waveform (100 numbers a row): only the song's own page draws it.
        fields = [f for f in TrackSerializer.Meta.fields if f not in ('lyrics', 'waveform')]


class TrackQueueSerializer(serializers.ModelSerializer):
    """Lean payload for building a playback queue (e.g. shuffle). Only the fields
    the player needs — no per-row like counts / annotations / ownership — so a
    capped random sample of many tracks stays one small request."""
    artist = SimpleUserSerializer(read_only=True)
    audio_file = MediaReferenceField()
    cover_image = MediaReferenceField(required=False)
    audio_low = MediaReferenceField(read_only=True)
    audio_standard = MediaReferenceField(read_only=True)
    audio_high = MediaReferenceField(read_only=True)
    cover_small = MediaReferenceField(read_only=True)
    cover_medium = MediaReferenceField(read_only=True)

    class Meta:
        model = Track
        # No lyrics: a 200-track shuffle sample was shipping 200 song texts to
        # build a queue, and the player fetches the current track's lyrics on
        # demand anyway.
        fields = ['id', 'title', 'artist', 'album', 'audio_file', 'cover_image',
                  'has_lyrics', 'slug', 'duration_ms', 'views',
                  'audio_low', 'audio_standard', 'audio_high', 'cover_small', 'cover_medium']

    has_lyrics = serializers.SerializerMethodField()

    def get_has_lyrics(self, obj):
        return bool((obj.lyrics or '').strip())


def playlist_collage(playlist):
    """Up to four covers (small size when processed) from the playlist's first
    songs, for the collage shown when it has no cover of its own. Reads the
    prefetched `items` when the view provided them."""
    urls = []
    for item in playlist.items.all():
        ref = item.track.cover_small or item.track.cover_image
        url = media.resolve(ref) if ref else None
        if url:
            urls.append(url)
        if len(urls) == 4:
            break
    return urls


class PlaylistListSerializer(serializers.ModelSerializer):
    """A playlist in a list (the Library, a profile, the add-to sheet): counts
    and covers, no songs."""
    cover_image = MediaReferenceField(required=False, allow_null=True)
    track_count = serializers.SerializerMethodField()
    cover_images = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = ('id', 'name', 'description', 'cover_image', 'visibility',
                  'track_count', 'cover_images', 'created_at', 'updated_at')

    def get_track_count(self, obj):
        count = getattr(obj, 'tracks_total', None)
        return count if count is not None else obj.items.count()

    def get_cover_images(self, obj):
        return playlist_collage(obj)


class PlaylistSerializer(PlaylistListSerializer):
    """One playlist, with its songs in order.

    The songs come from the view (context['ordered_tracks']): a playlist of 40
    used to cost a like-count and is-liked query per song; the view builds them
    in one annotated query instead."""
    # Slim owner ref (the full UserSerializer drags in the whole social-posts
    # payload, which is wasteful for a playlist).
    user = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    tracks = serializers.SerializerMethodField()
    duration_ms = serializers.SerializerMethodField()

    class Meta(PlaylistListSerializer.Meta):
        fields = PlaylistListSerializer.Meta.fields + ('user', 'is_owner', 'tracks', 'duration_ms')

    def validate_name(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('A playlist needs a name.')
        return value

    def validate_description(self, value):
        return (value or '').strip()

    def to_internal_value(self, data):
        # The cover column is a plain string: "no cover" is '' not NULL.
        out = super().to_internal_value(data)
        if 'cover_image' in out and out['cover_image'] is None:
            out['cover_image'] = ''
        return out

    def _tracks(self, obj):
        rows = self.context.get('ordered_tracks')
        return rows if rows is not None else [i.track for i in obj.items.select_related('track') if not i.track.is_removed]

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.user_id == request.user.id)

    def get_tracks(self, obj):
        return TrackListSerializer(self._tracks(obj), many=True, context=self.context).data

    def get_duration_ms(self, obj):
        return sum(t.duration_ms or 0 for t in self._tracks(obj))


class AlbumSerializer(serializers.ModelSerializer):
    """An album. In a list: counts and cover; opened (context['album_tracks']),
    with its songs in order. `cover` is its own cover, else its first song's."""
    artist = SimpleUserSerializer(read_only=True)
    cover_image = MediaReferenceField(required=False, allow_null=True)
    cover = serializers.SerializerMethodField()
    track_count = serializers.IntegerField(read_only=True, default=0)
    duration_ms = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Album
        fields = ('id', 'title', 'description', 'cover_image', 'cover', 'release_date', 'artist',
                  'track_count', 'duration_ms', 'is_owner', 'created_at')

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('An album needs a title.')
        return value

    def validate_description(self, value):
        return (value or '').strip()

    def to_internal_value(self, data):
        out = super().to_internal_value(data)
        if 'cover_image' in out and out['cover_image'] is None:
            out['cover_image'] = ''
        return out

    def get_cover(self, obj):
        if obj.cover_image:
            return media.resolve(obj.cover_image)
        first = getattr(obj, 'first_cover', None)
        return media.resolve(first) if first else None

    def get_duration_ms(self, obj):
        return getattr(obj, 'duration_total', None) or 0

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.artist_id == request.user.id)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        tracks = self.context.get('album_tracks')
        if tracks is not None:
            data['tracks'] = TrackListSerializer(tracks, many=True, context=self.context).data
        return data


class CommentSerializer(serializers.ModelSerializer):
    # SimpleUserSerializer (id, username, profile_picture) avoids the per-comment
    # cost of DetailedUserSerializer; track is just its id, not the full nested
    # track re-serialized on every row.
    user = SimpleUserSerializer(read_only=True)
    track = serializers.PrimaryKeyRelatedField(read_only=True)
    # Same thread/reaction fields as post comments, so one comment sheet
    # renders both.
    parent = serializers.PrimaryKeyRelatedField(read_only=True)
    reply_to = SimpleUserSerializer(read_only=True)
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ('id', 'content', 'user', 'track', 'created_at', 'updated_at',
                  'parent', 'reply_to', 'replies_count', 'reactions')
        read_only_fields = ('parent', 'reply_to', 'replies_count')

    def validate_content(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Comment cannot be empty.')
        if len(value) > 2200:
            raise serializers.ValidationError('Comment is too long.')
        return value

    def get_reactions(self, obj):
        summaries = self.context.get('reaction_summaries')
        if summaries is not None and obj.id in summaries:
            return summaries[obj.id]
        from ..comments import reaction_summaries, TRACK
        request = self.context.get('request')
        return reaction_summaries([obj.id], getattr(request, 'user', None), TRACK)[obj.id]



class LikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    track = TrackSerializer(read_only=True)
    class Meta:
        model = Like
        fields = ('id', 'user', 'track', 'created_at')



class CategorySerializer(serializers.ModelSerializer):
    # (It listed created_at / updated_at, which genres don't have: the
    # endpoint answered every request with an error.)
    track_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = ('id', 'slug', 'name', 'track_count')



class AvatarUploadSerializer(serializers.Serializer):
    avatar = serializers.ImageField(
        write_only=True,
        required=True,
        validators=[FileSizeValidator(max_size_mb=5)],
        help_text="Image file for avatar upload (max 5MB)"
    )



class TrackUploadSerializer(serializers.Serializer):
    audio_file = serializers.FileField(
        write_only=True,
        required=True,
        validators=[FileSizeValidator(max_size_mb=20)],
        help_text="Audio file upload (max 20MB)"
    )
    cover_image = serializers.ImageField(
        write_only=True,
        required=False,
        validators=[FileSizeValidator(max_size_mb=5)],
        help_text="Optional cover image (max 5MB)"
    )

