"""Single & Searching, phase 1: your own singles profile, and the admins'
review queue.

    GET    /api/singles/me/                 can I join, and my profile
    POST   /api/singles/me/                 join: agree to the rules, start a profile
    PATCH  /api/singles/me/                 change it (birth date and gender stay)
    DELETE /api/singles/me/                 leave: the profile and photos go
    POST   /api/singles/me/submit/          send it for review
    POST   /api/singles/me/pause/           {paused}: hidden from everyone, or back
    POST   /api/singles/me/photos/          add a photo (multipart `image`)
    DELETE /api/singles/me/photos/<id>/     take one away
    POST   /api/singles/me/photos/order/    {ids}: the order they show in

    /api/admin/singles/                     the queue (review_singles)
    POST /api/admin/singles/<id>/review/    {decision: approve|reject, reason}
    POST /api/admin/singles/<id>/ban/       {reason}  — from here only
    POST /api/admin/singles/<id>/unban/     {reason}

Nobody sees anyone else's profile in this phase: Discover comes in phase 2.
"""
import logging

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import r2
from .. import singles as rules
from ..models import SinglesPhoto, SinglesProfile
from .admin import log_admin_action, reason_of
from .common import Cap, StandardPagination

logger = logging.getLogger(__name__)

MAX_PHOTO_BYTES = 8 * 1024 * 1024
TEXT_FIELDS = {'first_name': 40, 'country': 60, 'town': 80, 'church': 120, 'about': 500,
               'occupation': 80, 'education': 80}
CHOICE_FIELDS = {'baptised': dict(SinglesProfile.BAPTISED), 'looking_for': dict(SinglesProfile.LOOKING)}
FIXED = ('birth_date', 'gender')


def _require_on():
    if not rules.feature_on():
        raise PermissionDenied({'code': 'feature_off', 'detail': 'Single & Searching is switched off.'})


def _photo_json(p, own=True):
    out = {'id': p.id, 'url': p.url, 'position': p.position}
    if own:
        out['status'] = p.status
    return out


def _own_json(profile):
    return {
        'id': profile.id,
        'first_name': profile.first_name,
        'age': rules.age_on(profile.birth_date),
        'birth_date': profile.birth_date.isoformat(),
        'gender': profile.gender,
        'country': profile.country, 'town': profile.town, 'church': profile.church,
        'baptised': profile.baptised, 'looking_for': profile.looking_for,
        'languages': profile.languages, 'about': profile.about, 'prompts': profile.prompts,
        'occupation': profile.occupation, 'education': profile.education, 'interests': profile.interests,
        'ministries': profile.ministries, 'diet': profile.diet,
        'show_age': profile.show_age, 'show_town': profile.show_town, 'show_online': profile.show_online,
        'discoverable': profile.discoverable,
        'preferences': {'min_age': profile.pref_min_age, 'max_age': profile.pref_max_age,
                        'countries': profile.pref_countries, 'intents': profile.pref_intents},
        'photo_verified': profile.photo_verified_at is not None,
        'answers': [{'key': a.key, 'answer': a.answer, 'visible': a.visible} for a in profile.answers.all()],
        'status': profile.status, 'review_note': profile.review_note,
        'is_paused': profile.is_paused,
        'photos': [_photo_json(p) for p in profile.photos.exclude(status=SinglesPhoto.REJECTED)],
        'missing': rules.missing_for_review(profile),
    }


