from rest_framework import serializers
from .models import User
from .models import User,Track,Playlist,Profile,LiveEvent, Comment,Like,Category,SocialPost,PostLike,PostComment,PostSave,Notification,Church,Choir,Group,Videostudio,Choir, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist
import re
from django.utils import timezone
from datetime import timedelta
from django.conf import settings
import logging
import cloudinary
import os
from cloudinary import config
logger = logging.getLogger(__name__)

class CloudinaryFieldSerializer(serializers.Field):
    def to_representation(self, value):
        """
        Convert internal value to representation for output.
        Handles multiple Cloudinary value formats:
        - CloudinaryResource objects
        - Dictionaries with URLs
        - Direct URLs
        - Public IDs
        """
        if not value:
            return None

        try:
            # Case 1: CloudinaryResource object
            if hasattr(value, 'url'):
                return value.url

            # Case 2: Dictionary format
            if isinstance(value, dict):
                return value.get('secure_url') or value.get('url') or value.get('public_id')

            # Case 3: Already a URL string
            if isinstance(value, str) and value.startswith(('http://', 'https://')):
                return value

            # Case 4: Public ID - build URL
            if isinstance(value, str):
                from cloudinary import CloudinaryImage
                return str(CloudinaryImage(value).build_url())

            # Fallback: string conversion
            return str(value)

        except Exception as e:
            logger.error(f"Error processing Cloudinary field representation: {str(e)}")
            return None

    def to_internal_value(self, data):
        """
        Convert incoming data to internal value.
        Handles:
        - Cloudinary URLs
        - CloudinaryResource objects
        - Dictionaries with public_id/url
        - Direct public_ids
        """
        if not data:
            return None

        try:
            # Case 1: CloudinaryResource object
            if hasattr(data, 'public_id'):
                return data.public_id

            # Case 2: Dictionary input
            if isinstance(data, dict):
                if 'public_id' in data:
                    return data['public_id']
                if 'url' in data:
                    data = data['url']

            # Case 3: String input
            if isinstance(data, str):
                # If it's a URL, extract public_id
                if 'res.cloudinary.com' in data:
                    try:
                        path = urlparse(data).path
                        parts = path.split('/')
                        
                        # Find the upload segment
                        upload_index = parts.index('upload') + 2 if 'upload' in parts else 0
                        
                        # Handle different URL formats:
                        # 1. Regular upload: .../upload/v123/public_id
                        # 2. Fetch upload: .../upload/f_auto,q_auto/public_id
                        if upload_index > 0:
                            public_id = '/'.join(parts[upload_index:])
                        else:
                            # For fetch URLs, the public_id might be after version
                            version_index = parts.index('v1') + 1 if 'v1' in parts else 1
                            public_id = '/'.join(parts[version_index:])
                        
                        # Remove file extension if present
                        return os.path.splitext(public_id)[0]
                    except (ValueError, IndexError) as e:
                        logger.warning(f"Couldn't parse Cloudinary URL: {str(e)}")
                        return data
                # Otherwise assume it's already a public_id
                return data

            # Case 4: Other types (fallback)
            return str(data)

        except Exception as e:
            logger.error(f"Error processing Cloudinary input: {str(e)}")
            raise serializers.ValidationError({
                'cloudinary': 'Invalid file data. Must be a Cloudinary URL, public_id, or resource object.'
            })

class ProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.ReadOnlyField(source='user.id')
    picture_url = serializers.SerializerMethodField()
    username = serializers.ReadOnlyField(source='user.username')
    
    class Meta:
        model = Profile
        fields = ['bio', 'user_id','username', 'birth_date', 'location', 'is_public', 'picture','picture_url']
        read_only_fields = ['user_id', 'username', 'picture_url']
        extra_kwargs = {
            'picture': {'write_only': True}  # Only needed for uploads
        }

    def get_picture_url(self, obj):
        """
        Returns optimized profile picture URL with consistent transformations
        Handles three formats:
        1. Cloudinary resource dict
        2. CloudinaryField object
        3. Public ID string
        """
        if not obj.picture:
            return None
            
        try:
            # Default transformation parameters
            width = self.context.get('picture_width', 200)
            height = self.context.get('picture_height', 200)
            crop = self.context.get('picture_crop', 'fill')
            gravity = self.context.get('picture_gravity', 'face')
            quality = self.context.get('picture_quality', 'auto')
            
            # Handle Cloudinary resource dict
            if isinstance(obj.picture, dict):
                if 'secure_url' in obj.picture:
                    base_url = obj.picture['secure_url']
                    return f"{base_url.split('/upload/')[0]}/upload/w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/{base_url.split('/upload/')[1]}"
                return None
                
            # Handle CloudinaryField object
            elif hasattr(obj.picture, 'url'):
                base_url = obj.picture.url
                return f"{base_url.split('/upload/')[0]}/upload/w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/{base_url.split('/upload/')[1]}"
                
            # Handle public_id string
            elif isinstance(obj.picture, str):
                return (
                    f"https://res.cloudinary.com/"
                    f"{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/"
                    f"image/upload/w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/{obj.picture}"
                )
                
            return None
        except Exception as e:
            logger.error(f"Error processing picture URL: {str(e)}", exc_info=True)
            return None

    def create(self, validated_data):
        """Handles profile creation with request context"""
        try:
            user = self.context['request'].user
            profile = Profile.objects.create(user=user, **validated_data)
            return profile
        except Exception as e:
            print(f"Profile creation error: {e}")
            raise serializers.ValidationError("Profile creation failed")

