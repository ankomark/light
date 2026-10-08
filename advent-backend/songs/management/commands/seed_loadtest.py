"""Fill a THROWAWAY database with a realistic amount of everything, to see
how the app holds up (loadtest/docker-compose.yml). Refuses to run against a
database that already has real-looking data, and never runs with DEBUG off
outside DJANGO_ENV=loadtest.

    python manage.py seed_loadtest                 # default sizes
    python manage.py seed_loadtest --scale 0.2     # smaller

Signs in for measuring: username "loadtester", password "Load-test-1234".
Bulk inserts skip signals, so the counters the signals keep (likes_count,
comments_count, total likes) are set from the rows afterwards, as they would be.
"""
import random
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from songs import models as m

WORDS = ('grace faith hope love peace joy sabbath choir hymn praise worship prayer youth church '
         'mission bible verse amen blessing kenya nairobi kisumu mombasa family music song light '
         'truth gospel service community friends morning evening family together').split()
TAGS = ['#sabbath', '#choir', '#youth', '#praise', '#prayer', '#hymn', '#bible', '#mission', '#kenya', '#music']


def text(n):
    return ' '.join(random.choice(WORDS) for _ in range(n)).capitalize()


class Command(BaseCommand):
    help = 'Fill a throwaway database with realistic volumes (load testing).'

    def add_arguments(self, parser):
        parser.add_argument('--scale', type=float, default=1.0)
        parser.add_argument('--seed', type=int, default=7)

    def handle(self, *args, scale, seed, **opts):
        import os
        if os.getenv('DJANGO_ENV') != 'loadtest' and not settings.DEBUG:
            raise CommandError('Only for the load-test stack (DJANGO_ENV=loadtest).')
        if m.User.objects.count() > 50:
            raise CommandError('This database already has users: refusing to seed it.')
        random.seed(seed)
        n = lambda k: max(1, int(k * scale))   # noqa: E731
        now = timezone.now()
        pw = make_password('Load-test-1234')
        say = self.stdout.write

        # ── people ───────────────────────────────────────────────────────────
        users = [m.User(username=f'user{i:05d}', email=f'user{i:05d}@load.test', password=pw,
                        is_email_verified=True, date_joined=now - timedelta(days=random.randint(1, 400)))
                 for i in range(n(3000))]
        users.append(m.User(username='loadtester', email='loadtester@load.test', password=pw,
                            is_email_verified=True))
        m.User.objects.bulk_create(users, batch_size=2000)
        users = list(m.User.objects.order_by('id'))
        me = users[-1]
        ids = [u.id for u in users]
        m.Profile.objects.bulk_create(
            [m.Profile(user=u, bio=text(12), is_public=random.random() > 0.08) for u in users],
            batch_size=2000, ignore_conflicts=True)
        say(f'users {len(users)}')

        # Follows: everyone follows ~40; the tester follows 150.
        Follow = m.User.followers.through
        rows, seen = [], set()
        for u in users:
            for t in random.sample(ids, min(40 if u is not me else 150, len(ids))):
                if t != u.id and (t, u.id) not in seen:
                    seen.add((t, u.id))
                    rows.append(Follow(from_user_id=t, to_user_id=u.id))   # u follows t
        Follow.objects.bulk_create(rows, batch_size=5000, ignore_conflicts=True)
        say(f'follows {len(rows)}')

        # ── posts, likes, comments ───────────────────────────────────────────
        posts = [m.SocialPost(
            user_id=random.choice(ids), caption=text(random.randint(4, 30)), content_type='image',
            media_file=f'https://cdn.load.test/posts/{uuid.uuid4().hex}.jpg', width=1080, height=1350,
            tags=' '.join(random.sample(TAGS, random.randint(0, 3))),
            visibility=random.choices(['public', 'followers', 'private'], [85, 12, 3])[0],
            view_count=random.randint(0, 5000),
        ) for _ in range(n(30000))]
        m.SocialPost.objects.bulk_create(posts, batch_size=2000)
        post_ids = list(m.SocialPost.objects.values_list('id', flat=True))
        # Spread over the last month (created_at is auto_now_add: set after).
        with connection.cursor() as c:
            c.execute("UPDATE songs_socialpost SET created_at = NOW() - (random() * interval '30 days')")
        say(f'posts {len(post_ids)}')

        likes, seen = [], set()
        hot = post_ids[: max(1, len(post_ids) // 20)]          # a few posts get most likes
        while len(likes) < n(300000):
            p = random.choice(hot) if random.random() < 0.3 else random.choice(post_ids)
            u = random.choice(ids)
            if (p, u) not in seen:
                seen.add((p, u))
                likes.append(m.PostLike(post_id=p, user_id=u))
        m.PostLike.objects.bulk_create(likes, batch_size=10000, ignore_conflicts=True)
        say(f'post likes {len(likes)}')

        comments = [m.PostComment(post_id=random.choice(post_ids), user_id=random.choice(ids),
                                  content=text(random.randint(3, 25))) for _ in range(n(60000))]
        m.PostComment.objects.bulk_create(comments, batch_size=5000)
        say(f'comments {len(comments)}')

        # ── music ─────────────────────────────────────────────────────────────
        artists = random.sample(ids, min(n(400), len(ids)))
        tracks = [m.Track(artist_id=random.choice(artists), title=text(random.randint(1, 4)),
                          slug=f'track-{i}-{uuid.uuid4().hex[:8]}',
                          audio_file=f'https://cdn.load.test/tracks/{uuid.uuid4().hex}.mp3',
                          duration_ms=random.randint(120000, 360000), processing_status='ready')
                  for i in range(n(4000))]
        m.Track.objects.bulk_create(tracks, batch_size=2000)
        track_ids = list(m.Track.objects.values_list('id', flat=True))
        tl, seen = [], set()
        while len(tl) < n(80000):
            t, u = random.choice(track_ids), random.choice(ids)
            if (t, u) not in seen:
                seen.add((t, u))
                tl.append(m.Like(track_id=t, user_id=u))
        m.Like.objects.bulk_create(tl, batch_size=10000, ignore_conflicts=True)
        m.Comment.objects.bulk_create([m.Comment(track_id=random.choice(track_ids), user_id=random.choice(ids),
                                                 content=text(8)) for _ in range(n(20000))], batch_size=5000)
        playlists = [m.Playlist(user_id=random.choice(ids), name=text(2)) for _ in range(n(3000))]
        m.Playlist.objects.bulk_create(playlists, batch_size=2000)
        pl_ids = list(m.Playlist.objects.values_list('id', flat=True))
        pt, seen = [], set()
        for pid in pl_ids:
            for pos, t in enumerate(random.sample(track_ids, min(12, len(track_ids)))):
                pt.append(m.PlaylistTrack(playlist_id=pid, track_id=t, position=pos))
        m.PlaylistTrack.objects.bulk_create(pt, batch_size=10000, ignore_conflicts=True)
        say(f'tracks {len(track_ids)}, track likes {len(tl)}, playlists {len(pl_ids)}')

        # ── groups and communities ───────────────────────────────────────────
        groups = [m.Group(creator_id=random.choice(ids), name=f'{text(2)} {i}', slug=f'group-{i}',
                          kind=random.choice(['group', 'community']), description=text(20),
                          is_private=random.random() < 0.3)
                  for i in range(n(150))]
        m.Group.objects.bulk_create(groups, batch_size=500)
        groups = list(m.Group.objects.all())
        members = []
        for g in groups:
            people = set(random.sample(ids, min(30, len(ids)))) | {g.creator_id}
            if random.random() < 0.15:
                people.add(me.id)
            members += [m.GroupMember(group=g, user_id=u, is_admin=(u == g.creator_id)) for u in people]
        m.GroupMember.objects.bulk_create(members, batch_size=5000, ignore_conflicts=True)
        by_group = {}
        for gm in members:
            by_group.setdefault(gm.group_id, []).append(gm.user_id)
        gposts = []
        for _ in range(n(30000)):
            g = random.choice(groups)
            gposts.append(m.GroupPost(group=g, user_id=random.choice(by_group[g.id]), content=text(random.randint(3, 30))))
        m.GroupPost.objects.bulk_create(gposts, batch_size=5000)
        say(f'groups {len(groups)}, members {len(members)}, group posts {len(gposts)}')

        # ── messages and notifications ───────────────────────────────────────
        convos = []
        for _ in range(n(1500)):
            c = m.Conversation.objects.create()
            a, b = random.sample(ids, 2)
            if random.random() < 0.05:
                a = me.id
            c.participants.add(a, b)
            convos.append((c.id, a, b))
        msgs = [m.Message(conversation_id=cid, sender_id=random.choice((a, b)), content=text(random.randint(2, 20)))
                for cid, a, b in convos for _ in range(20)]
        m.Message.objects.bulk_create(msgs, batch_size=10000)
        notes = [m.Notification(recipient_id=random.choice(ids + [me.id] * 50), sender_id=random.choice(ids),
                                message=text(6), notification_type=random.choice(['like', 'comment', 'follow']))
                 for _ in range(n(100000))]
        m.Notification.objects.bulk_create(notes, batch_size=10000)
        say(f'conversations {len(convos)}, messages {len(msgs)}, notifications {len(notes)}')

        # ── counters the signals would have kept ─────────────────────────────
        with transaction.atomic(), connection.cursor() as c:
            c.execute("""UPDATE songs_socialpost p SET
                likes_count = (SELECT COUNT(*) FROM songs_postlike l WHERE l.post_id = p.id),
                comments_count = (SELECT COUNT(*) FROM songs_postcomment c WHERE c.post_id = p.id)""")
            # A person's lifetime likes: on their posts and their songs.
            c.execute("""UPDATE songs_user u SET total_likes =
                COALESCE((SELECT SUM(likes_count) FROM songs_socialpost p WHERE p.user_id = u.id), 0)
              + (SELECT COUNT(*) FROM songs_like l JOIN songs_track t ON t.id = l.track_id WHERE t.artist_id = u.id)""")
        say('counters set')
        with connection.cursor() as c:
            c.execute('ANALYZE')
        self.stdout.write(self.style.SUCCESS('Seeded. Sign in as loadtester / Load-test-1234.'))
