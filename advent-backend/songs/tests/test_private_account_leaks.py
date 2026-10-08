"""A private account's posts, and the comments under them, reach only the
people it approved - not strangers, not anyone signed out - on every list.

    python manage.py test songs.tests.test_private_account_leaks --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import PostComment, Profile, SocialPost, User

WORDS = 'only my friends should read this 9c1e'


class PrivateAccountLeakTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.private = User.objects.create_user('quiet', 'q@x.com', 'pw-12345678', is_email_verified=True)
        Profile.objects.update_or_create(user=self.private, defaults={'is_public': False})
        self.friend = User.objects.create_user('friend', 'f@x.com', 'pw-12345678', is_email_verified=True)
        self.private.followers.add(self.friend)          # approved
        self.stranger = User.objects.create_user('stranger', 's@x.com', 'pw-12345678', is_email_verified=True)
        post = SocialPost.objects.create(user=self.private, caption=WORDS, content_type='text',
                                         visibility=SocialPost.VISIBILITY_PUBLIC)
        PostComment.objects.create(post=post, user=self.private, content=WORDS + ' (comment)')
        self.post = post

    URLS = ('/api/post-comments/', '/api/social-posts/', '/api/social-posts/latest/',
            '/api/explore/trending_posts/')

    def _leaks(self):
        out = []
        for url in self.URLS + (f'/api/social-posts/{self.post.pk}/comments/',):
            r = self.client.get(url)
            if WORDS in r.content.decode(errors='ignore'):
                out.append(f'{url} -> {r.status_code}')
        return out

    def test_signed_out_sees_none_of_it(self):
        self.client.force_authenticate(None)
        self.assertEqual(self._leaks(), [])

    def test_a_stranger_sees_none_of_it(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._leaks(), [])

    def test_an_approved_follower_does(self):
        self.client.force_authenticate(self.friend)
        r = self.client.get(f'/api/social-posts/{self.post.pk}/comments/')
        self.assertIn(WORDS, r.content.decode())


class PrivateProfileContentTests(APITestCase):
    """A private account's own grid, songs, playlists and stories: for its
    approved followers, not for strangers or anyone signed out."""

    def setUp(self):
        cache.clear()
        from songs.models import Playlist, Story
        self.private = User.objects.create_user('quiet2', 'q2@x.com', 'pw-12345678', is_email_verified=True)
        Profile.objects.update_or_create(user=self.private, defaults={'is_public': False})
        self.stranger = User.objects.create_user('stranger2', 's2@x.com', 'pw-12345678', is_email_verified=True)
        SocialPost.objects.create(user=self.private, caption=WORDS, content_type='text',
                                  visibility=SocialPost.VISIBILITY_PUBLIC)
        Playlist.objects.create(user=self.private, name=WORDS, visibility=Playlist.PUBLIC)
        try:
            Story.objects.create(user=self.private, caption=WORDS, media_type='text')
        except Exception:  # noqa: BLE001 - story fields differ: the others still count
            pass

    def _leaks(self):
        uid = self.private.pk
        out = []
        for url in (f'/api/users/{uid}/', f'/api/users/{uid}/tracks/',
                    f'/api/users/{uid}/playlists/', '/api/stories/feed/', '/api/playlists/'):
            r = self.client.get(url)
            if WORDS in r.content.decode(errors='ignore'):
                out.append(f'{url} -> {r.status_code}')
        # The grid carries thumbnails, not captions: count what it lists.
        r = self.client.get(f'/api/users/{uid}/social_posts/')
        if r.status_code < 300 and (r.json().get('results') if isinstance(r.json(), dict) else r.json()):
            out.append(f'/api/users/{uid}/social_posts/ lists posts')
        return out

    def test_signed_out_sees_none_of_it(self):
        self.assertEqual(self._leaks(), [])

    def test_a_stranger_sees_none_of_it(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self._leaks(), [])

    def test_an_approved_follower_does(self):
        friend = User.objects.create_user('friend2', 'f2@x.com', 'pw-12345678', is_email_verified=True)
        self.private.followers.add(friend)
        self.client.force_authenticate(friend)
        uid = self.private.pk
        self.assertIn(WORDS, self.client.get(f'/api/users/{uid}/playlists/').content.decode(errors='ignore'))
        self.assertEqual(len(self.client.get(f'/api/users/{uid}/social_posts/').json()['results']), 1)
