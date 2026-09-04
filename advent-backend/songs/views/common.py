from rest_framework import viewsets, permissions
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, BasePermission, IsAuthenticatedOrReadOnly
from rest_framework.permissions import AllowAny
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError
from django.http import FileResponse,Http404
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from django.shortcuts import get_object_or_404 
from rest_framework.pagination import PageNumberPagination, CursorPagination
from rest_framework_simplejwt.views import TokenObtainPairView
import time as time_module
from django.db import transaction
from django.contrib.auth.decorators import login_required
from rest_framework.exceptions import PermissionDenied
from rest_framework.exceptions import APIException
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser,JSONParser
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_control
from .. import media
from .. import r2
from ..models import User,SocialPost,PostSave,PostComment, PostLike, LiveEvent, Track, Playlist, Profile, Comment, Like, Category, Notification, DeviceToken, Conversation, Message, EmailVerification, PasswordResetCode, Story, StoryView, Report,Videostudio, CommunityCategory,PuzzleTheme,WordPuzzle,PuzzleProgress,CoinSpend,BibleVerse,DailyQuiz,QuizQuestion,QuizAttempt, Group, GroupMember, GroupJoinRequest, GroupPost,GroupAuditLog,GroupPostAttachment,GroupPostReaction,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist,MediaStation,Notice,AdminNote,NotificationPreference,Block,blocked_ids_for,is_blocked_between,Publication,Chapter,PublicationLike,PublicationBookmark,ReadingProgress,FollowRequest,can_view_profile,hidden_private_author_ids,Wallpaper,WeatherPlace
from ..push import notify_user
from ..tasks import run_in_background
from ..serializers import (
    UserSerializer,
    FollowRequestSerializer,
    TrackSerializer,
    TrackQueueSerializer,
    PlaylistSerializer,
    PlaylistListSerializer,
    ProfileSerializer,
    CommentSerializer,
    LikeSerializer,
    CategorySerializer,
    SocialPostSerializer, 
    PostLikeSerializer,
    PostCommentSerializer,
    PostSaveSerializer,
    NotificationSerializer,
    NoticeSerializer,
    WallpaperSerializer,
    AdminNoteSerializer,
    NotificationPreferenceSerializer,
    WeatherPlaceSerializer,
    MediaStationSerializer,
    PublicationListSerializer,
    PublicationDetailSerializer,
    ChapterSerializer,
    VideoStudioSerializer,
    VideoStudioListSerializer,
    CommunityCategorySerializer,
    GroupSerializer,
    GroupMemberSerializer, 
    GroupJoinRequestSerializer, 
    GroupPostSerializer,
    GroupPostAttachmentSerializer,
    WishlistSerializer,
    ProductReviewSerializer,
    OrderSerializer,
    OrderItemSerializer,
    CartSerializer,
    CartItemSerializer,
    ProductSerializer,
    ProductImageSerializer,
    ProductCategorySerializer,
    LiveEventSerializer,
    AvatarUploadSerializer,
    TrackUploadSerializer,
    SocialPostUploadSerializer,
    ConversationSerializer,
    MessageSerializer,
    StorySerializer,
    ReportSerializer,
    SimpleUserSerializer,
    FollowListSerializer,
)
import logging
import time
from django.utils import timezone
from django.conf import settings
from django.db.models import Count, Prefetch
from datetime import timedelta
logger = logging.getLogger(__name__)


class IsNotSuspended(BasePermission):
    """Suspended users can still read, but cannot create or modify content."""
    message = 'Your account is suspended.'

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = request.user
        # Honour temporary suspensions: a lapsed `suspended_until` no longer blocks.
        return not (u and u.is_authenticated and getattr(u, 'is_currently_suspended', False))


def Cap(*caps):
    """Permission factory: allow if the user has ANY of the given capabilities
    (super admins implicitly have all).

    Lives here rather than in views/admin.py so modules imported earlier (e.g.
    directory) can gate on a capability without a forward import."""
    class _CapPermission(BasePermission):
        message = 'You do not have permission for this action.'

        def has_permission(self, request, view):
            u = request.user
            return bool(u and u.is_authenticated and any(u.has_capability(c) for c in caps))
    return _CapPermission


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

    def get_paginated_response(self, data):
        return Response({
            'count': self.page.paginator.count,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data,
        })


class FeedCursorPagination(CursorPagination):
    """Keyset/cursor pagination for the home feed.

    Unlike PageNumberPagination (LIMIT/OFFSET — which gets slower the deeper you
    page, since the DB must scan+skip all preceding rows), a cursor walks the
    `-id` index directly: page N costs the same as page 1, and rows can't be
    skipped/duplicated when new posts arrive mid-scroll. Ordering by the PK is
    unique + monotonic (≈ newest-first) and index-backed.
    """
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50
    ordering = '-id'
    cursor_query_param = 'cursor'



def super_admin_user_ids():
    """IDs of every super admin. Super admins operate invisibly in community
    chats: their messages and reactions are filtered out for regular clients, so
    callers pass these ids to ``.exclude(...)`` / skip them in reaction aggregates.
    Empty-set-friendly: an empty ``__in`` exclude is a harmless no-op."""
    return set(
        User.objects.filter(Q(is_superuser=True) | Q(admin_role='super_admin'))
        .values_list('id', flat=True)
    )


class IsOwnerOrReadOnly(BasePermission):
    """Object-level permission: safe methods are open; writes/deletes are
    restricted to the object's owner.

    The owner attribute is resolved from the view's ``owner_field`` if set,
    otherwise from the first matching name in ``OWNER_FIELDS``. Applied
    alongside ``IsAuthenticatedOrReadOnly`` it guarantees a user can only
    modify their own content. DRF invokes ``has_object_permission`` whenever
    a detail view calls ``get_object()`` (retrieve/update/partial_update/
    destroy), so no per-view update/destroy overrides are needed.
    """
    message = "You can only modify your own content."

    OWNER_FIELDS = ('user', 'artist', 'seller', 'reviewer', 'created_by', 'creator')

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        owner_field = getattr(view, 'owner_field', None)
        if owner_field:
            return getattr(obj, owner_field, None) == request.user
        for name in self.OWNER_FIELDS:
            if hasattr(obj, name):
                return getattr(obj, name) == request.user
        # No recognizable owner field — deny writes rather than fail open.
        return False



def health_check(request):
    """Liveness probe for load balancers / uptime monitors. Plain Django view
    so it bypasses DRF auth, throttling and content negotiation."""
    return JsonResponse({'status': 'ok'})



class IsGroupCreator(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.creator == request.user

