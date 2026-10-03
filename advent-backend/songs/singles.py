"""Single & Searching: who may join, and what a profile may hold.

- Who: 18 or over (by a birth date set once), email verified, not suspended or
  deactivated, an account at least a week old, and not banned from here.
- Contact details never reach a profile: phone numbers, emails, links and
  @handles are taken out of everything a person writes, because the first
  move of a scam is to take someone off the app.
- Prompts are a fixed set, so they can be translated and compared.
- The whole part can be switched off by an admin; members then get 403
  {code: 'feature_off'} (admins can still review).
"""
import re
from datetime import date, timedelta

from django.utils import timezone

from . import app_settings

MIN_AGE = 18
MAX_AGE = 100
MIN_ACCOUNT_DAYS = 7
MAX_PHOTOS = 4
MAX_PROMPTS = 3
MAX_LIST = {'languages': 5, 'interests': 8}
LIST_ITEM_LEN = 30
PROMPT_LEN = 200

PROMPTS = ('verse', 'sabbath', 'grateful', 'serve', 'laugh', 'home', 'working_toward', 'ministry_hope', 'three_happy')

# Reasons a person can't join yet, as stable codes the app words itself.
NOT_VERIFIED = 'email_not_verified'
SUSPENDED = 'suspended'
TOO_NEW = 'account_too_new'
BANNED = 'banned'


def feature_on():
    return app_settings.status()['features'].get('singles', True)


def age_on(birth, today=None):
    today = today or timezone.localdate()
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def verification_required():
    """Email verification is only asked for once the app sends email
    (settings.REQUIRE_EMAIL_VERIFICATION). Until then the app treats everyone
    as verified (views/auth.AuthStatusView) — and so must this, or nobody
    could ever join: there would be no way to verify."""
    from django.conf import settings
    return bool(getattr(settings, 'REQUIRE_EMAIL_VERIFICATION', False))


def email_ok(user):
    return bool(user.is_email_verified) or not verification_required()


def blockers(user, now=None):
    """Why this person can't use Single & Searching yet ([] when they can).
    Age is checked when they give their birth date, not here. Admins are
    trusted accounts: the email and new-account checks don't apply to them."""
    now = now or timezone.now()
    out = []
    admin = bool(getattr(user, 'is_platform_admin', False))
    if not admin and not email_ok(user):
        out.append(NOT_VERIFIED)
    if user.is_suspended or user.is_deactivated:
        out.append(SUSPENDED)
    if not admin and user.date_joined and user.date_joined > now - timedelta(days=MIN_ACCOUNT_DAYS):
        out.append(TOO_NEW)
    from .models import SinglesProfile
    if SinglesProfile.objects.filter(user=user, status=SinglesProfile.BANNED).exists():
        out.append(BANNED)
    return out


def ready_on(user):
    """When a too-new account becomes old enough (for "you can join on …")."""
    return (user.date_joined + timedelta(days=MIN_ACCOUNT_DAYS)).date() if user.date_joined else None


# ── Contact details out ─────────────────────────────────────────────────────
_URL = re.compile(r'(https?://\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|co|ke|tz|ug|io|me|ly|app|info|biz)\b\S*)',
                  re.IGNORECASE)
_EMAIL = re.compile(r'\S+@\S+\.\S+')
_HANDLE = re.compile(r'(?<![\w@])@\w{2,}')
# Seven or more digits, with only spaces, dashes, dots or brackets between —
# a phone number. Bible references ("Isaiah 41:10", "1 Cor 13:4-7") break
# the run with a colon or a word, so they stay.
_PHONE = re.compile(r'\+?\d(?:[\s\-.()]*\d){6,}')
_SPACES = re.compile(r'[ \t]{2,}')


def clean(text, limit=None):
    """`text` with contact details taken out, trimmed (and cut to `limit`)."""
    text = str(text or '')
    for pattern in (_URL, _EMAIL, _HANDLE, _PHONE):
        text = pattern.sub('', text)
    text = _SPACES.sub(' ', text)
    text = '\n'.join(line.strip() for line in text.splitlines()).strip()
    return text[:limit] if limit else text


def clean_list(values, field):
    """A short list of short words (languages, interests), cleaned and unique."""
    if not isinstance(values, list):
        raise ValueError(f'{field}: a list')
    out = []
    for v in values:
        v = clean(v, LIST_ITEM_LEN)
        if v and v.lower() not in (x.lower() for x in out):
            out.append(v)
    if len(out) > MAX_LIST[field]:
        raise ValueError(f'{field}: at most {MAX_LIST[field]}')
    return out