def _apply(profile, data, creating=False):
    """Copy what was sent onto `profile`, cleaned; a dict of field errors if
    anything is wrong (nothing is saved then)."""
    errors = {}
    if not creating:
        for field in FIXED:
            if field in data and str(data[field]) != str(getattr(profile, field)):
                errors[field] = 'This can’t be changed.'
    for field, limit in TEXT_FIELDS.items():
        if field in data:
            value = rules.clean(data.get(field), limit)
            if field in ('first_name', 'country') and not value:
                errors[field] = 'Required.'
            setattr(profile, field, value)
    for field, allowed in CHOICE_FIELDS.items():
        if field in data:
            if data[field] not in allowed:
                errors[field] = f'One of {list(allowed)}.'
            else:
                setattr(profile, field, data[field])
    for field in ('languages', 'interests'):
        if field in data:
            try:
                setattr(profile, field, rules.clean_list(data[field], field))
            except ValueError as e:
                errors[field] = str(e)
    if 'prompts' in data:
        try:
            profile.prompts = rules.clean_prompts(data['prompts'])
        except ValueError as e:
            errors['prompts'] = str(e)
    if 'ministries' in data:
        try:
            profile.ministries = rules.clean_ministries(data['ministries'])
        except ValueError as e:
            errors['ministries'] = str(e)
    if 'diet' in data:
        if data['diet'] not in dict(SinglesProfile.DIETS):
            errors['diet'] = f'One of {list(dict(SinglesProfile.DIETS))}.'
        else:
            profile.diet = data['diet']
    for field in ('show_age', 'show_town', 'show_online'):
        if field in data:
            setattr(profile, field, bool(data[field]))
    if 'discoverable' in data:
        if data['discoverable'] not in dict(SinglesProfile.DISCOVERABLE):
            errors['discoverable'] = 'everyone or liked'
        else:
            profile.discoverable = data['discoverable']
    if 'preferences' in data:
        errors.update(_apply_preferences(profile, data['preferences']))
    return errors


def _apply_preferences(profile, prefs):
    if not isinstance(prefs, dict):
        return {'preferences': 'An object.'}
    errors = {}
    for key, field in (('min_age', 'pref_min_age'), ('max_age', 'pref_max_age')):
        if key in prefs:
            value = prefs[key]
            if value in (None, ''):
                setattr(profile, field, None)
                continue
            try:
                value = int(value)
            except (TypeError, ValueError):
                errors['preferences'] = 'Ages are numbers.'
                continue
            setattr(profile, field, max(rules.MIN_AGE, min(rules.MAX_AGE, value)))
    if profile.pref_min_age and profile.pref_max_age and profile.pref_min_age > profile.pref_max_age:
        errors['preferences'] = 'The youngest age is above the oldest.'
    if 'countries' in prefs:
        countries = prefs['countries'] if isinstance(prefs['countries'], list) else []
        profile.pref_countries = [rules.clean(c, 60) for c in countries if rules.clean(c, 60)][:5]
    if 'intents' in prefs:
        intents = prefs['intents'] if isinstance(prefs['intents'], list) else []
        allowed = dict(SinglesProfile.LOOKING)
        if any(i not in allowed for i in intents):
            errors['preferences'] = f'intents: any of {list(allowed)}'
        else:
            profile.pref_intents = list(dict.fromkeys(intents))
    return errors


class SinglesMeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        user = request.user
        blockers = rules.blockers(user)
        profile = _profile_of(user)
        return Response({
            'eligible': not blockers,
            'blockers': blockers,
            'ready_on': rules.ready_on(user).isoformat() if rules.TOO_NEW in blockers else None,
            'profile': _own_json(profile) if profile and profile.status != profile.BANNED else None,
        })

    def post(self, request):
        _require_on()
        user = request.user
        blockers = rules.blockers(user)
        if blockers:
            return Response({'code': 'not_eligible', 'blockers': blockers}, status=status.HTTP_403_FORBIDDEN)
        if SinglesProfile.objects.filter(user=user).exists():
            return Response({'error': 'You already have a profile.'}, status=status.HTTP_400_BAD_REQUEST)
        data = request.data
        if data.get('agree_rules') is not True:
            return Response({'agree_rules': 'Agree to the community rules to join.'},
                            status=status.HTTP_400_BAD_REQUEST)
        errors = {}
        try:
            birth = rules.check_birth_date(data.get('birth_date'))
        except ValueError as e:
            if str(e) == 'under_18':
                return Response({'code': 'under_18', 'birth_date': 'You must be 18 or over.'},
                                status=status.HTTP_403_FORBIDDEN)
            errors['birth_date'] = str(e)
            birth = None
        if data.get('gender') not in dict(SinglesProfile.GENDERS):
            errors['gender'] = f'One of {list(dict(SinglesProfile.GENDERS))}.'
        for field in ('first_name', 'country', 'baptised'):
            if not data.get(field):
                errors[field] = 'Required.'
        profile = SinglesProfile(user=user, birth_date=birth, gender=data.get('gender'),
                                 agreed_rules_at=timezone.now(), last_active_at=timezone.now())
        errors.update(_apply(profile, data, creating=True))
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        profile.save()
        return Response(_own_json(profile), status=status.HTTP_201_CREATED)

    def patch(self, request):
        _require_on()
        profile = _mine(request.user)
        errors = _apply(profile, request.data)
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        profile.save()
        rules.drop_hub(profile.pk)
        return Response(_own_json(profile))

    def delete(self, request):
        """Leave: everything here goes. Allowed even while switched off or
        banned (a ban is kept so they can't simply start again)."""
        profile = _profile_of(request.user)
        if profile is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        urls = list(profile.photos.values_list('url', flat=True))
        _end_all_matches(profile, by=request.user)
        if profile.status == profile.BANNED:
            profile.photos.all().delete()
            SinglesProfile.objects.filter(pk=profile.pk).update(
                about='', prompts=[], occupation='', education='', interests=[], church='', town='')
        else:
            profile.delete()
        for url in urls:
            r2.delete(url)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _profile_of(user):
    # Read fresh, never the cached `user.singles_profile`: a profile left or
    # banned a moment ago must not linger on a user object kept around.
    return SinglesProfile.objects.filter(user=user).first()


