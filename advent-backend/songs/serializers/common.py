from rest_framework import serializers
from django.db import models
from ..models import User
from ..models import User,Track,Playlist,Profile,LiveEvent, Comment,Like,Category,SocialPost,PostLike,PostComment,PostSave,Notification,Conversation,Message,Story,StoryView,Report,CommunityCategory,PuzzleTheme,WordPuzzle,PuzzleProgress,CoinSpend,Group,Videostudio,GroupMember, GroupJoinRequest, GroupPost,GroupAuditLog,GroupPostAttachment,GroupPostReaction,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist,MediaStation,Notice,AdminNote,NotificationPreference,FollowRequest,can_view_profile,Wallpaper,WeatherPlace
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


def own_upload(value, what='file'):
    """A media link a client sends must be one of our own uploads (R2) -
    never an arbitrary link that every viewer's phone would then fetch (an
    outside server learning who looks, or content no one can moderate).
    A bare storage key isn't a link (media.resolve serves only absolute ones),
    so only an absolute link to anywhere else is refused."""
    value = (value or '').strip() if isinstance(value, str) else value
    if (value and getattr(settings, 'R2_PUBLIC_BASE', '') and media.is_absolute(value)
            and not r2.is_r2_url(value)):
        raise serializers.ValidationError(f'Upload the {what} first.')
    return value


class MediaReferenceField(serializers.Field):
    """Media reference field: columns store the absolute R2 public URL. Reads
    resolve via songs.media (stray non-URL leftovers render as None); writes
    accept the URL string the app got back from its direct-to-R2 upload -
    our own storage only (own_upload). The value a row already has may be
    sent back unchanged (an edit that keeps an older song's legacy cover)."""

    def to_representation(self, value):
        return media.resolve(value)

    def to_internal_value(self, data):
        if not data:
            return None
        if isinstance(data, str) and media.is_absolute(data):
            if len(data) > 500:
                raise serializers.ValidationError('Media URL is too long.')
            instance = getattr(self.parent, 'instance', None)
            current = getattr(instance, self.source, None) if instance is not None and self.source else None
            if current and data in (current, media.resolve(current)):
                return current
            return own_upload(data, 'file')
        raise serializers.ValidationError(
            'Invalid media reference. Expected the public URL returned by the upload.'
        )


# Transitional alias — a handful of serializers still use the old name.
CloudinaryFieldSerializer = MediaReferenceField



PROFILE_BIO_MAX = 150
PROFILE_MIN_AGE = 13