def clean_prompts(values):
    """[{key, answer}] → the same, cleaned: known keys, once each, at most three."""
    if not isinstance(values, list):
        raise ValueError('prompts: a list')
    out, seen = [], set()
    for item in values:
        key = (item or {}).get('key') if isinstance(item, dict) else None
        if key not in PROMPTS:
            raise ValueError(f'prompts: key must be one of {list(PROMPTS)}')
        if key in seen:
            raise ValueError('prompts: each once')
        answer = clean(item.get('answer'), PROMPT_LEN)
        if answer:
            seen.add(key)
            out.append({'key': key, 'answer': answer})
    if len(out) > MAX_PROMPTS:
        raise ValueError(f'prompts: at most {MAX_PROMPTS}')
    return out


def check_birth_date(value):
    """A date (or 'YYYY-MM-DD') of someone 18 to 100 → the date; else ValueError."""
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value)
        except ValueError:
            raise ValueError('birth_date: YYYY-MM-DD') from None
    if not isinstance(value, date):
        raise ValueError('birth_date: YYYY-MM-DD')
    age = age_on(value)
    if age < MIN_AGE:
        raise ValueError('under_18')
    if age > MAX_AGE:
        raise ValueError('birth_date: not a real age')
    return value


def missing_for_review(profile):
    """What a profile still needs before it can be sent for review."""
    need = []
    if not profile.first_name:
        need.append('first_name')
    if not profile.country:
        need.append('country')
    if not profile.photos.exclude(status='rejected').exists():
        need.append('photo')
    if not profile.about and not profile.prompts:
        need.append('about_or_prompt')
    return need


# ── Discover (phase 2) ──────────────────────────────────────────────────────
DAILY_NEW = 20            # new profiles a day: read them, don't race through them
BATCH = 5                 # profiles sent at a time
FAST_INTERESTS = 60       # this many interests in an hour looks like a script or a scam
REPORTS_TO_PAUSE = 3      # this many people reporting a profile sends it back for review


def opposite(gender):
    from .models import SinglesProfile
    return SinglesProfile.WOMAN if gender == SinglesProfile.MAN else SinglesProfile.MAN


def visible_profiles():
    """Profiles anyone may be shown: approved, not paused, with an approved
    photo, on an account in good standing."""
    from django.db.models import Exists, OuterRef
    from .models import SinglesPhoto, SinglesProfile
    photo = SinglesPhoto.objects.filter(profile=OuterRef('pk'), status=SinglesPhoto.APPROVED)
    qs = (SinglesProfile.objects
          .filter(status=SinglesProfile.APPROVED, is_paused=False,
                  user__is_active=True, user__is_deactivated=False, user__is_suspended=False)
          .filter(Exists(photo)))
    if verification_required():
        # Admins never had to verify (see blockers), so they stay visible.
        from django.db.models import Q
        qs = qs.filter(Q(user__is_email_verified=True) | Q(user__admin_role__in=('moderator', 'super_admin'))
                       | Q(user__is_superuser=True) | Q(user__role__isnull=False))
    return qs


