from rest_framework import viewsets, permissions
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status
from django.core.cache import cache
from django.contrib.auth.models import User
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
from .models import User,SocialPost,PostSave,PostComment, PostLike, LiveEvent, Track, Playlist, Profile, Comment, Like, Category, Notification, DeviceToken, Conversation, Message, EmailVerification, PasswordResetCode, Story, StoryView, Report,Church,Videostudio, Choir, Group, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist
from .push import notify_user
from .tasks import run_in_background
from .serializers import (
    UserSerializer,
    TrackSerializer,
    PlaylistSerializer,
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


class CloudinarySignView(APIView):
    permission_classes = [IsAuthenticated]

    FOLDER_MAP = {
        'audio': 'audio_uploads',
        'image': 'social_media/images',
        'video': 'social_media/videos',
        'profile': 'profile_images',
        'cover': 'cover_images',
        'avatar': 'avatars',
    }

    def post(self, request):
        upload_type = request.data.get('type', 'image')
        folder = self.FOLDER_MAP.get(upload_type, 'uploads')
        timestamp = int(time_module.time())
        params_to_sign = {'timestamp': timestamp, 'folder': folder}
        api_secret = cloudinary.config().api_secret
        if not api_secret:
            return Response({'error': 'Cloudinary not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        signature = cloudinary_sign_request(params_to_sign, api_secret)
        return Response({
            'signature': signature,
            'timestamp': timestamp,
            'api_key': cloudinary.config().api_key,
            'cloud_name': cloudinary.config().cloud_name,
            'folder': folder,
        })


class AvatarUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        """Alternative endpoint for avatar uploads"""
        if not hasattr(request.user, 'profile'):
            return Response(
                {'error': 'Profile does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        serializer = AvatarUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = upload(
                serializer.validated_data['avatar'],
                folder='profile_pictures',
                resource_type='image',
                transformation=[
                    {'width': 300, 'height': 300, 'crop': 'thumb', 'gravity': 'face'},
                    {'quality': 'auto'}
                ]
            )
            
            # Update profile with new picture data
            profile = request.user.profile
            profile.picture = {
                'public_id': result['public_id'],
                'secure_url': result['secure_url']
            }
            profile.save()
            
            return Response(
                ProfileSerializer(profile, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Avatar upload failed: {str(e)}")
            return Response(
                {'error': 'Failed to process image upload'},
                status=status.HTTP_400_BAD_REQUEST
            )

class TrackUploadView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TrackUploadSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # Upload audio file
                audio_result = upload(
                    serializer.validated_data['audio_file'],
                    folder='audio',
                    resource_type='video',
                    format='mp3'
                )
                
                # Upload cover image if provided
                cover_result = None
                if 'cover_image' in serializer.validated_data:
                    cover_result = upload(
                        serializer.validated_data['cover_image'],
                        folder='covers',
                        resource_type='image'
                    )
                
                # Create track
                track_data = {
                    'title': request.data.get('title', 'Untitled Track'),
                    'artist': request.user.id,
                    'audio_file': audio_result['public_id'],
                    'cover_image': cover_result['public_id'] if cover_result else None,
                    'album': request.data.get('album', ''),
                    'lyrics': request.data.get('lyrics', '')
                }
                
                track_serializer = TrackSerializer(data=track_data, context={'request': request})
                if track_serializer.is_valid():
                    track = track_serializer.save()
                    return Response(track_serializer.data, status=status.HTTP_201_CREATED)
                return Response(track_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
            except CloudinaryError as e:
                return Response(
                    {'error': str(e)},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

def _send_verification_email(user):
    """Generate a 6-digit code and email it to the user. Returns the code."""
    import random
    from django.core.mail import send_mail
    from django.utils import timezone
    from datetime import timedelta

    code = f"{random.randint(0, 999999):06d}"
    expires_at = timezone.now() + timedelta(minutes=15)
    EmailVerification.objects.create(user=user, code=code, expires_at=expires_at)

    run_in_background(
        send_mail,
        subject=f"{settings.SITE_NAME} — Verify your email",
        message=(
            f"Hi {user.username},\n\n"
            f"Your verification code is: {code}\n\n"
            f"This code expires in 15 minutes.\n\n"
            f"If you didn't create an account, you can ignore this email.\n\n"
            f"— {settings.SITE_NAME} Team"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
    return code


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login endpoint with a tight per-IP rate limit to deter credential stuffing."""
    throttle_scope = 'auth'


class SignUpView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            _send_verification_email(user)
            return Response(
                {"message": "Account created. Please check your email to verify."},
                status=status.HTTP_201_CREATED
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class VerifyEmailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'email_verify'

    def post(self, request):
        code = request.data.get('code', '').strip()
        if not code:
            return Response({'error': 'Code is required'}, status=status.HTTP_400_BAD_REQUEST)

        verification = EmailVerification.objects.filter(
            user=request.user, code=code, used=False
        ).first()

        if not verification or not verification.is_valid():
            return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)

        verification.used = True
        verification.save()
        request.user.is_email_verified = True
        request.user.save(update_fields=['is_email_verified'])
        return Response({'message': 'Email verified successfully'})


class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'email_verify'

    def post(self, request):
        if request.user.is_email_verified:
            return Response({'message': 'Email already verified'})
        _send_verification_email(request.user)
        return Response({'message': 'Verification code sent'})


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        import random
        from django.core.mail import send_mail
        from datetime import timedelta

        email = request.data.get('email', '').strip()
        if not email:
            return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Return success even for unknown emails (prevents email enumeration)
            return Response({'message': 'If that email exists, a reset code has been sent.'})

        code = f"{random.randint(0, 999999):06d}"
        expires_at = timezone.now() + timedelta(minutes=15)
        PasswordResetCode.objects.create(user=user, code=code, expires_at=expires_at)

        run_in_background(
            send_mail,
            subject=f"{settings.SITE_NAME} — Password Reset Code",
            message=(
                f"Hi {user.username},\n\n"
                f"Your password reset code is: {code}\n\n"
                f"This code expires in 15 minutes.\n\n"
                f"If you didn't request this, you can ignore this email.\n\n"
                f"— {settings.SITE_NAME} Team"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        return Response({'message': 'If that email exists, a reset code has been sent.'})


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        email = request.data.get('email', '').strip()
        code = request.data.get('code', '').strip()
        new_password = request.data.get('new_password', '')

        if not all([email, code, new_password]):
            return Response({'error': 'email, code, and new_password are required'}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 8:
            return Response({'error': 'Password must be at least 8 characters'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid code'}, status=status.HTTP_400_BAD_REQUEST)

        reset = PasswordResetCode.objects.filter(user=user, code=code, used=False).first()
        if not reset or not reset.is_valid():
            return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)

        reset.used = True
        reset.save()
        user.set_password(new_password)
        user.save()
        return Response({'message': 'Password reset successfully. Please log in with your new password.'})


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Annotate followers count if needed
        if self.action in ['list', 'retrieve']:
            queryset = queryset.annotate(
                followers_count=Count('followers', distinct=True),
                following_count=Count('followed_by', distinct=True)
            )
            
            # For authenticated users, prefetch follow status
            if self.request.user.is_authenticated:
                queryset = queryset.prefetch_related(
                    Prefetch('followers', 
                           queryset=User.objects.filter(id=self.request.user.id),
                           to_attr='followers_set')
                )
                
        return queryset
    def get_serializer_context(self):
        """Add context for profile picture transformations"""
        context = super().get_serializer_context()
        context.update({
            'picture_width': 50,  # Smaller for user lists
            'picture_height': 50,
            'picture_crop': 'fill',
            'picture_gravity': 'face',
            'picture_quality': 'auto'
        })
        return context

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=True, methods=['get'])
    def playlists(self, request, pk=None):
        user = self.get_object()
        playlists = Playlist.objects.filter(user=user)
        serializer = PlaylistSerializer(playlists, many=True)
        return Response(serializer.data)


    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def follow(self, request, pk=None):
        user_to_follow = self.get_object()
        current_user = request.user

        if current_user == user_to_follow:
            return Response(
                {"error": "You cannot follow yourself"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if current_user in user_to_follow.followers.all():
            user_to_follow.followers.remove(current_user)
            action = 'unfollowed'
        else:
            user_to_follow.followers.add(current_user)
            action = 'followed'
            msg = f"{current_user.username} started following you"
            Notification.objects.create(
                recipient=user_to_follow,
                sender=current_user,
                message=msg,
                notification_type='follow'
            )
            notify_user(user_to_follow, 'follow', msg)

        # Return updated counts
        return Response({
            "status": f"Successfully {action} {user_to_follow.username}",
            "is_following": current_user in user_to_follow.followers.all(),
            "followers_count": user_to_follow.followers.count(),
            "following_count": user_to_follow.followed_by.count()
        })
    @action(detail=True, methods=['get'])
    def social_posts(self, request, pk=None):
        """Get user's posts with optimized author pictures"""
        user = self.get_object()
        posts = SocialPost.objects.filter(user=user).select_related('user__profile')
        
        page = self.paginate_queryset(posts)
        if page is not None:
            serializer = SocialPostSerializer(
                page, 
                many=True,
                context=self.get_serializer_context()
            )
            return self.get_paginated_response(serializer.data)
            
        serializer = SocialPostSerializer(
            posts, 
            many=True,
            context=self.get_serializer_context()
        )
        return Response(serializer.data)
    @action(detail=True, methods=['get'])
    def followers_count(self, request, pk=None):
        """Dedicated endpoint just for follower count"""
        user = self.get_object()
        return Response({
            "count": user.followers.count(),
            "user_id": user.id
        })

    @action(detail=True, methods=['get'])
    def following_count(self, request, pk=None):
        """Dedicated endpoint just for following count"""
        user = self.get_object()
        return Response({
            "count": user.followed_by.count(),
            "user_id": user.id
        })
    @action(detail=True, methods=['get'])
    def followers(self, request, pk=None):
        """Get list of followers"""
        user = self.get_object()
        followers = user.followers.all()
        serializer = self.get_serializer(followers, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def following(self, request, pk=None):
        """Get list of users this user follows"""
        user = self.get_object()
        following = user.followed_by.all()
        serializer = self.get_serializer(following, many=True)
        return Response(serializer.data)
class TrackViewSet(viewsets.ModelViewSet):
    queryset = Track.objects.all().order_by('-created_at')
    serializer_class = TrackSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination


    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only edit your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.artist != request.user:
            return Response(
                {"error": "You can only delete your own tracks"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        title = serializer.validated_data.get('title')
        slug = slugify(title)
        base_slug = slug
        counter = 1
        while Track.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        serializer.save(artist=self.request.user, slug=slug)

    @action(detail=False, methods=['post'], url_path='upload')
    def upload_track(self, request):
        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            serializer.save(artist=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)




    
    @action(detail=True, methods=['post'])
    def like(self, request, pk=None):
        track = self.get_object()
        user = request.user
        # Check if the user has already liked the track
        if Like.objects.filter(user=user, track=track).exists():
          return Response({"error": "You have already liked this track."}, status=400)

        Like.objects.create(user=user, track=track)
    # Return the updated like count
        likes_count = Like.objects.filter(track=track).count()
        return Response({"status": "Track liked", "likes_count": likes_count})



    @action(detail=True, methods=['post'], url_path='toggle-like')
    def toggle_like(self, request, pk=None):
        track = self.get_object()
        user = request.user

        existing_like = Like.objects.filter(user=user, track=track).first()
        if existing_like:
            existing_like.delete()
            likes_count = track.likes.count()
            return Response({
                "status": "Track unliked",
                "likes_count": likes_count,
                "is_liked": False
            })
        Like.objects.create(user=user, track=track)
        likes_count = track.likes.count()
        msg = f"{user.username} liked your track {track.title}"
        Notification.objects.create(
            recipient=track.artist,
            sender=user,
            message=msg,
            notification_type='like',
            track=track
        )
        notify_user(track.artist, 'like', msg)
        return Response({
            "status": "Track liked",
            "likes_count": likes_count,
            "is_liked": True
        })
    
  
    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        track = self.get_object()
        if not track.audio_file:
            return Response({'error': 'Audio file not found'}, status=404)
        return Response({
            'download_url': CloudinaryFieldSerializer().to_representation(track.audio_file)
        })
    @action(detail=True, methods=['post'])
    def favorites(self, request):
   
        user = request.user
        if not user.is_authenticated:
            return Response({'detail': 'Authentication required'}, status=401)

        favorite_tracks = user.favorite_tracks.all()
        serializer = self.get_serializer(favorite_tracks, many=True)
        return Response(serializer.data)
    @action(detail=True, methods=['post'], url_path='toggle-favorite')
    def toggle_favorite(self, request, pk=None):
        track = self.get_object()
        user = request.user

        existing_like = Like.objects.filter(user=user, track=track).first()
        if existing_like:
            existing_like.delete()
            return Response({"status": "Track unfavorited"}, status=status.HTTP_200_OK)
        
        Like.objects.create(user=user, track=track)
        return Response({"status": "Track favorited"}, status=status.HTTP_200_OK)


    @action(detail=False, methods=['get'], url_path='favorites')
    def get_favorites(self, request):
        user = request.user
        favorites = Track.objects.filter(likes__user=user)
        serializer = TrackSerializer(favorites, many=True, context={"request": request})
        return Response(serializer.data)
    

class PlaylistViewSet(viewsets.ModelViewSet):
    queryset = Playlist.objects.all()
    serializer_class = PlaylistSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)




class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    def get_serializer_context(self):
        """Add picture transformation parameters to serializer context"""
        context = super().get_serializer_context()
        context.update({
            'picture_width': 200,
            'picture_height': 200,
            'picture_crop': 'fill',
            'picture_gravity': 'face',
            'picture_quality': 'auto'
        })
        return context

    def perform_update(self, serializer):
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only update your own profile.")
        serializer.save()

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def check_or_redirect(self, request):
        user = request.user
        if hasattr(user, 'profile'):
            return Response({'profile_exists': True}, status=status.HTTP_200_OK)
        return Response({'profile_exists': False, 'message': 'Redirect to create profile'}, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def create_profile(self, request):
        if hasattr(request.user, 'profile'):
            return Response({'detail': 'Profile already exists for this user.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ProfileSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['patch'], permission_classes=[permissions.IsAuthenticated])
    def update_me(self, request):
        """Update current user's own profile."""
        try:
            profile = request.user.profile
        except Profile.DoesNotExist:
            return Response({'detail': 'Profile not found. Create one first.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ProfileSerializer(profile, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def has_profile(self, request):
        profile_exists = hasattr(self.request.user, 'profile')
        return Response({'profile_exists': profile_exists})
    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        """Retrieve the authenticated user's profile with optimized picture"""
        try:
            profile = request.user.profile
            serializer = self.get_serializer(profile)
            return Response(serializer.data)
        except Profile.DoesNotExist:
            return Response(
                {'detail': 'Profile does not exist for this user.'},
                status=status.HTTP_404_NOT_FOUND
            )


    @action(detail=False, methods=['get'], url_path='by_user/(?P<user_id>[^/.]+)')
    def by_user(self, request, user_id=None):
        """Retrieve a profile by user ID."""
        try:
            user = User.objects.get(id=user_id)
            profile = user.profile
            serializer = self.get_serializer(profile)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        except Profile.DoesNotExist:
            return Response({'detail': 'Profile not found for this user.'}, status=status.HTTP_404_NOT_FOUND)



    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def upload_picture(self, request):
        """Handle profile picture upload with Cloudinary transformations"""
        if not hasattr(request.user, 'profile'):
            return Response(
                {'error': 'Profile does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        serializer = AvatarUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = upload(
                serializer.validated_data['avatar'],
                folder='profiles',
                resource_type='image',
                transformation=[
                    {'width': 500, 'height': 500, 'crop': 'fill', 'gravity': 'face'},
                    {'quality': 'auto', 'fetch_format': 'auto'}
                ]
            )
            
            # Store both public_id and URL for flexibility
            request.user.profile.picture = {
                'public_id': result['public_id'],
                'secure_url': result['secure_url']
            }
            request.user.profile.save()
            
            return Response(
                self.get_serializer(request.user.profile).data,
                status=status.HTTP_200_OK
            )
        except CloudinaryError as e:
            logger.error(f"Cloudinary upload failed: {str(e)}")
            return Response(
                {'error': 'Failed to upload image to Cloudinary'},
                status=status.HTTP_400_BAD_REQUEST
            )
class CommentViewSet(viewsets.ModelViewSet):
    queryset = Comment.objects.all()
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        track_id = self.kwargs.get('track_pk')
        if track_id:
            return Comment.objects.filter(track_id=track_id)
        return Comment.objects.all()

    def perform_create(self, serializer):
        track_id = self.kwargs.get('track_pk')
        track = get_object_or_404(Track, id=track_id)
        serializer.save(user=self.request.user, track=track)
        comment = serializer.save(user=self.request.user, track=track)  # <-- This line was missing

        if comment.user != track.artist:
            msg = f"{self.request.user.username} commented on your track {track.title}"
            Notification.objects.create(
                recipient=track.artist,
                sender=self.request.user,
                message=msg,
                notification_type='comment',
                track=track
            )
            notify_user(track.artist, 'comment', msg)
class LikeViewSet(viewsets.ModelViewSet):
    queryset = Like.objects.all()
    serializer_class = LikeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]


class FavoriteTracksView(APIView):
    permission_classes = [IsAuthenticated]  # Ensure authentication is enforced

    def get(self, request):
        user = request.user
        favorite_tracks = Track.objects.filter(likes__user=user)  # Query for the user's favorites
        serializer = TrackSerializer(favorite_tracks, many=True, context={"request": request})
        return Response(serializer.data, status=200)

class SocialPostViewSet(viewsets.ModelViewSet):
    pagination_class = StandardPagination
    queryset = SocialPost.objects.select_related(
        'user', 
        # 'user__avatar',  
        'song',
        'song__artist'
    ).prefetch_related(
        'likes',
        'likes__user',
        'comments',
        'comments__user',
        'saves'
    ).order_by('-created_at')
    queryset = SocialPost.objects.all().order_by('-created_at')
    serializer_class = SocialPostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    def get_queryset(self):
        user_queryset = User.objects.annotate(
            followers_count=Count('followers', distinct=True)
        )
        return SocialPost.objects.annotate(
            likes_count=Count('likes', distinct=True),
            comments_count=Count('comments', distinct=True)
        ).select_related('song').prefetch_related(
            Prefetch('user', queryset=user_queryset)  # Prefetch with annotation
        ).order_by('-created_at')
    # Add this to ensure request context is available in serializers
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    

    def perform_create(self, serializer):
        try:
            # Create the post with the authenticated user
            logger.info(f"Creating post with data: {serializer.validated_data}")
            post = serializer.save(user=self.request.user)
            if post.media_file:
                logger.info(f"Created post ID {post.id} with media_file: {post.media_file}")
                logger.info(f"Media type: {post.content_type}, Size: {post.width}x{post.height}")
            return post

        except ValidationError as ve:
            logger.warning(f"Validation error: {ve}")
            raise
        except Exception as e:
            logger.exception("Post creation failed with exception:")
            logger.error(f"Post creation failed: {str(e)}", exc_info=True)
            # Log the serializer data that caused the error
            logger.error(f"Error data: {serializer.validated_data}")
            
            # Also log the request data
            logger.error(f"Request data: {self.request.data}")
            raise ValidationError({
                "non_field_errors": [f"Failed to create post: {str(e)}"]
            })
    
    def get_queryset(self):
        qs = SocialPost.objects.annotate(
            likes_count=Count('likes', distinct=True),
            comments_count=Count('comments', distinct=True)
        ).select_related('user', 'song').order_by('-created_at')
        tag = self.request.query_params.get('tag')
        if tag:
            qs = qs.filter(tags__icontains=tag)
        return qs

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def viewed(self, request, pk=None):
        """Increment view count — idempotent, fire-and-forget."""
        SocialPost.objects.filter(pk=pk).update(view_count=models.F('view_count') + 1)
        return Response({'status': 'ok'})

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def insights(self, request, pk=None):
        post = self.get_object()
        if post.user != request.user:
            return Response({'error': 'Insights only available for your own posts'}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            'likes': post.likes.count(),
            'comments': post.comments.count(),
            'saves': post.saves.count(),
            'views': post.view_count,
        })

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        
        if instance.user != request.user:
            return Response(
                {"error": "You can only edit your own posts."},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Only allow updating certain fields for existing posts
        allowed_fields = ['caption', 'tags', 'location']
        filtered_data = {k: v for k, v in request.data.items() if k in allowed_fields}
        
        serializer = self.get_serializer(instance, data=filtered_data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        
        if instance.user != request.user:
            return Response(
                {"error": "You can only delete your own posts."},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            # Delete from Cloudinary if media exists
            if instance.media_file:
                # Get public_id from either CloudinaryResource or string
                public_id = (
                    instance.media_file.public_id 
                    if hasattr(instance.media_file, 'public_id') 
                    else str(instance.media_file))
                
                # If it's a URL, extract just the public_id
                if 'res.cloudinary.com' in public_id:
                    path = urlparse(public_id).path
                    parts = path.split('/')
                    try:
                        upload_index = parts.index('upload') + 1
                        public_id = '/'.join(parts[upload_index:])
                        public_id = public_id.split('.')[0]  # Remove extension
                    except ValueError:
                        pass
                
                # Determine resource type from content_type
                resource_type = 'video' if instance.content_type == 'video' else 'image'
                
                try:
                    destroy(public_id, resource_type=resource_type)
                    logger.info(f"Deleted Cloudinary {resource_type}: {public_id}")
                except Exception as e:
                    logger.error(f"Cloudinary deletion failed: {str(e)}")
                    # Continue with DB deletion even if Cloudinary fails
        
        except Exception as e:
            logger.error(f"Error during post deletion: {str(e)}", exc_info=True)
        
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    # Keep all your existing methods but add this optimization:
    def list(self, request, *args, **kwargs):
        # Add pagination and field selection
        page = self.paginate_queryset(self.get_queryset())
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def like(self, request, pk=None):
        post = self.get_object()
        user = request.user
        
        # Check if like exists
        like_exists = PostLike.objects.filter(post=post, user=user).exists()
        
        if like_exists:
            # Unlike the post
            PostLike.objects.filter(post=post, user=user).delete()
            liked = False
        else:
            # Like the post
            PostLike.objects.create(post=post, user=user)
            liked = True
            
            # Create notification only when liking (not unliking)
            if user != post.user:  # Don't notify self
                msg = f"{user.username} liked your post"
                Notification.objects.create(
                    recipient=post.user,
                    sender=user,
                    message=msg,
                    notification_type='like',
                    post=post
                )
                notify_user(post.user, 'like', msg)
        
        # Get updated like count
        likes_count = PostLike.objects.filter(post=post).count()
        
        return Response({
            'status': 'success',
            'likes_count': likes_count,
            'is_liked': liked
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def comment(self, request, pk=None):
        post = self.get_object()
        serializer = PostCommentSerializer(data=request.data, context={'request': request})
        
        if serializer.is_valid():
            comment = serializer.save(user=request.user, post=post)
            
            # Create notification if commenter is not the post owner
            if request.user != post.user:
                msg = f"{request.user.username} commented on your post"
                Notification.objects.create(
                    recipient=post.user,
                    sender=request.user,
                    message=msg,
                    notification_type='comment',
                    post=post
                )
                notify_user(post.user, 'comment', msg)

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def save_post(self, request, pk=None):
        post = self.get_object()
        user = request.user
        
        save_obj, created = PostSave.objects.get_or_create(user=user, post=post)
        
        if created:
            return Response(
                {"status": "Post saved", "is_saved": True},
                status=status.HTTP_201_CREATED
            )
        else:
            # Toggle save - remove if already saved
            save_obj.delete()
            return Response(
                {"status": "Post unsaved", "is_saved": False},
                status=status.HTTP_200_OK
            )

    @action(detail=True, methods=['get'])
    def share(self, request, pk=None):
        post = self.get_object()
        share_url = request.build_absolute_uri(f'/posts/{post.id}/')
        return Response(
            {"share_url": share_url},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        post = self.get_object()
        if not post.media_file:
            return Response(
                {'error': 'Media file not found'}, 
                status=status.HTTP_404_NOT_FOUND
            )
            
        return Response({
            'public_id': str(post.media_file),
            'content_type': post.content_type,
            'media_url': post.media_file.url if hasattr(post.media_file, 'url') else str(post.media_file)
        }, status=status.HTTP_200_OK)


class SocialPostUploadView(APIView):
    """Alternative view for handling file uploads directly to Cloudinary"""
    parser_classes = [MultiPartParser]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = SocialPostUploadSerializer(data=request.data)
        if serializer.is_valid():
            try:
                # Determine content type from file
                media_file = serializer.validated_data['media_file']
                content_type = 'video' if media_file.content_type.startswith('video/') else 'image'
                
                # Upload to Cloudinary
                result = upload(
                    media_file,
                    folder='social_media',
                    resource_type='auto',
                    # transformation=[
                    #     {'quality': 'auto'},
                    #     {'fetch_format': 'auto'}
                    # ]
                )
                
                # Create post with Cloudinary public_id
                post_data = {
                    'content_type': content_type,
                    'media_file': result['public_id'],
                    'caption': serializer.validated_data.get('caption', ''),
                    'tags': serializer.validated_data.get('tags', ''),
                    'location': serializer.validated_data.get('location', ''),
                    'duration': serializer.validated_data.get('duration', None),
                    'width': result.get('width'),
                    'height': result.get('height'),
                }
                
                post_serializer = SocialPostSerializer(data=post_data, context={'request': request})
                if post_serializer.is_valid():
                    post = post_serializer.save(user=request.user)
                    return Response(post_serializer.data, status=status.HTTP_201_CREATED)
                return Response(post_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                
            except CloudinaryError as e:
                return Response(
                    {'error': str(e)},
                    status=status.HTTP_400_BAD_REQUEST
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PostLikeViewSet(viewsets.ModelViewSet):
    queryset = PostLike.objects.all()
    serializer_class = PostLikeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)


class PostCommentViewSet(viewsets.ModelViewSet):
    queryset = PostComment.objects.all()
    serializer_class = PostCommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        post_id = self.kwargs.get('post_pk')
        if post_id:
            return PostComment.objects.filter(post__id=post_id)
        return super().get_queryset()

    def perform_create(self, serializer):
        post_id = self.kwargs.get('post_pk')
        try:
            post = SocialPost.objects.get(id=post_id)
        except SocialPost.DoesNotExist:
            raise ValidationError({"error": "Post not found"})
        comment = serializer.save(user=self.request.user, post=post)
        # Create notification only if comment author is not the post owner
        if comment.user != post.user:
            msg = f"{self.request.user.username} commented on your post"
            Notification.objects.create(
                recipient=post.user,
                sender=self.request.user,
                message=msg,
                notification_type='comment',
                post=post
            )
            notify_user(post.user, 'comment', msg)


class PostSaveViewSet(viewsets.ModelViewSet):
    queryset = PostSave.objects.all()
    serializer_class = PostSaveSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)

class StoryViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    serializer_class = StorySerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return Story.objects.filter(
            expires_at__gt=timezone.now()
        ).select_related('user__profile').prefetch_related('views')

    def perform_create(self, serializer):
        serializer.save(
            user=self.request.user,
            expires_at=timezone.now() + timedelta(hours=24),
        )

    def destroy(self, request, *args, **kwargs):
        story = self.get_object()
        if story.user != request.user:
            return Response({'error': 'Not your story'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def feed(self, request):
        """Stories from followed users, grouped by user. Own stories first."""
        following_ids = list(request.user.followed_by.values_list('id', flat=True))
        following_ids.append(request.user.id)

        stories = Story.objects.filter(
            user_id__in=following_ids,
            expires_at__gt=timezone.now(),
        ).select_related('user__profile').prefetch_related('views').order_by('user_id', '-created_at')

        # Group by user
        grouped = {}
        for story in stories:
            uid = story.user_id
            if uid not in grouped:
                grouped[uid] = {'user': story.user, 'stories': [], 'has_unviewed': False}
            grouped[uid]['stories'].append(story)
            if not story.views.filter(viewer=request.user).exists():
                grouped[uid]['has_unviewed'] = True

        # Own stories first, then following
        result = []
        own = grouped.pop(request.user.id, None)
        if own:
            result.append(own)
        result.extend(grouped.values())

        output = [
            {
                'user': SimpleUserSerializer(g['user'], context={'request': request}).data,
                'stories': StorySerializer(g['stories'], many=True, context={'request': request}).data,
                'has_unviewed': g['has_unviewed'],
            }
            for g in result
        ]
        return Response(output)

    @action(detail=True, methods=['post'])
    def view_story(self, request, pk=None):
        story = self.get_object()
        StoryView.objects.get_or_create(story=story, viewer=request.user)
        return Response({'status': 'viewed'})


class ReportViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request):
        content_type = request.data.get('content_type', '').lower()
        object_id = request.data.get('object_id')
        reason = request.data.get('reason', '')
        description = request.data.get('description', '')

        valid_types = {'post', 'user', 'track', 'comment', 'group'}
        if content_type not in valid_types:
            return Response({'error': f'content_type must be one of {list(valid_types)}'}, status=status.HTTP_400_BAD_REQUEST)
        if not object_id:
            return Response({'error': 'object_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not reason:
            return Response({'error': 'reason is required'}, status=status.HTTP_400_BAD_REQUEST)

        _, created = Report.objects.get_or_create(
            reporter=request.user,
            content_type=content_type,
            object_id=object_id,
            defaults={'reason': reason, 'description': description},
        )
        if not created:
            return Response({'message': 'Already reported'})
        return Response({'message': 'Content reported successfully'}, status=status.HTTP_201_CREATED)


class CreatePaymentIntentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        if not stripe.api_key:
            return Response(
                {'error': 'Payment processing is not configured'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order = Order.objects.get(id=order_id, buyer=request.user)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)

        if order.payment_status == 'PAID':
            return Response({'error': 'This order has already been paid'}, status=status.HTTP_400_BAD_REQUEST)

        # Convert to smallest currency unit (cents for USD/EUR, etc.)
        amount_cents = int(float(order.total_amount) * 100)
        currency = request.data.get('currency', 'usd').lower()

        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'order_id': str(order.id),
                'user_id': str(request.user.id),
            },
        )
        # Persist the intent id so the webhook can map the event back to this order.
        order.transaction_id = intent.id
        order.save(update_fields=['transaction_id'])

        return Response({
            'client_secret': intent.client_secret,
            'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            'amount': float(order.total_amount),
            'currency': currency,
        })


class StripeWebhookView(APIView):
    """Authoritative payment confirmation. Stripe calls this server-to-server;
    it is the ONLY place an order is marked PAID and inventory is committed.
    Signature-verified, idempotent, and atomic under row locks."""
    permission_classes = [AllowAny]

    def post(self, request):
        import stripe
        webhook_secret = settings.STRIPE_WEBHOOK_SECRET
        if not webhook_secret:
            logger.error("Stripe webhook called but STRIPE_WEBHOOK_SECRET is not configured")
            return Response({'error': 'Webhook not configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = stripe.Webhook.construct_event(request.body, sig_header, webhook_secret)
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.warning(f"Invalid Stripe webhook signature: {e}")
            return Response({'error': 'Invalid signature'}, status=status.HTTP_400_BAD_REQUEST)

        event_type = event['type']
        intent = event['data']['object']
        order_id = (intent.get('metadata') or {}).get('order_id')

        if event_type == 'payment_intent.succeeded' and order_id:
            self._fulfill_order(order_id)
        elif event_type == 'payment_intent.payment_failed' and order_id:
            Order.objects.filter(id=order_id, payment_status='PENDING').update(payment_status='FAILED')

        return Response({'received': True})

    @staticmethod
    def _fulfill_order(order_id):
        with transaction.atomic():
            order = Order.objects.select_for_update().filter(id=order_id).first()
            if not order or order.payment_status == 'PAID':
                return  # Unknown order or already fulfilled — idempotent no-op.

            # Commit inventory under a row lock to prevent overselling.
            for item in order.items.select_related('product').all():
                product = item.product
                if product is None:
                    continue
                locked = Product.objects.select_for_update().get(pk=product.pk)
                locked.quantity = max(0, locked.quantity - item.quantity)
                locked.save(update_fields=['quantity'])

            order.payment_status = 'PAID'
            order.status = 'PROCESSING'
            order.save(update_fields=['payment_status', 'status'])


class ExploreViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def trending_posts(self, request):
        week_ago = timezone.now() - timedelta(days=7)
        posts = SocialPost.objects.annotate(
            engagement=Count('likes', distinct=True) + Count('comments', distinct=True)
        ).filter(
            created_at__gte=week_ago
        ).select_related('user').order_by('-engagement')[:30]
        serializer = SocialPostSerializer(posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def suggested_users(self, request):
        following_ids = list(request.user.followed_by.values_list('id', flat=True))
        users = User.objects.exclude(
            id=request.user.id
        ).exclude(
            id__in=following_ids
        ).annotate(
            followers_count=Count('followers', distinct=True)
        ).select_related('profile').order_by('-followers_count')[:12]
        serializer = SimpleUserSerializer(users, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def trending_hashtags(self, request):
        """Return the most-used hashtags in the last 7 days."""
        week_ago = timezone.now() - timedelta(days=7)
        posts_with_tags = SocialPost.objects.filter(
            created_at__gte=week_ago, tags__gt=''
        ).values_list('tags', flat=True)

        counts = {}
        for tag_str in posts_with_tags:
            for tag in tag_str.split():
                tag = tag.strip().lower()
                if tag:
                    counts[tag] = counts.get(tag, 0) + 1

        top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]
        return Response([{'tag': t, 'count': c} for t, c in top])

    @action(detail=False, methods=['get'])
    def search(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'users': [], 'posts': [], 'tracks': [], 'groups': []})
        users = User.objects.filter(
            Q(username__icontains=query) | Q(profile__bio__icontains=query)
        ).select_related('profile').distinct()[:10]
        posts = SocialPost.objects.filter(
            Q(caption__icontains=query) | Q(location__icontains=query)
        ).select_related('user').order_by('-created_at')[:20]
        tracks = Track.objects.filter(
            Q(title__icontains=query) | Q(album__icontains=query)
        ).select_related('artist').order_by('-created_at')[:10]
        groups = Group.objects.filter(
            Q(name__icontains=query) | Q(description__icontains=query)
        ).order_by('-created_at')[:10]
        return Response({
            'users': SimpleUserSerializer(users, many=True, context={'request': request}).data,
            'posts': SocialPostSerializer(posts, many=True, context={'request': request}).data,
            'tracks': TrackSerializer(tracks, many=True, context={'request': request}).data,
            'groups': GroupSerializer(groups, many=True, context={'request': request}).data,
        })


class ConversationViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationSerializer
    pagination_class = StandardPagination
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return Conversation.objects.filter(
            participants=self.request.user
        ).prefetch_related(
            'participants__profile',
            'messages__sender__profile',
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def create(self, request):
        """Get or create a 1-to-1 conversation with another user."""
        other_id = request.data.get('user_id')
        if not other_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            other_user = User.objects.get(id=other_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if other_user == request.user:
            return Response({'error': 'Cannot message yourself'}, status=status.HTTP_400_BAD_REQUEST)

        # Find existing conversation between exactly these two users
        conversation = (
            Conversation.objects
            .filter(participants=request.user)
            .filter(participants=other_user)
            .first()
        )
        if not conversation:
            conversation = Conversation.objects.create()
            conversation.participants.add(request.user, other_user)

        serializer = self.get_serializer(conversation)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        if not conversation.participants.filter(id=request.user.id).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        # Bound the response: return the most recent 100 messages in
        # chronological order (older history can be loaded later if needed).
        recent = conversation.messages.select_related('sender__profile').order_by('-created_at')[:100]
        msgs = sorted(recent, key=lambda m: m.created_at)
        return Response(MessageSerializer(msgs, many=True).data)

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        conversation = self.get_object()
        if not conversation.participants.filter(id=request.user.id).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        content = request.data.get('content', '').strip()
        if not content:
            return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=content,
        )
        # Touch conversation so ordering by updated_at works
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=message.created_at)

        # Push notification to the other participant
        other = conversation.participants.exclude(id=request.user.id).first()
        if other:
            notify_user(
                other,
                'message',
                f"{request.user.username}: {content[:80]}",
                data={'conversationId': conversation.id},
            )

        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        conversation = self.get_object()
        conversation.messages.filter(read=False).exclude(sender=request.user).update(read=True)
        return Response({'status': 'ok'})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Message.objects.filter(
            conversation__participants=request.user,
            read=False,
        ).exclude(sender=request.user).count()
        return Response({'unread_count': count})


class DeviceTokenViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['post'])
    def register(self, request):
        token = request.data.get('token', '').strip()
        platform = request.data.get('platform', 'android')
        if not token:
            return Response({'error': 'Token is required'}, status=status.HTTP_400_BAD_REQUEST)
        DeviceToken.objects.update_or_create(
            user=request.user,
            token=token,
            defaults={'platform': platform, 'is_active': True},
        )
        return Response({'status': 'registered'})

    @action(detail=False, methods=['post'])
    def unregister(self, request):
        token = request.data.get('token', '').strip()
        if token:
            DeviceToken.objects.filter(user=request.user, token=token).update(is_active=False)
        return Response({'status': 'unregistered'})


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)\
            .select_related(
                'sender__profile',
                'post',
                'track',
                'post__user__profile',
                'track__artist__profile'
            )\
            .order_by('-created_at')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=True, methods=['post'])
    def mark_as_read(self, request, pk=None):
        notification = self.get_object()
        if notification.recipient != request.user:
            return Response(
                {'error': 'You can only mark your own notifications as read'},
                status=status.HTTP_403_FORBIDDEN
            )
        notification.read = True
        notification.save()
        return Response({'status': 'notification marked as read'})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Notification.objects.filter(
            recipient=request.user, 
            read=False
        ).count()
        return Response({'unread_count': count})

class ChurchViewSet(viewsets.ModelViewSet):
    queryset = Church.objects.all()
    serializer_class = ChurchSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit churches you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete churches you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_churches(self, request):
        churches = Church.objects.filter(created_by=request.user)
        serializer = self.get_serializer(churches, many=True)
        return Response(serializer.data)





from rest_framework.exceptions import PermissionDenied

class VideoStudioViewSet(viewsets.ModelViewSet):
    queryset = Videostudio.objects.all().order_by('-created_at')
    serializer_class = VideoStudioSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

     
    def create(self, request, *args, **kwargs):
        # Convert single service type to array if needed
        if 'service_types' in request.data and isinstance(request.data['service_types'], str):
            request.data._mutable = True
            request.data['service_types'] = [request.data['service_types']]
        return super().create(request, *args, **kwargs)
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        # Add filtering by user if requested
        user_id = self.request.query_params.get('user_id')
        if user_id:
            return Videostudio.objects.filter(created_by=user_id)
        return super().get_queryset()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit video studios you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete video studios you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_videostudios(self, request):
        studios = Videostudio.objects.filter(created_by=request.user)
        serializer = self.get_serializer(studios, many=True)
        return Response(serializer.data)

class ChoirViewSet(viewsets.ModelViewSet):
    queryset = Choir.objects.all().order_by('-created_at')
    serializer_class = ChoirSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        user_id = self.request.query_params.get('user_id')
        if user_id:
            return Choir.objects.filter(created_by=user_id)
        return super().get_queryset()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only edit choirs you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by != request.user:
            return Response(
                {"error": "You can only delete choirs you created"},
                status=status.HTTP_403_FORBIDDEN
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def my_choirs(self, request):
        choirs = Choir.objects.filter(created_by=request.user)
        serializer = self.get_serializer(choirs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        choir = self.get_object()
        user_id = request.data.get('user_id')
        
        if not user_id:
            return Response(
                {"error": "User ID is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {"error": "User not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        if choir.members.filter(id=user.id).exists():
            return Response(
                {"error": "User is already a member of this choir"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        choir.members.add(user)
        choir.members_count = choir.members.count()
        choir.save()
        
        return Response(
            {"status": "Member added successfully"},
            status=status.HTTP_200_OK
        )
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
            choir = self.get_object()
            if choir.created_by != request.user:
                return Response(
                    {"error": "Only the creator can toggle active status"},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            choir.is_active = not choir.is_active
            choir.save()
            return Response(
                {"status": "Active status updated", "is_active": choir.is_active},
                status=status.HTTP_200_OK
            )    
    @action(detail=True, methods=['post'])
    def update_members(self, request, pk=None):
            choir = self.get_object()
            if choir.created_by != request.user:
                return Response(
                    {"error": "Only the creator can update members count"},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            count = request.data.get('count')
            if count is None or not str(count).isdigit() or int(count) < 0:
                return Response(
                    {"error": "Valid count value is required"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            choir.members_count = int(count)
            choir.save()
            return Response(
                {"status": "Members count updated", "members_count": choir.members_count},
                status=status.HTTP_200_OK
            )
class IsGroupCreator(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.creator == request.user

@method_decorator(cache_control(no_cache=True, no_store=True, must_revalidate=True), name='dispatch')
class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().order_by('-created_at')
    serializer_class = GroupSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    lookup_field = 'slug'
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        # For authenticated users
        if self.request.user.is_authenticated:
            return Group.objects.filter(
                Q(is_private=False) |  # Show all public groups
                Q(creator=self.request.user) |  # Show groups user created
                Q(members__user=self.request.user)  # Show groups user is member of
            ).distinct().order_by('-created_at')
        # For unauthenticated users (if needed)
        return Group.objects.filter(is_private=False).order_by('-created_at')

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            self.permission_classes = [IsAuthenticated, IsGroupCreator]
        return super().get_permissions()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    

    @transaction.atomic
    def perform_create(self, serializer):
        group = serializer.save(creator=self.request.user)
        GroupMember.objects.create(
            group=group, 
            user=self.request.user, 
            is_admin=True
        )
        return group
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response['Pragma'] = 'no-cache'
        response['Expires'] = '0'
        return response

    def perform_destroy(self, instance):
        instance.delete()
        cache.delete('group_list')

    @action(detail=True, methods=['get'], url_path='members')
    def group_members(self, request, slug=None):
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user).exists():
            raise PermissionDenied("You are not a member of this group")
        
        members = GroupMember.objects.filter(group=group).select_related('user', 'user__profile')
        serializer = GroupMemberSerializer(members, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='request-join')
    def request_join(self, request, slug=None):
        group = self.get_object()
        
        if GroupMember.objects.filter(group=group, user=request.user).exists():
            return Response(
                {"error": "You are already a member of this group"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        existing_request = GroupJoinRequest.objects.filter(
            group=group, 
            user=request.user,
            status='pending'
        ).first()
        
        if existing_request:
            return Response(
                {"error": "You already have a pending request to join this group"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Allow empty requests
        message = request.data.get('message', '')
        
        # Create join request directly
        join_request = GroupJoinRequest.objects.create(
            group=group,
            user=request.user,
            message=message,
            status='pending'
        )
        
        # Notify group admins
        admins = GroupMember.objects.filter(group=group, is_admin=True)
        msg = f"{request.user.username} requested to join {group.name}"
        for admin in admins:
            Notification.objects.create(
                recipient=admin.user,
                sender=request.user,
                message=msg,
                notification_type='group_join_request',
            )
            notify_user(admin.user, 'group_join_request', msg)
        
        serializer = GroupJoinRequestSerializer(join_request)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, slug=None):
        group = self.get_object()
        if not GroupMember.objects.filter(group=group, user=request.user, is_admin=True).exists():
            raise PermissionDenied("Only admins can remove members")
        
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        GroupMember.objects.filter(group=group, user_id=user_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    @action(detail=True, methods=['get'], url_path='check-membership')
    def check_membership(self, request, slug=None):
        group = self.get_object()
        is_member = GroupMember.objects.filter(group=group, user=request.user).exists()
        is_admin = GroupMember.objects.filter(
            group=group, 
            user=request.user,
            is_admin=True
        ).exists()
        
        return Response({
            'is_member': is_member,
            'is_admin': is_admin,
            'group_slug': slug  # Include group slug in response for verification
        })
    
    @action(detail=True, methods=['post'], url_path='upload-cover')
    def upload_cover(self, request, slug=None):
        group = self.get_object()
        if group.creator != request.user:
            return Response(
                {"error": "Only the group creator can upload cover images"},
                status=status.HTTP_403_FORBIDDEN
            )
            
        if 'cover_image' not in request.FILES:
            return Response(
                {"error": "No cover image provided"},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        try:
            # Upload to Cloudinary
            result = upload(
                request.FILES['cover_image'],
                folder='group_covers',
                resource_type='image',
                transformation=[
                    {'width': 1200, 'height': 630, 'crop': 'fill'},
                    {'quality': 'auto'}
                ]
            )
            # Save to group
            group.cover_image = result['public_id']
            group.save()
            return Response(
                GroupSerializer(group, context={'request': request}).data,
                status=status.HTTP_200_OK
            )
        except CloudinaryError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

class GroupPostViewSet(viewsets.ModelViewSet):
    queryset = GroupPost.objects.all()
    serializer_class = GroupPostSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    pagination_class = StandardPagination
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)
        return super().get_queryset().filter(group=group).order_by('-created_at')

    def perform_create(self, serializer):
        group_slug = self.kwargs.get('group_slug')
        group = get_object_or_404(Group, slug=group_slug)
        
        if not GroupMember.objects.filter(group=group, user=self.request.user).exists():
            raise PermissionDenied("You are not a member of this group")
        
        post = serializer.save(user=self.request.user, group=group)
        
        # Handle attachments
        for file in self.request.FILES.getlist('attachments'):
            mime_type, _ = mimetypes.guess_type(file.name)
            file_type = 'document'
            if mime_type:
                if mime_type.startswith('image/'):
                    file_type = 'image'
                elif mime_type.startswith('video/'):
                    file_type = 'video'
                elif mime_type.startswith('audio/'):
                    file_type = 'audio'
            
            GroupPostAttachment.objects.create(
                post=post,
                file=file,
                file_type=file_type
            )
        return post  # Make sure to return the post object

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        # This will call perform_create and return the post object
        post = self.perform_create(serializer)  
        
        # Serialize the complete post with attachments
        complete_serializer = self.get_serializer(post)
        headers = self.get_success_headers(complete_serializer.data)
        return Response(complete_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user and not GroupMember.objects.filter(
            group=instance.group, 
            user=request.user,
            is_admin=True
        ).exists():
            return Response(
                {"error": "You don't have permission to delete this post"},
                status=status.HTTP_403_FORBIDDEN
            )
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

class GroupJoinRequestViewSet(viewsets.ModelViewSet):
    queryset = GroupJoinRequest.objects.all()
    serializer_class = GroupJoinRequestSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        return GroupJoinRequest.objects.filter(
            group__members__user=self.request.user,
            group__members__is_admin=True,
            status='pending'
        )

    @action(detail=True, methods=['post'], url_path='approve')
    def approve_request(self, request, pk=None):
        join_request = self.get_object()
        if not GroupMember.objects.filter(
            group=join_request.group, 
            user=request.user,
            is_admin=True
        ).exists():
            raise PermissionDenied("Only group admins can approve requests")
        
        GroupMember.objects.create(
            group=join_request.group,
            user=join_request.user
        )
        join_request.status = 'approved'
        join_request.save()
        
        return Response({"status": "Request approved"}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject_request(self, request, pk=None):
        join_request = self.get_object()
        if not GroupMember.objects.filter(
            group=join_request.group, 
            user=request.user,
            is_admin=True
        ).exists():
            raise PermissionDenied("Only group admins can reject requests")
        
        join_request.status = 'rejected'
        join_request.save()
        
        return Response({"status": "Request rejected"}, status=status.HTTP_200_OK)






# Add to existing views.py
class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.all().order_by('-created_at')
    serializer_class = ProductSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    owner_field = 'seller'
    pagination_class = StandardPagination
    lookup_field = 'slug'

    def get_queryset(self):
        queryset = super().get_queryset()
        seller_id = self.request.query_params.get('seller')
        if seller_id:
            try:
                queryset = queryset.filter(seller__id=seller_id)
            except ValueError:
                logger.warning(f"Invalid seller ID: {seller_id}")
                return queryset.none()
        return queryset

    def list(self, request, *args, **kwargs):
        try:
            logger.debug(f"Listing products with query params: {request.query_params}")
            return super().list(request, *args, **kwargs)
        except Exception as e:
            logger.error(f"Error listing products: {str(e)}", exc_info=True)
            return Response(
                {"error": f"An unexpected error occurred while fetching products: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def create(self, request, *args, **kwargs):
        logger.debug(f"Received product creation request: {request.data}")
        logger.debug(f"FILES: {request.FILES}")
        if not request.user.is_authenticated:
            logger.error("Unauthenticated user attempted to create a product")
            return Response(
                {"error": "Authentication required to create a product"},
                status=status.HTTP_401_UNAUTHORIZED
            )
        try:
            return super().create(request, *args, **kwargs)
        except Exception as e:
            logger.error(f"Error creating product: {str(e)}", exc_info=True)
            return Response(
                {"error": f"An unexpected error occurred while creating the product: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def perform_create(self, serializer):
        # No need to set seller here, as it's handled in the serializer
        serializer.save()

    @action(detail=True, methods=['post'])
    def upload_images(self, request, slug=None):
        logger.debug(f"Received image upload request for slug {slug}: {request.FILES}")
        try:
            product = self.get_object()
            if product.seller != request.user:
                return Response(
                    {"error": "You can only add images to your own products"},
                    status=status.HTTP_403_FORBIDDEN
                )
            images = request.FILES.getlist('images')
            for image in images:
                ProductImage.objects.create(product=product, image=image)
            return Response(
                {"status": "Images uploaded successfully"},
                status=status.HTTP_201_CREATED
            )
        except Exception as e:
            logger.error(f"Error uploading images: {str(e)}", exc_info=True)
            return Response(
                {"error": f"An unexpected error occurred while uploading images: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

class ProductCategoryViewSet(viewsets.ModelViewSet):
    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

class CartViewSet(viewsets.ModelViewSet):
    serializer_class = CartSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Cart.objects.filter(user=self.request.user)
    def destroy(self, request, *args, **kwargs):
        # Handle DELETE requests for cart items
        try:
            item_id = kwargs.get('pk')
            cart_item = CartItem.objects.get(id=item_id, cart__user=request.user)
            cart_item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except CartItem.DoesNotExist:
            return Response(
                {"error": "Item not found in cart"},
                status=status.HTTP_404_NOT_FOUND
            )
    @action(detail=False, methods=['get'])
    def my_cart(self, request):
        cart = get_object_or_404(Cart, user=request.user)
        serializer = self.get_serializer(cart)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def add_item(self, request):
        product_id = request.data.get('product_id')
        quantity = request.data.get('quantity', 1)
        
        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        cart, created = Cart.objects.get_or_create(user=request.user)
        cart_item, created = CartItem.objects.get_or_create(
            cart=cart,
            product=product,
            defaults={'quantity': quantity}
        )
        
        if not created:
            cart_item.quantity += int(quantity)
            cart_item.save()
        
        return Response(
            {"status": "Item added to cart"},
            status=status.HTTP_200_OK
        )
    
    @action(detail=False, methods=['post'])
    def checkout(self, request):
        cart = get_object_or_404(Cart, user=request.user)
        
        if cart.items.count() == 0:
            return Response(
                {"error": "Your cart is empty"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        items = list(cart.items.select_related('product').all())

        # Validate stock up front so we don't create an order we can't fulfil.
        # (Inventory is only committed once payment is confirmed by the webhook.)
        for item in items:
            if item.quantity > item.product.quantity:
                return Response(
                    {"error": f"Not enough stock for '{item.product.title}' "
                              f"(requested {item.quantity}, available {item.product.quantity})"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        with transaction.atomic():
            order = Order.objects.create(
                buyer=request.user,
                status='PENDING',
                total_amount=sum(item.product.price * item.quantity for item in items)
            )

            for item in items:
                OrderItem.objects.create(
                    order=order,
                    product=item.product,
                    quantity=item.quantity,
                    price_at_purchase=item.product.price,
                    seller=item.product.seller
                )

            # Clear the cart. Stock is decremented later, by the Stripe webhook,
            # so an abandoned payment never consumes inventory.
            cart.items.all().delete()

        return Response(
            OrderSerializer(order, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )

class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Order.objects.filter(Q(buyer=self.request.user) | Q(items__seller=self.request.user)).distinct()

    @action(detail=True, methods=['post'], url_path='set-shipping')
    def set_shipping(self, request, pk=None):
        """Buyer saves/updates the shipping address for their order."""
        order = self.get_object()
        if order.buyer != request.user:
            return Response(
                {"error": "Only the buyer can set the shipping address"},
                status=status.HTTP_403_FORBIDDEN
            )
        address = request.data.get('shipping_address', '').strip()
        if not address:
            return Response({"error": "shipping_address is required"}, status=status.HTTP_400_BAD_REQUEST)
        order.shipping_address = address
        order.save(update_fields=['shipping_address'])
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        order = self.get_object()
        new_status = request.data.get('status')

        if new_status not in dict(Order.STATUS_CHOICES).keys():
            return Response(
                {"error": "Invalid status"},
                status=status.HTTP_400_BAD_REQUEST
            )

        is_seller = order.items.filter(seller=request.user).exists()
        is_buyer = order.buyer == request.user

        # Buyers may only cancel a not-yet-shipped order; sellers drive fulfilment.
        if is_buyer and not is_seller:
            if new_status != 'CANCELLED':
                return Response(
                    {"error": "Buyers can only cancel an order"},
                    status=status.HTTP_403_FORBIDDEN
                )
            if order.status not in ('PENDING', 'PROCESSING'):
                return Response(
                    {"error": "This order can no longer be cancelled"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        elif not is_seller:
            return Response(
                {"error": "You don't have permission to update this order"},
                status=status.HTTP_403_FORBIDDEN
            )

        order.status = new_status
        order.save(update_fields=['status'])
        return Response({"status": "Order status updated"}, status=status.HTTP_200_OK)

class ProductReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ProductReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    owner_field = 'reviewer'
    
    def get_queryset(self):
        product_id = self.kwargs.get('product_pk')
        if product_id:
            return ProductReview.objects.filter(product_id=product_id)
        return ProductReview.objects.all()
    
    def perform_create(self, serializer):
        product = get_object_or_404(Product, id=self.kwargs.get('product_pk'))
        serializer.save(reviewer=self.request.user, product=product)

class WishlistViewSet(viewsets.ModelViewSet):
    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)
    
    @action(detail=False, methods=['post'])
    def add_product(self, request):
        product_id = request.data.get('product_id')
        
        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        wishlist, created = Wishlist.objects.get_or_create(user=request.user)
        wishlist.products.add(product)
        
        return Response(
            {"status": "Product added to wishlist"},
            status=status.HTTP_200_OK
        )
    
    @action(detail=False, methods=['post'])
    def remove_product(self, request):
        product_id = request.data.get('product_id')
        
        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        wishlist = get_object_or_404(Wishlist, user=request.user)
        wishlist.products.remove(product)
        
        return Response(
            {"status": "Product removed from wishlist"},
            status=status.HTTP_200_OK
        )



class LiveEventViewSet(viewsets.ModelViewSet):
    queryset = LiveEvent.objects.all().order_by('-start_time')
    serializer_class = LiveEventSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Active events filter - MOST IMPORTANT FIX
        if self.request.query_params.get('is_active', '').lower() == 'true':
            twenty_four_hours_ago = timezone.now() - timedelta(hours=24)
            queryset = queryset.filter(
                Q(is_live=True) |
                Q(end_time__gte=twenty_four_hours_ago) |  # Changed from start_time
                Q(end_time__isnull=True, start_time__gte=twenty_four_hours_ago)
            )
        
        return queryset.select_related('user')
    
    def create(self, request, *args, **kwargs):
        """Enhanced create with comprehensive logging"""
        logger.info(f"Creating live event with data: {request.data}")
        
        try:
            # Validate input
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            
            # Check for existing active events
            active_events = LiveEvent.objects.filter(
                user=request.user,
                is_live=True
            ).count()
            
            logger.info(f"User {request.user.id} has {active_events} active events")
            
            if active_events > 0:
                logger.warning("User already has an active live event")
                return Response(
                    {"error": "You already have an active live event"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Extract YouTube ID
            youtube_url = serializer.validated_data['youtube_url']
            video_id = LiveEvent.extract_youtube_id(youtube_url)
            
            if not video_id:
                logger.error(f"Invalid YouTube URL: {youtube_url}")
                raise serializers.ValidationError({
                    'youtube_url': 'Invalid YouTube URL format'
                })
            
            # Create the event
            logger.info("Creating new live event")
            self.perform_create(serializer)
            instance = serializer.instance
            
            # Ensure we have the saved instance
            if not instance.id:
                logger.warning("Instance not saved, trying to retrieve")
                instance = LiveEvent.objects.filter(
                    youtube_url=youtube_url,
                    user=request.user
                ).order_by('-start_time').first()
            
            if not instance:
                logger.error("Failed to create or retrieve event")
                return Response(
                    {"error": "Failed to create event"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            logger.info(f"Successfully created event ID {instance.id}")
            
            # Return response
            return Response(
                self.get_serializer(instance).data,
                status=status.HTTP_201_CREATED,
                headers=self.get_success_headers(serializer.data)
            )
            
        except Exception as e:
            logger.error(f"Error creating live event: {str(e)}", exc_info=True)
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    def perform_create(self, serializer):
        """Create with automatic thumbnail generation"""
        youtube_url = serializer.validated_data['youtube_url']
        video_id = LiveEvent.extract_youtube_id(youtube_url)
        
        # Generate thumbnail URL
        thumbnail = f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"
        
        serializer.save(
            user=self.request.user,
            thumbnail=thumbnail,
            is_live=True,
            start_time=timezone.now(),
            viewers_count=0
        )
    
    @action(detail=False, methods=['get'])
    def featured(self, request):
        """Simplified featured events endpoint"""
        try:
            # Get active events (live or recently started)
            featured = self.get_queryset().filter(
                Q(is_live=True) |
                Q(start_time__gte=timezone.now() - timedelta(hours=24))
            ).order_by('-viewers_count')[:6]
            
            logger.info(f"Found {featured.count()} featured events")
            
            serializer = self.get_serializer(featured, many=True)
            return Response(serializer.data)
            
        except Exception as e:
            logger.error(f"Error getting featured events: {str(e)}")
            return Response(
                {"error": "Failed to load featured events"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def list(self, request, *args, **kwargs):
        """Enhanced list with debugging"""
        logger.info("Listing live events")
        try:
            response = super().list(request, *args, **kwargs)
            logger.info(f"Returning {len(response.data)} events")
            return response
        except Exception as e:
            logger.error(f"Error listing events: {str(e)}")
            raise