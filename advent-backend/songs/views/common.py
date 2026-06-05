from rest_framework import viewsets, permissions
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.permissions import AllowAny
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError
from django.http import FileResponse,Http404
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from django.shortcuts import get_object_or_404 
from rest_framework.pagination import PageNumberPagination
from rest_framework_simplejwt.views import TokenObtainPairView
import time as time_module
import cloudinary
from cloudinary.utils import api_sign_request as cloudinary_sign_request
from django.db import transaction
from django.contrib.auth.decorators import login_required
from rest_framework.exceptions import PermissionDenied
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser,JSONParser
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_control
from cloudinary.uploader import upload
from cloudinary.uploader import destroy 
from cloudinary.exceptions import Error as CloudinaryError
from ..models import User,SocialPost,PostSave,PostComment, PostLike, LiveEvent, Track, Playlist, Profile, Comment, Like, Category, Notification, DeviceToken, Conversation, Message, EmailVerification, PasswordResetCode, Story, StoryView, Report,Church,Videostudio, Choir, Group, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist
from ..push import notify_user
from ..tasks import run_in_background
from ..serializers import (
    UserSerializer,
    TrackSerializer,
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
    ChurchSerializer,
    VideoStudioSerializer,  
    ChoirSerializer, 
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
)
import logging
import time
from django.utils import timezone
from django.conf import settings
from django.db.models import Count
from datetime import timedelta
logger = logging.getLogger(__name__)


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

