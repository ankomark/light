"""Rebuild User.total_likes from the like tables.

The counter is maintained incrementally by signals (songs/signals.py), so this
is a repair tool: run it after a bulk import, a raw-SQL delete, or any other
path that bypasses the ORM and leaves the totals drifting.

    python manage.py recount_total_likes
    python manage.py recount_total_likes --user alice
"""
from django.core.management.base import BaseCommand
from django.db.models import Count, Q, Sum

from songs.models import LiveBroadcast, User


def recount(users=None):
    """Recompute total_likes for `users` (all of them when None).

    Returns the number of rows whose stored value was wrong and got fixed.
    Only drifted rows are written.
    """
    qs = User.objects.all() if users is None else users
    # distinct=True on each Count so the three joins can share one query without
    # multiplying each other's rows. Moderator takedowns are excluded to match
    # the incremental rule (see signals.sync_removal_likes) — if this disagreed,
    # every run would "repair" the counters to a different number.
    qs = qs.annotate(
        post_likes=Count(
            'social_posts__likes', distinct=True,
            filter=Q(social_posts__is_removed=False),
        ),
        track_likes=Count(
            'tracks__likes', distinct=True,
            filter=Q(tracks__is_removed=False),
        ),
        pub_likes=Count(
            'publications__likes', distinct=True,
            filter=Q(publications__is_removed=False),
        ),
    )

    # Live hearts are a stored tally rather than one row per like, so they need a
    # SUM — and a SUM cannot ride along with the joins above without being
    # inflated by them. Grouped separately, then looked up per user.
    live_likes = dict(
        LiveBroadcast.objects.values_list('host_id')
        .annotate(n=Sum('like_count'))
        .values_list('host_id', 'n')
    )

    stale = []
    for user in qs.only('id', 'total_likes'):
        actual = (
            user.post_likes + user.track_likes + user.pub_likes
            + (live_likes.get(user.id) or 0)
        )
        if actual != user.total_likes:
            user.total_likes = actual
            stale.append(user)

    if stale:
        User.objects.bulk_update(stale, ['total_likes'], batch_size=500)
    return len(stale)


class Command(BaseCommand):
    help = "Recompute User.total_likes from the underlying like rows."

    def add_arguments(self, parser):
        parser.add_argument(
            '--user',
            dest='username',
            help='Only recount this username (default: every user).',
        )

    def handle(self, *args, **options):
        username = options.get('username')
        users = None
        if username:
            users = User.objects.filter(username__iexact=username)
            if not users.exists():
                self.stderr.write(self.style.ERROR(f'No user named "{username}".'))
                return

        fixed = recount(users)
        scope = f'@{username}' if username else 'all users'
        self.stdout.write(self.style.SUCCESS(
            f'total_likes recount complete for {scope}: {fixed} row(s) corrected.'
        ))