def _mine(user):
    profile = _profile_of(user)
    if profile is None or profile.status == SinglesProfile.BANNED:
        raise PermissionDenied({'code': 'no_profile', 'detail': 'You have no singles profile.'})
    # Standing is checked on every action, not only when joining: someone
    # suspended after they joined can't carry on here (leaving still works —
    # it doesn't come through here).
    blockers = rules.blockers(user)
    if blockers:
        raise PermissionDenied({'code': 'not_eligible', 'blockers': blockers})
    return profile


class SinglesSubmitView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        _require_on()
        profile = _mine(request.user)
        if profile.status in (profile.PENDING, profile.APPROVED):
            return Response(_own_json(profile))
        missing = rules.missing_for_review(profile)
        if missing:
            return Response({'code': 'incomplete', 'missing': missing}, status=status.HTTP_400_BAD_REQUEST)
        profile.status, profile.submitted_at, profile.review_note = profile.PENDING, timezone.now(), ''
        profile.save(update_fields=['status', 'submitted_at', 'review_note', 'updated_at'])
        rules.notify_reviewers('profile', 'A Single & Searching profile is waiting for review.')
        return Response(_own_json(profile))


class SinglesPauseView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        _require_on()
        profile = _mine(request.user)
        profile.is_paused = bool(request.data.get('paused'))
        profile.save(update_fields=['is_paused', 'updated_at'])
        return Response(_own_json(profile))


