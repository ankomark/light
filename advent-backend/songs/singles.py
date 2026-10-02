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

PROMPTS = ('verse', 'sabbath', 'grateful', 'serve', 'laugh', 'home')

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


def blockers(user, now=None):
    """Why this person can't use Single & Searching yet ([] when they can).
    Age is checked when they give their birth date, not here."""
    now = now or timezone.now()
    out = []
    if not user.is_email_verified:
        out.append(NOT_VERIFIED)
    if user.is_suspended or user.is_deactivated:
        out.append(SUSPENDED)
    if user.date_joined and user.date_joined > now - timedelta(days=MIN_ACCOUNT_DAYS):
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
    return (SinglesProfile.objects
            .filter(status=SinglesProfile.APPROVED, is_paused=False,
                    user__is_active=True, user__is_deactivated=False, user__is_suspended=False,
                    user__is_email_verified=True)
            .filter(Exists(photo)))


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
    return qs.select_related('user').prefetch_related('photos').order_by(
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
