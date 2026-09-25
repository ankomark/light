"""Publishing: chapters, their history, and reading.

- Which chapters a reader may see (drafts and takedowns are the author's).
- Saving a book's chapters IN PLACE: a chapter keeps its id across saves,
  its version goes up when its words change, and what a save replaced (or
  a deleted chapter) is kept as a ChapterRevision the author can look back
  at and restore.
- Reading as it happens (ReadingActivity, a row per chapter per day) and
  where the reader is (ReadingProgress).
- Moving chapters' old inline base64 pictures to R2 (a background job).
"""
import base64
import binascii
import difflib
import re
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .jobs import enqueue, handler
from .models import Chapter, ChapterRevision, Publication, ReadingActivity, ReadingProgress

STATUSES = {Chapter.DRAFT, Chapter.PUBLISHED}


# ── Who sees which chapters ──────────────────────────────────────────────────

def visible_chapters_q(user, prefix=''):
    """Chapters a user may read: published and not taken down — and all of
    their own book's (drafts, takedowns marked) for the author."""
    q = Q(**{f'{prefix}status': Chapter.PUBLISHED, f'{prefix}is_removed': False})
    if getattr(user, 'is_authenticated', False):
        q |= Q(**{f'{prefix}publication__author_id': user.id})
    return q


def reader_chapters(publication, user):
    """A book's chapters as this user reads them, in order."""
    return publication.chapters.filter(visible_chapters_q(user)).order_by('order', 'id')


# ── Saving chapters, keeping history ─────────────────────────────────────────

def _keep(publication, chapter, reason, user):
    return ChapterRevision(
        publication=publication, chapter_ref=chapter.pk, version=chapter.version,
        title=chapter.title, body=chapter.body, word_count=chapter.word_count,
        reason=reason, created_by=user,
    )


def _prune(publication, refs):
    for ref in refs:
        old = list(ChapterRevision.objects.filter(publication=publication, chapter_ref=ref)
                   .order_by('-created_at', '-id').values_list('pk', flat=True)[ChapterRevision.KEEP:])
        if old:
            ChapterRevision.objects.filter(pk__in=old).delete()


@transaction.atomic
def sync_chapters(publication, chapters, user=None):
    """Make the book's chapters match `chapters` (a list of dicts: id?,
    title, body, status?, in reading order).

    A chapter sent with its id is updated in place; without one it's new;
    one no longer sent is deleted (its last words kept). A moderator's
    takedown stays whatever the author sends. Apps from before chapter ids
    send none at all: then chapters are matched by their place in the book,
    so their saves don't churn every chapter's id and history.
    """
    existing = list(publication.chapters.order_by('order', 'id'))
    by_id = {c.pk: c for c in existing}
    if chapters and not any(ch.get('id') for ch in chapters):
        chapters = [dict(ch, id=existing[i].pk) if i < len(existing) else ch for i, ch in enumerate(chapters)]

    kept_ids, revisions, touched, new = set(), [], set(), []
    for i, ch in enumerate(chapters, start=1):
        title = (ch.get('title') or '')[:200]
        body = ch.get('body') or ''
        status = ch.get('status') if ch.get('status') in STATUSES else None
        c = by_id.get(ch.get('id'))
        if c is None or c.pk in kept_ids:
            new.append(Chapter(publication=publication, order=i, title=title, body=body,
                               word_count=Chapter.count_words(body), status=status or Chapter.PUBLISHED))
            continue
        kept_ids.add(c.pk)
        fields = []
        if c.title != title or c.body != body:
            revisions.append(_keep(publication, c, 'edit', user))
            touched.add(c.pk)
            c.title, c.body, c.word_count = title, body, Chapter.count_words(body)
            c.version += 1
            fields += ['title', 'body', 'word_count', 'version']
        if c.order != i:
            c.order = i
            fields.append('order')
        if status and c.status != status:
            c.status = status
            fields.append('status')
        if fields:
            c.save(update_fields=fields + ['updated_at'])

    gone = [c for c in existing if c.pk not in kept_ids]
    for c in gone:
        revisions.append(_keep(publication, c, 'delete', user))
        touched.add(c.pk)
    if gone:
        Chapter.objects.filter(pk__in=[c.pk for c in gone]).delete()
    if new:
        Chapter.objects.bulk_create(new)
    if revisions:
        ChapterRevision.objects.bulk_create(revisions)
        _prune(publication, touched)

    # Pictures sent the old way (base64 in the text) go to R2 behind the save.
    for c in publication.chapters.filter(body__contains='data:image/').only('pk'):
        enqueue('pub_inline_images', key=f'chapter:{c.pk}', chapter_id=c.pk)


# ── History ──────────────────────────────────────────────────────────────────

_DATA_IMAGE = re.compile(r'!\[([^\]]*)\]\((data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))\)')


def _for_diff(body):
    # Base64 pictures are one enormous "word"; a diff shows them as [image].
    return _DATA_IMAGE.sub(lambda m: f'![{m.group(1)}]([image])', body or '')


def diff_paragraphs(old, new):
    """What changed from `old` to `new`, paragraph by paragraph:
    [{op: 'equal' | 'insert' | 'delete', text}] — 'delete' was in `old`
    only, 'insert' is in `new` only."""
    a = _for_diff(old).split('\n')
    b = _for_diff(new).split('\n')
    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == 'equal':
            out.append({'op': 'equal', 'text': '\n'.join(a[i1:i2])})
            continue
        if tag in ('delete', 'replace'):
            out.append({'op': 'delete', 'text': '\n'.join(a[i1:i2])})
        if tag in ('insert', 'replace'):
            out.append({'op': 'insert', 'text': '\n'.join(b[j1:j2])})
    return out