def candidates(me, filters=None):
    """Who `me` may be shown next in Discover: the opposite gender, visible,
    not blocked either way, not already answered by me, not matched with me,
    and not someone who said "not now" to me (showing them is no kindness).
    Most recently active first, then those who share my country, church or
    a language."""
    from django.db.models import Case, IntegerField, Q, Value, When
    from .models import SinglesInterest, SinglesMatch, blocked_ids_for
    filters = filters or {}
    qs = visible_profiles().filter(gender=opposite(me.gender)).exclude(pk=me.pk)
    blocked = blocked_ids_for(me.user)
    if blocked:
        qs = qs.exclude(user_id__in=blocked)
    answered = SinglesInterest.objects.filter(from_profile=me).values('to_profile_id')
    passed_me = SinglesInterest.objects.filter(to_profile=me, kind=SinglesInterest.PASS).values('from_profile_id')
    matched_a = SinglesMatch.objects.filter(profile_a=me).values('profile_b_id')
    matched_b = SinglesMatch.objects.filter(profile_b=me).values('profile_a_id')
    qs = (qs.exclude(pk__in=answered).exclude(pk__in=passed_me)
          .exclude(pk__in=matched_a).exclude(pk__in=matched_b))
    # Incognito: shown only to the people they have shown interest in.
    liked_me = SinglesInterest.objects.filter(to_profile=me, kind=SinglesInterest.INTERESTED).values('from_profile_id')
    qs = qs.filter(Q(discoverable='everyone') | Q(pk__in=liked_me))

    today = timezone.localdate()
    if filters.get('min_age'):
        latest = _shift_years(today, int(filters['min_age']))
        qs = qs.filter(birth_date__lte=latest)
    if filters.get('max_age'):
        earliest = _shift_years(today, int(filters['max_age']) + 1) + timedelta(days=1)
        qs = qs.filter(birth_date__gte=earliest)
    if filters.get('country'):
        qs = qs.filter(country__iexact=filters['country'])
    if filters.get('baptised') in ('yes', 'not_yet'):
        qs = qs.filter(baptised=filters['baptised'])
    if filters.get('looking_for'):
        qs = qs.filter(looking_for=filters['looking_for'])

    shared = Value(0)
    near = Case(When(country__iexact=me.country, then=Value(2)), default=Value(0), output_field=IntegerField())
    church = (Case(When(church__iexact=me.church, then=Value(1)), default=Value(0), output_field=IntegerField())
              if me.church else shared)
    qs = qs.annotate(near=near, same_church=church)
    language = filters.get('language')
    if language:
        # JSON contains is not on every database; the list is short, so a
        # text match on its stored form is enough.
        qs = qs.filter(languages__icontains=language)
    # Photos and values answers come in two queries for the whole page, not
    # one per profile.
    return qs.select_related('user').prefetch_related('photos', 'answers').order_by(
        '-near', '-same_church', '-last_active_at', '-id')


def _shift_years(d, years):
    try:
        return d.replace(year=d.year - years)
    except ValueError:      # 29 February
        return d.replace(year=d.year - years, day=28)


def answered_today(me):
    from .models import SinglesInterest
    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    return SinglesInterest.objects.filter(from_profile=me, created_at__gte=start).count()


def can_view(viewer, target):
    """May `viewer` open `target`'s profile? Their own; someone they are or
    were matched with; or anyone visible of the opposite gender."""
    from django.db.models import Q
    from .models import SinglesInterest, SinglesMatch, is_blocked_between
    if viewer.pk == target.pk:
        return True
    if is_blocked_between(viewer.user, target.user):
        return False
    if SinglesMatch.objects.filter(Q(profile_a=viewer, profile_b=target) | Q(profile_a=target, profile_b=viewer)).exists():
        return True
    if not visible_profiles().filter(pk=target.pk).exists() or target.gender == viewer.gender:
        return False
    if target.discoverable == target.LIKED_ONLY:
        return SinglesInterest.objects.filter(from_profile=target, to_profile=viewer,
                                              kind=SinglesInterest.INTERESTED).exists()
    return True


def opener(profile):
    """A way to begin, from what they wrote — never sent for anyone."""
    for item in profile.prompts or []:
        return {'kind': 'prompt', 'key': item['key'], 'answer': item['answer']}
    if profile.interests:
        return {'kind': 'interest', 'value': profile.interests[0]}
    if profile.church:
        return {'kind': 'church', 'value': profile.church}
    return {'kind': 'general'}


# ── Phase 7: deeper profiles ────────────────────────────────────────────────
MINISTRIES = ('youth', 'music', 'bible_study', 'health', 'community', 'children', 'media', 'prayer',
              'evangelism', 'hospitality')
MAX_MINISTRIES = 5

# Values questions: each with its fixed answers (worded in the app). Optional,
# answered over time, and each shown only if its owner chooses.
VALUES = {
    'family_worship': ('very', 'somewhat', 'not_much'),
    'relocate': ('yes', 'maybe', 'no'),
    'children': ('want', 'open', 'not_for_me', 'have'),
    'finances': ('plan_together', 'separate', 'not_sure'),
    'conflict': ('talk_it_out', 'need_time', 'write_it'),
    'career': ('career_first', 'balance', 'family_first'),
    'health': ('very', 'some', 'little'),
    'serve_together': ('yes', 'maybe', 'no'),
}


def clean_ministries(values):
    if not isinstance(values, list):
        raise ValueError('ministries: a list')
    out = []
    for v in values:
        if v not in MINISTRIES:
            raise ValueError(f'ministries: one of {list(MINISTRIES)}')
        if v not in out:
            out.append(v)
    if len(out) > MAX_MINISTRIES:
        raise ValueError(f'ministries: at most {MAX_MINISTRIES}')
    return out


