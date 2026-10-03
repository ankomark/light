"""Single & Searching, phases 6-11: the relationship hub around Discover.

    GET  /api/singles/hub/                         the home: greeting, today, a preview, community, events
    GET  /api/singles/browse/?mode=foryou|new|nearby|online&page=  the grid, with "why you're seeing"
    GET  /api/singles/likes/                       people interested in you, not yet answered
    PUT  /api/singles/me/answers/                  {answers: [{key, answer, visible}]} — values questions
    GET/POST /api/singles/matches/<id>/icebreakers/          {key}: ask one
    POST /api/singles/icebreakers/<id>/answer/               {answer}: both answer before either sees
    GET/POST /api/singles/topics/                  the singles community's questions
    GET  /api/singles/topics/<id>/                 one, with its replies
    POST /api/singles/topics/<id>/replies/         {body}
    POST /api/singles/topics/<id>/heart/           toggles
    GET/POST /api/singles/gatherings/              upcoming meet-ups; suggest one (an admin lists it)
    POST /api/singles/gatherings/<id>/rsvp/        toggles "I'm interested"
    GET  /api/singles/rooms/                       live singles-only audio rooms
    GET  /api/singles/stories/                     couples who chose to share
    POST /api/singles/matches/<id>/story/          {title, body}: tell yours (both must agree)
    POST /api/singles/stories/<id>/consent/        agree (or, DELETE, take it down)
    GET/POST /api/singles/me/verify/               the gesture to make; send the selfie
    GET  /api/bible/lookup/?ref=Philippians 4:13   a verse, for Scripture cards

    Admins (review_singles): /api/admin/singles-gatherings/, /api/admin/singles-stories/,
    /api/admin/singles-verifications/ (list, then POST <id>/decide/ {decision, reason}),
    /api/admin/singles-stats/.
"""
import logging
import random

from django.db import transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import r2
from .. import singles as rules
from ..models import (
    LiveBroadcast, SinglesAnswer, SinglesGathering, SinglesHeart, SinglesIcebreaker, SinglesInterest, SinglesMatch,
    SinglesProfile, SinglesReply, SinglesRsvp, SinglesSignal, SinglesStory, SinglesTopic, SinglesVerification,
    blocked_ids_for,
)
from .admin import log_admin_action, reason_of
from .common import Cap
from .singles import (
    MAX_PHOTO_BYTES, _browsing, _match_json, _mine, _public_json, _require_on, _seen,
)

logger = logging.getLogger(__name__)


def _approved(user):
    """An approved singles profile (paused is fine: the community and your
    matches stay open while you are hidden from Discover)."""
    profile = _mine(user)
    if profile.status != profile.APPROVED:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied({'code': 'not_approved', 'detail': 'Your profile is not approved yet.'})
    return profile


def _card(profile, viewer, reasons=None):
    """The small form for grids: first photo, name, age, place, intent,
    badges, online, and why."""
    full = _public_json(profile, viewer, reasons=reasons)
    return {k: full[k] for k in ('id', 'first_name', 'age', 'country', 'town', 'looking_for', 'online', 'badges',
                                 'reasons')} | {'photo': (full['photos'] or [{}])[0].get('url')}