class SimpleUserSerializer(serializers.ModelSerializer):
    profile_picture = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'profile_picture']
        read_only_fields = ['id', 'username', 'profile_picture']
    
    def get_profile_picture(self, obj):
        """
        Returns optimized profile picture URL with consistent transformations
        Handles three formats:
        1. Cloudinary resource dict
        2. CloudinaryField object
        3. Public ID string
        
        Uses context parameters for customization (width, height, crop, etc.)
        """
        if not hasattr(obj, 'profile') or not obj.profile.picture:
            return None
            
        try:
            # Get transformation parameters from context or use defaults
            width = self.context.get('picture_width', 50)  # Default smaller for lists
            height = self.context.get('picture_height', 50)
            crop = self.context.get('picture_crop', 'fill')
            gravity = self.context.get('picture_gravity', 'face')
            quality = self.context.get('picture_quality', 'auto')
            
            picture = obj.profile.picture
            
            # Handle Cloudinary resource dict
            if isinstance(picture, dict):
                if 'secure_url' in picture:
                    base_url = picture['secure_url']
                    return (
                        f"{base_url.split('/upload/')[0]}/upload/"
                        f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                        f"{base_url.split('/upload/')[1]}"
                    )
                return None
                
            # Handle CloudinaryField object
            elif hasattr(picture, 'url'):
                base_url = picture.url
                return (
                    f"{base_url.split('/upload/')[0]}/upload/"
                    f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                    f"{base_url.split('/upload/')[1]}"
                )
                
            # Handle public_id string
            elif isinstance(picture, str):
                return (
                    f"https://res.cloudinary.com/"
                    f"{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/"
                    f"image/upload/"
                    f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                    f"{picture}"
                )
                
            return None
            
        except Exception as e:
            logger.error(
                f"Error processing profile picture for user {obj.id}: {str(e)}",
                exc_info=True
            )
            return None