# ── Phase 8: the discovery engine ───────────────────────────────────────────
ONLINE_MINUTES = 15
NEW_DAYS = 30
POOL = 300           # candidates scored for For You (most recently active first)
PAGE = 20
MODES = ('foryou', 'new', 'nearby', 'online')


def _lower_set(values):
    return {str(v).strip().lower() for v in (values or []) if str(v).strip()}


def reasons_for(me, other):
    """Why `other` is suggested to `me`, in plain facts the app words — never
    a compatibility percentage. Most telling first."""
    out = []
    shared_ministries = [m for m in (other.ministries or []) if m in (me.ministries or [])]
    if shared_ministries:
        out.append({'kind': 'ministries', 'values': shared_ministries[:3]})
    mine = _lower_set(me.interests)
    shared_interests = [i for i in (other.interests or []) if i.strip().lower() in mine]
    if shared_interests:
        out.append({'kind': 'interests', 'values': shared_interests[:3]})
    if other.looking_for == me.looking_for:
        out.append({'kind': 'intent', 'value': other.looking_for})
    if me.church and other.church and me.church.strip().lower() == other.church.strip().lower():
        out.append({'kind': 'church', 'value': other.church})
    elif me.town and other.town and other.show_town and me.town.strip().lower() == other.town.strip().lower():
        out.append({'kind': 'town', 'value': other.town})
    shared_languages = [x for x in (other.languages or []) if x.strip().lower() in _lower_set(me.languages)]
    if shared_languages:
        out.append({'kind': 'languages', 'values': shared_languages[:2]})
    agreed = _agreed_values(me, other)
    if agreed:
        out.append({'kind': 'values', 'values': agreed[:2]})
    return out


def _agreed_values(me, other):
    """Values questions both answered alike — counted only where both chose
    to show their answer."""
    mine = getattr(me, '_answers', None)
    theirs = getattr(other, '_answers', None)
    if mine is None or theirs is None:
        return []
    return [k for k, a in theirs.items() if mine.get(k) == a]


WEIGHTS = {'ministries': 4, 'interests': 3, 'intent': 3, 'church': 3, 'town': 2, 'languages': 1, 'values': 2}


