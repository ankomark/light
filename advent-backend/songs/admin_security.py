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
    if not request:
        return None
    fwd = request.META.get('HTTP_X_FORWARDED_FOR', '')
    ip = (fwd.split(',')[0].strip() if fwd else request.META.get('REMOTE_ADDR')) or None
    return ip[:45] if ip else None


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