# ── Phase 6: the hub ────────────────────────────────────────────────────────
class SinglesHubView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        me = _approved(request.user)
        _seen(me)
        mode = request.query_params.get('mode', 'foryou')
        if mode not in rules.MODES:
            mode = 'foryou'
        preview = []
        if not me.is_paused:
            rows, _more = rules.browse(me, mode)
            preview = [_card(p, me, rules.reasons_for(me, p) if mode == 'foryou' else None) for p in rows[:6]]
        today = rules.apply_preferences(rules.candidates(me), me).count() if not me.is_paused else 0
        topic = SinglesTopic.objects.filter(is_removed=False).exclude(author__user_id__in=blocked_ids_for(request.user)).first()
        upcoming = (SinglesGathering.objects.filter(status=SinglesGathering.APPROVED, starts_at__gte=timezone.now())
                    .annotate(n=Count('rsvps')).first())
        return Response({
            'first_name': me.first_name,
            'paused': me.is_paused,
            'today': min(today, rules.DAILY_NEW),
            'left_today': max(0, rules.DAILY_NEW - rules.answered_today(me)),
            'mode': mode,
            'preview': preview,
            'likes': _likes_qs(me).count(),
            'matches': SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), ended_at__isnull=True).count(),
            'topic': _topic_json(topic, me) if topic else None,
            'gathering': _gathering_json(upcoming, me) if upcoming else None,
            'live_rooms': LiveBroadcast.objects.filter(singles_only=True, status='live').count(),
            'stories': SinglesStory.objects.filter(status=SinglesStory.PUBLISHED).count(),
        })