def revision_list(publication, chapter_ref=None):
    """A chapter's kept copies (newest first); without a chapter, the
    book's deleted chapters (the last copy of each)."""
    qs = ChapterRevision.objects.filter(publication=publication)
    fields = ('id', 'chapter_ref', 'version', 'title', 'word_count', 'reason', 'created_at')
    if chapter_ref is not None:
        return list(qs.filter(chapter_ref=chapter_ref).values(*fields)[:ChapterRevision.KEEP])
    live = set(publication.chapters.values_list('pk', flat=True))
    seen, out = set(), []
    for row in qs.filter(reason='delete').exclude(chapter_ref__in=live).values(*fields):
        if row['chapter_ref'] not in seen:
            seen.add(row['chapter_ref'])
            out.append(row)
    return out


# ── Reading ──────────────────────────────────────────────────────────────────

MAX_EVENTS = 50
MAX_SECONDS = 15 * 60          # a single report's time in one chapter
OLDEST = timedelta(days=30)    # reading reported later than this is dropped
FINISHED_AT = 0.97


def _when(value):
    """An event's time: ISO text or epoch milliseconds → aware datetime."""
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / 1000, tz=dt_timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        try:
            d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
        return d if timezone.is_aware(d) else timezone.make_aware(d)
    return None


def _fraction(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if f != f else min(1.0, max(0.0, f))   # NaN → 0


def record_reading(user, publication, events):
    """Add a batch of reading reports: [{index, chapter_id?, seconds,
    furthest, position?, at}]. Returns how many were taken.

    Each adds its time to that chapter's row for that day; the furthest
    point only moves forward. The newest report (by when it happened, not
    when it arrived — a phone offline for a day reports late) sets where
    the reader is."""
    now = timezone.now()
    chapters = list(reader_chapters(publication, user).values_list('pk', flat=True))
    taken, latest = 0, None
    with transaction.atomic():
        for ev in (events or [])[:MAX_EVENTS]:
            if not isinstance(ev, dict):
                continue
            try:
                index = int(ev.get('index'))
            except (TypeError, ValueError):
                continue
            at = _when(ev.get('at')) or now
            if not 0 <= index < len(chapters) or at > now + timedelta(days=1) or at < now - OLDEST:
                continue
            try:
                seconds = max(0, min(MAX_SECONDS, int(ev.get('seconds') or 0)))
            except (TypeError, ValueError):
                seconds = 0
            furthest = _fraction(ev.get('furthest'))
            row, _ = ReadingActivity.objects.select_for_update().get_or_create(
                user=user, publication=publication, chapter_index=index, day=timezone.localdate(at),
                defaults={'chapter_id': chapters[index]},
            )
            row.seconds += seconds
            row.furthest = max(row.furthest, furthest)
            row.finished = row.finished or furthest >= FINISHED_AT or bool(ev.get('finished'))
            row.chapter_id = chapters[index]
            row.save()
            taken += 1
            if latest is None or at >= latest[0]:
                latest = (at, index, _fraction(ev.get('position', furthest)))

        if latest:
            at, index, position = latest
            rp, created = ReadingProgress.objects.get_or_create(
                publication=publication, user=user, defaults={'last_chapter': index, 'position': position})
            if not created and at >= rp.updated_at:
                # update(): auto_now would stamp the arrival time, and a late
                # report must not look newer than reading done since.
                ReadingProgress.objects.filter(pk=rp.pk).update(
                    last_chapter=index, position=position, updated_at=at)
            elif created:
                ReadingProgress.objects.filter(pk=rp.pk).update(updated_at=at)
    return taken


# ── Old inline pictures → R2 ─────────────────────────────────────────────────

@handler('pub_inline_images')
def move_inline_images(chapter_id):
    """Upload a chapter's base64 pictures to R2 and put their addresses in
    its text. Mechanical (the chapter reads the same), so no history copy —
    but the version goes up, so phones fetch the lighter text. If the
    author saved meanwhile, the job runs again on the new text."""
    from . import r2
    ch = Chapter.objects.filter(pk=chapter_id).only('pk', 'body').first()
    if ch is None or 'data:image/' not in ch.body:
        return

    def upload(m):
        alt, mime, payload = m.group(1), m.group(3).lower(), m.group(4)
        try:
            data = base64.b64decode(re.sub(r'\s+', '', payload), validate=True)
        except (binascii.Error, ValueError):
            return m.group(0)                   # not a picture after all: left alone
        ext = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'}.get(mime, '')
        url = r2.put_bytes(f'publication_images/{uuid.uuid4().hex}{ext}', data, mime)
        return f'![{alt}]({url})'

    body = _DATA_IMAGE.sub(upload, ch.body)
    if body == ch.body:
        return
    updated = Chapter.objects.filter(pk=ch.pk, body=ch.body).update(
        body=body, version=F('version') + 1, updated_at=timezone.now())
    if not updated:
        raise RuntimeError('chapter changed while its pictures moved; retrying on the new text')


def queue_inline_image_moves():
    """Queue the move for every chapter still carrying base64 pictures."""
    ids = list(Chapter.objects.filter(body__contains='data:image/').values_list('pk', flat=True))
    for pk in ids:
        enqueue('pub_inline_images', key=f'chapter:{pk}', chapter_id=pk)
    return len(ids)
