"""Test settings: run the suite without external services.

Usage:
    python manage.py test songs --settings=music.settings_test
"""
from .settings import *  # noqa: F401,F403

# In-memory SQLite — no Supabase/Postgres or test-DB-create privilege needed.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Run background tasks (email/push) inline and deterministically.
TASKS_ALWAYS_EAGER = True

# Capture email in mail.outbox instead of sending.
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

# Faster password hashing for test user creation.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

# Local-memory cache (DRF throttles store counts here). Each test clears it.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}

# Don't let Sentry phone home during tests.
import sentry_sdk  # noqa: E402
sentry_sdk.init(dsn='')
