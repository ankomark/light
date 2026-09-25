"""Publishing phase 7: organisation accounts (conferences, schools,
publishing houses…) and books shared to the social feed as posts.

    python manage.py test songs.tests.test_publishing_phase7 --settings=music.settings_test
"""
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from songs.models import (
    User, Publication, Chapter, Organization, OrganizationMember as M, SocialPost, BookHighlight,
)
from songs import writer_studio


def book(author, title='Book', status='published', org=None):
    pub = Publication.objects.create(title=title, author=author, status=status, category='devotional',
                                     published_at=timezone.now(), cover='https://r2.test/c.jpg', organization=org,
                                     rights_confirmed_at=timezone.now())
    Chapter.objects.create(publication=pub, order=1, title='One', body='Once there was a sower.')
    Chapter.objects.create(publication=pub, order=2, title='Two', body='Draft words.', status='draft')
    return pub


class Base(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.ann = User.objects.create_user('ann', 'a@x.com', 'x')
        self.bob = User.objects.create_user('bob', 'b@x.com', 'x')
        self.client.force_authenticate(self.owner)

    def make_org(self, **extra):
        r = self.client.post('/api/organizations/', {'name': 'East Kenya Union', 'kind': 'union', **extra},
                             format='json')
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def join(self, user, role):
        org = Organization.objects.get()
        M.objects.create(organization=org, user=user, role=role, accepted_at=timezone.now())


class OrganizationTests(Base):
    def test_start_one_and_its_page(self):
        org = self.make_org(website='eku.org', description='Books for the field')
        self.assertEqual((org['slug'], org['my_role'], org['website']), ('east-kenya-union', 'owner', 'https://eku.org'))
        self.assertFalse(org['is_verified'])
        again = self.make_org()
        self.assertEqual(again['slug'], 'east-kenya-union-2')
        self.assertEqual(self.client.post('/api/organizations/', {'name': 'x'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/organizations/', {'name': 'Okay', 'kind': 'bank'}, format='json').status_code, 400)

        self.client.force_authenticate(None)
        r = self.client.get('/api/organizations/east-kenya-union/')
        self.assertEqual((r.data['members_count'], r.data['books_count'], r.data['my_role']), (1, 0, None))

    def test_invitations_roles_and_leaving(self):
        self.make_org()
        url = '/api/organizations/east-kenya-union/'
        r = self.client.post(url + 'members/', {'username': '@ann', 'role': 'editor'}, format='json')
        self.assertEqual((r.status_code, r.data['accepted']), (201, False))
        self.assertEqual(self.client.post(url + 'members/', {'username': 'nobody'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url + 'members/', {'username': 'ann', 'role': 'owner'}, format='json').status_code, 400)

        # Not a member until accepted: invitations aren't public.
        self.client.force_authenticate(self.bob)
        self.assertEqual(len(self.client.get(url + 'members/').data['results']), 1)
        self.client.force_authenticate(self.ann)
        inv = self.client.get('/api/organizations/invitations/').data['results']
        self.assertEqual((inv[0]['organization']['slug'], inv[0]['role']), ('east-kenya-union', 'editor'))
        self.assertEqual(self.client.get(url).data['invited_as'], 'editor')
        r = self.client.post(url + 'respond/', {'accept': True}, format='json')
        self.assertEqual(r.data['my_role'], 'editor')

        # An editor doesn't run it; the owner can't be removed; members may leave.
        self.assertEqual(self.client.patch(url, {'name': 'Mine now'}, format='json').status_code, 403)
        owner_row = M.objects.get(user=self.owner)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f'{url}members/{owner_row.id}/').status_code, 400)
        ann_row = M.objects.get(user=self.ann)
        self.assertEqual(self.client.patch(f'{url}members/{ann_row.id}/', {'role': 'admin'}, format='json').data['role'], 'admin')
        self.client.force_authenticate(self.ann)
        # An admin can't touch another admin — but may leave.
        self.assertEqual(self.client.delete(f'{url}members/{ann_row.id}/').status_code, 204)
        self.assertFalse(M.objects.filter(user=self.ann).exists())

    def test_declining(self):
        self.make_org()
        M.objects.create(organization=Organization.objects.get(), user=self.ann, role='author')
        self.client.force_authenticate(self.ann)
        self.client.post('/api/organizations/east-kenya-union/respond/', {'accept': False}, format='json')
        self.assertFalse(M.objects.filter(user=self.ann).exists())

    def test_publishing_under_an_organisation(self):
        self.make_org()
        org = Organization.objects.get()
        self.join(self.ann, 'author')
        self.client.force_authenticate(self.ann)
        r = self.client.post('/api/publications/', {
            'title': 'Health Message', 'category': 'health', 'status': 'draft', 'organization_slug': org.slug,
            'chapters': [{'title': 'One', 'body': 'Words'}]}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        pub = Publication.objects.get(title='Health Message')
        self.assertEqual(pub.organization, org)
        self.assertEqual(r.data['organization']['slug'], org.slug)

        # Not a member: refused.
        self.client.force_authenticate(self.bob)
        r = self.client.post('/api/publications/', {'title': 'X', 'status': 'draft', 'organization_slug': org.slug,
                                                    'chapters': []}, format='json')
        self.assertEqual(r.status_code, 400)

        # The organisation's editors edit it (drafts included); its authors don't.
        self.join(self.bob, 'editor')
        self.assertEqual(writer_studio.role_of(self.bob, pub), 'editor')
        r = self.client.get(f'/api/publications/{pub.id}/')
        self.assertEqual((r.status_code, r.data['my_role']), (200, 'editor'))
        self.assertIn(pub.id, [p['id'] for p in self.client.get('/api/publications/mine/').data['results']])
        other = book(self.owner, 'Personal')
        self.assertIsNone(writer_studio.role_of(self.bob, other))

        # Its page lists what's out under its name.
        book(self.owner, 'Out', org=org)
        r = self.client.get('/api/publications/', {'organization': org.slug})
        self.assertEqual([p['title'] for p in r.data['results']], ['Out'])

    def test_follow_and_hear_of_new_books(self):
        self.make_org()
        org = Organization.objects.get()
        self.client.force_authenticate(self.bob)
        r = self.client.post('/api/organizations/east-kenya-union/follow/')
        self.assertEqual((r.data['is_following'], r.data['followers_count']), (True, 1))
        from songs.book_community import _audience
        pub = book(self.ann, org=org)
        self.assertIn(self.bob, list(_audience(pub, include_readers=False)))

    def test_discover_publishers_and_list(self):
        self.make_org()
        org = Organization.objects.get()
        book(self.owner, org=org)
        r = self.client.get('/api/publications/home/')
        self.assertEqual(r.data['publishers'], [])                         # not verified yet
        Organization.objects.update(is_verified=True)
        r = self.client.get('/api/publications/home/')
        self.assertEqual([(p['slug'], p['books_count']) for p in r.data['publishers']], [(org.slug, 1)])
        r = self.client.get('/api/organizations/', {'q': 'kenya'})
        self.assertEqual([o['slug'] for o in r.data['results']], [org.slug])
        self.assertEqual(self.client.get('/api/organizations/', {'mine': 1}).data['results'][0]['slug'], org.slug)

    def test_closing(self):
        self.make_org()
        pub = book(self.owner, org=Organization.objects.get())
        self.join(self.ann, 'admin')
        self.client.force_authenticate(self.ann)
        self.assertEqual(self.client.delete('/api/organizations/east-kenya-union/').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete('/api/organizations/east-kenya-union/').status_code, 204)
        pub.refresh_from_db()
        self.assertIsNone(pub.organization)                              # the book stays


class BookPostTests(Base):
    def test_share_a_book_and_a_passage_to_the_feed(self):
        pub = book(self.ann)
        self.client.force_authenticate(self.bob)
        r = self.client.post(f'/api/publications/{pub.id}/share-to-feed/', {'caption': 'Read this #faith'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['content_type'], 'book')
        self.assertEqual(r.data['book']['title'], 'Book')
        self.assertEqual(r.data['thumbnail_url'], 'https://r2.test/c.jpg')          # grids show the cover

        ch = pub.chapters.get(order=1)
        r = self.client.post(f'/api/publications/{pub.id}/share-to-feed/', {
            'quote': 'Once there was a sower.', 'chapter_id': ch.id, 'block': 0}, format='json')
        self.assertEqual((r.data['book']['quote'], r.data['book']['chapter_id'], r.data['book']['block']),
                         ('Once there was a sower.', ch.id, 0))
        # A draft chapter isn't a reader's to point at.
        draft = pub.chapters.get(order=2)
        r = self.client.post(f'/api/publications/{pub.id}/share-to-feed/', {
            'quote': 'Draft words.', 'chapter_id': draft.id, 'block': 0}, format='json')
        self.assertIsNone(r.data['book']['chapter_id'])

        feed = self.client.get('/api/social-posts/').data
        rows = feed['results'] if isinstance(feed, dict) else feed
        self.assertEqual(sum(1 for p in rows if p['content_type'] == 'book'), 3)

    def test_only_published_books_and_gone_with_them(self):
        pub = book(self.ann)
        draft = book(self.ann, 'Draft', status='draft')
        self.client.force_authenticate(self.ann)
        self.assertEqual(self.client.post(f'/api/publications/{draft.id}/share-to-feed/').status_code, 400)
        self.client.post(f'/api/publications/{pub.id}/share-to-feed/')
        post = SocialPost.objects.get()
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get(f'/api/social-posts/{post.id}/').status_code, 200)
        Publication.objects.filter(pk=pub.pk).update(status='draft')
        self.assertEqual(self.client.get(f'/api/social-posts/{post.id}/').status_code, 404)
        Publication.objects.filter(pk=pub.pk).update(status='published', is_removed=True)
        self.assertEqual(self.client.get(f'/api/social-posts/{post.id}/').status_code, 404)
        Publication.objects.filter(pk=pub.pk).update(is_removed=False)
        self.assertEqual(self.client.get(f'/api/social-posts/{post.id}/').status_code, 200)
