"""Publishing phase 5: the Author Studio (how a book is read) and book clubs.

Analytics are totals only — how many, how long, how far — never who. The
reading behind them is ReadingActivity (a row per reader per chapter per
day); the author's and collaborators' own reading is left out. With very few
readers a total can point at a person, so the answer says so (`few_readers`)
and the app shows it as "early days" rather than as trends.

Book clubs are Groups (their membership and chat) reading one book on a plan:
"up to chapter N by this date". How far the members have got is shown as a
count per step ("8 of 12 are there"), not person by person.
"""
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Avg, Count, Max, Q, Sum
from django.utils import timezone

from .models import (
    BookClub, BookClubMilestone, BookHighlight, BookReview, ChapterComment, Group, GroupMember, Publication,
    PublicationBookmark, PublicationCollaborator, PublicationLike, ReadingActivity, ReadingProgress, User,
)
from .publishing import reader_chapters

FEW_READERS = 5
CACHE_TTL = 5 * 60
RANGES = (7, 30, 90)


def _writers(pub):
    """The author and collaborators: their own reading isn't readership."""
    ids = set(PublicationCollaborator.objects.filter(publication=pub).values_list('user_id', flat=True))
    ids.add(pub.author_id)
    return ids


def book_analytics(pub, days=30, today=None):
    days = days if days in RANGES else 30
    key = f'books:analytics:{pub.pk}:{days}:{pub.updated_at.timestamp() if pub.updated_at else 0}'
    got = cache.get(key)
    if got is not None:
        return got
    today = today or timezone.localdate()
    since = today - timedelta(days=days - 1)
    writers = _writers(pub)
    act = ReadingActivity.objects.filter(publication=pub).exclude(user_id__in=writers)
    window = act.filter(day__gte=since, day__lte=today)
    progress = ReadingProgress.objects.filter(publication=pub).exclude(user_id__in=writers)

    chapters = list(reader_chapters(pub, None).values_list('pk', 'title'))
    readers_all = act.values('user').distinct().count()
    started = progress.count() or readers_all
    finished = progress.filter(finished_at__isnull=False).count()

    per_day = dict(window.values('day').annotate(n=Count('user', distinct=True)).values_list('day', 'n'))
    seconds = window.aggregate(s=Sum('seconds'))['s'] or 0
    window_readers = window.values('user').distinct().count()

    # How far readers get: readers who were in each chapter (all time) …
    reached = dict(act.values('chapter_index').annotate(n=Count('user', distinct=True)).values_list('chapter_index', 'n'))
    funnel = [{'index': i, 'title': title or '', 'readers': reached.get(i, 0)} for i, (_, title) in enumerate(chapters)]
    # … and where those who haven't finished stopped: their furthest chapter.
    not_done = progress.filter(finished_at__isnull=True).values_list('user_id', flat=True)
    furthest = (act.filter(user_id__in=list(not_done)).values('user').annotate(m=Max('chapter_index'))
                .values_list('m', flat=True))
    stops = {}
    for m in furthest:
        if m < len(chapters) - 1:                  # not stopped if they're on the last chapter
            stops[m] = stops.get(m, 0) + 1
    most_left = max(stops.items(), key=lambda kv: (kv[1], -kv[0]))[0] if stops else None

    reviews = BookReview.objects.filter(publication=pub, is_removed=False).aggregate(a=Avg('rating'), n=Count('pk'))
    out = {
        'days': days,
        'few_readers': readers_all < FEW_READERS,
        'readers': window_readers,
        'readers_all_time': readers_all,
        'started': started,
        'finished': finished,
        'completion': round(finished / started, 3) if started else None,
        'reading_seconds': seconds,
        'avg_seconds_per_reader': round(seconds / window_readers) if window_readers else 0,
        'daily': [{'day': (since + timedelta(days=i)).isoformat(), 'readers': per_day.get(since + timedelta(days=i), 0)}
                  for i in range(days)],
        'funnel': funnel,
        'most_left_after': ({'index': most_left, 'title': chapters[most_left][1] or '', 'readers': stops[most_left]}
                            if most_left is not None else None),
        'likes': PublicationLike.objects.filter(publication=pub).count(),
        'saves': PublicationBookmark.objects.filter(publication=pub).count(),
        'highlights': BookHighlight.objects.filter(publication=pub, deleted=False).exclude(user_id__in=writers).count(),
        'comments': ChapterComment.objects.filter(publication=pub, is_removed=False).count(),
        'rating_avg': round(reviews['a'], 1) if reviews['a'] is not None else None,
        'rating_count': reviews['n'],
    }
    cache.set(key, out, CACHE_TTL)
    return out


