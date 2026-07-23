from .common import *  # noqa: F401,F403
from rest_framework import mixins
from rest_framework.throttling import ScopedRateThrottle
from ..models import Appeal
from ..serializers import AppealSerializer


class NotificationPreferenceView(APIView):
    """Get or update the signed-in user's per-category push preferences.
    The row is created on first access so the client always has something to
    bind to (absence == all-enabled)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response(NotificationPreferenceSerializer(pref).data)

    def patch(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(pref, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class AppealViewSet(viewsets.GenericViewSet):
    """A suspended user submits / views their own appeal."""
    permission_classes = [IsAuthenticated]
    serializer_class = AppealSerializer

    def get_throttles(self):
        # Throttle only submissions (not the cheap `mine` GET).
        if self.action == 'create':
            self.throttle_scope = 'appeals'
        return super().get_throttles()

    def create(self, request):
        user = request.user
        if not getattr(user, 'is_currently_suspended', False):
            return Response({'error': 'There is nothing to appeal — your account is not suspended.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if Appeal.objects.filter(user=user, status='pending').exists():
            return Response({'error': 'You already have an appeal under review.'},
                            status=status.HTTP_400_BAD_REQUEST)
        message = (request.data.get('message') or '').strip()
        if len(message) < 10:
            return Response({'error': 'Please describe your appeal (at least 10 characters).'},
                            status=status.HTTP_400_BAD_REQUEST)
        appeal = Appeal.objects.create(user=user, message=message[:4000])
        return Response(self.get_serializer(appeal).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def mine(self, request):
        """Most recent appeal for the current user (or null)."""
        appeal = Appeal.objects.filter(user=request.user).order_by('-created_at').first()
        return Response(self.get_serializer(appeal).data if appeal else None)


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # List/retrieve + the follow/block/social actions only — NOT a full
    # ModelViewSet. With default update/destroy and no ownership check, any
    # authenticated user could PATCH /users/<victim>/ to change another account's
    # email/password (takeover) or DELETE it. Account mutation goes through the
    # dedicated, self-scoped paths: SignUpView, /profiles/update_me/,
    # ChangePasswordView, DeleteAccountView.
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
        # (The old picture_width/crop/gravity context was Cloudinary-era and was
        # already dead — a second definition shadowed it — so it's dropped. R2
        # serves stored URLs as-is.)
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

        already_following = user_to_follow.followers.filter(pk=current_user.pk).exists()

        if already_following:
            user_to_follow.followers.remove(current_user)
            action = 'unfollowed'
        else:
            profile = getattr(user_to_follow, 'profile', None)
            is_private = profile is not None and not profile.is_public

            if is_private:
                # Private account: don't follow — raise a request the owner
                # approves. Toggling again withdraws a pending request, so the
                # button stays a two-state toggle for the client.
                existing = FollowRequest.objects.filter(
                    requester=current_user, target=user_to_follow
                ).first()
                if existing and existing.status == 'pending':
                    existing.delete()
                    return Response({
                        "status": "Follow request withdrawn",
                        "follow_status": "none",
                        "is_following": False,
                        "followers_count": user_to_follow.followers.count(),
                        "following_count": user_to_follow.followed_by.count(),
                    })

                FollowRequest.objects.update_or_create(
                    requester=current_user, target=user_to_follow,
                    defaults={'status': 'pending'},
                )
                msg = f"{current_user.username} requested to follow you"
                Notification.objects.create(
                    recipient=user_to_follow,
                    sender=current_user,
                    message=msg,
                    notification_type='follow',
                )
                notify_user(user_to_follow, 'follow', msg)
                return Response({
                    "status": "Follow request sent",
                    "follow_status": "requested",
                    "is_following": False,
                    "followers_count": user_to_follow.followers.count(),
                    "following_count": user_to_follow.followed_by.count(),
                })

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
        is_following = user_to_follow.followers.filter(pk=current_user.pk).exists()
        return Response({
            "status": f"Successfully {action} {user_to_follow.username}",
            "is_following": is_following,
            "follow_status": 'following' if is_following else 'none',
            "followers_count": user_to_follow.followers.count(),
            "following_count": user_to_follow.followed_by.count()
        })
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def block(self, request, pk=None):
        """Block a user: hides each other's content and disables DMs between
        them. Blocking also severs any follow relationship in both directions."""
        target = self.get_object()
        if target == request.user:
            return Response({'error': "You can't block yourself"}, status=status.HTTP_400_BAD_REQUEST)

        Block.objects.get_or_create(blocker=request.user, blocked=target)
        # A block implies an unfollow both ways.
        target.followers.remove(request.user)
        request.user.followers.remove(target)
        return Response({'status': 'blocked', 'is_blocked': True})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def unblock(self, request, pk=None):
        target = self.get_object()
        Block.objects.filter(blocker=request.user, blocked=target).delete()
        return Response({'status': 'unblocked', 'is_blocked': False})

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def blocked(self, request):
        """List the users the current user has blocked."""
        qs = User.objects.filter(blocks_received__blocker=request.user).select_related('profile')
        return Response(SimpleUserSerializer(qs, many=True, context={'request': request}).data)

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
    def _follow_list_response(self, queryset):
        """Paginated, lightweight user list with each row's is_following flag."""
        queryset = queryset.select_related('profile').order_by('username')
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = FollowListSerializer(
                page, many=True, context=self.get_serializer_context()
            )
            return self.get_paginated_response(serializer.data)
        serializer = FollowListSerializer(
            queryset, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def followers(self, request, pk=None):
        """Get the users who follow this user."""
        user = self.get_object()
        return self._follow_list_response(user.followers.all())

    @action(detail=True, methods=['get'])
    def following(self, request, pk=None):
        """Get the users this user follows."""
        user = self.get_object()
        return self._follow_list_response(user.followed_by.all())



class ProfileViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # List/retrieve + self-scoped actions only. As a full ModelViewSet, default
    # destroy had no ownership check (any user could DELETE another's profile) and
    # create was unguarded. Profile changes go through the self-scoped actions
    # below (create_profile / update_me); reads via me / by_user / retrieve.
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
            # Straight to R2; the stored reference is the public URL. Sizing/
            # cropping is the client's job (it compresses before upload).
            request.user.profile.picture = r2.upload_file(
                serializer.validated_data['avatar'], 'profile_images')
            request.user.profile.save()

            return Response(
                self.get_serializer(request.user.profile).data,
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Profile picture upload to R2 failed: {e}", exc_info=True)
            return Response(
                {'error': 'Failed to upload image'},
                status=status.HTTP_400_BAD_REQUEST
            )



class FollowRequestViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Pending follow requests addressed to the current user, plus approve /
    reject. Only the target can act on a request — the requester's only control
    is withdrawing it, which they do by toggling follow again."""
    serializer_class = FollowRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            FollowRequest.objects
            .filter(target=self.request.user, status='pending')
            .select_related('requester', 'requester__profile')
        )

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        follow_request = self.get_object()
        with transaction.atomic():
            # The follow itself is the source of truth; the request row is just
            # the pending state, so drop it once it has been acted on.
            request.user.followers.add(follow_request.requester)
            requester = follow_request.requester
            follow_request.delete()

        msg = f"{request.user.username} accepted your follow request"
        Notification.objects.create(
            recipient=requester,
            sender=request.user,
            message=msg,
            notification_type='follow',
        )
        notify_user(requester, 'follow', msg)
        return Response({'status': 'approved', 'requester_id': requester.id})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        follow_request = self.get_object()
        requester_id = follow_request.requester_id
        # Deleted rather than kept as 'rejected' so the requester can ask again
        # later without hitting the unique_together constraint. Silent by
        # design — the requester isn't told they were turned down.
        follow_request.delete()
        return Response({'status': 'rejected', 'requester_id': requester_id})
