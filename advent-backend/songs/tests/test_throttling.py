from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import User


class LoginThrottleTests(APITestCase):
    """The login endpoint is scoped to 'auth' (10/min) to deter brute force."""

    def setUp(self):
        cache.clear()

    def test_login_is_rate_limited_after_repeated_attempts(self):
        User.objects.create_user(username='target', password='correct-horse')
        last = None
        for _ in range(12):  # 'auth' scope allows 10/min
            last = self.client.post(
                '/api/auth/token/', {'username': 'target', 'password': 'wrong'}
            )
        self.assertEqual(last.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
