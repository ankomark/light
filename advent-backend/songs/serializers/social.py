from .common import *  # noqa: F401,F403
from .music import TrackSerializer


class SocialPostSerializer(serializers.ModelSerializer):
    user = DetailedUserSerializer(read_only=True)
    song = TrackSerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    media_url = serializers.SerializerMethodField()
    media_items = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    optimized_url = serializers.SerializerMethodField()
    song_id = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(),
        source='song',
        write_only=True,
        required=False,
        allow_null=True
    )

    class Meta:
        model = SocialPost
        fields = [
            'id', 'user', 'content_type', 'media_file', 'media_url', 'media_items',
            'gallery', 'song','song_id',
            'song_audio_url', 'song_title', 'song_artist',
            'song_start_time', 'song_end_time',
            'video_start_time', 'video_end_time',
            'caption', 'tags', 'location', 'duration', 'width', 'height',
            'created_at', 'updated_at', 'likes_count', 'comments_count',
            'is_liked', 'is_saved', 'can_edit','optimized_url'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']
        extra_kwargs = {
            'media_file': {'write_only': True},
            'gallery': {'write_only': True},
        }
    
    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Inject the author's follower count from the feed's subquery annotation
        # (DetailedUserSerializer is annotation-only to avoid an N+1).
        fc = getattr(instance, 'author_followers_count', None)
        if fc is not None and isinstance(data.get('user'), dict):
            data['user']['followers_count'] = fc
        # Inject whether the current user follows the author (feed annotation),
        # so post cards can hide the Follow button for people already followed.
        isf = getattr(instance, 'author_is_following', None)
        if isf is not None and isinstance(data.get('user'), dict):
            data['user']['is_following'] = isf
        return data

    def get_can_edit(self, obj):
        try:
            request = self.context.get('request')
            return request and request.user == obj.user
        except Exception as e:
            logger.error("get_media_url failed on SocialPost %s: %r", obj.pk, e, exc_info=True)
            return None  # or safe fallback

   
    def get_media_url(self, obj):
        # Stored references are absolute R2 URLs; new uploads arrive already
        # trimmed/compressed client-side, so there are no URL transforms.
        return media.resolve(obj.media_file)

    def get_optimized_url(self, obj):
        # No delivery-transform tier yet (comes with the custom media domain) —
        # optimized == original.
        return media.resolve(obj.media_file)

    def _gallery_item(self, it):
        """Normalize a gallery entry ({url|public_id, width, height}) to the
        uniform media-item payload; entries that don't resolve are dropped."""
        url = media.resolve(it.get('url') or it.get('public_id'))
        if not url:
            return None
        return {
            'media_url': url,
            'optimized_url': url,
            'width': it.get('width'),
            'height': it.get('height'),
        }

    def get_media_items(self, obj):
        """Ordered media for the post. A 1–4 image carousel comes from `gallery`;
        legacy/single posts fall back to a one-item list from media_file so the
        client can always render a uniform pager."""
        gallery = obj.gallery if isinstance(obj.gallery, list) else []
        items = [self._gallery_item(it) for it in gallery if isinstance(it, dict)]
        items = [it for it in items if it]
        if items:
            return items
        # Fallback: single media (image or video) from media_file.
        return [{
            'media_url': self.get_media_url(obj),
            'optimized_url': self.get_optimized_url(obj),
            'width': obj.width,
            'height': obj.height,
        }]
    def create(self, validated_data):
        """Create a new social post with enhanced logging"""
        logger.info(f"Creating new social post with data: {validated_data}")
        try:
            post = SocialPost.objects.create(**validated_data)
            logger.info(f"Successfully created post {post.id}")
            if post.media_file:
                logger.info(f"Post media details - Type: {post.content_type}, Public ID: {post.media_file}")
            return post
        except Exception as e:
            logger.error(f"Post creation failed: {str(e)}", exc_info=True)
            raise

    def update(self, instance, validated_data):
        """Update an existing social post with logging"""
        logger.info(f"Updating post {instance.id} with data: {validated_data}")
        if 'media_file' in validated_data:
            logger.warning("Attempt to update media_file was blocked (media_file can only be set at creation)")
            validated_data.pop('media_file', None)
        
        try:
            instance = super().update(instance, validated_data)
            logger.info(f"Successfully updated post {instance.id}")
            return instance
        except Exception as e:
            logger.error(f"Post update failed: {str(e)}", exc_info=True)
            raise
    # Each of these prefers an annotation set by SocialPostViewSet.get_queryset
    # (one query for the whole page) and falls back to a per-object query for
    # other call sites (e.g. retrieve, nested serialization).
    def get_likes_count(self, obj):
        # Denormalised field kept in sync by signals; no per-post COUNT.
        return getattr(obj, 'likes_count', 0)

    def get_comments_count(self, obj):
        return getattr(obj, 'comments_count', 0)

    def get_is_liked(self, obj):
        liked = getattr(obj, 'liked_by_me', None)
        if liked is not None:
            return liked
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False

    def get_is_saved(self, obj):
        saved = getattr(obj, 'saved_by_me', None)
        if saved is not None:
            return saved
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.saves.filter(user=request.user).exists()
        return False

    def validate(self, data):
        if data.get('content_type') == 'video':
            duration = data.get('duration')
            if duration and duration > timedelta(minutes=1):
                raise serializers.ValidationError("Video cannot exceed 1 minute")

        # Video trim window (seconds): valid range, capped at 30s.
        vs = data.get('video_start_time')
        ve = data.get('video_end_time')
        if vs is not None or ve is not None:
            vs = vs or 0
            if ve is None or ve <= vs or vs < 0:
                raise serializers.ValidationError("Invalid video trim range")
            if ve - vs > 30:
                raise serializers.ValidationError("Trimmed video cannot exceed 30 seconds")
            data['video_start_time'] = vs

        # Image carousel: 1–4 images, each carrying its uploaded R2 URL (the
        # legacy key name public_id is still accepted for older clients).
        gallery = data.get('gallery')
        if gallery is not None:
            if not isinstance(gallery, list):
                raise serializers.ValidationError("gallery must be a list")
            if len(gallery) > 4:
                raise serializers.ValidationError("A post can have at most 4 images")
            for it in gallery:
                if not isinstance(it, dict) or not (it.get('url') or it.get('public_id')):
                    raise serializers.ValidationError("Each gallery item needs its uploaded media URL")

        # Validate the accompanying-audio trim window (seconds). Cap the clip at
        # 30s so the feed only plays the short section the user picked.
        start = data.get('song_start_time')
        end = data.get('song_end_time')
        if start is not None or end is not None:
            start = start or 0
            if end is None:
                raise serializers.ValidationError("song_end_time is required when trimming audio")
            if start < 0 or end <= start:
                raise serializers.ValidationError("Invalid audio trim range")
            if end - start > 30:
                raise serializers.ValidationError("Audio clip cannot exceed 30 seconds")
            data['song_start_time'] = start
        return data

    
   
    def create(self, validated_data):
        """Create a new social post"""
        return SocialPost.objects.create(**validated_data)

    
   
    def create(self, validated_data):
        """Create a new social post"""
        return SocialPost.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update an existing social post.

        Save ONLY the changed columns. Re-saving the whole row rewrites the
        CloudinaryField and mangles the stored media_file (it gains an
        'auto/upload/' prefix), which 404s the media after the next reload.
        Restricting the write to the edited fields leaves media_file untouched.
        """
        validated_data.pop('media_file', None)  # media is set once, at creation
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        update_fields = list(validated_data.keys())
        if update_fields:
            update_fields.append('updated_at')
            instance.save(update_fields=update_fields)
        return instance



# Reused only for its pure (DB-free) media-URL builders below.
_thumb_helper = SocialPostSerializer()


class ProfilePostThumbSerializer(serializers.ModelSerializer):
    """Minimal post payload for profile grids — just id, type, and a thumbnail.
    Avoids the full SocialPostSerializer's nested author/song and per-row
    is_liked/is_saved lookups (the source of the slow profile load)."""
    media_url = serializers.SerializerMethodField()
    optimized_url = serializers.SerializerMethodField()

    class Meta:
        model = SocialPost
        fields = ['id', 'content_type', 'media_url', 'optimized_url', 'width', 'height']

    def get_media_url(self, obj):
        return _thumb_helper.get_media_url(obj)

    def get_optimized_url(self, obj):
        return _thumb_helper.get_optimized_url(obj)


class PostLikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostLike
        fields = ['id', 'user', 'post', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']



class CommentUserSerializer(serializers.ModelSerializer):
    """Minimal user payload for comment rows.

    The full UserSerializer serializes the user's profile, ENTIRE post history
    (get_social_posts) and three count queries — fine for a profile screen, but
    catastrophic across a comment list (it N+1s per comment). Comments only need
    the avatar + name, so we keep this tiny.
    """
    profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'profile_picture']

    def get_profile_picture(self, obj):
        profile = getattr(obj, 'profile', None)
        if profile and profile.picture:
            return ProfileSerializer(profile, context=self.context).data.get('picture_url')
        return None


class PostCommentSerializer(serializers.ModelSerializer):
    user = CommentUserSerializer(read_only=True)
    # Just the id — the previous nested SocialPostSerializer re-serialized the
    # whole post (media, counts, author) on every single comment.
    post = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'user', 'post', 'content', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']



class PostSaveSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostSave
        fields = ['id', 'user', 'post', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']



class SocialPostUploadSerializer(serializers.Serializer):
    media_file = serializers.FileField(
        write_only=True,
        required=True,
        help_text="Media file for post (image or video)"
    )



class StorySerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    is_viewed = serializers.SerializerMethodField()
    views_count = serializers.SerializerMethodField()

    class Meta:
        model = Story
        fields = ['id', 'user', 'media_url', 'media_file', 'content_type',
                  'caption', 'created_at', 'expires_at', 'is_viewed', 'views_count']
        read_only_fields = ['id', 'user', 'created_at', 'expires_at', 'is_viewed', 'views_count']

    def get_is_viewed(self, obj):
        request = self.context.get('request')
        if not request:
            return False
        return obj.views.filter(viewer=request.user).exists()

    def get_views_count(self, obj):
        return obj.views.count()



class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ['id', 'content_type', 'object_id', 'reason', 'description', 'status', 'created_at']
        read_only_fields = ['id', 'status', 'created_at']

