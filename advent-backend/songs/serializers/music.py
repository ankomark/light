from .common import *  # noqa: F401,F403


class TrackSerializer(serializers.ModelSerializer):
     likes_count = serializers.SerializerMethodField()
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
     class Meta:
        model = Track
        fields = [
            'id', 'title', 'artist', 'album', 'audio_file','is_owner',
            'cover_image', 'lyrics', 'slug', 
            'views', 'downloads','likes_count','is_liked', 'created_at', 'updated_at'
        ]
        read_only_fields = ['artist', 'slug', 'views', 'downloads', 'created_at', 'updated_at']
        # extra_kwargs = {
        #     'title': {'required': True, 'max_length': 200},
        #     'lyrics': {'allow_blank': True}
        # }
     def validate_title(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Title cannot be empty")
        return value.strip()
     def get_likes_count(self, obj):
        # Prefer the annotation set by TrackViewSet.get_queryset to avoid a
        # COUNT query per row; fall back to a live count for other call sites.
        count = getattr(obj, 'likes_total', None)
        return count if count is not None else obj.likes.count()
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



class PlaylistSerializer(serializers.ModelSerializer):
    # Slim owner ref (the full UserSerializer drags in the whole social-posts
    # payload, which is wasteful for a playlist).
    user = SimpleUserSerializer(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    track_count = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = ('id', 'name', 'user', 'tracks', 'track_count', 'created_at', 'updated_at')

    def get_track_count(self, obj):
        count = getattr(obj, 'tracks_total', None)
        return count if count is not None else obj.tracks.count()


class PlaylistListSerializer(serializers.ModelSerializer):
    """Lightweight playlist for list views: counts + a few cover thumbnails,
    no nested track payloads."""
    track_count = serializers.SerializerMethodField()
    cover_images = serializers.SerializerMethodField()

    class Meta:
        model = Playlist
        fields = ('id', 'name', 'track_count', 'cover_images', 'created_at', 'updated_at')

    def get_track_count(self, obj):
        count = getattr(obj, 'tracks_total', None)
        return count if count is not None else obj.tracks.count()

    def get_cover_images(self, obj):
        # Up to 4 covers for a collage; reads the prefetched tracks cache.
        field = CloudinaryFieldSerializer()
        urls = []
        for track in list(obj.tracks.all())[:4]:
            if track.cover_image:
                url = field.to_representation(track.cover_image)
                if url:
                    urls.append(url)
        return urls



class CommentSerializer(serializers.ModelSerializer):
    # SimpleUserSerializer (id, username, profile_picture) avoids the per-comment
    # cost of DetailedUserSerializer; track is just its id, not the full nested
    # track re-serialized on every row.
    user = SimpleUserSerializer(read_only=True)
    track = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Comment
        fields = ('id', 'content', 'user', 'track', 'created_at', 'updated_at')



class LikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    track = TrackSerializer(read_only=True)
    class Meta:
        model = Like
        fields = ('id', 'user', 'track', 'created_at')



class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ('id', 'name', 'created_at', 'updated_at')



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

