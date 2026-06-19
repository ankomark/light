from rest_framework import serializers
from ..models import User
from ..models import User,Track,Playlist,Profile,LiveEvent, Comment,Like,Category,SocialPost,PostLike,PostComment,PostSave,Notification,Conversation,Message,Story,StoryView,Report,Church,Choir,Group,Videostudio,Choir, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist,MediaStation,Notice,ChoirMembership,ChoirJoinRequest,ChoirMessage
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
    is_staff = serializers.ReadOnlyField(source='user.is_staff')
    # Drives the in-app admin panel gating (rides along on /profiles/me/).
    admin_role = serializers.ReadOnlyField(source='user.admin_role')
    is_super_admin = serializers.ReadOnlyField(source='user.is_super_admin')
    capabilities = serializers.ReadOnlyField(source='user.capabilities')
    is_suspended = serializers.ReadOnlyField(source='user.is_suspended')
    followers_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    posts_count = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ['bio', 'user_id','username', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                  'birth_date', 'location', 'is_public', 'picture','picture_url',
                  'followers_count', 'following_count', 'posts_count']
        read_only_fields = ['user_id', 'username', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                            'picture_url', 'followers_count', 'following_count', 'posts_count']
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

    def get_followers_count(self, obj):
        # obj.user.followers are the users who follow this profile's owner.
        return obj.user.followers.count()

    def get_following_count(self, obj):
        return obj.user.followed_by.count()

    def get_posts_count(self, obj):
        return obj.user.social_posts.count()

    def create(self, validated_data):
        """Handles profile creation with request context"""
        try:
            user = self.context['request'].user
            profile = Profile.objects.create(user=user, **validated_data)
            return profile
        except Exception as e:
            print(f"Profile creation error: {e}")
            raise serializers.ValidationError("Profile creation failed")



class DetailedUserSerializer(serializers.ModelSerializer):
    profile_picture = serializers.SerializerMethodField()
    followers_count = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'profile_picture', 'followers_count']
        read_only_fields = ['id', 'username', 'profile_picture']
    
    def get_profile_picture(self, obj):
        """
        Returns optimized profile picture URL with consistent transformations.
        Always returns a string or None.
        Handles:
        1. Cloudinary resource dict
        2. CloudinaryField object
        3. Public ID string
        """
        if not hasattr(obj, 'profile') or not obj.profile.picture:
            return None

        try:
            width = self.context.get('picture_width', 50)
            height = self.context.get('picture_height', 50)
            crop = self.context.get('picture_crop', 'fill')
            gravity = self.context.get('picture_gravity', 'face')
            quality = self.context.get('picture_quality', 'auto')

            picture = obj.profile.picture

            # If dict, get the URL string
            if isinstance(picture, dict):
                url = picture.get('secure_url') or picture.get('url')
                if url:
                    # Transform the URL if needed
                    return (
                        f"{url.split('/upload/')[0]}/upload/"
                        f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                        f"{url.split('/upload/')[1]}"
                    )
                # If only public_id, build URL
                public_id = picture.get('public_id')
                if public_id:
                    return (
                        f"https://res.cloudinary.com/"
                        f"{settings.CLOUDINARY_STORAGE['CLOUD_NAME']}/"
                        f"image/upload/"
                        f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                        f"{public_id}"
                    )
                return None

            # If CloudinaryField object
            if hasattr(picture, 'url'):
                url = picture.url
                return (
                    f"{url.split('/upload/')[0]}/upload/"
                    f"w_{width},h_{height},c_{crop},g_{gravity},q_{quality}/"
                    f"{url.split('/upload/')[1]}"
                )

            # If string (public_id or URL)
            if isinstance(picture, str):
                if picture.startswith('http'):
                    # It's already a URL
                    return picture
                # Otherwise, build URL from public_id
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
    def get_followers_count(self, obj):
        # Annotation-only: callers that need this (e.g. the feed) annotate
        # followers_count; we avoid a per-object COUNT here to prevent an N+1
        # during list serialization. Falls back to 0 when not annotated.
        return getattr(obj, 'followers_count', 0)



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

    def validate_email(self, value):
        # Email is the account-recovery key, so it must be present and unique
        # (case-insensitive). Django's EmailField already validates the format.
        value = (value or '').strip().lower()
        if not value:
            raise serializers.ValidationError("Email is required.")
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

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
        # Profile grids only need thumbnails, so serialize a lightweight payload
        # (no nested author/song, no per-row like/save lookups). media_file lives
        # on the row, so no joins/prefetch are needed — this removes the N+1 that
        # made the profile slow.
        posts = obj.social_posts.order_by('-created_at')

        if self.context.get('request'):
            content_type = self.context['request'].GET.get('content_type')
            if content_type in ['image', 'video']:
                posts = posts.filter(content_type=content_type)

        # Lazy import avoids a circular dependency (UserSerializer is in
        # serializers-common, the post serializers in serializers-social).
        from songs.serializers import ProfilePostThumbSerializer
        return ProfilePostThumbSerializer(posts, many=True, context=self.context).data

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



class FollowListSerializer(SimpleUserSerializer):
    """Lightweight user row for followers/following lists, plus whether the
    requesting user already follows this person (drives the Follow/Following
    button in the list)."""
    is_following = serializers.SerializerMethodField()

    class Meta(SimpleUserSerializer.Meta):
        fields = SimpleUserSerializer.Meta.fields + ['is_following']

    def get_is_following(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated and request.user != obj:
            return obj.followers.filter(id=request.user.id).exists()
        return False


class FileSizeValidator:
    def __init__(self, max_size_mb):
        self.max_size_mb = max_size_mb
    
    def __call__(self, value):
        filesize = value.size
        if filesize > self.max_size_mb * 1024 * 1024:
            raise serializers.ValidationError(f"Max file size is {self.max_size_mb}MB")



class CloudinaryURLValidator:
    def __call__(self, value):
        if not isinstance(value, str):
            raise serializers.ValidationError("Invalid URL format")
        if not value.startswith(('http://', 'https://')):
            raise serializers.ValidationError("URL must start with http:// or https://")
        if 'res.cloudinary.com' not in value:
            raise serializers.ValidationError("Only Cloudinary URLs are allowed")

