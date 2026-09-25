"""Publishing phase 3: finding books and talking about them.

- How far a reader has got in a book (discussions warn of spoilers past it).
- Who may review a book: someone who has read some of it — not its author.
- Discover's sections: continue reading, editor's picks, trending (readers
  who finish count double — completion, not clicks), from authors you
  follow, new releases, rising authors (readers growing fastest, so new
  voices surface rather than the same few forever), and "because you
  highlighted…" — books near the one a reader last marked.
- Telling followers, savers and readers about a new book or chapter.
"""
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count, F, Max, Q
from django.utils import timezone

from .models import (
    BookHighlight, BookReview, Chapter, Publication, PublicationBookmark, ReadingActivity, ReadingProgress, User,
    blocked_ids_for,
)

REVIEW_MIN_PERCENT = 0.2       # read a fifth of a book before reviewing it
SECTION = 10
TRENDING_DAYS = 7
RISING_DAYS = 14
RISING_MIN_READERS = 3
GLOBAL_TTL = 10 * 60


# ── How far a reader has got ─────────────────────────────────────────────────

def reader_reach(user, publication):
    """The furthest chapter (index among readers' chapters) this user has
    been in — discussions up to it are spoiler-free for them. The author
    has read it all."""
    if not getattr(user, 'is_authenticated', False):
        return -1
    if publication.author_id == user.id:
        return 10 ** 6
    act = ReadingActivity.objects.filter(user=user, publication=publication).aggregate(m=Max('chapter_index'))['m']
    rp = ReadingProgress.objects.filter(user=user, publication=publication).values_list(
        'last_chapter', 'finished_at').first()
    if rp and rp[1]:
        return 10 ** 6                              # finished: nothing is a spoiler
    return max(act if act is not None else -1, rp[0] if rp else -1)


def review_eligibility(user, publication):
    """(may_review, reason): 'own', 'read_more', 'sign_in' or None."""
    if not getattr(user, 'is_authenticated', False):
        return False, 'sign_in'
    if publication.author_id == user.id:
        return False, 'own'
    rp = ReadingProgress.objects.filter(user=user, publication=publication).values_list('percent', 'finished_at').first()
    if rp and (rp[1] or rp[0] >= REVIEW_MIN_PERCENT):
        return True, None
    if BookReview.objects.filter(user=user, publication=publication).exists():
        return True, None                           # kept a review from before: may edit it
    return False, 'read_more'


# ── Discover ─────────────────────────────────────────────────────────────────

def _published():
    return Publication.objects.filter(status='published', is_removed=False).exclude(author__is_deactivated=True)


def trending_ids():
    """The week's most-read books: readers, with readers who finished
    counting twice. Shared by everyone; kept a few minutes."""
    ids = cache.get('books:trending')
    if ids is None:
        since = timezone.localdate() - timedelta(days=TRENDING_DAYS)
        rows = (ReadingActivity.objects.filter(day__gte=since, publication__in=_published())
                .values('publication')
                .annotate(readers=Count('user', distinct=True),
                          finishers=Count('user', filter=Q(finished=True), distinct=True))
                .order_by())
        ranked = sorted(rows, key=lambda r: (-(r['readers'] + 2 * r['finishers']), -r['publication']))
        ids = [r['publication'] for r in ranked[:50]]
        cache.set('books:trending', ids, GLOBAL_TTL)
    return ids


def rising_author_rows():
    """Authors whose readers grew most over the last two weeks against the two
    before — [{user_id, readers, growth}]. At least a few readers, so one
    friend doesn't make a trend."""
    rows = cache.get('books:rising')
    if rows is None:
        today = timezone.localdate()
        recent_from = today - timedelta(days=RISING_DAYS)
        prior_from = recent_from - timedelta(days=RISING_DAYS)

        def readers(start, end):
            # Authors reading their own books aren't readers of them.
            return dict(
                ReadingActivity.objects.filter(day__gte=start, day__lt=end, publication__in=_published())
                .exclude(user_id=F('publication__author'))
                .values('publication__author').annotate(n=Count('user', distinct=True))
                .values_list('publication__author', 'n'))
        recent = readers(recent_from, today + timedelta(days=1))
        prior = readers(prior_from, recent_from)
        rows = []
        for uid, n in recent.items():
            if n < RISING_MIN_READERS:
                continue
            before = prior.get(uid, 0)
            rows.append({'user_id': uid, 'readers': n, 'growth': (n - before) / max(1, before)})
        rows.sort(key=lambda r: (-r['growth'], -r['readers']))
        rows = rows[:20]
        cache.set('books:rising', rows, GLOBAL_TTL)
    return rows


