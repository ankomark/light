from .common import *  # noqa: F401,F403
from rest_framework import mixins
from django.db.models import Exists, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from rest_framework.throttling import ScopedRateThrottle
from ..models import Appeal
from ..serializers import AppealSerializer, TrackListSerializer
from .music import annotated_tracks


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


def not_blocked_q(me, field='pk'):
    """Q that drops accounts blocked either way with `me`, as SQL subqueries —
    folded into the main query instead of two extra lookups per request."""
    return ~Q(**{f'{field}__in': Block.objects.filter(blocker=me).values('blocked_id')}) &         ~Q(**{f'{field}__in': Block.objects.filter(blocked=me).values('blocker_id')})


class UserViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # Retrieve + the follow/block/social actions only — NOT a full
    # ModelViewSet. With default update/destroy and no ownership check, any
    # authenticated user could PATCH /users/<victim>/ to change another account's
    # email/password (takeover) or DELETE it. Account mutation goes through the
    # dedicated, self-scoped paths: SignUpView, /profiles/update_me/,
    # ChangePasswordView, DeleteAccountView.
    #
    # Signed-in only, and no list: GET /users/ used to hand anyone — even
    # logged out — every account's email, profile and posts. Search and
    # suggestions (Explore) are the ways to find people.
    queryset = User.objects.all()
    serializer_class = ProfileDetailSerializer
    permission_classes = [IsAuthenticated]

    # Actions that must still reach someone you've blocked (to undo it).
    BLOCK_ACTIONS = ('block', 'unblock')

    def get_queryset(self):
        queryset = super().get_queryset().select_related('profile')
        me = self.request.user
        if self.action not in self.BLOCK_ACTIONS:
            # Someone who blocked you (or whom you blocked) and deactivated
            # accounts simply don't exist here — profile, posts, follower
            # lists and the follow button alike. You always exist to yourself.
            queryset = (queryset.exclude(Q(is_deactivated=True) & ~Q(pk=me.pk))
                        .filter(not_blocked_q(me)))
        if self.action == 'retrieve':
            # Every number and follow flag the profile header draws, in the
            # one row query. `followers` rows are from_user=<account>,
            # to_user=<fan>.
            Follow = User.followers.through
            queryset = queryset.annotate(
                n_followers=Count('followers', distinct=True),
                n_following=Count('followed_by', distinct=True),
                viewer_follows=Exists(Follow.objects.filter(from_user=OuterRef('pk'), to_user=me.pk)),
                follows_viewer=Exists(Follow.objects.filter(from_user=me.pk, to_user=OuterRef('pk'))),
                viewer_requested=Exists(FollowRequest.objects.filter(
                    requester=me.pk, target=OuterRef('pk'), status='pending')),
                # A subquery, not Count('tracks'): a third join would multiply
                # the follower rows the two Counts above already aggregate.
                n_tracks=Coalesce(Subquery(
                    Track.objects.filter(artist=OuterRef('pk'), is_removed=False)
                    .order_by().values('artist').annotate(n=Count('id')).values('n')[:1],
                    output_field=IntegerField()), 0),
            )
        return queryset

    def _require_can_view(self, user):
        """403 unless the viewer may see this account's content (a private
        account shows its posts and follower lists only to approved followers)."""
        if not can_view_profile(self.request.user, user):
            return Response({'detail': 'This account is private.', 'code': 'private'},
                            status=status.HTTP_403_FORBIDDEN)
        return None
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
    def mention_suggest(self, request):
        """Autocomplete for @mentions in a caption: usernames starting with
        ?q=, people you follow first (they're who you usually tag), then
        everyone else by followers. Never blocked accounts either way."""
        from django.db.models import Case, When, Value, IntegerField as IntF
        q = (request.query_params.get('q') or '').strip().lstrip('@')[:150]
        me = request.user
        following = me.followed_by.values('pk')
        qs = (
            User.objects.exclude(pk=me.pk).exclude(is_deactivated=True)
            .select_related('profile')
            .annotate(
                is_followed=Case(When(pk__in=following, then=Value(0)), default=Value(1), output_field=IntF()),
                n_followers=Count('followers', distinct=True),
            )
        )
        if q:
            qs = qs.filter(username__istartswith=q)
        else:
            qs = qs.filter(pk__in=following)  # empty "@" → the people you follow
        blocked = blocked_ids_for(me)
        if blocked:
            qs = qs.exclude(pk__in=blocked)
        rows = qs.order_by('is_followed', '-n_followers', 'username')[:10]
        return Response(SimpleUserSerializer(rows, many=True, context={'request': request}).data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def by_username(self, request):
        """Resolve an @name from a caption to a user id, so tapping a mention
        can open the profile. Case-insensitive, like mention matching."""
        name = (request.query_params.get('u') or '').strip().lstrip('@')
        user = User.objects.filter(username__iexact=name, is_deactivated=False).first() if name else None
        if user is None or user.pk in blocked_ids_for(request.user):
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'id': user.pk, 'username': user.username})

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def blocked(self, request):
        """List the users the current user has blocked."""
        qs = User.objects.filter(blocks_received__blocker=request.user).select_related('profile')
        return Response(SimpleUserSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def social_posts(self, request, pk=None):
        """A profile's post grid, ?page=N (30 per page by default): light tiles,
        newest first. Moderator takedowns and posts the viewer may not see
        (followers-only / "only me") are left out, and a private account shows
        nothing to anyone it hasn't approved.

        This used to ignore paging entirely — the viewset has no paginator —
        and ship every post with the full feed payload: 60 posts were 48 KB
        and 122 queries."""
        user = self.get_object()
        denied = self._require_can_view(user)
        if denied:
            return denied
        posts = (SocialPost.objects.filter(user=user, is_removed=False)
                 .filter(visible_posts_q(request.user)).order_by('-created_at'))
        content_type = request.query_params.get('content_type')
        if content_type in ('image', 'video'):
            posts = posts.filter(content_type=content_type)
        paginator = StandardPagination()
        paginator.page_size = 30
        page = paginator.paginate_queryset(posts, request, view=self)
        data = ProfilePostThumbSerializer(page, many=True, context=self.get_serializer_context()).data
        return paginator.get_paginated_response(data)
    @action(detail=True, methods=['get'])
    def tracks(self, request, pk=None):
        """A profile's Music tab, ?page=N (20 per page): the songs this
        account uploaded, newest first, as the same rows the library shows (so
        they play, like and comment the same way). Held back from viewers a
        private account hasn't approved, like its posts."""
        user = self.get_object()
        denied = self._require_can_view(user)
        if denied:
            return denied
        qs = annotated_tracks(request.user).filter(artist=user).order_by('-created_at')
        paginator = StandardPagination()
        paginator.page_size = 20
        page = paginator.paginate_queryset(qs, request, view=self)
        data = TrackListSerializer(page, many=True, context=self.get_serializer_context()).data
        return paginator.get_paginated_response(data)

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
        """Paginated, lightweight user list with each row's is_following flag.
        Accounts blocked either way and deactivated ones aren't listed."""
        viewer = self.request.user
        queryset = (queryset.select_related('profile').exclude(is_deactivated=True)
                    .filter(not_blocked_q(viewer)).order_by('username'))
        if viewer.is_authenticated:
            # Each row's Follow/Following button used to cost its own EXISTS
            # query — a full page of 20 was 22 queries. Resolved in the page
            # query instead. `obj.followers` holds from_user=obj, to_user=fan.
            from django.db.models import Exists, OuterRef
            Follow = User.followers.through
            queryset = queryset.annotate(viewer_follows=Exists(
                Follow.objects.filter(from_user=OuterRef('pk'), to_user=viewer.pk)
            ))
        # Paginated explicitly: this viewset has no pagination_class (its
        # `list` returns a bare array other code relies on), so
        # paginate_queryset() here used to return None and a popular account
        # shipped its ENTIRE follower list in one response before the first
        # row could paint. The client already sends ?page= and reads
        # results/next.
        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, self.request, view=self)
        serializer = FollowListSerializer(
            page, many=True, context=self.get_serializer_context()
        )
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=['get'])
    def followers(self, request, pk=None):
        """Get the users who follow this user."""
        user = self.get_object()
        return self._require_can_view(user) or self._follow_list_response(user.followers.all())

    @action(detail=True, methods=['get'])
    def following(self, request, pk=None):
        """Get the users this user follows."""
        user = self.get_object()
        return self._require_can_view(user) or self._follow_list_response(user.followed_by.all())



class ProfileViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # Retrieve + self-scoped actions only. As a full ModelViewSet, default
    # destroy had no ownership check (any user could DELETE another's profile) and
    # create was unguarded. Profile changes go through the self-scoped actions
    # below (create_profile / update_me); reads via me / by_user / retrieve.
    #
    # Signed-in only, and no list: GET /profiles/ used to give anyone every
    # member's email and birth date. Someone else's profile is the public
    # view (PublicProfileSerializer); the full one is /profiles/me/ only.
    queryset = Profile.objects.all()
    serializer_class = ProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset().select_related('user')
        if self.action == 'retrieve':
            me = self.request.user
            qs = qs.exclude(Q(user__is_deactivated=True) & ~Q(user=me))
            hidden = blocked_ids_for(me)
            if hidden:
                qs = qs.exclude(user_id__in=hidden)
        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return PublicProfileSerializer
        return ProfileSerializer
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
        """Someone's public profile by user id (no email / birth date).
        Blocked (either way) and deactivated accounts are "not found"."""
        try:
            user = User.objects.select_related('profile').get(id=user_id)
            profile = user.profile
        except (User.DoesNotExist, Profile.DoesNotExist, ValueError):
            return Response({'detail': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)
        if user.pk != request.user.pk and (user.is_deactivated or user.pk in blocked_ids_for(request.user)):
            return Response({'detail': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)
        if user.pk == request.user.pk:
            return Response(ProfileSerializer(profile, context={'request': request}).data)
        return Response(PublicProfileSerializer(profile, context={'request': request}).data)



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


class WeatherPlaceView(APIView):
    """Get, set or clear the signed-in user's weather place.

    The device keeps its own copy for the screen; this is the copy the morning
    briefing reads, because a cron job cannot ask a sleeping phone where it is.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        place = WeatherPlace.objects.filter(user=request.user).first()
        if not place:
            return Response({})
        return Response(WeatherPlaceSerializer(place).data)

    def put(self, request):
        place = WeatherPlace.objects.filter(user=request.user).first()
        serializer = WeatherPlaceSerializer(place, data=request.data, partial=bool(place))
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data)

    def delete(self, request):
        """Forget the place, and with it the briefings."""
        WeatherPlace.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
