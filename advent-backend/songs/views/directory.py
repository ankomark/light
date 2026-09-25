from .common import *  # noqa: F401,F403
import base64
from django.http import HttpResponse
from django.utils import timezone
from django.db.models import Avg, Count, Exists, F, OuterRef, Q, TextField
from rest_framework.exceptions import PermissionDenied
from django.http import Http404
from django.db.models.functions import Cast
from ..models import blocked_ids_for, SavedService, ServiceBooking
from .. import services_directory as svc_dir
from ..serializers.directory import ServiceReviewSerializer, ServiceBookingSerializer





class MediaStationViewSet(viewsets.ModelViewSet):
    queryset = MediaStation.objects.all()
    serializer_class = MediaStationSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = MediaStation.objects.filter(is_removed=False)
        station_type = self.request.query_params.get('type')
        if station_type in ('TV', 'Radio', 'Podcast'):
            qs = qs.filter(type=station_type)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by_id != request.user.id:
            return Response(
                {"error": "You can only edit stations you created."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.created_by_id != request.user.id:
            return Response(
                {"error": "You can only delete stations you created."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NoticeViewSet(viewsets.ModelViewSet):
    """Notice board: anyone signed in can read; only staff/admins can post.
    Admin-role gating is interim (User.is_staff) and will be expanded later."""
    # Pinned notices float to the top, then newest-first — this is what makes the
    # admin "Pin to top" toggle actually reorder the board. select_related the
    # author so the list doesn't fire a query per row for created_by.username.
    queryset = (
        Notice.objects.select_related('created_by')
        .order_by('-is_pinned', '-created_at')
    )
    serializer_class = NoticeSerializer
    pagination_class = StandardPagination

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AdminNoteViewSet(viewsets.ModelViewSet):
    """Private notes from users to admins. Any signed-in user may submit one,
    but only staff/admins can list, read, mark-read (partial_update) or delete.
    Admin gating is interim (User.is_staff) and will be expanded later."""
    serializer_class = AdminNoteSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        # Newest note first so the admin inbox reads top-to-bottom by recency.
        return AdminNote.objects.select_related('sender').order_by('-created_at')

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.IsAuthenticated()]
        return [permissions.IsAdminUser()]

    def perform_create(self, serializer):
        # Force is_read=False on create so a sender can't submit a pre-read note;
        # only admins flip it later via update/partial_update.
        serializer.save(sender=self.request.user, is_read=False)


HOME_ROW = 10


def _verification_json(v, service):
    if v is None:
        return {'status': 'approved' if service.is_verified else None}
    return {'id': v.id, 'status': v.status, 'legal_name': v.legal_name, 'decision_note': v.decision_note,
            'created_at': v.created_at, 'decided_at': v.decided_at}

class VideoStudioViewSet(viewsets.ModelViewSet):
    # select_related avoids an N+1 on created_by (+ its profile) during listing.
    queryset = (Videostudio.objects.filter(is_removed=False)
                .select_related('created_by', 'created_by__profile', 'organization').order_by('-created_at'))
    serializer_class = VideoStudioSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        # The list ships image URLs (small); detail/create/update keep base64.
        # Reading one or many: pictures as addresses (never old base64).
        if self.action in ('list', 'retrieve', 'home'):
            return VideoStudioListSerializer
        return VideoStudioSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        qs = super().get_queryset()
        # ?category=hotel narrows the Services directory to one bucket; omitted
        # returns every category.
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        user_id = self.request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(created_by=user_id)
        # An organisation's page: the services it runs.
        org = self.request.query_params.get('organization')
        if org:
            qs = qs.filter(organization__slug=org)
        # Nobody the viewer blocked (or who blocked them), and no one who
        # deactivated their account — their own listings excepted.
        user = self.request.user
        qs = qs.exclude(Q(created_by__is_deactivated=True) & ~Q(created_by_id=getattr(user, 'id', None)))
        if user.is_authenticated:
            blocked = blocked_ids_for(user)
            if blocked:
                qs = qs.exclude(created_by_id__in=blocked)
        if self.action in ('list', 'retrieve', 'home'):
            # The stars, counted in the same query (reviews still up).
            live = Q(reviews__is_removed=False)
            qs = qs.annotate(rating_avg_anno=Avg('reviews__rating', filter=live),
                             rating_count_anno=Count('reviews', filter=live, distinct=True))
            if user.is_authenticated:
                qs = qs.annotate(saved_by_me=Exists(SavedService.objects.filter(service=OuterRef('pk'), user=user)))
        if self.action == 'list':
            qs = self._search(qs)
            qs = self._filter(qs)
            qs = self._sort(qs)
        return qs

    def _filter(self, qs):
        """?saved=1 (yours) · ?verified=1 · ?min_rating=4 · ?min_price= /
        ?max_price= · ?open_at=mon,14:30 (the viewer's own day and time)."""
        p = self.request.query_params
        user = self.request.user
        if p.get('saved') and user.is_authenticated:
            qs = qs.filter(saves__user=user)
        if p.get('verified') in ('1', 'true'):
            qs = qs.filter(is_verified=True)
        try:
            if p.get('min_rating'):
                qs = qs.filter(rating_avg_anno__gte=float(p['min_rating']))
            if p.get('min_price'):
                qs = qs.filter(service_rates__gte=float(p['min_price']))
            if p.get('max_price'):
                qs = qs.filter(service_rates__lte=float(p['max_price']))
        except ValueError:
            pass
        if p.get('open_at'):
            q = svc_dir.open_at_q(p['open_at'])
            if q is not None:
                qs = qs.filter(q)
        return qs

    def _sort(self, qs):
        """?sort=near (with ?near=lat,lng) · rating · new · (default) verified
        first, then newest. ?near= alone adds each card's distance."""
        p = self.request.query_params
        point = svc_dir.parse_point(p.get('near'))
        if point:
            qs = svc_dir.with_distance(qs, point)
        sort = p.get('sort')
        if sort == 'near' and point:
            return qs.order_by(F('dist2').asc(nulls_last=True), '-id')
        if sort == 'rating':
            return qs.order_by(F('rating_avg_anno').desc(nulls_last=True), '-rating_count_anno', '-id')
        if sort == 'new':
            return qs.order_by('-created_at', '-id')
        # Verified first, then newest: a directory people can trust.
        return qs.order_by('-is_verified', '-created_at', '-id')

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['near'] = svc_dir.parse_point(self.request.query_params.get('near'))
        return ctx

    def retrieve(self, request, *args, **kwargs):
        resp = super().retrieve(request, *args, **kwargs)
        # How quickly they usually answer a request (once there are a few).
        resp.data['responds_in_hours'] = svc_dir.responds_in_hours(self.get_object())
        return resp

    # ── Saved (yours to come back to) ──

    @action(detail=True, methods=['post', 'delete'], permission_classes=[permissions.IsAuthenticated])
    def save(self, request, pk=None):
        s = self.get_object()
        if request.method == 'POST':
            SavedService.objects.get_or_create(user=request.user, service=s)
        else:
            SavedService.objects.filter(user=request.user, service=s).delete()
        return Response({'is_saved': request.method == 'POST'})

    # ── How it's found and reached (totals for its owner) ──

    @action(detail=True, methods=['post'], permission_classes=[permissions.AllowAny])
    def events(self, request, pk=None):
        """{kind: view | call | whatsapp | message | directions | share}. An
        owner looking at their own listing isn't counted."""
        s = self.get_object()
        if request.user.is_authenticated and s.created_by_id == request.user.id:
            return Response({'counted': False})
        who = request.user.id if request.user.is_authenticated else (
            request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR', ''))
        return Response({'counted': svc_dir.record(s, str(request.data.get('kind') or ''), who)})

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def insights(self, request, pk=None):
        s = self.get_object()
        if s.created_by_id != request.user.id:
            raise PermissionDenied('Only the listing’s owner sees its numbers.')
        try:
            days = int(request.query_params.get('days', 30))
        except ValueError:
            days = 30
        return Response(svc_dir.insights(s, days))

    # ── Bookings and quotes ──

    @action(detail=True, methods=['post'], url_path='bookings', permission_classes=[permissions.IsAuthenticated])
    def request_booking(self, request, pk=None):
        """Ask the provider: {kind: booking | quote, date?, time?, note}."""
        s = self.get_object()
        if s.created_by_id == request.user.id:
            return Response({'error': 'This is your own listing.'}, status=status.HTTP_400_BAD_REQUEST)
        if getattr(request.user, 'is_suspended', False):
            return Response({'error': 'Your account is suspended.'}, status=status.HTTP_403_FORBIDDEN)
        ser = ServiceBookingSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        b = ser.save(service=s, customer=request.user)
        from ..push import notify_user
        what = 'a quote' if b.kind == ServiceBooking.QUOTE else 'a booking'
        notify_user(s.created_by, 'service_booking', f'{request.user.username} asked {s.name} for {what}',
                    data={'type': 'service_booking', 'service_id': s.id, 'booking_id': b.id, 'role': 'incoming'})
        return Response(ServiceBookingSerializer(b, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='bookings', permission_classes=[permissions.IsAuthenticated])
    def bookings(self, request):
        """?role=mine (what you asked for) · incoming (asked of your services)."""
        qs = ServiceBooking.objects.select_related('service', 'customer', 'customer__profile')
        if request.query_params.get('role') == 'incoming':
            qs = qs.filter(service__created_by=request.user)
        else:
            qs = qs.filter(customer=request.user)
        status_ = request.query_params.get('status')
        if status_ in dict(ServiceBooking.STATUSES):
            qs = qs.filter(status=status_)
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(ServiceBookingSerializer(page, many=True, context=self.get_serializer_context()).data)

    def _booking(self, bid):
        b = ServiceBooking.objects.select_related('service', 'customer').filter(pk=bid).first()
        if b is None:
            raise Http404('No such request.')
        return b

    @action(detail=False, methods=['post'], url_path=r'bookings/(?P<bid>\d+)/respond',
            permission_classes=[permissions.IsAuthenticated])
    def respond_booking(self, request, bid=None):
        """The provider: {accept: bool, note?}."""
        b = self._booking(bid)
        if b.service.created_by_id != request.user.id:
            raise PermissionDenied('Only the provider answers.')
        if b.status != ServiceBooking.PENDING:
            return Response({'error': 'Already answered.', 'code': b.status}, status=status.HTTP_400_BAD_REQUEST)
        accept = str(request.data.get('accept', '')).lower() in ('1', 'true')
        b.status = ServiceBooking.ACCEPTED if accept else ServiceBooking.DECLINED
        b.reply_note = str(request.data.get('note') or '').strip()[:500]
        b.responded_at = timezone.now()
        b.save(update_fields=['status', 'reply_note', 'responded_at', 'updated_at'])
        from ..push import notify_user
        notify_user(b.customer, 'service_booking',
                    f'{b.service.name} {"accepted" if accept else "declined"} your request',
                    data={'type': 'service_booking', 'service_id': b.service_id, 'booking_id': b.id, 'role': 'mine'})
        return Response(ServiceBookingSerializer(b, context=self.get_serializer_context()).data)

    @action(detail=False, methods=['post'], url_path=r'bookings/(?P<bid>\d+)/cancel',
            permission_classes=[permissions.IsAuthenticated])
    def cancel_booking(self, request, bid=None):
        """The one who asked, while it waits or once accepted."""
        b = self._booking(bid)
        if b.customer_id != request.user.id:
            raise PermissionDenied('Only the one who asked cancels.')
        if b.status not in (ServiceBooking.PENDING, ServiceBooking.ACCEPTED):
            return Response({'error': 'Nothing to cancel.'}, status=status.HTTP_400_BAD_REQUEST)
        was = b.status
        b.status = ServiceBooking.CANCELLED
        b.save(update_fields=['status', 'updated_at'])
        if was == ServiceBooking.ACCEPTED:
            from ..push import notify_user
            notify_user(b.service.created_by, 'service_booking', f'{request.user.username} cancelled their booking',
                        data={'type': 'service_booking', 'service_id': b.service_id, 'booking_id': b.id, 'role': 'incoming'})
        return Response(ServiceBookingSerializer(b, context=self.get_serializer_context()).data)

    def get_throttles(self):
        if self.action == 'request_booking':
            self.throttle_scope = 'service_booking'
        elif self.action == 'events':
            self.throttle_scope = 'service_event'
        return super().get_throttles()

    @action(detail=False, methods=['get'], permission_classes=[permissions.AllowAny])
    def home(self, request):
        """The Services home: how many in each category, and rows of the
        featured (picked by staff), the verified and the newest."""
        qs = self.get_queryset()
        ctx = self.get_serializer_context()

        def row(q):
            return VideoStudioListSerializer(q[:HOME_ROW], many=True, context=ctx).data
        counts = dict(qs.order_by().values('category').annotate(n=Count('pk', distinct=True)).values_list('category', 'n'))
        return Response({
            'counts': counts,
            'featured': row(qs.filter(featured_at__isnull=False).order_by('-featured_at')),
            'verified': row(qs.filter(is_verified=True).order_by('-updated_at')),
            'new': row(qs.order_by('-created_at', '-id')),
        })

    def _search(self, qs):
        """?search= over the name, place, description and service tags — on
        the server, so every listing can be found, not just a first page.
        ?tags=a,b: listings offering any of these (the app sends the tags
        whose names match what was typed, in the reader's language)."""
        q = (self.request.query_params.get('search') or '').strip()[:100]
        tags = [x for x in (self.request.query_params.get('tags') or '').split(',') if x][:20]
        if not q and not tags:
            return qs
        qs = qs.annotate(tags_text=Cast('service_types', TextField()))
        match = Q()
        if q:
            match |= (Q(name__icontains=q) | Q(location__icontains=q) | Q(description__icontains=q)
                      | Q(tags_text__icontains=q))
        for tag in tags:
            match |= Q(tags_text__icontains=f'"{tag}"')
        return qs.filter(match)

    # ── Reviews (one per person, never the owner's), and the owner's reply ──

    @action(detail=True, methods=['get', 'post', 'delete'])
    def reviews(self, request, pk=None):
        """GET: the summary (average, count, how the stars fall), yours, and
        others' (paged). POST {rating, body}: write or change yours. DELETE:
        take yours down."""
        s = self.get_object()
        user = request.user
        mine = s.reviews.filter(user=user).first() if user.is_authenticated else None
        if request.method in ('POST', 'DELETE') and not user.is_authenticated:
            return Response({'error': 'Sign in to review.'}, status=status.HTTP_401_UNAUTHORIZED)
        if request.method == 'DELETE':
            if mine:
                mine.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if request.method == 'POST':
            if s.created_by_id == user.id:
                return Response({'error': 'You can’t review your own listing.', 'code': 'own'},
                                status=status.HTTP_403_FORBIDDEN)
            if getattr(user, 'is_suspended', False):
                return Response({'error': 'Your account is suspended.'}, status=status.HTTP_403_FORBIDDEN)
            ser = ServiceReviewSerializer(mine, data=request.data, context={'request': request}, partial=bool(mine))
            ser.is_valid(raise_exception=True)
            review = ser.save(service=s, user=user)
            if mine is None:
                from ..push import notify_user
                notify_user(s.created_by, 'service_review', f'{user.username} rated {s.name} {review.rating}★',
                            data={'type': 'service', 'service_id': s.id})
            return Response(ServiceReviewSerializer(review, context={'request': request}).data,
                            status=status.HTTP_201_CREATED if mine is None else status.HTTP_200_OK)

        qs = s.reviews.filter(is_removed=False).select_related('user', 'user__profile')
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(user_id__in=blocked)
        spread = dict(qs.order_by().values('rating').annotate(n=Count('pk')).values_list('rating', 'n'))
        total = sum(spread.values())
        others = qs.exclude(user=user) if user.is_authenticated else qs
        page = self.paginate_queryset(others)
        resp = self.get_paginated_response(ServiceReviewSerializer(page, many=True, context={'request': request}).data)
        resp.data.update({
            'summary': {
                'count': total,
                'average': round(sum(r * n for r, n in spread.items()) / total, 1) if total else None,
                'spread': {str(r): spread.get(r, 0) for r in range(1, 6)},
            },
            'mine': ServiceReviewSerializer(mine, context={'request': request}).data if mine else None,
            'can_review': bool(user.is_authenticated and s.created_by_id != user.id),
            'is_owner': bool(user.is_authenticated and s.created_by_id == user.id),
        })
        return resp

    @action(detail=True, methods=['post', 'delete'], url_path=r'reviews/(?P<rid>\d+)/reply',
            permission_classes=[permissions.IsAuthenticated])
    def review_reply(self, request, pk=None, rid=None):
        """The owner answers a review in public: POST {reply}; DELETE to take it back."""
        s = self.get_object()
        if s.created_by_id != request.user.id:
            raise PermissionDenied('Only the listing’s owner replies.')
        review = s.reviews.filter(pk=rid, is_removed=False).first()
        if review is None:
            raise Http404('No such review.')
        if request.method == 'DELETE':
            review.reply, review.replied_at = '', None
        else:
            reply = str(request.data.get('reply') or '').strip()
            if not reply or len(reply) > 2000:
                return Response({'error': 'A reply is 1 to 2000 characters.'}, status=status.HTTP_400_BAD_REQUEST)
            first = not review.reply
            review.reply, review.replied_at = reply, timezone.now()
            if first:
                from ..push import notify_user
                notify_user(review.user, 'service_review', f'{s.name} replied to your review',
                            data={'type': 'service', 'service_id': s.id})
        review.save(update_fields=['reply', 'replied_at'])
        return Response(ServiceReviewSerializer(review, context={'request': request}).data)

    # ── The verified tick: asked for by the owner, decided by staff ──

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated])
    def verification(self, request, pk=None):
        """The owner's request for the tick. GET: the latest ({status, …} or
        {status: null}). POST {legal_name, registration_number?, note?,
        documents: [R2 URLs, up to 4]}: ask (one waiting at a time)."""
        from ..models import ServiceVerification as V
        from .. import r2
        s = self.get_object()
        if s.created_by_id != request.user.id:
            raise PermissionDenied('Only the listing’s owner asks for the tick.')
        latest = s.verifications.first()
        if request.method == 'GET':
            return Response(_verification_json(latest, s))
        if s.is_verified:
            return Response({'error': 'Already verified.', 'code': 'verified'}, status=status.HTTP_400_BAD_REQUEST)
        if latest and latest.status == V.PENDING:
            return Response({'error': 'Your request is being looked at.', 'code': 'pending'},
                            status=status.HTTP_400_BAD_REQUEST)
        legal = str(request.data.get('legal_name') or '').strip()[:200]
        docs = request.data.get('documents') or []
        if len(legal) < 2:
            return Response({'error': 'Give the registered name.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(docs, list) or not docs or len(docs) > 4 or not all(r2.is_r2_url(str(d)) for d in docs):
            return Response({'error': 'Add 1 to 4 photos of your papers.', 'code': 'documents'},
                            status=status.HTTP_400_BAD_REQUEST)
        v = V.objects.create(service=s, requested_by=request.user, legal_name=legal, documents=[str(d) for d in docs],
                             registration_number=str(request.data.get('registration_number') or '').strip()[:100],
                             note=str(request.data.get('note') or '').strip()[:2000])
        return Response(_verification_json(v, s), status=status.HTTP_201_CREATED)

    # ── Image serving: stream the stored base64 as a real, cacheable image ────
    def _serve_data_uri(self, data_uri):
        if not data_uri or ',' not in data_uri:
            raise Http404('No image.')
        header, _, payload = data_uri.partition(',')
        mime = header[5:].split(';')[0] if header.startswith('data:') else ''
        try:
            raw = base64.b64decode(payload)
        except Exception:
            raise Http404('Bad image data.')
        resp = HttpResponse(raw, content_type=mime or 'image/jpeg')
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'  # URLs are version-busted
        return resp

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def logo(self, request, pk=None):
        return self._serve_data_uri(self.get_object().logo)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def cover(self, request, pk=None):
        return self._serve_data_uri(self.get_object().cover_image)

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



class WallpaperViewSet(viewsets.ModelViewSet):
    """App-wide backgrounds. Everyone reads the active set (that is what every
    RotatingBackground renders); only admins holding `manage_wallpapers` may
    upload, reorder, deactivate or delete.

    Read is open — these are decorative images with no user data, and keeping it
    unauthenticated means a cold start never races the token refresh and drops
    back to the bundled fallbacks."""
    serializer_class = WallpaperSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
        return [Cap('manage_wallpapers')()]

    def _may_manage(self):
        user = self.request.user
        return bool(
            user and user.is_authenticated
            and getattr(user, 'has_capability', None)
            and user.has_capability('manage_wallpapers')
        )

    def get_queryset(self):
        queryset = Wallpaper.objects.select_related('uploaded_by')
        # ?scope=music narrows to one surface; omitted means every scope, which
        # is what the client wants (it groups them itself in one round trip).
        scope = self.request.query_params.get('scope')
        if scope:
            queryset = queryset.filter(scope=scope)

        # ONLY the public list is limited to the active set. Detail actions must
        # see everything, or a deactivated wallpaper would fall out of the
        # queryset and an admin could never switch it back on (it 404s).
        if self.action != 'list':
            return queryset

        # ?all=1 exposes hidden rows for the admin library — capability-gated, so
        # a passer-by can't enumerate wallpapers the admin took out of rotation.
        if self.request.query_params.get('all') and self._may_manage():
            return queryset
        return queryset.filter(is_active=True)

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    def perform_destroy(self, instance):
        # Best-effort: drop the R2 object too, so deleting a wallpaper doesn't
        # leave the bytes paying storage forever. r2.delete never raises.
        r2.delete(instance.image)
        instance.delete()

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Persist a new rotation order in one round trip: [{id, sort_order}]."""
        items = request.data.get('items')
        if not isinstance(items, list):
            return Response({'error': 'items must be a list of {id, sort_order}'},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for entry in items:
                if not isinstance(entry, dict) or 'id' not in entry:
                    continue
                try:
                    order = int(entry.get('sort_order', 0))
                except (TypeError, ValueError):
                    continue
                Wallpaper.objects.filter(pk=entry['id']).update(sort_order=order)
        return Response({'status': 'reordered'})

def service_share_page(request, service_id):
    """A service's public page for a shared link: a rich card (its cover, name,
    what and where) and a hand-off into the app at that service."""
    from django.conf import settings as dj_settings
    from django.http import HttpResponseNotFound
    from django.utils.html import escape
    from .social import _SHARE_PAGE
    s = (Videostudio.objects.filter(pk=service_id, is_removed=False, created_by__is_deactivated=False)
         .select_related('created_by').first())
    if s is None:
        return HttpResponseNotFound('Service not found')
    label = dict(Videostudio.SERVICE_CATEGORIES).get(s.category, '')
    about = (s.description or '').strip()
    desc = ' · '.join(x for x in (label, s.location) if x) + (f' — {about}' if about else '')
    image = media.resolve(s.cover_image) or media.resolve(s.logo) or (
        getattr(dj_settings, 'SHARE_FALLBACK_IMAGE', '') or request.build_absolute_uri('/share-og.png'))
    deep = f'streams://service/{s.id}'
    html = (
        _SHARE_PAGE
        .replace('__OGTYPE__', 'business.business')
        .replace('__VIDEO_TAGS__', '')
        .replace('__IMG_BLOCK__', f'<img src="{escape(image)}" alt="">')
        .replace('__PLAY_BLOCK__', '')
        .replace('__CAPTION_BLOCK__', f'\n      <p class="caption">{escape(desc[:300])}</p>')
        .replace('__STORE_BLOCK__', '')
        .replace('__USER__', escape(s.name))
        .replace('__TITLE__', escape(f'{s.name} on Adventist Life'))
        .replace('__DESC__', escape(desc[:200]))
        .replace('__IMAGE__', escape(image))
        .replace('__URL__', escape(request.build_absolute_uri()))
        .replace('__DEEP__', escape(deep))
    )
    resp = HttpResponse(html)
    resp['Cache-Control'] = 'public, max-age=300'
    return resp