def because_highlighted(user, visible):
    """Books near the one this reader last highlighted in: the same author's
    first, then the same kind of book (most read this week, then newest) —
    none they've started or wrote. → {quote, publication, title, ids} or None."""
    h = (BookHighlight.objects.filter(user=user, deleted=False, publication__in=visible)
         .exclude(publication__author=user).select_related('publication').order_by('-updated_at').first())
    if h is None:
        return None
    src = h.publication
    started = ReadingProgress.objects.filter(user=user).values('publication')
    near = visible.exclude(pk=src.pk).exclude(author=user).exclude(pk__in=started)
    same_kind = near.filter(category=src.category)
    trending = trending_ids()
    ranked = (
        list(near.filter(author_id=src.author_id).order_by('-published_at', '-id').values_list('id', flat=True)[:SECTION])
        + sorted(same_kind.filter(id__in=trending).values_list('id', flat=True), key=trending.index)
        + list(same_kind.order_by('-published_at', '-id').values_list('id', flat=True)[:SECTION])
    )
    ids = list(dict.fromkeys(ranked))[:SECTION]
    if not ids:
        return None
    return {'quote': h.quote[:160], 'publication': src.pk, 'title': src.title, 'ids': ids}


def home_sections(user):
    """Discover's sections as publication ids (and rising authors as rows);
    the view turns ids into cards in one query per section."""
    blocked = blocked_ids_for(user)
    visible = _published().exclude(author_id__in=blocked) if blocked else _published()
    authed = getattr(user, 'is_authenticated', False)

    def ids(qs, n=SECTION):
        return list(qs.values_list('id', flat=True)[:n])

    out = {
        'picks': ids(visible.filter(featured_at__isnull=False).order_by('-featured_at')),
        'new': ids(visible.order_by('-published_at', '-id')),
    }
    allowed = set(visible.filter(id__in=trending_ids()).values_list('id', flat=True))
    out['trending'] = [i for i in trending_ids() if i in allowed][:SECTION]
    if authed:
        out['continue'] = ids(
            visible.filter(progresses__user=user, progresses__finished_at__isnull=True)
            .order_by('-progresses__updated_at'), 6)
        follows = User.followers.through.objects.filter(to_user_id=user.id).values('from_user_id')
        out['following'] = ids(visible.filter(author_id__in=follows).order_by('-published_at', '-id'))
        out['because'] = because_highlighted(user, visible)
    else:
        out['continue'], out['following'], out['because'] = [], [], None
    rising = [r for r in rising_author_rows() if r['user_id'] not in blocked and r['user_id'] != getattr(user, 'id', None)]
    out['rising'] = rising[:SECTION]
    return out


# ── Telling readers ──────────────────────────────────────────────────────────

MAX_RECIPIENTS = 5000


def _audience(publication, include_readers):
    """Followers of the author — and for a new chapter, people who saved the
    book or are reading it. Never the author; never anyone blocked either way."""
    author = publication.author
    ids = set(User.followers.through.objects.filter(from_user_id=author.id).values_list('to_user_id', flat=True))
    if include_readers:
        ids |= set(PublicationBookmark.objects.filter(publication=publication).values_list('user_id', flat=True))
        ids |= set(ReadingProgress.objects.filter(publication=publication).values_list('user_id', flat=True))
    ids.discard(author.id)
    ids -= blocked_ids_for(author)
    return User.objects.filter(id__in=list(ids)[:MAX_RECIPIENTS], is_deactivated=False)


def notify_new_book(publication):
    from .push import notify_user
    for u in _audience(publication, include_readers=False):
        notify_user(u, 'new_book', f'{publication.author.username} published “{publication.title}”',
                    data={'type': 'publication', 'publication_id': publication.id})


def notify_new_chapters(publication, chapter_ids):
    from .push import notify_user
    chapters = list(Chapter.objects.filter(pk__in=chapter_ids).order_by('order'))
    if not chapters:
        return
    first = chapters[0]
    what = (f'“{first.title}”' if first.title else 'A new chapter') if len(chapters) == 1 else f'{len(chapters)} new chapters'
    for u in _audience(publication, include_readers=True):
        notify_user(u, 'new_chapter', f'{what} in “{publication.title}”',
                    data={'type': 'publication', 'publication_id': publication.id, 'chapter_id': first.id})


def announce(publication, was_published, newly_visible_chapters):
    """After a save: a book going out for the first time is news to the
    author's followers; chapters added to a book already out are news to its
    readers too. Sent off the request (a thread), so saving stays quick."""
    from .tasks import run_in_background
    if publication.status != 'published' or publication.is_removed:
        return
    if not was_published:
        run_in_background(notify_new_book, publication)
    elif newly_visible_chapters:
        run_in_background(notify_new_chapters, publication, list(newly_visible_chapters))
