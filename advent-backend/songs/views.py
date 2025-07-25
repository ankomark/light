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
from .models import User,SocialPost,PostSave,PostComment, PostLike, LiveEvent, Track, Playlist, Profile, Comment, Like, Category, Notification,Church,Videostudio, Choir, Group, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment,ProductCategory,ProductImage,Product,CartItem,Cart,OrderItem,Order,ProductReview,Wishlist
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
    SocialPostUploadSerializer
)
import logging
import time
from django.utils import timezone
from django.conf import settings
from django.db.models import Count
from datetime import timedelta
logger = logging.getLogger(__name__)



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

class SignUpView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        print("Request data received:", request.data)  # Debug log

        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response({"message": "User registered successfully"}, status=status.HTTP_201_CREATED)
        
        print("Serializer errors:", serializer.errors)  # Debug log
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


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

    # @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    # def follow(self, request, pk=None):
    #     user_to_follow = self.get_object()
    #     current_user = request.user

    #     if current_user == user_to_follow:
    #         return Response(
    #             {"error": "You cannot follow yourself"},
    #             status=status.HTTP_400_BAD_REQUEST
    #         )

    #     if current_user in user_to_follow.followers.all():
    #         user_to_follow.followers.remove(current_user)
    #         action = 'unfollowed'
    #     else:
    #         user_to_follow.followers.add(current_user)
    #         action = 'followed'
    #         Notification.objects.create(
    #             recipient=user_to_follow,
    #             sender=current_user,
    #             message=f"{current_user.username} started following you",
    #             notification_type='follow'
    #         )

    #     return Response({
    #         "status": f"Successfully {action} {user_to_follow.username}",
    #         "followers_count": user_to_follow.followers.count(),
    #         "following_count": current_user.followed_by.count()
    #     })
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
            Notification.objects.create(
                recipient=user_to_follow,
                sender=current_user,
                message=f"{current_user.username} started following you",
                notification_type='follow'
            )

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
class TrackViewSet(viewsets.ModelViewSet):
    queryset = Track.objects.all().order_by('-created_at')
    serializer_class = TrackSerializer
    permission_classes = [IsAuthenticated]


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
        # Create notification
        Notification.objects.create(
            recipient=track.artist,
            sender=user,
            message=f"{user.username} liked your track {track.title}",
            notification_type='like',
            track=track
        )
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

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

        # Pass the request to the serializer context
        serializer = ProfileSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            print("Serializer data is valid:", serializer.validated_data)  # Debug log
            serializer.save()  # Save will now correctly handle user
            print("Profile created successfully")  # Debug log
            return Response(serializer.data, status=status.HTTP_201_CREATED)

        print("Serializer errors:", serializer.errors)  # Debug log
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = PageNumberPagination
    page_size = 20

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
            Notification.objects.create(
                recipient=track.artist,
                sender=self.request.user,
                message=f"{self.request.user.username} commented on your track {track.title}",
                notification_type='comment',
                track=track
            )
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    
    # Add this to ensure request context is available in serializers
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

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
        return SocialPost.objects.annotate(
            # Add annotations for counts to reduce queries
            likes_count=Count('likes', distinct=True),
            comments_count=Count('comments', distinct=True)
        ).select_related('user', 'song').order_by('-created_at')

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
                Notification.objects.create(
                    recipient=post.user,
                    sender=user,
                    message=f"{user.username} liked your post",
                    notification_type='like',
                    post=post
                )
        
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
                Notification.objects.create(
                    recipient=post.user,
                    sender=request.user,
                    message=f"{request.user.username} commented on your post",
                    notification_type='comment',
                    post=post
                )
            
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

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
            Notification.objects.create(
                recipient=post.user,
                sender=self.request.user,
                message=f"{self.request.user.username} commented on your post",
                notification_type='comment',
                post=post
            )


class PostSaveViewSet(viewsets.ModelViewSet):
    queryset = PostSave.objects.all()
    serializer_class = PostSaveSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return self.queryset.filter(user=self.request.user)

class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

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
        for admin in admins:
            Notification.objects.create(
                recipient=admin.user,
                sender=request.user,
                message=f"{request.user.username} requested to join {group.name}",
                notification_type='group_join_request',
                # group=group
            )
        
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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
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
        
        with transaction.atomic():
            order = Order.objects.create(
                buyer=request.user,
                status='PENDING',
                total_amount=sum(item.product.price * item.quantity for item in cart.items.all())
            )
            
            for item in cart.items.all():
                OrderItem.objects.create(
                    order=order,
                    product=item.product,
                    quantity=item.quantity,
                    price_at_purchase=item.product.price,
                    seller=item.product.seller
                )
                
                # Update product quantity
                item.product.quantity -= item.quantity
                item.product.save()
            
            # Clear the cart
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
    
    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        order = self.get_object()
        new_status = request.data.get('status')
        
        if new_status not in dict(Order.STATUS_CHOICES).keys():
            return Response(
                {"error": "Invalid status"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if order.items.filter(seller=request.user).exists() or order.buyer == request.user:
            order.status = new_status
            order.save()
            return Response(
                {"status": "Order status updated"},
                status=status.HTTP_200_OK
            )
        
        return Response(
            {"error": "You don't have permission to update this order"},
            status=status.HTTP_403_FORBIDDEN
        )

class ProductReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ProductReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    
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
        
        # Add debug logging
        logger.info(f"Final queryset SQL: {str(queryset.query)}")
        logger.info(f"Found {queryset.count()} events")
        
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