class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    profile_picture = serializers.SerializerMethodField() 
    profile = ProfileSerializer(read_only=True)
    social_posts = serializers.SerializerMethodField()
    followers_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password',
            'profile', 'social_posts', 'followers_count',
            'following_count', 'is_following','profile_picture'
        ]
        extra_kwargs = {
            'password': {'write_only': True},
            'email': {'required': True}
        }
    def get_profile_picture(self, obj):
        """Get optimized profile picture URL from associated profile"""
        if hasattr(obj, 'profile') and obj.profile.picture:
            # Reuse the transformation logic from ProfileSerializer
            return ProfileSerializer(
                obj.profile,
                context=self.context
            ).data.get('picture_url')
        return None
    
    def get_social_posts(self, obj):
        posts = obj.social_posts.select_related('user').prefetch_related(
            'likes',
            'comments'
        ).order_by('-created_at')
        
        # Optional: Add request-based filtering
        if self.context.get('request'):
            # Example: Filter by post type if requested
            content_type = self.context['request'].GET.get('content_type')
            if content_type in ['image', 'video']:
                posts = posts.filter(content_type=content_type)
                
        return SocialPostSerializer(posts, many=True, context=self.context).data
    
    def get_followers_count(self, obj):
        return getattr(obj, 'followers_count', obj.followers.count())
    
    def get_following_count(self, obj):
        return getattr(obj, 'followed_by_count', obj.followed_by.count())
    
    def get_is_following(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated and request.user != obj:
            return obj.followers.filter(id=request.user.id).exists()
        return False
    
    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User.objects.create_user(password=password, **validated_data)
        return user
    
class TrackSerializer(serializers.ModelSerializer):
     likes_count = serializers.SerializerMethodField()
     is_liked = serializers.SerializerMethodField()
    #  favorite = serializers.SerializerMethodField()
     artist = UserSerializer(read_only=True)  # Include full artist detai
     is_owner = serializers.SerializerMethodField() 
     audio_file = CloudinaryFieldSerializer()
     cover_image = CloudinaryFieldSerializer(required=False)
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
     def get_favorite(self, obj):
        user = self.context['request'].user
        return Like.objects.filter(user=user, track=obj).exists()
     def get_likes_count(self, obj):
      return obj.likes.count()
     def get_is_liked(self, obj):
        user = self.context['request'].user
        if user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False
  
     def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.artist == request.user
     def get_is_favorite(self, obj):
        user = self.context['request'].user
        return user.is_authenticated and obj.favorites.filter(id=user.id).exists()


class PlaylistSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    class Meta:
        model = Playlist
        fields = ('id', 'name', 'user', 'tracks', 'created_at', 'updated_at')



class CommentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    track = TrackSerializer(read_only=True)
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



class SocialPostSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    song = TrackSerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    media_url = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    optimized_url = serializers.SerializerMethodField()

    class Meta:
        model = SocialPost
        fields = [
            'id', 'user', 'content_type', 'media_file', 'media_url', 'song',
            'caption', 'tags', 'location', 'duration', 'width', 'height',
            'created_at', 'updated_at', 'likes_count', 'comments_count', 
            'is_liked', 'is_saved', 'can_edit','optimized_url'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']
        extra_kwargs = {
            'media_file': {'write_only': True}
        }
    
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
    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_comments_count(self, obj):
        return obj.comments.count()

    def get_is_liked(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False

    def get_is_saved(self, obj):
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

    def update(self, instance, validated_data):
        """Update an existing social post"""
        # Don't allow updating media_file after creation
        validated_data.pop('media_file', None)
        return super().update(instance, validated_data)

class SocialPostUploadSerializer(serializers.Serializer):
    """Serializer for handling file uploads to Cloudinary"""
    media_file = serializers.FileField()
    caption = serializers.CharField(max_length=2200, required=False, allow_blank=True)
    tags = serializers.CharField(max_length=200, required=False, allow_blank=True)
    location = serializers.CharField(max_length=100, required=False, allow_blank=True)
    duration = serializers.DurationField(required=False, allow_null=True)

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


class NotificationSerializer(serializers.ModelSerializer):
    sender = SimpleUserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True, required=False)
    track = TrackSerializer(read_only=True, required=False)
    related_comment = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id', 'sender', 'message', 'read', 
            'notification_type', 'post', 'track', 
            'created_at', 'related_comment'
        ]
    
    def get_related_comment(self, obj):
        if obj.notification_type == 'comment':
            from .models import PostComment  # Import here to avoid circular imports
            comment = PostComment.objects.filter(
                post=obj.post,
                user=obj.sender
            ).first()
            return comment.content if comment else None
        return None

class SimpleUserSerializer(serializers.ModelSerializer):
    profile_picture = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'profile_picture']
    
    def get_profile_picture(self, obj):
        """Get optimized profile picture URL"""
        if hasattr(obj, 'profile') and obj.profile.picture:
            picture = obj.profile.picture
            
            # Handle Cloudinary resource dict
            if isinstance(picture, dict):
                return picture.get('secure_url')
            
            # Handle CloudinaryField object
            if hasattr(picture, 'url'):
                return picture.url
                
            # Handle public_id string
            if isinstance(picture, str):
                return (
                    f"https://res.cloudinary.com/"
                    f"{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/"
                    f"image/upload/w_50,h_50,c_fill/{picture}"
                )
        
        return None
class ChurchSerializer(serializers.ModelSerializer):
    image = CloudinaryFieldSerializer(read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = CloudinaryFieldSerializer(source='created_by.profile.picture', read_only=True)
    
    
    class Meta:
        model = Church
        fields = '__all__'
        read_only_fields = ('created_by', 'created_at', 'updated_at', 'id')

    def get_created_by_picture(self, obj):
        # Ensure we're returning a complete URL
        if hasattr(obj.created_by, 'profile') and obj.created_by.profile.picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.created_by.profile.picture.url)
            return obj.created_by.profile.picture.url
        return None


# Add to existing serializers
# from .models import Videostudio, Audiostudio, Choir

class VideoStudioSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    logo = CloudinaryFieldSerializer(read_only=True)
    cover_image = CloudinaryFieldSerializer(read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = CloudinaryFieldSerializer(source='created_by.profile.picture', read_only=True)
    service_types = serializers.ListField(child=serializers.ChoiceField(choices=Videostudio.SERVICE_TYPES),default=list)
    
    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified')
    
    def get_logo_url(self, obj):
        if obj.logo:
            return self.context['request'].build_absolute_uri(obj.logo.url)
        return None
    
    def get_cover_image_url(self, obj):
        if obj.cover_image:
            return self.context['request'].build_absolute_uri(obj.cover_image.url)
        return None

    def get_created_by_picture(self, obj):
        # Add null checks for safety
        if obj.created_by and hasattr(obj.created_by, 'profile') and obj.created_by.profile.picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.created_by.profile.picture.url)
            return obj.created_by.profile.picture.url
        return None

    # ... rest of the serializer ...
class ChoirSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    profile_image = CloudinaryFieldSerializer(read_only=True)
    cover_image = CloudinaryFieldSerializer(read_only=True)
    
    class Meta:
        model = Choir
        fields = '__all__'
        read_only_fields = ('created_by', 'members_count')
    
    def get_profile_image_url(self, obj):
        if obj.profile_image:
            return self.context['request'].build_absolute_uri(obj.profile_image.url)
        return None
    
    def get_cover_image_url(self, obj):
        if obj.cover_image:
            return self.context['request'].build_absolute_uri(obj.cover_image.url)
        return None
    
