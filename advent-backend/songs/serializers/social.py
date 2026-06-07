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
            'id', 'user', 'content_type', 'media_file', 'media_url', 'song','song_id',
            # 'song_start_time', 'song_end_time',
            'caption', 'tags', 'location', 'duration', 'width', 'height',
            'created_at', 'updated_at', 'likes_count', 'comments_count', 
            'is_liked', 'is_saved', 'can_edit','optimized_url'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']
        extra_kwargs = {
            'media_file': {'write_only': True}
        }
    
    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Inject the author's follower count from the feed's subquery annotation
        # (DetailedUserSerializer is annotation-only to avoid an N+1).
        fc = getattr(instance, 'author_followers_count', None)
        if fc is not None and isinstance(data.get('user'), dict):
            data['user']['followers_count'] = fc
        return data

    def get_can_edit(self, obj):
        try:
            request = self.context.get('request')
            return request and request.user == obj.user
        except Exception as e:
            logger.error("get_media_url failed on SocialPost %s: %r", obj.pk, e, exc_info=True)
            return None  # or safe fallback

   
    def get_media_url(self, obj):
        if not obj.media_file:
            return None
            
        try:
            # Handle both FileField and raw strings
            if hasattr(obj.media_file, 'url'):
                url = obj.media_file.url
                # Convert auto/upload URLs to proper delivery URLs
                if '/auto/upload/' in url:
                    return self._convert_auto_url(url, obj.content_type)
                return url
                
            if isinstance(obj.media_file, str):
                ext = '.jpg' if obj.content_type == 'image' else '.mp4'
                return f"https://res.cloudinary.com/{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/{obj.content_type}/upload/{obj.media_file}{ext}"
                
        except Exception as e:
            logger.error(f"URL generation error for post {obj.id}: {str(e)}")
            return None

    def _convert_auto_url(self, url, content_type):
        """Convert auto/upload URL to proper delivery URL"""
        parts = url.split('/auto/upload/')
        if len(parts) != 2:
            return url
            
        public_id = parts[1]
        ext = '.jpg' if content_type == 'image' else '.mp4'
        
        return f"https://res.cloudinary.com/{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/{content_type}/upload/{public_id}{ext}"

    def get_optimized_url(self, obj):
        if not obj.media_file:
            return None
            
        try:
            base_url = f"https://res.cloudinary.com/{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}"
            ext = '.jpg' if obj.content_type == 'image' else '.mp4'
            
            if hasattr(obj.media_file, 'url') and '/auto/upload/' in obj.media_file.url:
                public_id = obj.media_file.url.split('/auto/upload/')[1]
            elif isinstance(obj.media_file, str):
                public_id = obj.media_file
            else:
                return None
                
            if obj.content_type == 'image':
                return f"{base_url}/image/upload/w_600,h_600,c_fill,q_auto,f_auto/{public_id}{ext}"
            else:
                return f"{base_url}/video/upload/q_auto,f_auto/{public_id}{ext}"
                
        except Exception as e:
            logger.error(f"Optimized URL error: {str(e)}")
            return None
    def to_internal_value(self, data):
        internal_data = super().to_internal_value(data)
        
        if 'media_file' in internal_data:
            media_file = internal_data['media_file']
            
            # Handle CloudinaryResource objects first
            if hasattr(media_file, 'public_id'):
                internal_data['media_file'] = media_file.public_id
                return internal_data
                
            # Then handle string paths
            if isinstance(media_file, str):
                # If it's already a full public_id with folder, keep it
                if '/' in media_file:
                    return internal_data
                    
                # Parse if it looks like a URL
                if 'res.cloudinary.com' in media_file:
                    try:
                        path = urlparse(media_file).path
                        parts = path.split('/')
                        try:
                            upload_index = parts.index('upload') + 1
                            public_id = '/'.join(parts[upload_index:])
                            public_id = os.path.splitext(public_id)[0]
                            internal_data['media_file'] = public_id
                        except ValueError:
                            pass
                    except Exception as e:
                        logger.error(f"URL parsing error: {str(e)}")
        
        return internal_data
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
    def _convert_auto_url(self, url, content_type):
        """Convert auto/upload URL to proper delivery URL"""
        parts = url.split('/auto/upload/')
        if len(parts) != 2:
            return url
            
        public_id = parts[1]
        ext = '.jpg' if content_type == 'image' else '.mp4'
        
        return f"https://res.cloudinary.com/{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/{content_type}/upload/{public_id}{ext}"



    def _ensure_proper_url(self, url, content_type):
        """Convert any Cloudinary URL to proper delivery URL"""
        if not url or 'res.cloudinary.com' not in url:
            return url
            
        # Handle auto/upload URLs
        if '/auto/upload/' in url:
            parts = url.split('/auto/upload/')
            base = parts[0].replace('/auto/upload', '')
            public_id = parts[1]
            
            if content_type == 'image':
                return f"{base}/image/upload/w_600,h_600,c_fill,q_auto,f_auto/{public_id}.jpg"
            else:
                return f"{base}/video/upload/q_auto,f_auto/{public_id}.mp4"
                
        # Already proper URL
        return url

    def _fix_auto_upload_url(self, url, content_type):
        """
        Convert auto/upload URLs to proper Cloudinary delivery URLs
        Example: 
        Input: https://res.cloudinary.com/dxdmo9j4v/auto/upload/vdv2gbt7zagsmongikwr
        Output: https://res.cloudinary.com/dxdmo9j4v/image/upload/w_600,h_600,c_fill/vdv2gbt7zagsmongikwr.jpg
        """
        try:
            parts = url.split('/auto/upload/')
            if len(parts) != 2:
                return url
                
            base = parts[0].replace('/auto/upload', '')
            public_id = parts[1]
            
            if content_type == 'image':
                return f"{base}/image/upload/w_600,h_600,c_fill,q_auto,f_auto/{public_id}.jpg"
            else:
                return f"{base}/video/upload/q_auto,f_auto/{public_id}.mp4"
                
        except Exception as e:
            logger.error(f"Error fixing auto upload URL {url}: {str(e)}")
            return url
    # Each of these prefers an annotation set by SocialPostViewSet.get_queryset
    # (one query for the whole page) and falls back to a per-object query for
    # other call sites (e.g. retrieve, nested serialization).
    def get_likes_count(self, obj):
        count = getattr(obj, 'likes_total', None)
        return count if count is not None else obj.likes.count()

    def get_comments_count(self, obj):
        count = getattr(obj, 'comments_total', None)
        return count if count is not None else obj.comments.count()

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
        return data

    
   
    def create(self, validated_data):
        """Create a new social post"""
        return SocialPost.objects.create(**validated_data)

    
   
    def create(self, validated_data):
        """Create a new social post"""
        return SocialPost.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update an existing social post"""
        # Don't allow updating media_file after creation
        validated_data.pop('media_file', None)
        return super().update(instance, validated_data)



class PostLikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostLike
        fields = ['id', 'user', 'post', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']



class PostCommentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

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

