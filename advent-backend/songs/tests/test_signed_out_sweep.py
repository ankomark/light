"""What answers someone who is not signed in.

Every API route (from the URL configuration) is asked GET with no account.
Only the routes on PUBLIC may answer with content; everything else must
refuse (401/403) or not exist for them (404/405). A new endpoint that
forgets its permission shows up here.

    python manage.py test songs.tests.test_signed_out_sweep --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.tests.test_no_crash_sweep import api_paths

# Open to anyone, on purpose: the health check, sign-in/sign-up helpers, the
# app's on/off switches, and what a shared link or the web preview shows.
PUBLIC = {
    '/api/health/',
    '/api/app-status/',
    # Read-only for anyone by design (IsAuthenticatedOrReadOnly): public
    # posts and their comments (private accounts and followers-only posts
    # are filtered out - test_private_account_leaks), and the catalogues a
    # shared link opens into. Reviewed 2026-10-08.
    '/api/social-posts/', '/api/social-posts/latest/', '/api/post-comments/',
    '/api/social-posts/999999/comments/', '/api/tracks/999999/comments/',
    '/api/community-categories/', '/api/live-events/', '/api/live-events/featured/',
    '/api/marketplace/categories/', '/api/marketplace/products/', '/api/marketplace/products/999999/reviews/',
    '/api/media-stations/', '/api/organizations/', '/api/video-studios/',
    '/api/publications/', '/api/publications/home/', '/api/publications/ai-status/',
    '/api/publications/clubs/by-group/999999/',
}
PUBLIC_PREFIXES = ()


@mock.patch('requests.Session.request', side_effect=__import__('requests').exceptions.ConnectionError('no network'))
class SignedOutSweepTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.raise_request_exception = False

    def test_only_public_routes_answer_someone_signed_out(self, *_):
        answered = []
        for path in api_paths():
            r = self.client.get(path)
            if r.status_code < 300 and path not in PUBLIC and not path.startswith(PUBLIC_PREFIXES):
                answered.append(f'{path} -> {r.status_code}')
        self.assertEqual(answered, [], '\n' + '\n'.join(answered))
