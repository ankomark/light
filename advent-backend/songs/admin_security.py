"""Who may act as an admin, and how they prove it is them.

An admin power needs, every time:

1. **standing**: an account that is active, not suspended, not deactivated;
2. **a capability** (or super admin), read fresh from the database, so a role
   taken away is gone on the very next request;
3. **an admin session**: opened with a code from an authenticator app
   (two-step sign-in), short-lived, sent as the X-Admin-Session header; and
   for the dangerous actions (roles, bans, bulk changes) a code entered in
   the last few minutes.

Removing someone's admin role, or suspending or banning them, ends all their
admin sessions and signs them out everywhere, so there is no way back in on
an old token.

The authenticator secret is stored encrypted (Fernet, a key derived from the
server's secret) and the backup codes and session tokens only as hashes.
"""
import base64
import contextvars
import hashlib
import hmac
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone

SESSION_HOURS = 12
REAUTH_MINUTES = 10
TOTP_STEP = 30
TOTP_DIGITS = 6
BACKUP_CODES = 10
# Wrong codes: after this many in LOCK_MINUTES the account's code box is shut
# for LOCK_MINUTES (a 6-digit code must not be guessable at 10 a minute).
MAX_FAILURES = 5
LOCK_MINUTES = 15
ISSUER = 'Adventist Life'

# The request being served, for the audit log's IP and device (set by
# AdminRequestMiddleware; nothing else reads it).
current_request = contextvars.ContextVar('current_request', default=None)


class AdminRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = current_request.set(request)
        try:
            return self.get_response(request)
        finally:
            current_request.reset(token)


def two_factor_required():
    return getattr(settings, 'ADMIN_2FA_REQUIRED', True)


# ── Encryption at rest ──────────────────────────────────────────────────────

def _fernet():
    from cryptography.fernet import Fernet
    secret = getattr(settings, 'ADMIN_SECRET_KEY', '') or settings.SECRET_KEY
    key = hashlib.sha256(f'admin-2fa:{secret}'.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(text):
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token):
    return _fernet().decrypt(token.encode()).decode()


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


# ── One-time codes (RFC 6238, what authenticator apps use) ──────────────────