class SinglesPhotosView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        _require_on()
        profile = _mine(request.user)
        image = request.FILES.get('image')
        if image is None:
            return Response({'image': 'Choose a photo.'}, status=status.HTTP_400_BAD_REQUEST)
        if not (getattr(image, 'content_type', '') or '').startswith('image/'):
            return Response({'image': 'That is not a photo.'}, status=status.HTTP_400_BAD_REQUEST)
        if image.size > MAX_PHOTO_BYTES:
            return Response({'image': 'That photo is too large.'}, status=status.HTTP_400_BAD_REQUEST)
        kept = profile.photos.exclude(status=SinglesPhoto.REJECTED)
        if kept.count() >= rules.MAX_PHOTOS:
            return Response({'image': f'At most {rules.MAX_PHOTOS} photos.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            url = r2.upload_file(image, 'singles')
        except Exception:  # noqa: BLE001
            logger.exception('Singles photo upload failed')
            return Response({'error': 'The photo could not be uploaded.'}, status=status.HTTP_502_BAD_GATEWAY)
        position = (kept.order_by('-position').values_list('position', flat=True).first() or 0) + 1
        if not kept.exists():
            position = 0
        photo = SinglesPhoto.objects.create(profile=profile, url=url, position=position)
        if profile.status == profile.APPROVED:
            rules.notify_reviewers('photo', 'A new Single & Searching photo is waiting for review.')
        return Response(_photo_json(photo), status=status.HTTP_201_CREATED)


class SinglesPhotoDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        _require_on()
        profile = _mine(request.user)
        photo = profile.photos.filter(pk=pk).first()
        if photo is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        url = photo.url
        photo.delete()
        r2.delete(url)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SinglesPhotoOrderView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        _require_on()
        profile = _mine(request.user)
        ids = request.data.get('ids')
        mine = list(profile.photos.exclude(status=SinglesPhoto.REJECTED).values_list('id', flat=True))
        if not isinstance(ids, list) or sorted(ids) != sorted(mine):
            return Response({'ids': 'Every one of your photo ids, in order.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for position, pk in enumerate(ids):
                SinglesPhoto.objects.filter(pk=pk, profile=profile).update(position=position)
        return Response(_own_json(profile))


# ── The admins' side ────────────────────────────────────────────────────────
def _review_json(profile):
    user = profile.user
    return {
        **_own_json(profile),
        'user': {'id': user.id, 'username': user.username, 'joined': user.date_joined.isoformat(),
                 'strikes': user.strikes},
        'photos': [_photo_json(p) for p in profile.photos.all()],
        'submitted_at': profile.submitted_at.isoformat() if profile.submitted_at else None,
        'risk': rules.risk(profile),
        'reviewed_at': profile.reviewed_at.isoformat() if profile.reviewed_at else None,
    }


def _tell(user, message):
    from ..push import notify_user
    try:
        notify_user(user, 'system', message, data={'screen': 'Singles'})
    except Exception:  # noqa: BLE001 — telling them never undoes the decision
        logger.exception('Singles notice failed')


class AdminSinglesViewSet(viewsets.ViewSet):
    """The review queue: profiles waiting for review, and approved profiles
    with a new photo waiting. `state`: waiting (default), approved, rejected,
    banned, all."""
    permission_classes = [Cap('review_singles')]

    def _qs(self):
        return SinglesProfile.objects.select_related('user').prefetch_related('photos')

    def list(self, request):
        state = request.query_params.get('state', 'waiting')
        qs = self._qs()
        if state == 'waiting':
            new_photo = SinglesPhoto.objects.filter(profile=OuterRef('pk'), status=SinglesPhoto.PENDING)
            qs = qs.filter(Q(status=SinglesProfile.PENDING)
                           | Q(Exists(new_photo), status=SinglesProfile.APPROVED)).order_by('submitted_at', 'id')
        elif state in dict(SinglesProfile.STATUSES):
            qs = qs.filter(status=state).order_by('-updated_at')
        elif state != 'all':
            return Response({'error': 'state: waiting, approved, rejected, banned, pending, draft or all'},
                            status=status.HTTP_400_BAD_REQUEST)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response([_review_json(p) for p in page])

    def retrieve(self, request, pk=None):
        profile = self._qs().filter(pk=pk).first()
        if profile is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(_review_json(profile))

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """{decision: approve|reject, reason, photos?: {id: approve|reject}}.
        Approving approves its waiting photos unless a photo is named as
        rejected; rejecting needs a reason, which the person is told."""
        profile = self._qs().filter(pk=pk).first()
        if profile is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if profile.status == profile.BANNED:
            return Response({'error': 'This person is banned from Single & Searching.'},
                            status=status.HTTP_400_BAD_REQUEST)
        decision = request.data.get('decision')
        if decision not in ('approve', 'reject'):
            return Response({'decision': 'approve or reject'}, status=status.HTTP_400_BAD_REQUEST)
        reason, refused = reason_of(request, required=decision == 'reject')
        if refused:
            return refused
        per_photo = request.data.get('photos') or {}
        if not isinstance(per_photo, dict):
            return Response({'photos': '{id: approve|reject}'}, status=status.HTTP_400_BAD_REQUEST)
        photo_news = []          # what happened to each waiting photo, for telling them
        with transaction.atomic():
            for photo in profile.photos.filter(status=SinglesPhoto.PENDING):
                said = per_photo.get(str(photo.id)) or per_photo.get(photo.id)
                if said == 'reject' or (decision == 'reject' and said != 'approve'):
                    photo.status = SinglesPhoto.REJECTED
                else:
                    photo.status = SinglesPhoto.APPROVED
                photo.save(update_fields=['status'])
                photo_news.append('approve' if photo.status == SinglesPhoto.APPROVED else 'reject')
            approved_photo = profile.photos.filter(status=SinglesPhoto.APPROVED).exists()
            if decision == 'approve' and not approved_photo:
                transaction.set_rollback(True)
                return Response({'error': 'A profile needs at least one approved photo.'},
                                status=status.HTTP_400_BAD_REQUEST)
            was = profile.status
            profile.status = profile.APPROVED if decision == 'approve' else profile.REJECTED
            profile.review_note = '' if decision == 'approve' else reason
            profile.reviewed_by, profile.reviewed_at = request.user, timezone.now()
            if decision == 'approve' and was != profile.APPROVED and not profile.approved_at:
                profile.approved_at = timezone.now()
            profile.save(update_fields=['status', 'review_note', 'reviewed_by', 'reviewed_at', 'approved_at',
                                        'updated_at'])
        log_admin_action(request.user, f'singles_{decision}', 'singlesprofile', profile.pk,
                         reason=reason or profile.first_name)
        if decision == 'approve' and was != profile.APPROVED:
            _tell(profile.user, 'Your Single & Searching profile is approved — others can now see it.')
        elif decision == 'approve' and photo_news:
            kept = photo_news.count('approve')
            _tell(profile.user, 'Your new photo is approved and now shows on your profile.' if kept
                  else 'Your new photo wasn’t approved. Please choose a clear, recent photo of yourself.')
        elif decision == 'reject':
            _tell(profile.user, f'Your Single & Searching profile needs a change: {reason}')
        return Response(_review_json(profile))

    @action(detail=True, methods=['post'])
    def ban(self, request, pk=None):
        profile = self._qs().filter(pk=pk).first()
        if profile is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        reason, refused = reason_of(request)
        if refused:
            return refused
        profile.status, profile.review_note, profile.is_paused = profile.BANNED, reason, True
        profile.reviewed_by, profile.reviewed_at = request.user, timezone.now()
        profile.save(update_fields=['status', 'review_note', 'is_paused', 'reviewed_by', 'reviewed_at',
                                    'updated_at'])
        _end_all_matches(profile, by=request.user)
        log_admin_action(request.user, 'singles_ban', 'singlesprofile', profile.pk, reason=reason)
        _tell(profile.user, f'You can no longer use Single & Searching. Reason: {reason}')
        return Response(_review_json(profile))

    @action(detail=True, methods=['post'])
    def unban(self, request, pk=None):
        profile = self._qs().filter(pk=pk, status=SinglesProfile.BANNED).first()
        if profile is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        reason, refused = reason_of(request)
        if refused:
            return refused
        # Back to the start of review: they look again before anyone sees it.
        profile.status, profile.review_note = profile.DRAFT, ''
        profile.save(update_fields=['status', 'review_note', 'updated_at'])
        log_admin_action(request.user, 'singles_unban', 'singlesprofile', profile.pk, reason=reason)
        return Response(_review_json(profile))


# ── Phase 2: Discover, interest and matches ─────────────────────────────────
def _public_json(profile, viewer=None, reasons=None):
    """A profile as someone else sees it: no birth date, no review state,
    approved photos only — and only what its owner chose to show (age, town,
    being online, each values answer)."""
    answers = getattr(profile, '_answers', None)
    if answers is None:
        answers = {a.key: a.answer for a in profile.answers.all() if a.visible}
    out = {
        'id': profile.id,
        'first_name': profile.first_name,
        'age': rules.age_on(profile.birth_date) if profile.show_age else None,
        'country': profile.country, 'town': profile.town if profile.show_town else '',
        'church': profile.church,
        'baptised': profile.baptised, 'looking_for': profile.looking_for,
        'languages': profile.languages, 'about': profile.about, 'prompts': profile.prompts,
        'occupation': profile.occupation, 'education': profile.education, 'interests': profile.interests,
        'ministries': profile.ministries, 'diet': profile.diet,
        'answers': [{'key': k, 'answer': v} for k, v in answers.items()],
        'online': rules.is_online(profile),
        'badges': {'email': True, 'photo': profile.photo_verified_at is not None},
        'photos': [_photo_json(p, own=False) for p in profile.photos.all() if p.status == SinglesPhoto.APPROVED],
    }
    if viewer is not None and reasons is None and viewer.pk != profile.pk:
        if getattr(viewer, '_answers', None) is None:
            rules._with_answers([viewer])
        profile._answers = answers
        reasons = rules.reasons_for(viewer, profile)
    if reasons is not None:
        out['reasons'] = reasons
    return out


def _seen(profile):
    SinglesProfile.objects.filter(pk=profile.pk).update(last_active_at=timezone.now())


def _browsing(user):
    """The viewer's own profile, which must be approved and not paused to
    look at others."""
    profile = _mine(user)
    if profile.status != profile.APPROVED:
        raise PermissionDenied({'code': 'not_approved', 'detail': 'Your profile is not approved yet.'})
    if profile.is_paused:
        raise PermissionDenied({'code': 'paused', 'detail': 'Your profile is paused.'})
    return profile


def _filters(params):
    out = {}
    for key in ('min_age', 'max_age'):
        value = params.get(key)
        if value not in (None, ''):
            try:
                out[key] = max(rules.MIN_AGE, min(rules.MAX_AGE, int(value)))
            except (TypeError, ValueError):
                pass
    for key in ('country', 'baptised', 'language', 'looking_for'):
        if params.get(key):
            out[key] = str(params[key])[:60]
    return out


class SinglesDiscoverView(APIView):
    """GET /api/singles/discover/?min_age&max_age&country&baptised&language&looking_for
    → {results: [profile…], left_today}. Empty results with left_today 0:
    come back tomorrow."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        _require_on()
        me = _browsing(request.user)
        _seen(me)
        left = max(0, rules.DAILY_NEW - rules.answered_today(me))
        if not left:
            return Response({'results': [], 'left_today': 0})
        filters = _filters(request.query_params)
        qs = rules.candidates(me, filters)
        if not filters:
            qs = rules.apply_preferences(qs, me)
        batch = list(qs[:min(rules.BATCH, left)])
        return Response({'results': [_public_json(p, me) for p in batch], 'left_today': left})


def _match_json(match, me):
    other = match.other(me)
    return {
        'id': match.id,
        'profile': _public_json(other, me),
        'conversation_id': match.conversation_id,
        'created_at': match.created_at.isoformat(),
        'ended': match.ended_at is not None,
        'opener': rules.opener(other),
        'starters': rules.starters(other),
        # Only once matched: who they are in Messages, where the chat lives.
        'user': {'id': other.user_id, 'username': other.user.username},
        'story': _story_state(match, me),
    }


def _story_state(match, me):
    try:
        story = match.story
    except Exception:  # noqa: BLE001 — RelatedObjectDoesNotExist: no story yet
        return None
    consents = story.consents or []
    return {'id': story.id, 'title': story.title, 'status': story.status,
            'agreed': me.user_id in consents, 'both_agreed': len(set(consents)) >= 2}


def _make_match(me, other):
    """Both are interested: the match, its own chat (accepted on both sides —
    it is not a request), and a discreet word to each."""
    from .. import messaging as dm
    from ..models import Conversation, ConversationState, SinglesMatch
    a, b = sorted([me, other], key=lambda p: p.pk)
    with transaction.atomic():
        match, created = SinglesMatch.objects.get_or_create(profile_a=a, profile_b=b)
        if created:
            conv = Conversation.objects.create()
            conv.participants.add(me.user, other.user)
            ConversationState.objects.bulk_create([
                ConversationState(conversation=conv, user=me.user, accepted=True),
                ConversationState(conversation=conv, user=other.user, accepted=True),
            ])
            match.conversation = conv
            match.save(update_fields=['conversation'])
            rules.signal(me, 'match', other)
    if created:
        for user in (me.user, other.user):
            try:
                from ..push import notify_user
                notify_user(user, 'singles_match', 'You have a new match.', data={'screen': 'SinglesMatches'})
            except Exception:  # noqa: BLE001
                logger.exception('Singles match notice failed')
        dm.tell([me.user_id, other.user_id], {'type': 'singles_match', 'match_id': match.id})
    return match


class SinglesProfileView(APIView):
    """GET /api/singles/profiles/<id>/ — someone else's profile, when you may
    see it (rules.can_view)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        _require_on()
        me = _mine(request.user)
        target = (SinglesProfile.objects.select_related('user').prefetch_related('photos')
                  .filter(pk=pk).first())
        if target is None or not rules.can_view(me, target):
            return Response(status=status.HTTP_404_NOT_FOUND)
        if target.pk == me.pk:
            return Response(_own_json(me))
        rules.signal(me, 'view', target)
        return Response(_public_json(target, me))


class SinglesInterestView(APIView):
    """POST /api/singles/profiles/<id>/interest/ {kind: interested|pass}
    → {matched, match?, left_today}."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from ..models import SinglesInterest
        _require_on()
        me = _browsing(request.user)
        kind = request.data.get('kind')
        if kind not in dict(SinglesInterest.KINDS):
            return Response({'kind': 'interested or pass'}, status=status.HTTP_400_BAD_REQUEST)
        target = rules.visible_profiles().filter(pk=pk).select_related('user').first()
        if target is None or not rules.can_view(me, target) or target.pk == me.pk:
            return Response(status=status.HTTP_404_NOT_FOUND)
        already = SinglesInterest.objects.filter(from_profile=me, to_profile=target).first()
        if already is None and rules.answered_today(me) >= rules.DAILY_NEW:
            return Response({'code': 'daily_limit', 'left_today': 0}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        SinglesInterest.objects.update_or_create(from_profile=me, to_profile=target, defaults={'kind': kind})
        rules.signal(me, 'interest' if kind == SinglesInterest.INTERESTED else 'pass', target)
        _seen(me)
        rules.drop_hub(me.pk, target.pk)
        if kind == SinglesInterest.INTERESTED and _too_fast(me):
            return Response({'code': 'slow_down'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        match = None
        if kind == SinglesInterest.INTERESTED and SinglesInterest.objects.filter(
                from_profile=target, to_profile=me, kind=SinglesInterest.INTERESTED).exists():
            match = _make_match(me, target)
        return Response({
            'matched': match is not None,
            'match': _match_json(match, me) if match else None,
            'left_today': max(0, rules.DAILY_NEW - rules.answered_today(me)),
        })


def _too_fast(me):
    """Very many interests in an hour: likely a script or a scammer. The
    profile goes back for review (hidden meanwhile) and the admins see why."""
    from datetime import timedelta
    from ..models import SinglesInterest
    hour = timezone.now() - timedelta(hours=1)
    n = SinglesInterest.objects.filter(from_profile=me, kind=SinglesInterest.INTERESTED, created_at__gte=hour).count()
    if n < rules.FAST_INTERESTS:
        return False
    SinglesProfile.objects.filter(pk=me.pk).update(
        status=SinglesProfile.PENDING, review_note='Automatic: very many interests in an hour.',
        submitted_at=timezone.now())
    rules.notify_reviewers('flag', 'A Single & Searching profile was flagged automatically — please review.')
    return True


class SinglesMatchesView(APIView):
    """GET /api/singles/matches/ — your matches, newest first (ended ones
    are left out)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from ..models import SinglesMatch, blocked_ids_for
        _require_on()
        me = _mine(request.user)
        qs = (SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), ended_at__isnull=True)
              .select_related('profile_a__user', 'profile_b__user')
              .prefetch_related('profile_a__photos', 'profile_b__photos').order_by('-created_at'))
        blocked = blocked_ids_for(request.user)
        rows = [m for m in qs if m.other(me).user_id not in blocked
                and m.other(me).status != SinglesProfile.BANNED]
        return Response({'results': [_match_json(m, me) for m in rows]})


class SinglesUnmatchView(APIView):
    """POST /api/singles/matches/<id>/unmatch/ — ends it for both. The chat
    stays (for a report) but no one can write in it; it leaves both inboxes."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _mine(request.user)
        match = _end_match(me, pk=pk, by=request.user)
        if match is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response({'ended': True})


def _end_match(me, pk=None, other=None, by=None):
    from ..models import ConversationState, SinglesMatch
    qs = SinglesMatch.objects.filter(Q(profile_a=me) | Q(profile_b=me), ended_at__isnull=True)
    if pk is not None:
        qs = qs.filter(pk=pk)
    if other is not None:
        qs = qs.filter(Q(profile_a=other) | Q(profile_b=other))
    match = qs.first()
    if match is None:
        return None
    match.ended_at, match.ended_by = timezone.now(), by
    match.save(update_fields=['ended_at', 'ended_by'])
    # Both sides' menu counts (the Singles badge) change at once.
    from ..messaging import forget_unread
    forget_unread([match.profile_a.user_id, match.profile_b.user_id])
    if match.conversation_id:
        ConversationState.objects.filter(conversation_id=match.conversation_id).update(archived=True)
    return match


def _end_all_matches(profile, by=None):
    """Leaving or a ban ends every match: their chats close for both."""
    while _end_match(profile, by=by) is not None:
        pass


# ── Phase 3: report and block ───────────────────────────────────────────────
REPORT_REASONS = ('fake', 'scam', 'inappropriate', 'harassment', 'underage', 'married', 'other')


class SinglesReportView(APIView):
    """POST /api/singles/profiles/<id>/report/ {reason, description, block?}.
    Goes to the admins' reports queue as 'singlesprofile'. Enough different
    people reporting a profile sends it back for review at once."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from ..models import Report
        _require_on()
        me = _mine(request.user)
        target = SinglesProfile.objects.filter(pk=pk).select_related('user').first()
        if target is None or target.pk == me.pk or not rules.can_view(me, target):
            return Response(status=status.HTTP_404_NOT_FOUND)
        reason = request.data.get('reason')
        if reason not in REPORT_REASONS:
            return Response({'reason': f'One of {list(REPORT_REASONS)}.'}, status=status.HTTP_400_BAD_REQUEST)
        description = (request.data.get('description') or '').strip()[:1000]
        # The Report model's reasons are the app-wide set; the singles reason
        # rides in the description so the reviewer sees it.
        Report.objects.get_or_create(
            reporter=request.user, content_type='singlesprofile', object_id=target.pk,
            defaults={'reason': 'other', 'description': f'[{reason}] {description}'.strip()})
        rules.signal(me, 'report', target)
        open_reports = (Report.objects.filter(content_type='singlesprofile', object_id=target.pk, status='pending')
                        .values('reporter').distinct().count())
        if open_reports >= rules.REPORTS_TO_PAUSE and target.status == target.APPROVED:
            SinglesProfile.objects.filter(pk=target.pk).update(
                status=SinglesProfile.PENDING, submitted_at=timezone.now(),
                review_note=f'Automatic: reported by {open_reports} people.')
            rules.notify_reviewers('flag', 'A Single & Searching profile was reported by several people — please review.')
        if request.data.get('block'):
            _block(request.user, me, target)
        return Response({'reported': True}, status=status.HTTP_201_CREATED)


def _block(user, me, target):
    from ..models import Block
    Block.objects.get_or_create(blocker=user, blocked=target.user)
    rules.signal(me, 'block', target)
    _end_match(me, other=target, by=user)


class SinglesBlockView(APIView):
    """POST /api/singles/profiles/<id>/block/ — the app-wide block (they
    disappear everywhere, both ways), and any match between you ends."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        _require_on()
        me = _mine(request.user)
        target = SinglesProfile.objects.filter(pk=pk).select_related('user').first()
        if target is None or target.pk == me.pk:
            return Response(status=status.HTTP_404_NOT_FOUND)
        _block(request.user, me, target)
        return Response({'blocked': True})