class SinglesBrowseView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .singles import _filters
        _require_on()
        me = _browsing(request.user)
        _seen(me)
        mode = request.query_params.get('mode', 'foryou')
        if mode not in rules.MODES:
            return Response({'mode': f'one of {list(rules.MODES)}'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        rows, more = rules.browse(me, mode, _filters(request.query_params), page)
        return Response({
            'mode': mode, 'page': page, 'more': more,
            'results': [_card(p, me, rules.reasons_for(me, p)) for p in rows],
            'left_today': max(0, rules.DAILY_NEW - rules.answered_today(me)),
        })


def _likes_qs(me):
    """Visible people interested in me whom I haven't answered."""
    answered = SinglesInterest.objects.filter(from_profile=me).values('to_profile_id')
    blocked = blocked_ids_for(me.user)
    qs = (rules.visible_profiles().filter(interests_given__to_profile=me,
                                          interests_given__kind=SinglesInterest.INTERESTED,
                                          gender=rules.opposite(me.gender))
          .exclude(pk__in=answered))
    if blocked:
        qs = qs.exclude(user_id__in=blocked)
    return qs.distinct()


class SinglesLikesView(APIView):
    """People who are interested in you. Answer Interested to match, or Not
    now — they are never told of a "not now"."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        me = _approved(request.user)
        rows = list(_likes_qs(me).select_related('user').prefetch_related('photos', 'answers')
                    .order_by('-interests_given__created_at')[:60])
        return Response({'results': [_card(p, me) for p in rows]})


# ── Phase 7: values questions ───────────────────────────────────────────────
class SinglesAnswersView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        _require_on()
        me = _mine(request.user)
        items = request.data.get('answers')
        if not isinstance(items, list):
            return Response({'answers': 'A list of {key, answer, visible}.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for item in items:
                key, answer = (item or {}).get('key'), (item or {}).get('answer')
                if key not in rules.VALUES:
                    return Response({'answers': f'key: one of {list(rules.VALUES)}'}, status=status.HTTP_400_BAD_REQUEST)
                if answer in (None, ''):
                    SinglesAnswer.objects.filter(profile=me, key=key).delete()
                    continue
                if answer not in rules.VALUES[key]:
                    return Response({'answers': f'{key}: one of {list(rules.VALUES[key])}'},
                                    status=status.HTTP_400_BAD_REQUEST)
                SinglesAnswer.objects.update_or_create(profile=me, key=key, defaults={
                    'answer': answer, 'visible': bool(item.get('visible', True))})
        return Response({'answers': [{'key': a.key, 'answer': a.answer, 'visible': a.visible}
                                     for a in SinglesAnswer.objects.filter(profile=me).order_by('key')]})


# ── Phase 9: icebreakers ────────────────────────────────────────────────────
def _my_match(me, pk):
    return (SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), pk=pk, ended_at__isnull=True)
            .select_related('profile_a__user', 'profile_b__user').first())


def _icebreaker_json(ice, me_user):
    answers = ice.answers or {}
    mine = answers.get(str(me_user.pk))
    both = len(answers) >= 2
    theirs = next((v for k, v in answers.items() if k != str(me_user.pk)), None)
    return {
        'id': ice.id, 'key': ice.key, 'mine': mine,
        'theirs': theirs if both else None,
        'waiting_for': None if both else ('them' if mine else 'you'),
        'asked_by_me': ice.asked_by_id == me_user.pk,
        'created_at': ice.created_at.isoformat(),
    }


class SinglesIcebreakersView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        _require_on()
        me = _mine(request.user)
        match = _my_match(me, pk)
        if match is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response({'results': [_icebreaker_json(i, request.user) for i in match.icebreakers.all()[:30]],
                         'keys': list(rules.ICEBREAKERS)})

    def post(self, request, pk):
        _require_on()
        me = _mine(request.user)
        match = _my_match(me, pk)
        if match is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        key = request.data.get('key')
        if key not in rules.ICEBREAKERS:
            return Response({'key': f'one of {list(rules.ICEBREAKERS)}'}, status=status.HTTP_400_BAD_REQUEST)
        if match.icebreakers.filter(key=key).exists():
            return Response({'key': 'Already asked in this match.'}, status=status.HTTP_400_BAD_REQUEST)
        ice = SinglesIcebreaker.objects.create(match=match, key=key, asked_by=request.user)
        _tell_match(match, {'type': 'singles_icebreaker', 'match_id': match.id, 'icebreaker_id': ice.id})
        return Response(_icebreaker_json(ice, request.user), status=status.HTTP_201_CREATED)


def _tell_match(match, payload):
    from .. import messaging as dm
    ids = [p.user_id for p in (match.profile_a, match.profile_b) if p is not None]
    dm.tell(ids, payload)


class SinglesIcebreakerAnswerView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _mine(request.user)
        with transaction.atomic():
            ice = (SinglesIcebreaker.objects.select_for_update()
                   .filter(pk=pk, match__ended_at__isnull=True)
                   .filter(Q(match__profile_a=me) | Q(match__profile_b=me)).first())
            if ice is None:
                return Response(status=status.HTTP_404_NOT_FOUND)
            answer = rules.clean(request.data.get('answer'), rules.ICEBREAKER_LEN)
            if not answer:
                return Response({'answer': 'Write an answer.'}, status=status.HTTP_400_BAD_REQUEST)
            if str(request.user.pk) in (ice.answers or {}):
                return Response({'answer': 'Already answered.'}, status=status.HTTP_400_BAD_REQUEST)
            ice.answers = {**(ice.answers or {}), str(request.user.pk): answer}
            ice.save(update_fields=['answers'])
        _tell_match(ice.match, {'type': 'singles_icebreaker', 'match_id': ice.match_id, 'icebreaker_id': ice.id})
        return Response(_icebreaker_json(ice, request.user))


# ── Phase 10: the singles community ─────────────────────────────────────────
TOPIC_LEN, REPLY_LEN = 300, 600


def _author_json(profile):
    photo = next((p.url for p in profile.photos.all() if p.status == 'approved'), None)
    return {'id': profile.id, 'first_name': profile.first_name, 'photo': photo}


def _topic_json(topic, me):
    return {
        'id': topic.id, 'body': topic.body, 'author': _author_json(topic.author),
        'reply_count': topic.reply_count, 'heart_count': topic.heart_count,
        'hearted': SinglesHeart.objects.filter(topic=topic, profile=me).exists(),
        'mine': topic.author_id == me.pk,
        'created_at': topic.created_at.isoformat(),
    }


class SinglesTopicsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        me = _approved(request.user)
        qs = (SinglesTopic.objects.filter(is_removed=False, author__status=SinglesProfile.APPROVED)
              .exclude(author__user_id__in=blocked_ids_for(request.user))
              .select_related('author').prefetch_related('author__photos')[:50])
        return Response({'results': [_topic_json(t, me) for t in qs]})

    def post(self, request):
        _require_on()
        me = _approved(request.user)
        body = rules.clean(request.data.get('body'), TOPIC_LEN)
        if len(body) < 10:
            return Response({'body': 'Ask a question of at least a few words.'}, status=status.HTTP_400_BAD_REQUEST)
        day_ago = timezone.now() - timezone.timedelta(days=1)
        if SinglesTopic.objects.filter(author=me, created_at__gte=day_ago).count() >= 3:
            return Response({'code': 'slow_down'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        topic = SinglesTopic.objects.create(author=me, body=body)
        return Response(_topic_json(topic, me), status=status.HTTP_201_CREATED)


def _visible_topic(pk, user):
    return (SinglesTopic.objects.filter(pk=pk, is_removed=False)
            .exclude(author__user_id__in=blocked_ids_for(user))
            .select_related('author').prefetch_related('author__photos').first())


class SinglesTopicView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        _require_on()
        me = _approved(request.user)
        topic = _visible_topic(pk, request.user)
        if topic is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        blocked = blocked_ids_for(request.user)
        replies = (topic.replies.filter(is_removed=False).exclude(author__user_id__in=blocked)
                   .select_related('author').prefetch_related('author__photos'))
        return Response({**_topic_json(topic, me), 'replies': [
            {'id': r.id, 'body': r.body, 'author': _author_json(r.author), 'mine': r.author_id == me.pk,
             'created_at': r.created_at.isoformat()} for r in replies]})


class SinglesReplyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _approved(request.user)
        topic = _visible_topic(pk, request.user)
        if topic is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        body = rules.clean(request.data.get('body'), REPLY_LEN)
        if not body:
            return Response({'body': 'Write a reply.'}, status=status.HTTP_400_BAD_REQUEST)
        reply = SinglesReply.objects.create(topic=topic, author=me, body=body)
        SinglesTopic.objects.filter(pk=topic.pk).update(reply_count=F('reply_count') + 1)
        return Response({'id': reply.id, 'body': reply.body, 'author': _author_json(me), 'mine': True,
                         'created_at': reply.created_at.isoformat()}, status=status.HTTP_201_CREATED)


class SinglesHeartView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _approved(request.user)
        topic = _visible_topic(pk, request.user)
        if topic is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        heart, created = SinglesHeart.objects.get_or_create(topic=topic, profile=me)
        if created:
            SinglesTopic.objects.filter(pk=topic.pk).update(heart_count=F('heart_count') + 1)
        else:
            heart.delete()
            SinglesTopic.objects.filter(pk=topic.pk, heart_count__gt=0).update(heart_count=F('heart_count') - 1)
        topic.refresh_from_db()
        return Response({'hearted': created, 'heart_count': topic.heart_count})


def _gathering_json(g, me):
    matched = SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), ended_at__isnull=True)
    friend_ids = {m.profile_b_id if m.profile_a_id == me.pk else m.profile_a_id for m in matched}
    going = SinglesRsvp.objects.filter(gathering=g)
    friends = [r.profile.first_name for r in going.filter(profile_id__in=friend_ids).select_related('profile')[:3]]
    return {
        'id': g.id, 'kind': g.kind, 'title': g.title, 'description': g.description,
        'starts_at': g.starts_at.isoformat(), 'place': g.place, 'country': g.country, 'online': g.online,
        'status': g.status, 'going': going.count(), 'interested': going.filter(profile=me).exists(),
        'friends_going': friends, 'mine': g.created_by_id == me.user_id,
    }


class SinglesGatheringsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        me = _approved(request.user)
        qs = SinglesGathering.objects.filter(starts_at__gte=timezone.now() - timezone.timedelta(hours=6)).filter(
            Q(status=SinglesGathering.APPROVED) | Q(created_by=request.user, status=SinglesGathering.PENDING))
        return Response({'results': [_gathering_json(g, me) for g in qs[:40]]})

    def post(self, request):
        _require_on()
        me = _approved(request.user)
        data = request.data
        kind = data.get('kind')
        if kind not in dict(SinglesGathering.KINDS):
            return Response({'kind': f'one of {list(dict(SinglesGathering.KINDS))}'}, status=status.HTTP_400_BAD_REQUEST)
        title = rules.clean(data.get('title'), 120)
        if not title:
            return Response({'title': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        from django.utils.dateparse import parse_datetime
        starts = parse_datetime(str(data.get('starts_at') or ''))
        if starts is None or (timezone.is_aware(starts) and starts < timezone.now()):
            return Response({'starts_at': 'A future date and time.'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(starts):
            starts = timezone.make_aware(starts)
        g = SinglesGathering.objects.create(
            created_by=request.user, kind=kind, title=title, description=rules.clean(data.get('description'), 1500),
            starts_at=starts, place=rules.clean(data.get('place'), 160), country=rules.clean(data.get('country'), 60),
            online=bool(data.get('online')) or kind == 'online')
        return Response(_gathering_json(g, me), status=status.HTTP_201_CREATED)


class SinglesRsvpView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _approved(request.user)
        g = SinglesGathering.objects.filter(pk=pk, status=SinglesGathering.APPROVED).first()
        if g is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        rsvp, created = SinglesRsvp.objects.get_or_create(gathering=g, profile=me)
        if not created:
            rsvp.delete()
        return Response(_gathering_json(g, me))


class SinglesRoomsView(APIView):
    """Live singles-only audio rooms (LiveBroadcast.singles_only)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        _approved(request.user)
        rooms = (LiveBroadcast.objects.filter(singles_only=True, status='live')
                 .exclude(host_id__in=blocked_ids_for(request.user)).select_related('host')[:20])
        return Response({'results': [{'id': r.id, 'title': r.title, 'kind': r.kind, 'host': r.host.username,
                                      'listening': r.viewer_count, 'started_at': r.started_at.isoformat()}
                                     for r in rooms]})


def _story_json(story, me_user=None):
    names = [p.first_name for p in (story.match.profile_a, story.match.profile_b) if p is not None]
    out = {'id': story.id, 'title': story.title, 'body': story.body, 'photo': story.photo or None,
           'names': names, 'status': story.status,
           'published_at': story.published_at.isoformat() if story.published_at else None}
    if me_user is not None:
        out['agreed'] = me_user.pk in (story.consents or [])
        out['both_agreed'] = len(set(story.consents or [])) >= 2
    return out


class SinglesStoriesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        qs = (SinglesStory.objects.filter(status=SinglesStory.PUBLISHED)
              .select_related('match__profile_a', 'match__profile_b').order_by('-published_at')[:30])
        return Response({'results': [_story_json(s) for s in qs]})


class SinglesMatchStoryView(APIView):
    """A couple tells how they met. The teller agrees by telling; the other
    agrees separately; only then may an admin publish it."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _mine(request.user)
        match = (SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), pk=pk)
                 .select_related('profile_a', 'profile_b').first())
        if match is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        title = rules.clean(request.data.get('title'), 120)
        body = rules.clean(request.data.get('body'), 3000)
        if not title or len(body) < 40:
            return Response({'body': 'A title and a few sentences.'}, status=status.HTTP_400_BAD_REQUEST)
        story, _ = SinglesStory.objects.update_or_create(match=match, defaults={
            'title': title, 'body': body, 'consents': [request.user.pk], 'status': SinglesStory.PENDING,
            'published_at': None})
        return Response(_story_json(story, request.user), status=status.HTTP_201_CREATED)


class SinglesStoryConsentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _story(self, request, pk):
        me = _mine(request.user)
        return (SinglesStory.objects.filter(pk=pk).filter(Q(match__profile_a=me) | Q(match__profile_b=me))
                .select_related('match__profile_a', 'match__profile_b').first())

    def post(self, request, pk):
        _require_on()
        story = self._story(request, pk)
        if story is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.user.pk not in story.consents:
            story.consents = [*story.consents, request.user.pk]
            story.save(update_fields=['consents'])
        return Response(_story_json(story, request.user))

    def delete(self, request, pk):
        """Either of them takes it down, at any time."""
        story = self._story(request, pk)
        if story is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        story.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Phase 11: photo verification ────────────────────────────────────────────
class SinglesVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        _require_on()
        me = _mine(request.user)
        last = me.verifications.first()
        return Response({'gesture': random.choice(rules.GESTURES), 'verified': me.photo_verified_at is not None,
                         'last': last.status if last else None})

    def post(self, request):
        _require_on()
        me = _mine(request.user)
        gesture = request.data.get('gesture')
        if gesture not in rules.GESTURES:
            return Response({'gesture': f'one of {list(rules.GESTURES)}'}, status=status.HTTP_400_BAD_REQUEST)
        image = request.FILES.get('image')
        if image is None or not (getattr(image, 'content_type', '') or '').startswith('image/') \
                or image.size > MAX_PHOTO_BYTES:
            return Response({'image': 'A photo, please.'}, status=status.HTTP_400_BAD_REQUEST)
        if me.verifications.filter(status=SinglesVerification.PENDING).exists():
            return Response({'code': 'waiting'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = r2.upload_file(image, 'singles_verify')
        except Exception:  # noqa: BLE001
            logger.exception('Singles selfie upload failed')
            return Response({'error': 'The photo could not be uploaded.'}, status=status.HTTP_502_BAD_GATEWAY)
        SinglesVerification.objects.create(profile=me, selfie=url, gesture=gesture)
        return Response({'last': 'pending'}, status=status.HTTP_201_CREATED)


# ── Scripture cards ─────────────────────────────────────────────────────────
class BibleLookupView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from ..bible_books import lookup
        found = lookup(request.query_params.get('ref', ''))
        if found is None:
            return Response({'error': 'Verse not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(found)


# ── The admins' side ────────────────────────────────────────────────────────
def _tell(user, message):
    from ..push import notify_user
    try:
        notify_user(user, 'system', message, data={'screen': 'Singles'})
    except Exception:  # noqa: BLE001
        logger.exception('Singles notice failed')


class _Decide:
    """{decision: approve|reject, reason}: reject needs a reason."""

    @staticmethod
    def read(request):
        decision = request.data.get('decision')
        if decision not in ('approve', 'reject'):
            return None, None, Response({'decision': 'approve or reject'}, status=status.HTTP_400_BAD_REQUEST)
        reason, refused = reason_of(request, required=decision == 'reject')
        return decision, reason, refused


class AdminSinglesGatheringViewSet(viewsets.ViewSet):
    permission_classes = [Cap('review_singles')]

    def list(self, request):
        state = request.query_params.get('state', 'pending')
        qs = SinglesGathering.objects.filter(status=state).select_related('created_by').order_by('starts_at')[:100]
        return Response({'results': [{
            'id': g.id, 'kind': g.kind, 'title': g.title, 'description': g.description,
            'starts_at': g.starts_at.isoformat(), 'place': g.place, 'country': g.country, 'online': g.online,
            'status': g.status, 'by': g.created_by.username} for g in qs]})

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        g = SinglesGathering.objects.filter(pk=pk).select_related('created_by').first()
        if g is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        decision, reason, refused = _Decide.read(request)
        if refused:
            return refused
        g.status = g.APPROVED if decision == 'approve' else g.REJECTED
        g.review_note = reason or ''
        g.save(update_fields=['status', 'review_note'])
        log_admin_action(request.user, f'singles_gathering_{decision}', 'singlesgathering', g.pk, reason=reason or g.title)
        _tell(g.created_by, f'Your singles event "{g.title}" is listed.' if decision == 'approve'
              else f'Your singles event "{g.title}" was not listed: {reason}')
        return Response({'id': g.id, 'status': g.status})


class AdminSinglesStoryViewSet(viewsets.ViewSet):
    permission_classes = [Cap('review_singles')]

    def list(self, request):
        qs = (SinglesStory.objects.filter(status=SinglesStory.PENDING)
              .select_related('match__profile_a', 'match__profile_b')[:100])
        return Response({'results': [_story_json(s) | {'both_agreed': len(set(s.consents or [])) >= 2} for s in qs]})

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        story = SinglesStory.objects.filter(pk=pk).select_related('match__profile_a', 'match__profile_b').first()
        if story is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        decision, reason, refused = _Decide.read(request)
        if refused:
            return refused
        if decision == 'approve' and len(set(story.consents or [])) < 2:
            return Response({'error': 'Both of them must agree first.'}, status=status.HTTP_400_BAD_REQUEST)
        story.status = story.PUBLISHED if decision == 'approve' else story.REJECTED
        story.published_at = timezone.now() if decision == 'approve' else None
        story.save(update_fields=['status', 'published_at'])
        log_admin_action(request.user, f'singles_story_{decision}', 'singlesstory', story.pk, reason=reason or story.title)
        return Response(_story_json(story))


class AdminSinglesVerificationViewSet(viewsets.ViewSet):
    permission_classes = [Cap('review_singles')]

    def list(self, request):
        qs = (SinglesVerification.objects.filter(status=SinglesVerification.PENDING)
              .select_related('profile__user').prefetch_related('profile__photos')[:100])
        return Response({'results': [{
            'id': v.id, 'gesture': v.gesture, 'selfie': v.selfie, 'profile_id': v.profile_id,
            'first_name': v.profile.first_name, 'username': v.profile.user.username,
            'photos': [p.url for p in v.profile.photos.all() if p.status == 'approved'],
            'created_at': v.created_at.isoformat()} for v in qs]})

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        v = SinglesVerification.objects.filter(pk=pk, status=SinglesVerification.PENDING).select_related('profile__user').first()
        if v is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        decision, reason, refused = _Decide.read(request)
        if refused:
            return refused
        v.status = v.APPROVED if decision == 'approve' else v.REJECTED
        v.reviewed_by = request.user
        v.save(update_fields=['status', 'reviewed_by'])
        if decision == 'approve':
            SinglesProfile.objects.filter(pk=v.profile_id).update(photo_verified_at=timezone.now())
        log_admin_action(request.user, f'singles_verify_{decision}', 'singlesprofile', v.profile_id, reason=reason or '')
        _tell(v.profile.user, 'Your photo is verified — your profile now shows the tick.' if decision == 'approve'
              else f'Your photo verification didn’t pass: {reason}')
        return Response({'id': v.id, 'status': v.status})


class AdminSinglesStatsView(APIView):
    """Totals only — never who matched with whom. "Meaningful connections"
    (matches that became a conversation) over time spent."""
    permission_classes = [Cap('review_singles', 'view_analytics')]

    def get(self, request):
        week = timezone.now() - timezone.timedelta(days=7)
        by_status = dict(SinglesProfile.objects.values_list('status').annotate(n=Count('id')))
        signals = dict(SinglesSignal.objects.filter(created_at__gte=week).values_list('kind').annotate(n=Count('id')))
        return Response({
            'profiles': by_status,
            'week': {k: signals.get(k, 0) for k in SinglesSignal.KINDS},
            'matches_total': SinglesMatch.objects.count(),
            'conversations_started_week': signals.get('chat_started', 0),
            'waiting': {
                'profiles': by_status.get('pending', 0),
                'gatherings': SinglesGathering.objects.filter(status='pending').count(),
                'stories': SinglesStory.objects.filter(status='pending').count(),
                'verifications': SinglesVerification.objects.filter(status='pending').count(),
            },
        })