class GroupSerializer(serializers.ModelSerializer):
    creator = UserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    cover_image = serializers.ImageField(required=False, allow_null=True) 
    is_private = serializers.BooleanField(default=False)  # Ensure default is False

    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['creator', 'slug', 'created_at', 'updated_at']
    
    def get_member_count(self, obj):
        return obj.members.count()
    
    def get_is_member(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(group=obj, user=request.user).exists()
        return False
    
    def get_is_admin(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(
                group=obj, 
                user=request.user, 
                is_admin=True
            ).exists()
        return False

class GroupMemberSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    
    class Meta:
        model = GroupMember
        fields = ['id', 'user', 'is_admin', 'joined_at']
    
    def get_user(self, obj):
        return {
            'id': obj.user.id,
            'username': obj.user.username,
            'profile': {
                'picture': obj.user.profile.picture.url if obj.user.profile and obj.user.profile.picture else None
            }
        }

class GroupJoinRequestSerializer(serializers.ModelSerializer):
    # user = serializers.StringRelatedField(read_only=True)
    user = UserSerializer(read_only=True)
    group = serializers.StringRelatedField(read_only=True)
    
    class Meta:
        model = GroupJoinRequest
        fields = '__all__'
        read_only_fields = ['status', 'created_at']
        extra_kwargs = {
            'message': {'required': False, 'allow_blank': True}
        }

class GroupPostAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupPostAttachment  # Make sure this model is imported
        fields = ['id', 'file', 'file_type', 'created_at']
        read_only_fields = ['file_type', 'created_at']

class GroupPostSerializer(serializers.ModelSerializer):
    # user = serializers.StringRelatedField(read_only=True)
    user = UserSerializer(read_only=True)
    attachments = GroupPostAttachmentSerializer(many=True, read_only=True, required=False)
    
    class Meta:
        model = GroupPost
        fields = ['id', 'content', 'created_at', 'updated_at', 'group', 'user', 'attachments']
        read_only_fields = ['group', 'user', 'created_at', 'updated_at', 'attachments']
        extra_kwargs = {
            'content': {'required': False, 'allow_blank': True}
        }


# Add to existing serializers.py
class ProductCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductCategory
        fields = '__all__'

class ProductImageSerializer(serializers.ModelSerializer):
    image = CloudinaryFieldSerializer(read_only=True)
    image_url = serializers.SerializerMethodField()
    
    class Meta:
        model = ProductImage
        fields = ['id', 'image', 'image_url', 'is_primary', 'uploaded_at']
        read_only_fields = ['uploaded_at']
    
    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and request:
            return CloudinaryFieldSerializer().to_representation(obj.image)
        return None

class ProductSerializer(serializers.ModelSerializer):
    seller = serializers.SerializerMethodField()
    currency = serializers.CharField(max_length=3)
    images = serializers.ListField(
        child=serializers.ImageField(),
        write_only=True,
        required=False,
        allow_empty=True
    )
    category = serializers.CharField()
    track = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(),
        required=False,
        allow_null=True
    )
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'seller', 'title', 'description', 'price', 'condition',
            'quantity', 'category', 'is_digital', 'is_available', 'created_at',
            'updated_at', 'views', 'slug', 'images', 'is_owner', 'track','currency','whatsapp_number', 'contact_number', 'location',
        ]
        read_only_fields = ['seller', 'created_at', 'updated_at', 'views', 'slug']

    def get_seller(self, obj):
        try:
            return UserSerializer(obj.seller, context=self.context).data
        except AttributeError:
            return None

    def get_is_owner(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.seller == request.user
        return False

    def validate_category(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Category name cannot be empty.")
        if len(value) > 100:
            raise serializers.ValidationError("Category name cannot exceed 100 characters.")
        return value

    def validate(self, data):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authenticated user required to create a product.")
        return data

    def create(self, validated_data):
        images = validated_data.pop('images', [])
        category_name = validated_data.pop('category')
        category, _ = ProductCategory.objects.get_or_create(
            name=category_name,
            defaults={'description': f'Category for {category_name}'}
        )
        # Remove seller from validated_data to avoid duplication
        validated_data.pop('seller', None)
        # Use the authenticated user from the request context
        product = Product.objects.create(
            seller=self.context['request'].user,
            category=category,
            **validated_data
        )
        for image in images:
            ProductImage.objects.create(product=product, image=image)
        return product

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        representation['images'] = ProductImageSerializer(
            instance.images.all(),
            many=True,
            context=self.context
        ).data
        representation['category'] = instance.category.name if instance.category else None
        return representation
    
    def update(self, instance, validated_data):
        category_name = validated_data.pop('category', None)
        if category_name:
            category, _ = ProductCategory.objects.get_or_create(
                name=category_name,
                defaults={'description': f'Category for {category_name}'}
            )
            instance.category = category

        # Apply the rest of the updates
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        instance.save()
        return instance

class CartItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()
    
    class Meta:
        model = CartItem
        fields = ['id', 'product', 'quantity', 'added_at', 'total_price']
        read_only_fields = ['added_at']
    
    def get_total_price(self, obj):
        return obj.product.price * obj.quantity

class CartSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    subtotal = serializers.SerializerMethodField()
    total_items = serializers.SerializerMethodField()
    
    class Meta:
        model = Cart
        fields = ['id', 'user', 'created_at', 'updated_at', 'items', 'subtotal', 'total_items']
        read_only_fields = ['user', 'created_at', 'updated_at']
    
    def get_subtotal(self, obj):
        return sum(item.product.price * item.quantity for item in obj.items.all())
    
    def get_total_items(self, obj):
        return obj.items.count()

class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()
    
    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'quantity', 'price_at_purchase', 'total_price', 'seller']
        read_only_fields = ['price_at_purchase', 'seller']
    
    def get_total_price(self, obj):
        return obj.price_at_purchase * obj.quantity

class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    buyer = UserSerializer(read_only=True)
    seller = UserSerializer(read_only=True)
    
    class Meta:
        model = Order
        fields = [
            'id', 'buyer', 'seller', 'status', 'shipping_address', 
            'payment_method', 'total_amount', 'created_at', 'updated_at', 
            'transaction_id', 'items'
        ]
        read_only_fields = ['buyer', 'seller', 'total_amount', 'created_at', 'updated_at']

class ProductReviewSerializer(serializers.ModelSerializer):
    reviewer = UserSerializer(read_only=True)
    
    class Meta:
        model = ProductReview
        fields = ['id', 'product', 'reviewer', 'rating', 'comment', 'created_at']
        read_only_fields = ['reviewer', 'created_at']

class WishlistSerializer(serializers.ModelSerializer):
    products = ProductSerializer(many=True, read_only=True)
    
    class Meta:
        model = Wishlist
        fields = ['id', 'user', 'products', 'created_at']
        read_only_fields = ['user', 'created_at']


class LiveEventSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    embed_url = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    viewers_count = serializers.IntegerField(read_only=True)
    
    class Meta:
        model = LiveEvent
        fields = [
            'id', 'user', 'youtube_url', 'title', 'description',
            'thumbnail', 'is_live', 'start_time', 'end_time',
            'viewers_count', 'embed_url', 'is_owner', 'duration',
            'is_active'
        ]
        read_only_fields = [
            'user', 'thumbnail', 'is_live', 'start_time',
            'end_time', 'viewers_count', 'embed_url', 'is_owner',
            'duration', 'is_active'
        ]
        extra_kwargs = {
            'youtube_url': {
                'help_text': "Must be a valid YouTube live stream URL (e.g., https://www.youtube.com/live/VIDEO_ID)"
            },
            'title': {
                'max_length': 200,
                'help_text': "Maximum 200 characters"
            }
        }
    
    def get_user(self, obj):
        return UserSerializer(obj.user, context=self.context).data
    
    def get_embed_url(self, obj):
        return obj.get_embed_url()
    
    def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.user == request.user
    
    def get_duration(self, obj):
        if obj.end_time:
            return (obj.end_time - obj.start_time).total_seconds()
        elif obj.is_live:
            return (timezone.now() - obj.start_time).total_seconds()
        return 0
    
    def get_is_active(self, obj):
        """Simplified active check"""
        if obj.is_live:
            return True
        if obj.end_time:
            return (timezone.now() - obj.end_time).total_seconds() < 86400  # 24 hours
        return False
    
    def validate_youtube_url(self, value):
        """Comprehensive YouTube URL validation"""
        if not value:
            raise serializers.ValidationError("YouTube URL is required")
        
        # Normalize URL by adding https:// if missing
        if not value.startswith(('http://', 'https://')):
            value = f'https://{value}'
        
        # Validate URL structure
        if not any(domain in value for domain in ['youtube.com', 'youtu.be']):
            raise serializers.ValidationError(
                "URL must be from youtube.com or youtu.be"
            )
        
        # Extract and validate video ID
        video_id = self.extract_youtube_id(value)
        if not video_id:
            raise serializers.ValidationError(
                "Could not extract video ID. Valid formats:\n"
                "- https://www.youtube.com/live/VIDEO_ID\n"
                "- https://youtu.be/VIDEO_ID\n"
                "- https://www.youtube.com/watch?v=VIDEO_ID"
            )
        
        # Additional validation for live streams
        if not self.is_live_stream_url(value):
            raise serializers.ValidationError(
                "URL must be a YouTube live stream (should contain /live/ or livestream parameters)"
            )
        
        return value
    
    @staticmethod
    def extract_youtube_id(url):
        """
        Extract YouTube ID from various URL formats
        Returns None if no valid ID found
        """
        patterns = [
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([^?]{11})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    @staticmethod
    def is_live_stream_url(url):
        """Check if URL appears to be a live stream"""
        live_indicators = [
            '/live/',
            '&feature=youtu.be',
            '&livestream=1',
            '&live=1'
        ]
        return any(indicator in url for indicator in live_indicators)
    
    def validate(self, data):
        """Final validation before saving"""
        # Ensure title is provided
        if not data.get('title'):
            raise serializers.ValidationError({
                'title': 'Title is required'
            })
        
        # Ensure description is not too long
        if data.get('description', '').strip() and len(data['description']) > 1000:
            raise serializers.ValidationError({
                'description': 'Description cannot exceed 1000 characters'
            })
        
        return data
    
    def create(self, validated_data):
        """Custom create method with all necessary fields"""
        request = self.context.get('request')
        url = validated_data['youtube_url']
        video_id = self.extract_youtube_id(url)
        
        if not video_id:
            raise serializers.ValidationError({
                'youtube_url': 'Could not extract valid video ID'
            })
        
        # Create the event instance
        event = LiveEvent.objects.create(
            user=request.user,
            youtube_url=url,
            title=validated_data['title'],
            description=validated_data.get('description', ''),
            thumbnail=f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            is_live=True,
            start_time=timezone.now(),
            viewers_count=0
        )
        
        # Return the fully serialized event
        return LiveEvent.objects.get(id=event.id)



class FileSizeValidator:
    def __init__(self, max_size_mb):
        self.max_size_mb = max_size_mb
    
    def __call__(self, value):
        filesize = value.size
        if filesize > self.max_size_mb * 1024 * 1024:
            raise serializers.ValidationError(f"Max file size is {self.max_size_mb}MB")
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

class SocialPostUploadSerializer(serializers.Serializer):
    media_file = serializers.FileField(
        write_only=True,
        required=True,
        help_text="Media file for post (image or video)"
    )


class CloudinaryURLValidator:
    def __call__(self, value):
        if not isinstance(value, str):
            raise serializers.ValidationError("Invalid URL format")
        if not value.startswith(('http://', 'https://')):
            raise serializers.ValidationError("URL must start with http:// or https://")
        if 'res.cloudinary.com' not in value:
            raise serializers.ValidationError("Only Cloudinary URLs are allowed")