def score(me, other, now=None):
    """Shared things count; being around recently counts a little; a verified
    photo a little. Activity is a tie-breaker, not the point."""
    now = now or timezone.now()
    total = sum(WEIGHTS[r['kind']] * (len(r.get('values', [])) or 1) for r in reasons_for(me, other))
    if other.last_active_at:
        days = (now - other.last_active_at).days
        total += max(0, 3 - days // 2)
    if other.photo_verified_at:
        total += 1
    return total


def _with_answers(profiles):
    """Load each profile's visible values answers onto it (one query)."""
    from .models import SinglesAnswer
    by = {}
    for row in SinglesAnswer.objects.filter(profile__in=profiles, visible=True).values('profile_id', 'key', 'answer'):
        by.setdefault(row['profile_id'], {})[row['key']] = row['answer']
    for p in profiles:
        p._answers = by.get(p.pk, {})
    return profiles


def apply_preferences(qs, me):
    """The person's saved "who I'd like to see"."""
    today = timezone.localdate()
    if me.pref_min_age:
        qs = qs.filter(birth_date__lte=_shift_years(today, me.pref_min_age))
    if me.pref_max_age:
        qs = qs.filter(birth_date__gte=_shift_years(today, me.pref_max_age + 1) + timedelta(days=1))
    if me.pref_countries:
        from django.db.models import Q
        cond = Q()
        for c in me.pref_countries:
            cond |= Q(country__iexact=c)
        qs = qs.filter(cond)
    if me.pref_intents:
        qs = qs.filter(looking_for__in=me.pref_intents)
    return qs


def browse(me, mode='foryou', filters=None, page=1):
    """A page of profiles for the grid. For You is ranked by shared things and
    explained; New, Nearby and Online are what they say."""
    qs = candidates(me, filters)
    if mode == 'foryou':
        qs = apply_preferences(qs, me)
        pool = _with_answers(list(qs.order_by('-last_active_at', '-id')[:POOL]))
        _with_answers([me])
        now = timezone.now()
        ranked = sorted(pool, key=lambda o: (-score(me, o, now), -(o.last_active_at.timestamp() if o.last_active_at else 0)))
        start = (page - 1) * PAGE
        return ranked[start:start + PAGE], len(ranked) > start + PAGE
    if mode == 'new':
        qs = qs.filter(approved_at__gte=timezone.now() - timedelta(days=NEW_DAYS)).order_by('-approved_at', '-id')
    elif mode == 'nearby':
        if me.town:
            qs = qs.filter(town__iexact=me.town, show_town=True)
        else:
            qs = qs.filter(country__iexact=me.country)
        qs = qs.order_by('-last_active_at', '-id')
    elif mode == 'online':
        qs = qs.filter(show_online=True, last_active_at__gte=timezone.now() - timedelta(minutes=ONLINE_MINUTES))
        qs = qs.order_by('-last_active_at', '-id')
    start = (page - 1) * PAGE
    rows = list(qs[start:start + PAGE + 1])
    _with_answers(rows)
    _with_answers([me])
    return rows[:PAGE], len(rows) > PAGE


def is_online(profile, now=None):
    now = now or timezone.now()
    return bool(profile.show_online and profile.last_active_at
                and profile.last_active_at >= now - timedelta(minutes=ONLINE_MINUTES))


def signal(profile, kind, target=None):
    from .models import SinglesSignal
    try:
        SinglesSignal.objects.create(profile=profile, target=target, kind=kind)
    except Exception:  # noqa: BLE001 — a lost signal never fails what the person did
        pass


# ── Phase 9: conversation ───────────────────────────────────────────────────
ICEBREAKERS = ('country_visit', 'bible_character', 'gospel_song', 'five_years', 'quality_value',
               'childhood_memory', 'sabbath_meal', 'favourite_hymn')
ICEBREAKER_LEN = 300


def starters(profile):
    """Ways to begin, from what they wrote — suggestions the person sends in
    their own words, never sent for them."""
    out = []
    for item in (profile.prompts or [])[:2]:
        out.append({'kind': 'prompt', 'key': item['key'], 'answer': item['answer']})
    for m in (profile.ministries or [])[:1]:
        out.append({'kind': 'ministry', 'value': m})
    for i in (profile.interests or [])[:1]:
        out.append({'kind': 'interest', 'value': i})
    if profile.church:
        out.append({'kind': 'church', 'value': profile.church})
    out.append({'kind': 'meaningful'})
    return out[:5]


# ── Phase 11: verification and risk ─────────────────────────────────────────
GESTURES = ('thumbs_up', 'peace', 'wave', 'hand_on_chin')


def risk(profile):
    """What an admin should notice about a profile, as a score and its
    reasons. Signals, not a verdict."""
    from .models import Report, SinglesSignal
    reasons = []
    reports = Report.objects.filter(content_type='singlesprofile', object_id=profile.pk, status='pending').count()
    if reports:
        reasons.append({'kind': 'reports', 'n': reports})
    blocks = SinglesSignal.objects.filter(target=profile, kind='block').count()
    if blocks:
        reasons.append({'kind': 'blocked_by', 'n': blocks})
    links = SinglesSignal.objects.filter(profile=profile, kind='link_shared').count()
    if links:
        reasons.append({'kind': 'links_shared', 'n': links})
    days = (timezone.now() - profile.user.date_joined).days if profile.user.date_joined else 0
    if days < 30:
        reasons.append({'kind': 'new_account', 'n': days})
    if profile.user.strikes:
        reasons.append({'kind': 'strikes', 'n': profile.user.strikes})
    if (profile.review_note or '').startswith('Automatic'):
        reasons.append({'kind': 'auto_flag'})
    if not profile.photo_verified_at:
        reasons.append({'kind': 'unverified'})
    weights = {'reports': 3, 'blocked_by': 2, 'links_shared': 1, 'new_account': 1, 'strikes': 2, 'auto_flag': 3,
               'unverified': 0}
    total = sum(weights[r['kind']] * max(1, min(5, r.get('n', 1))) for r in reasons)
    level = 'high' if total >= 8 else 'medium' if total >= 3 else 'low'
    return {'score': total, 'level': level, 'reasons': reasons}


CONTACT_PATTERNS = (_URL, _EMAIL, _PHONE)


def has_contact(text):
    return any(p.search(text or '') for p in CONTACT_PATTERNS)


# ── Phase 14: the hub, briefly cached ───────────────────────────────────────
HUB_SECONDS = 30


def hub_key(profile_id, mode):
    return f'singles:hub:{profile_id}:{mode}'


def drop_hub(*profile_ids):
    """Something changed for these people (an answer, a match): their hub is
    recomputed on the next open rather than up to 30 s later."""
    from django.core.cache import cache
    cache.delete_many([hub_key(pid, m) for pid in profile_ids if pid for m in MODES])
