"""Admin: music from the app - listening at a glance (by listeners, not
plays), genres renamed / reordered / added, and the Editor's picks rail that
opens everyone's Music home. Members can't reach any of it.

    python manage.py test songs.tests.test_admin_music --settings=music.settings_test
"""
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import AdminActionLog, Category, PlayEvent, Track, User

R2 = 'https://media.example.com'
_n = [0]


def user(name):
    return User.objects.create_user(name, f'{name}@x.com', 'x')


def admin(name):
    u = user(name)
    u.admin_role = 'super_admin'
    u.is_superuser = True
    u.is_staff = True
    u.save(update_fields=['admin_role', 'is_superuser', 'is_staff'])
    return u


def song(artist, title):
    return Track.objects.create(title=title, artist=artist, audio_file=f'{R2}/a/{title}.mp3')


def play(track, listener):
    _n[0] += 1
    PlayEvent.objects.create(user=listener, track=track, play_id=f'am{_n[0]}', counted=True,
                             started_at=timezone.now())


class AdminMusicTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.boss = admin('am_boss')
        self.member = user('am_member')
        self.choir = user('am_choir')
        self.loved = song(self.choir, 'Loved by many')
        self.looped = song(self.choir, 'Looped by one')
        for i in range(3):
            play(self.loved, user(f'am_l{i}'))
        for _ in range(6):
            play(self.looped, self.member)        # one person, on repeat

    def test_members_cannot_reach_it(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/admin/music/').status_code, 403)
        self.assertEqual(self.client.post('/api/admin/music/picks/', {'tracks': [self.loved.id]},
                                          format='json').status_code, 403)

    def test_most_listened_is_by_people_not_plays(self):
        self.client.force_authenticate(self.boss)
        data = self.client.get('/api/admin/music/').json()
        self.assertEqual(data['totals']['plays'], 9)
        self.assertEqual(data['top'][0]['id'], self.loved.id)
        self.assertEqual(data['top'][0]['listeners'], 3)

    def test_genres_are_added_renamed_and_reordered(self):
        self.client.force_authenticate(self.boss)
        # The genres the migrations seed (hymns, choir, ...).
        a, b = list(Category.objects.exclude(slug__isnull=True).order_by('position', 'name')[:2])
        Category.objects.filter(pk__in=[a.pk, b.pk]).update(position=5)   # old data: positions repeat
        a.refresh_from_db()
        res = self.client.post('/api/admin/music/genres/', {'name': 'Kwaya ya vijana'}, format='json').json()
        self.assertIn('kwaya-ya-vijana', [g['slug'] for g in res['genres']])
        self.client.post(f'/api/admin/music/genres/{a.id}/', {'name': 'Classic hymns'}, format='json')
        a.refresh_from_db()
        self.assertEqual(a.name, 'Classic hymns')
        self.assertTrue(a.slug)                                            # the key stays
        self.client.post('/api/admin/music/genres/', {'order': [b.id, a.id]}, format='json')
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertLess(b.position, a.position)
        self.assertTrue(AdminActionLog.objects.filter(action='order_genres').exists())

    def test_editors_picks_open_the_music_home_in_order(self):
        self.client.force_authenticate(self.boss)
        res = self.client.post('/api/admin/music/picks/', {'tracks': [self.looped.id, self.loved.id, 999999]},
                               format='json')
        self.assertEqual(res.json()['picks'], [self.looped.id, self.loved.id])   # an unknown id is dropped
        self.client.force_authenticate(self.member)
        home = self.client.get('/api/music/home/').json()
        self.assertEqual([r['id'] for r in home['picks']], [self.looped.id, self.loved.id])