def clean_website(value):
    """A profile link: http(s) only (never javascript:, data:, a phone's own
    file), at most 200 characters; 'example.org' is read as https://."""
    value = (value or '').strip()
    if not value:
        return ''
    if '://' not in value:
        value = f'https://{value}'
    from urllib.parse import urlparse
    parts = urlparse(value)
    if parts.scheme not in ('http', 'https') or not parts.netloc or ' ' in value or '.' not in parts.netloc:
        raise serializers.ValidationError('Enter a web address, like example.org.')
    if len(value) > 200:
        raise serializers.ValidationError('That link is too long.')
    return value


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
    # Lifetime likes on this user's posts, tracks and publications. A stored
    # counter (see User.total_likes), so it costs no extra query here.
    total_likes = serializers.ReadOnlyField(source='user.total_likes')

    class Meta:
        model = Profile
        fields = ['bio', 'user_id','username', 'email', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                  'birth_date', 'location', 'is_public', 'picture','picture_url',
                  'display_name', 'website',
                  'followers_count', 'following_count', 'posts_count', 'total_likes']
        read_only_fields = ['user_id', 'username', 'email', 'is_staff', 'admin_role', 'is_super_admin', 'capabilities', 'is_suspended',
                            'picture_url', 'followers_count', 'following_count', 'posts_count', 'total_likes']
        extra_kwargs = {
            'picture': {'write_only': True}  # Only needed for uploads
        }

    def get_picture_url(self, obj):
        return media.resolve(obj.picture)

    # ── what may be saved (the app checks the same; the server must too) ──
    def validate_picture(self, value):
        # Our own uploads only: an outside link would be fetched by every
        # viewer's phone (telling that server who looks) and skip moderation.
        if value and len(value) > 500:
            raise serializers.ValidationError('Picture link is too long.')
        return own_upload(value, 'photo') or ''

    def validate_bio(self, value):
        value = (value or '').strip()
        if len(value) > PROFILE_BIO_MAX:
            raise serializers.ValidationError(f'Keep the bio to {PROFILE_BIO_MAX} characters.')
        return value

    def validate_location(self, value):
        value = ' '.join((value or '').split())
        if len(value) > 100:
            raise serializers.ValidationError('Keep the location to 100 characters.')
        return value

    def validate_display_name(self, value):
        value = ' '.join((value or '').split())      # one line, single spaces
        if len(value) > 50:
            raise serializers.ValidationError('Keep the name to 50 characters.')
        return value

    def validate_website(self, value):
        return clean_website(value)

    def validate_birth_date(self, value):
        if value is None:
            return value
        from datetime import date
        today = date.today()
        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if value > today:
            raise serializers.ValidationError('That date is in the future.')
        if age < PROFILE_MIN_AGE:
            raise serializers.ValidationError(f'You must be at least {PROFILE_MIN_AGE}.')
        if age > 120:
            raise serializers.ValidationError('Check the year.')
        return value

    def get_followers_count(self, obj):
        # obj.user.followers are the users who follow this profile's owner.
        return obj.user.followers.count()

    def get_following_count(self, obj):
        return obj.user.followed_by.count()

    def get_posts_count(self, obj):
        # Matches the grid below, which hides takedowns — otherwise the header
        # would advertise a post the profile refuses to show. The admin
        # serializer keeps its own unfiltered count on purpose.
        from songs.models import visible_posts_q
        request = self.context.get('request')
        viewer = getattr(request, 'user', None) if request else None
        return obj.user.social_posts.filter(is_removed=False).filter(visible_posts_q(viewer)).count()

    def update(self, instance, validated_data):
        was_private = not instance.is_public
        instance = super().update(instance, validated_data)
        if was_private and instance.is_public:
            # Open now: the requests still waiting would read "Requested" for
            # ever on an account anyone may follow. Let them in.
            from ..models import Block
            owner = instance.user
            blocked = set(Block.objects.filter(blocker=owner).values_list('blocked_id', flat=True)) | set(
                Block.objects.filter(blocked=owner).values_list('blocker_id', flat=True))
            waiting = FollowRequest.objects.filter(target=owner, status='pending')
            ids = [r for r in waiting.exclude(requester__is_deactivated=True)
                   .values_list('requester_id', flat=True) if r not in blocked]
            if ids:
                owner.followers.add(*ids)
            waiting.delete()
        return instance

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
            'follow_status', 'profile_picture', 'total_likes'
        ]
        extra_kwargs = {
            'password': {'write_only': True},
            'email': {'required': True},
            # Stored counter maintained by signals — never client-writable.
            'total_likes': {'read_only': True},
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

        # is_removed hides a moderator takedown from every public surface — the
        # author included, as on the feed. Without this the grid was the one
        # place a removed post stayed visible.
        posts = obj.social_posts.filter(is_removed=False).order_by('-created_at')
        # Per-post visibility: followers-only posts for followers, "only me"
        # posts for the author alone.
        from songs.models import visible_posts_q
        posts = posts.filter(visible_posts_q(viewer))

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



PROFILE_POSTS_PAGE = 30


class PublicProfileSerializer(serializers.ModelSerializer):
    """Someone else's profile as other people see it: no email, birth date,
    staff/admin flags or capabilities (ProfileSerializer carries those for the
    owner's own /profiles/me/)."""
    user_id = serializers.ReadOnlyField(source='user.id')
    username = serializers.ReadOnlyField(source='user.username')
    picture_url = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ['user_id', 'username', 'bio', 'location', 'is_public', 'picture_url', 'display_name', 'website']

    def get_picture_url(self, obj):
        return media.resolve(obj.picture)


# A profile's grid: pinned posts first (the latest pin on top), then newest.
PROFILE_GRID_ORDER = (models.F('pinned_at').desc(nulls_last=True), '-created_at')


class ProfileDetailSerializer(serializers.ModelSerializer):
    """GET /users/<id>/ — everything a profile screen draws, in one response:
    header, counts, follow state and the first page of the post grid.

    Built for speed: every count and follow flag is annotated by the view
    (UserViewSet.get_queryset), so the whole screen costs a handful of queries
    whatever the account's size — it used to be a dozen, plus every post the
    account ever made in one payload. Private fields (email, birth date) go to
    the owner only."""
    profile_picture = serializers.SerializerMethodField()
    profile = serializers.SerializerMethodField()
    followers_count = serializers.IntegerField(source='n_followers', read_only=True)
    following_count = serializers.IntegerField(source='n_following', read_only=True)
    posts_count = serializers.SerializerMethodField()
    tracks_count = serializers.IntegerField(source='n_tracks', read_only=True, default=0)
    verified = serializers.BooleanField(source='is_verified_artist', read_only=True)
    # Public playlists (the Playlists tab shows on a profile that has some).
    playlists_count = serializers.IntegerField(source='n_public_playlists', read_only=True, default=0)
    is_self = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    follows_you = serializers.SerializerMethodField()
    follow_status = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    can_view = serializers.SerializerMethodField()
    social_posts = serializers.SerializerMethodField()
    posts_has_more = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'profile_picture', 'profile',
            'followers_count', 'following_count', 'posts_count', 'tracks_count', 'playlists_count', 'total_likes',
            'is_self', 'is_following', 'follows_you', 'follow_status', 'verified',
            'is_private', 'can_view', 'social_posts', 'posts_has_more',
        ]

    def _viewer(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

    def _is_self(self, obj):
        viewer = self._viewer()
        return bool(viewer and viewer.is_authenticated and viewer.pk == obj.pk)

    def _profile(self, obj):
        try:
            return obj.profile
        except Profile.DoesNotExist:
            return None

    def get_profile_picture(self, obj):
        prof = self._profile(obj)
        return media.resolve(prof.picture) if prof and prof.picture else None

    def get_profile(self, obj):
        prof = self._profile(obj)
        if prof is None:
            return {'bio': '', 'location': '', 'is_public': True, 'display_name': '', 'website': ''}
        data = {'bio': prof.bio or '', 'location': prof.location or '', 'is_public': prof.is_public,
                'display_name': prof.display_name or '', 'website': prof.website or ''}
        if self._is_self(obj):
            data['birth_date'] = prof.birth_date
        return data

    def get_is_self(self, obj):
        return self._is_self(obj)

    def get_is_following(self, obj):
        return bool(getattr(obj, 'viewer_follows', False))

    def get_follows_you(self, obj):
        return bool(getattr(obj, 'follows_viewer', False)) and not self._is_self(obj)

    def get_follow_status(self, obj):
        if getattr(obj, 'viewer_follows', False):
            return 'following'
        if getattr(obj, 'viewer_requested', False):
            return 'requested'
        return 'none'

    def get_is_private(self, obj):
        prof = self._profile(obj)
        return prof is not None and not prof.is_public

    def get_can_view(self, obj):
        prof = self._profile(obj)
        return (prof is None or prof.is_public or self._is_self(obj)
                or bool(getattr(obj, 'viewer_follows', False)))

    def _visible_posts(self, obj):
        from songs.models import visible_posts_q
        return (obj.social_posts.filter(is_removed=False)
                .filter(visible_posts_q(self._viewer())).order_by(*PROFILE_GRID_ORDER))

    def get_posts_count(self, obj):
        # The count stays visible on a private account (as on other networks);
        # it's the posts themselves that are withheld.
        return self._visible_posts(obj).count()

    def _first_page(self, obj):
        if not hasattr(self, '_page_cache'):
            self._page_cache = {}
        if obj.pk not in self._page_cache:
            if not self.get_can_view(obj):
                self._page_cache[obj.pk] = ([], False)
            else:
                rows = list(self._visible_posts(obj)[:PROFILE_POSTS_PAGE + 1])
                self._page_cache[obj.pk] = (rows[:PROFILE_POSTS_PAGE], len(rows) > PROFILE_POSTS_PAGE)
        return self._page_cache[obj.pk]

    def get_social_posts(self, obj):
        from songs.serializers.social import ProfileGridPostSerializer
        rows, _ = self._first_page(obj)
        return ProfileGridPostSerializer(rows, many=True, context=self.context).data

    def get_posts_has_more(self, obj):
        return self._first_page(obj)[1]


class SimpleUserSerializer(serializers.ModelSerializer):
    profile_picture = serializers.SerializerMethodField()
    # The verified-artist tick, next to the name on songs, comments, lists.
    verified = serializers.BooleanField(source='is_verified_artist', read_only=True)
    
    class Meta:
        model = User
        fields = ['id', 'username', 'profile_picture', 'verified']
    
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
            # Annotated by the follow-list views; the query is the fallback
            # for any caller that serializes a plain queryset.
            if hasattr(obj, 'viewer_follows'):
                return obj.viewer_follows
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




