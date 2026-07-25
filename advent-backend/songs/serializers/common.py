from rest_framework import serializers
from ..models import User
from ..models import User,Track,Playlist,Profile,LiveEvent, Comment,Like,Category,SocialPost,PostLike,PostComment,PostSave,Notification,Conversation,Message,Story,StoryView,Report,Church,Choir,Group,Videostudio,Choir, GroupMember, GroupJoinRequest, GroupPost,GroupAuditLog,CommunityAuditLog,GroupPostAttachment,GroupPostReaction,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist,MediaStation,Notice,AdminNote,NotificationPreference,ChoirMembership,ChoirJoinRequest,ChoirMessage,ChoirMessageReaction,ChurchMembership,ChurchJoinRequest,ChurchMessage,ChurchMessageReaction,FollowRequest,can_view_profile,Wallpaper
import re
from django.db.models import Avg
from django.utils import timezone
from datetime import timedelta
from django.conf import settings
import logging
import os
from .. import media
from .. import r2
logger = logging.getLogger(__name__)


class MediaReferenceImageField(serializers.ImageField):
    """Image field over a string reference column: accepts an uploaded image on
    write (the serializer's create/update pushes it to R2), and on read renders
    the stored reference as a URL."""

    def to_representation(self, value):
        return media.resolve(value)


class MediaReferenceField(serializers.Field):
    """Media reference field: columns store the absolute R2 public URL. Reads
    resolve via songs.media (stray non-URL leftovers render as None); writes
    accept the URL string the app got back from its direct-to-R2 upload."""

    def to_representation(self, value):
        return media.resolve(value)

    def to_internal_value(self, data):
        if not data:
            return None
        if isinstance(data, str) and media.is_absolute(data):
            if len(data) > 500:
                raise serializers.ValidationError('Media URL is too long.')
            return data
        raise serializers.ValidationError(
            'Invalid media reference. Expected the public URL returned by the upload.'
        )


# Transitional alias — a handful of serializers still use the old name.
CloudinaryFieldSerializer = MediaReferenceField



class ProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.ReadOnlyField(source='user.id')
    picture_url = serializers.SerializerMethodField()
    username = serializers.ReadOnlyField(source='user.username')
    email = serializers.ReadOnlyField(source='user.email')
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
        fields = ['bio', 'user_id','username', 'email', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                  'birth_date', 'location', 'is_public', 'picture','picture_url',
                  'followers_count', 'following_count', 'posts_count']
        read_only_fields = ['user_id', 'username', 'email', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                            'picture_url', 'followers_count', 'following_count', 'posts_count']
        extra_kwargs = {
            'picture': {'write_only': True}  # Only needed for uploads
        }

    def get_picture_url(self, obj):
        return media.resolve(obj.picture)

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
        if not hasattr(obj, 'profile'):
            return None
        return media.resolve(obj.profile.picture)

    def get_followers_count(self, obj):
        # Annotation-only: callers that need this (e.g. the feed) annotate
        # followers_count; we avoid a per-object COUNT here to prevent an N+1
        # during list serialization. Falls back to 0 when not annotated.
        return getattr(obj, 'followers_count', 0)



class UserSerializer(serializers.ModelSerializer):
    # Declared explicitly so the default (case-sensitive) UniqueValidator is
    # replaced by our case-insensitive check below with a friendly message.
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    profile_picture = serializers.SerializerMethodField() 
    profile = ProfileSerializer(read_only=True)
    social_posts = serializers.SerializerMethodField()
    followers_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    can_view = serializers.SerializerMethodField()
    follow_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password',
            'profile', 'social_posts', 'followers_count',
            'following_count', 'is_following', 'is_private', 'can_view',
            'follow_status', 'profile_picture'
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

    def validate_username(self, value):
        # Usernames must be unique case-insensitively — "Otieno" reserves
        # "otieno" too. The entered casing is preserved for display.
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError("Username is required.")
        if len(value) < 3:
            raise serializers.ValidationError("Username must be at least 3 characters.")
        if ' ' in value:
            raise serializers.ValidationError("Username cannot contain spaces.")
        qs = User.objects.filter(username__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This username is already taken. Please pick a unique name.")
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
        #
        # A private account shows nothing to anyone it hasn't approved. The
        # counts above stay visible (as on other networks) — it's the content
        # that's withheld.
        request = self.context.get('request')
        viewer = getattr(request, 'user', None) if request else None
        if not can_view_profile(viewer, obj):
            return []

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

    def get_is_private(self, obj):
        profile = getattr(obj, 'profile', None)
        return profile is not None and not profile.is_public

    def get_can_view(self, obj):
        """Whether the requester may see this account's content. Drives the
        locked state on the profile screen."""
        request = self.context.get('request')
        return can_view_profile(getattr(request, 'user', None) if request else None, obj)

    def get_follow_status(self, obj):
        """'following' | 'requested' | 'none' — lets the follow button show a
        pending request rather than pretending the follow went through."""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated or request.user == obj:
            return 'none'
        if obj.followers.filter(id=request.user.id).exists():
            return 'following'
        if FollowRequest.objects.filter(
            requester=request.user, target=obj, status='pending'
        ).exists():
            return 'requested'
        return 'none'

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
        if not hasattr(obj, 'profile'):
            return None
        return media.resolve(obj.profile.picture)



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


class FollowRequestSerializer(serializers.ModelSerializer):
    """A pending request to follow the current user, as shown in their
    follow-requests list."""
    requester = SimpleUserSerializer(read_only=True)

    class Meta:
        model = FollowRequest
        fields = ['id', 'requester', 'status', 'created_at']
        read_only_fields = fields


class FileSizeValidator:
    def __init__(self, max_size_mb):
        self.max_size_mb = max_size_mb
    
    def __call__(self, value):
        filesize = value.size
        if filesize > self.max_size_mb * 1024 * 1024:
            raise serializers.ValidationError(f"Max file size is {self.max_size_mb}MB")




