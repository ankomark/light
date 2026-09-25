"""Publishing phase 5: the Author Studio (how a book is read, in totals) and
book clubs (a group reading a book on a plan).

    python manage.py test songs.tests.test_publishing_phase5 --settings=music.settings_test
"""
from datetime import date, timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, ReadingActivity, ReadingProgress, PublicationCollaborator, BookClub,
    GroupMember, BookReview, Group,
)
from songs import author_studio


def book(author, chapters=4, status='published', title='Book'):
    pub = Publication.objects.create(title=title, author=author, status=status, category='devotional',
                                     published_at=timezone.now())
    for i in range(chapters):
        Chapter.objects.create(publication=pub, order=i + 1, title=f'Ch {i + 1}', body='w', word_count=100)
    return pub


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.pub = book(self.author)
        self.readers = [User.objects.create_user(f'r{i}', f'r{i}@x.com', 'x') for i in range(6)]
        self.client.force_authenticate(self.author)

    def read(self, user, index, days_ago=0, seconds=300, finished=False):
        ReadingActivity.objects.create(user=user, publication=self.pub, chapter_index=index, seconds=seconds,
                                       day=timezone.localdate() - timedelta(days=days_ago), finished=finished)


class AnalyticsTests(Base):
    def test_a_books_numbers(self):
        a, b, c, d, e, f = self.readers
        for u, reached in ((a, 3), (b, 1), (c, 1), (d, 0)):
            for i in range(reached + 1):
                self.read(u, i)
            ReadingProgress.objects.create(user=u, publication=self.pub, last_chapter=reached,
                                           finished_at=timezone.now() if u is a else None)
        self.read(e, 0, days_ago=40)                                 # outside the 30 days
        self.read(self.author, 0)                                    # the author's own reading: not counted
        data = self.client.get(f'/api/publications/{self.pub.id}/analytics/?days=30').json()
        self.assertEqual((data['readers'], data['readers_all_time'], data['finished']), (4, 5, 1))
        self.assertEqual(data['completion'], 0.25)                   # 1 of 4 who started
        self.assertEqual([f['readers'] for f in data['funnel']], [5, 3, 1, 1])
        self.assertEqual(data['most_left_after'], {'index': 1, 'title': 'Ch 2', 'readers': 2})
        self.assertEqual(len(data['daily']), 30)
        self.assertEqual(data['daily'][-1]['readers'], 4)
        self.assertEqual(data['reading_seconds'], 300 * (4 + 2 + 2 + 1))
        self.assertFalse(data['few_readers'])

    def test_few_readers_is_said(self):
        self.read(self.readers[0], 0)
        self.assertTrue(self.client.get(f'/api/publications/{self.pub.id}/analytics/').json()['few_readers'])

    def test_only_the_books_writers_see_it(self):
        self.client.force_authenticate(self.readers[0])
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/analytics/').status_code, 403)
        PublicationCollaborator.objects.create(publication=self.pub, user=self.readers[0], role='editor',
                                               accepted_at=timezone.now())
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/analytics/').status_code, 200)

    def test_the_authors_overview(self):
        other = book(self.author, title='Second')
        self.read(self.readers[0], 0)
        ReadingActivity.objects.create(user=self.readers[1], publication=other, chapter_index=0, seconds=60,
                                       day=timezone.localdate())
        self.author.followers.add(self.readers[2])
        data = self.client.get('/api/publications/analytics/?days=7').json()
        self.assertEqual((data['readers'], data['followers'], data['days']), (2, 1, 7))
        self.assertEqual({b['title']: b['readers'] for b in data['books']}, {'Book': 1, 'Second': 1})


class ClubTests(Base):
    def test_the_plan(self):
        start = date(2026, 10, 1)
        self.assertEqual(author_studio.plan(5, start, chapters_per_step=2, every_days=7),
                         [(1, date(2026, 10, 7)), (3, date(2026, 10, 14)), (4, date(2026, 10, 21))])

    def test_start_a_club_and_see_how_members_are_doing(self):
        self.client.force_authenticate(self.readers[0])
        res = self.client.post(f'/api/publications/{self.pub.id}/clubs/', {
            'name': 'Sabbath readers', 'starts_on': timezone.localdate().isoformat(), 'chapters_per_step': 2,
            'every_days': 7, 'private': False}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        club = res.json()
        self.assertEqual((club['name'], club['members'], club['is_member']), ('Sabbath readers', 1, True))
        self.assertEqual([s['through_chapter'] for s in club['plan']], [1, 3])
        self.assertEqual(club['plan'][0]['state'], 'current')
        group = Group.objects.get(pk=club['group']['id'])
        self.assertTrue(GroupMember.objects.get(group=group, user=self.readers[0]).is_admin)

        GroupMember.objects.create(group=group, user=self.readers[1])
        self.read(self.readers[1], 0)
        self.read(self.readers[1], 1)
        ReadingProgress.objects.create(user=self.readers[0], publication=self.pub, percent=1, finished_at=timezone.now())
        data = self.client.get(f'/api/publications/clubs/{club["id"]}/').json()
        self.assertEqual([s['members_there'] for s in data['plan']], [2, 1])
        self.assertEqual((data['members'], data['finished_members']), (2, 1))

    def test_private_clubs_are_for_members(self):
        self.client.force_authenticate(self.readers[0])
        cid = self.client.post(f'/api/publications/{self.pub.id}/clubs/', {'name': 'Quiet'}, format='json').json()['id']
        self.client.force_authenticate(self.readers[1])
        self.assertEqual(self.client.get(f'/api/publications/clubs/{cid}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/publications/{self.pub.id}/clubs/').json()['results'], [])
        slug = BookClub.objects.get().group.slug
        self.assertEqual(self.client.get(f'/api/publications/clubs/by-group/{slug}/').json(), {'club': cid})

    def test_a_club_needs_a_published_book_and_an_account(self):
        draft = book(self.author, status='draft', title='Draft')
        self.assertEqual(self.client.post(f'/api/publications/{draft.id}/clubs/', {}, format='json').status_code, 400)
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(f'/api/publications/{self.pub.id}/clubs/', {}, format='json').status_code, (401, 403))