def author_overview(user, days=30, today=None):
    """All of an author's books at a glance: totals, readers per day across
    them, and a row per book."""
    days = days if days in RANGES else 30
    today = today or timezone.localdate()
    since = today - timedelta(days=days - 1)
    books = list(Publication.objects.filter(author=user, is_removed=False).order_by('-published_at', '-created_at'))
    ids = [b.pk for b in books]
    act = (ReadingActivity.objects.filter(publication_id__in=ids).exclude(user=user)
           .exclude(user_id__in=PublicationCollaborator.objects.filter(publication_id__in=ids).values('user_id')))
    window = act.filter(day__gte=since, day__lte=today)
    per_day = dict(window.values('day').annotate(n=Count('user', distinct=True)).values_list('day', 'n'))
    by_book = {r['publication']: r for r in window.values('publication').annotate(
        readers=Count('user', distinct=True), seconds=Sum('seconds'))}
    finished = dict(ReadingProgress.objects.filter(publication_id__in=ids, finished_at__isnull=False)
                    .exclude(user=user).values('publication').annotate(n=Count('pk')).values_list('publication', 'n'))
    started = dict(ReadingProgress.objects.filter(publication_id__in=ids).exclude(user=user)
                   .values('publication').annotate(n=Count('pk')).values_list('publication', 'n'))
    from . import media
    rows = [{
        'id': b.pk, 'title': b.title, 'status': b.status, 'cover': media.resolve(b.cover) or '',
        'readers': (by_book.get(b.pk) or {}).get('readers', 0),
        'reading_seconds': (by_book.get(b.pk) or {}).get('seconds') or 0,
        'finished': finished.get(b.pk, 0),
        'completion': round(finished.get(b.pk, 0) / started[b.pk], 3) if started.get(b.pk) else None,
    } for b in books]
    readers_all = act.values('user').distinct().count()
    return {
        'days': days,
        'few_readers': readers_all < FEW_READERS,
        'readers': window.values('user').distinct().count(),
        'reading_seconds': window.aggregate(s=Sum('seconds'))['s'] or 0,
        'finished': sum(finished.values()),
        'followers': user.followers.count(),
        'books': rows,
        'daily': [{'day': (since + timedelta(days=i)).isoformat(), 'readers': per_day.get(since + timedelta(days=i), 0)}
                  for i in range(days)],
    }


# ── Book clubs ───────────────────────────────────────────────────────────────

def plan(chapter_count, starts_on, chapters_per_step=1, every_days=7):
    """The reading plan: [(through_chapter, due)] — `chapters_per_step`
    chapters every `every_days` days until the book is done."""
    chapters_per_step = max(1, int(chapters_per_step))
    every_days = max(1, int(every_days))
    out, through, step = [], -1, 0
    while through < chapter_count - 1:
        step += 1
        through = min(chapter_count - 1, through + chapters_per_step)
        out.append((through, starts_on + timedelta(days=step * every_days - 1)))
    return out


@transaction.atomic
def create_club(user, pub, name, is_private=True, starts_on=None, chapters_per_step=1, every_days=7):
    starts_on = starts_on or timezone.localdate()
    group = Group.objects.create(creator=user, kind=Group.KIND_GROUP, name=name[:100],
                                 description=f'Reading “{pub.title}” together.', is_private=is_private)
    GroupMember.objects.create(group=group, user=user, is_admin=True)
    club = BookClub.objects.create(group=group, publication=pub, created_by=user, starts_on=starts_on)
    count = reader_chapters(pub, None).count()
    BookClubMilestone.objects.bulk_create([
        BookClubMilestone(club=club, through_chapter=t, due=d)
        for t, d in plan(count, starts_on, chapters_per_step, every_days)
    ])
    return club


def club_summary(club, user, today=None):
    """The club's page: the book, the plan with this step marked, how many
    members are where the plan says (totals), and the viewer's own place."""
    today = today or timezone.localdate()
    members = list(GroupMember.objects.filter(group=club.group).values_list('user_id', flat=True))
    rp = {r['user_id']: r for r in ReadingProgress.objects.filter(publication=club.publication, user_id__in=members)
          .values('user_id', 'last_chapter', 'finished_at', 'percent')}
    furthest = dict(ReadingActivity.objects.filter(publication=club.publication, user_id__in=members)
                    .values('user').annotate(m=Max('chapter_index')).values_list('user', 'm'))

    def reached(uid, through):
        r = rp.get(uid)
        if r and r['finished_at']:
            return True
        return max(furthest.get(uid, -1), r['last_chapter'] if r else -1) >= through

    steps = []
    current = None
    for m in club.milestones.all():
        state = 'done' if m.due < today else 'upcoming'
        if current is None and m.due >= today:
            current, state = m.pk, 'current'
        steps.append({'through_chapter': m.through_chapter, 'due': m.due.isoformat(), 'state': state,
                      'members_there': sum(1 for u in members if reached(u, m.through_chapter))})
    mine = rp.get(getattr(user, 'id', None))
    g = club.group
    return {
        'id': club.pk,
        'group': {'id': g.pk, 'slug': g.slug, 'name': g.name, 'is_private': g.is_private},
        'publication': club.publication_id,
        'starts_on': club.starts_on.isoformat(),
        'members': len(members),
        'is_member': getattr(user, 'id', None) in members,
        'finished_members': sum(1 for u in members if (rp.get(u) or {}).get('finished_at')),
        'plan': steps,
        'my_percent': (mine or {}).get('percent'),
    }


def clubs_for(user, pub):
    """Clubs reading this book the user can see: theirs, and public ones."""
    mine = GroupMember.objects.filter(user_id=getattr(user, 'id', None)).values('group_id')
    return (BookClub.objects.filter(publication=pub, group__is_removed=False)
            .filter(Q(group__is_private=False) | Q(group_id__in=mine))
            .select_related('group', 'publication'))