def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def _code_at(secret, step):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    number = struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def code_for(secret, at=None):
    """The code an authenticator shows now (for tests)."""
    return _code_at(secret, int((at or time.time()) // TOTP_STEP))


def check_code(secret, code, last_step=0, at=None):
    """The time step a correct code belongs to (one step of drift either way
    allowed), or None. A step already used is refused: a code read over a
    shoulder cannot be used twice."""
    code = ''.join(ch for ch in str(code or '') if ch.isdigit())
    if len(code) != TOTP_DIGITS:
        return None
    now = int((at or time.time()) // TOTP_STEP)
    for step in (now, now - 1, now + 1):
        if step > (last_step or 0) and hmac.compare_digest(_code_at(secret, step), code):
            return step
    return None


def otpauth_url(secret, account):
    label = quote(f'{ISSUER}:{account}')
    return (f'otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}'
            f'&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_STEP}')


def new_backup_codes():
    """Ten one-use codes, shown once, kept as hashes."""
    codes = [f'{secrets.token_hex(2)}-{secrets.token_hex(2)}' for _ in range(BACKUP_CODES)]
    return codes, [digest(c) for c in codes]


# ── Standing and rank ───────────────────────────────────────────────────────

def in_good_standing(user):
    return bool(user and user.is_authenticated and user.is_active
                and not getattr(user, 'is_deactivated', False)
                and not user.is_currently_suspended)


def rank(user):
    """3 super admin, 2 moderator, 1 staff with a role, 0 member."""
    if not user:
        return 0
    if user.is_super_admin:
        return 3
    if user.admin_role == 'moderator':
        return 2
    if user.role_id and user.capabilities:
        return 1
    return 0


def outranks(actor, target):
    """An admin acts only on those below them: a moderator never on another
    moderator, nobody but a super admin on a super admin's peers below."""
    return rank(actor) > rank(target)


# ── Admin sessions ──────────────────────────────────────────────────────────

def open_session(user, request=None):
    """A new admin session for `user`; the token is returned once."""
    from .models import AdminSession
    token = secrets.token_urlsafe(32)
    now = timezone.now()
    AdminSession.objects.create(
        user=user, token_hash=digest(token), verified_at=now,
        expires_at=now + timedelta(hours=SESSION_HOURS),
        ip=client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT', '')[:255] if request else ''),
    )
    return token, now + timedelta(hours=SESSION_HOURS)


def session_for(request):
    """The live admin session the request carries, or None."""
    from .models import AdminSession
    token = request.META.get('HTTP_X_ADMIN_SESSION', '')
    if not token or not request.user or not request.user.is_authenticated:
        return None
    return AdminSession.objects.filter(
        user=request.user, token_hash=digest(token), revoked_at__isnull=True, expires_at__gt=timezone.now(),
    ).first()


def claim_step(two_factor, step):
    """Record `step` as used, unless a request at the same moment already used
    it (or a later one): one code opens one session."""
    from .models import AdminTwoFactor
    return AdminTwoFactor.objects.filter(pk=two_factor.pk, last_step__lt=step).update(last_step=step) == 1


def claim_backup_code(two_factor, code_hash):
    """Take a backup code off the list, unless it is not there (or another
    request took it this instant). True when this request used it."""
    from django.db import transaction
    from .models import AdminTwoFactor
    with transaction.atomic():
        tf = AdminTwoFactor.objects.select_for_update().get(pk=two_factor.pk)
        if code_hash not in (tf.backup_hashes or []):
            return False
        tf.backup_hashes = [h for h in tf.backup_hashes if h != code_hash]
        tf.save(update_fields=['backup_hashes'])
    two_factor.backup_hashes = tf.backup_hashes
    return True


def end_sessions(user, reason=''):
    """Every admin session of `user` ended now."""
    from .models import AdminSession
    return AdminSession.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason[:60])


def cut_off(user, reason):
    """No longer an admin (or suspended, banned): admin sessions ended and
    every device signed out, so no old token carries them back in."""
    end_sessions(user, reason)
    try:
        from .views.auth import _revoke_other_sessions
        _revoke_other_sessions(user)
    except Exception:  # noqa: BLE001 — the admin sessions are what matter here
        pass


def client_ip(request):
    """The caller's address. X-Forwarded-For is written by the caller too, so
    only the hops our own proxies added are believed: with TRUSTED_PROXY_COUNT
    proxies in front (nginx: 1), the address the outermost one saw."""
    if not request:
        return None
    hops = getattr(settings, 'TRUSTED_PROXY_COUNT', 0)
    ip = request.META.get('REMOTE_ADDR')
    if hops:
        chain = [p.strip() for p in request.META.get('HTTP_X_FORWARDED_FOR', '').split(',') if p.strip()]
        if len(chain) >= hops:
            ip = chain[-hops]
    return ip[:45] if ip else None


# ── Wrong codes ─────────────────────────────────────────────────────────────

def _fail_key(user):
    return f'admin2fa:fails:{user.pk}'


def _lock_key(user):
    return f'admin2fa:lock:{user.pk}'


def locked_out(user):
    """Seconds left on a lock after too many wrong codes, else 0."""
    from django.core.cache import cache
    until = cache.get(_lock_key(user))
    return max(0, int(until - time.time())) if until else 0


def code_failed(user):
    """Count a wrong code; True when this one locked the account."""
    from django.core.cache import cache
    key = _fail_key(user)
    cache.add(key, 0, LOCK_MINUTES * 60)
    try:
        fails = cache.incr(key)
    except ValueError:
        cache.set(key, 1, LOCK_MINUTES * 60)
        fails = 1
    if fails >= MAX_FAILURES:
        cache.set(_lock_key(user), time.time() + LOCK_MINUTES * 60, LOCK_MINUTES * 60)
        cache.delete(key)
        return True
    return False


def code_passed(user):
    from django.core.cache import cache
    cache.delete(_fail_key(user))


# ── The gate every admin permission goes through ────────────────────────────

class AdminDenied(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def check_admin(request, allowed, recent=False):
    """Raise AdminDenied unless the request may use an admin power that
    `allowed(user)` grants. `recent`: a code must have been entered within
    REAUTH_MINUTES (the dangerous actions)."""
    user = request.user
    if not (user and user.is_authenticated and allowed(user)):
        raise AdminDenied('not_admin', 'You do not have permission for this action.')
    if not in_good_standing(user):
        raise AdminDenied('not_admin', 'Your account cannot use admin tools right now.')
    if not two_factor_required():
        return
    session = getattr(request, '_admin_session', None)
    if session is None:
        session = session_for(request)
        request._admin_session = session
    if not session:
        raise AdminDenied('admin_session_required', 'Confirm it is you with your authenticator code.')
    if recent and session.verified_at < timezone.now() - timedelta(minutes=REAUTH_MINUTES):
        raise AdminDenied('reauth_required', 'Enter a fresh code to confirm this action.')
