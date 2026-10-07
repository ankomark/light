"""Seeing an attack, and stopping it.

What is watched, and what happens:

  password guessing    one account, many wrong passwords — the account's
                       sign-in is shut for a while, and the owner can still
                       reset their password by email;
  credential stuffing  one address trying many accounts — the address is
                       blocked for an hour;
  sign-up burst        many new accounts from one address — no more from it
                       for an hour;
  ban evasion          a new account (or a sign-in) from an address a banned
                       person used — flagged for an admin to look at;
  rate-limit spike     a flood of requests refused for going too fast.

Each becomes a SecurityEvent in the Security Centre and an alert to the super
admins (once an hour per thing). Admins can block or unblock addresses and
ranges, lock accounts, force a password reset, and switch on lockdown —
sign-ups paused, and the limits above halved — while an attack lasts.

Addresses come from admin_security.client_ip, which only believes the hops
our own proxies add (TRUSTED_PROXY_COUNT).
"""
import ipaddress
from datetime import timedelta

from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone

WINDOW = timedelta(minutes=15)
ACCOUNT_FAILS = 10           # wrong passwords on one account in WINDOW → locked
ACCOUNT_LOCK = 15 * 60
IP_FAILS = 20                # failures from one address in WINDOW …
IP_ACCOUNTS = 5              # … across this many accounts → address blocked
IP_BLOCK = timedelta(hours=1)
SIGNUPS_PER_IP = 5           # an hour
SIGNUP_PAUSE = 60 * 60
EVASION_DAYS = 30
THROTTLE_SPIKE = 300         # refusals for going too fast, in a minute
KEEP_DAYS = 90

BLOCKS_KEY = 'security:blocks'
LOCKDOWN_KEY = 'security:lockdown'


# ── lockdown ────────────────────────────────────────────────────────────────

def lockdown():
    """{'signups_paused': bool, 'strict': bool} — what an admin has switched on."""
    state = cache.get(LOCKDOWN_KEY)
    if state is None:
        from .models import SiteSetting
        row = SiteSetting.objects.filter(key='security').first()
        state = {'signups_paused': False, 'strict': False, **((row.value if row else None) or {})}
        cache.set(LOCKDOWN_KEY, state, 30)
    return state


def set_lockdown(changes, user):
    from .models import SiteSetting
    state = {**lockdown(), **{k: bool(v) for k, v in changes.items() if k in ('signups_paused', 'strict')}}
    SiteSetting.objects.update_or_create(key='security', defaults={'value': state, 'updated_by': user})
    cache.delete(LOCKDOWN_KEY)
    return lockdown()


def _limit(n):
    """A limit, halved while lockdown is strict."""
    return max(1, n // 2) if lockdown().get('strict') else n


# ── blocked addresses ───────────────────────────────────────────────────────

def is_internal(ip):
    """A private or loopback address. Seen on the sign-ins, it means the
    proxy hops are not set (TRUSTED_PROXY_COUNT): every request then looks as
    if it came from the proxy, and blocking it would shut everyone out. The
    rules never act on one — they say so instead."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local


def parse_network(text):
    """An address or a range as typed ('41.90.1.2', '41.90.0.0/16'), or None."""
    try:
        return ipaddress.ip_network(str(text).strip(), strict=False)
    except ValueError:
        return None


def _blocks():
    rows = cache.get(BLOCKS_KEY)
    if rows is None:
        from .models import BlockedIP
        now = timezone.now()
        rows = []
        for b in BlockedIP.objects.all():
            if b.expires_at and b.expires_at <= now:
                continue
            net = parse_network(b.network)
            if net:
                rows.append((net, b.expires_at.timestamp() if b.expires_at else None))
        cache.set(BLOCKS_KEY, rows, 60)
    return rows


def forget_blocks():
    cache.delete(BLOCKS_KEY)


def is_blocked(ip):
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    now = timezone.now().timestamp()
    return any(addr in net and (until is None or until > now) for net, until in _blocks() if addr.version == net.version)


def block(network, reason, user=None, hours=None, automatic=False):
    from .models import BlockedIP
    net = parse_network(network)
    if net is None:
        return None
    expires = timezone.now() + timedelta(hours=hours) if hours else None
    row, _ = BlockedIP.objects.update_or_create(
        network=str(net), defaults={'reason': reason[:255], 'created_by': user, 'automatic': automatic,
                                    'expires_at': expires})
    forget_blocks()
    return row


class BlockMiddleware:
    """Refuses everything from a blocked address, first thing; and counts the
    requests refused for going too fast, to see a flood."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.conf import settings
        from .admin_security import client_ip
        on = getattr(settings, 'SECURITY_BLOCKS', True)
        if on and request.path.startswith('/api/') and '/webhook' not in request.path:
            ip = client_ip(request)
            if is_blocked(ip):
                return JsonResponse({'code': 'blocked', 'detail': 'Access from this network is blocked.'},
                                    status=403)
        response = self.get_response(request)
        if on and response.status_code == 429:
            note_throttled(client_ip(request))
        return response


# ── events ──────────────────────────────────────────────────────────────────

def raise_event(kind, detail, ip='', user=None, severity='medium'):
    """A new SecurityEvent — or the open one for the same thing seen again
    (its count goes up) — and the super admins told once an hour."""
    from .models import SecurityEvent
    since = timezone.now() - timedelta(hours=1)
    event = (SecurityEvent.objects.filter(kind=kind, ip=ip or '', user=user, resolved_at__isnull=True,
                                          last_seen_at__gte=since).first())
    if event:
        event.count += 1
        event.detail = detail[:255]
        event.save(update_fields=['count', 'detail', 'last_seen_at'])
    else:
        event = SecurityEvent.objects.create(kind=kind, detail=detail[:255], ip=ip or '', user=user,
                                             severity=severity)
    try:
        from .admin_alerts import alert
        alert(f'security:{kind}:{ip}:{getattr(user, "pk", "")}', f'Security: {detail}')
    except Exception:  # noqa: BLE001 — an alert never stands in the way
        pass
    return event


def note_throttled(ip):
    key = f'security:429:{timezone.now():%Y%m%d%H%M}'
    cache.add(key, 0, 120)
    try:
        n = cache.incr(key)
    except ValueError:
        return
    if n == THROTTLE_SPIKE:
        raise_event('rate_limit_spike', f'{n} requests refused for going too fast in a minute '
                                        f'(latest from {ip or "unknown"}).', ip=ip or '', severity='medium')


# ── signing in ──────────────────────────────────────────────────────────────

def _lock_key(username):
    return f'security:locked:{username.lower()}'


def login_refusal(username, ip=None):
    """Seconds left on this account's sign-in lock, else 0.

    Not on an address the owner signed in from in the last 30 days: anyone
    can type wrong passwords at someone's name, and the lock must stop the
    guesser without locking the owner out at home."""
    until = cache.get(_lock_key(username))
    if not until:
        return 0
    if ip:
        from .models import LoginAttempt
        if LoginAttempt.objects.filter(username__iexact=username, ip=ip, outcome=LoginAttempt.OK,
                                       created_at__gte=timezone.now() - timedelta(days=30)).exists():
            return 0
    return max(0, int(until - timezone.now().timestamp()))


def lock_account(username, seconds=ACCOUNT_LOCK):
    cache.set(_lock_key(username), timezone.now().timestamp() + seconds, seconds)


def unlock_account(username):
    cache.delete(_lock_key(username))


def record_login(request, username, user, outcome):
    from .admin_security import client_ip
    from .models import LoginAttempt
    return LoginAttempt.objects.create(
        username=(username or '')[:150], user=user, ip=client_ip(request) or '', outcome=outcome,
        device_name=str(request.headers.get('X-Device-Name') or '')[:80],
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:255],
    )


def after_failure(request, username, user):
    """Count a failed sign-in against the account and the address; lock or
    block when it looks like an attack."""
    from .admin_security import client_ip
    from .models import LoginAttempt
    ip = client_ip(request) or ''
    since = timezone.now() - WINDOW
    failed = LoginAttempt.objects.filter(created_at__gte=since).exclude(outcome=LoginAttempt.OK)
    if user is not None:
        n = failed.filter(username__iexact=username).count()
        if n >= _limit(ACCOUNT_FAILS) and not login_refusal(username):
            lock_account(username)
            raise_event('password_guessing', f'{n} wrong passwords for @{user.username} in 15 minutes; '
                        f'sign-in locked for 15 minutes.', ip=ip, user=user, severity='high')
    if ip:
        from_ip = failed.filter(ip=ip)
        tries, accounts = from_ip.count(), from_ip.values('username').distinct().count()
        if tries >= _limit(IP_FAILS) and accounts >= _limit(IP_ACCOUNTS) and not is_blocked(ip):
            if is_internal(ip):
                raise_event('credential_stuffing', f'{tries} failed sign-ins on {accounts} accounts from the '
                            f'internal address {ip} — not blocked. If every sign-in shows this address, set '
                            f'TRUSTED_PROXY_COUNT.', ip=ip, severity='medium')
            else:
                block(ip, f'{tries} failed sign-ins on {accounts} accounts',
                      hours=IP_BLOCK.total_seconds() / 3600, automatic=True)
                raise_event('credential_stuffing', f'{tries} failed sign-ins on {accounts} accounts from {ip}; '
                            f'address blocked for an hour.', ip=ip, severity='high')


def after_success(request, user):
    from .admin_security import client_ip
    unlock_account(user.username)
    _check_evasion(client_ip(request) or '', user)


def _check_evasion(ip, user):
    """An address a banned person signed in from lately, now used by someone
    else: maybe them, back under a new name. Flagged, never acted on alone."""
    if not ip or is_internal(ip):
        return
    from .models import LoginAttempt
    since = timezone.now() - timedelta(days=EVASION_DAYS)
    banned = (LoginAttempt.objects.filter(ip=ip, outcome=LoginAttempt.OK, created_at__gte=since,
                                          user__is_active=False)
              .exclude(user=user).values_list('user__username', flat=True).distinct()[:3])
    banned = list(banned)
    if banned:
        raise_event('ban_evasion', f'@{user.username} used an address banned account(s) used: '
                    + ', '.join(f'@{u}' for u in banned), ip=ip, user=user, severity='medium')


# ── signing up ──────────────────────────────────────────────────────────────

def signup_refusal(request):
    """Why a sign-up is refused now ('paused', 'burst'), or None."""
    from .admin_security import client_ip
    if lockdown().get('signups_paused'):
        return 'paused'
    ip = client_ip(request)
    if ip and cache.get(f'security:signup-paused:{ip}'):
        return 'burst'
    return None


def after_signup(request, user):
    from .admin_security import client_ip
    ip = client_ip(request) or ''
    _check_evasion(ip, user)
    if not ip or is_internal(ip):
        return
    key = f'security:signups:{ip}'
    cache.add(key, 0, 60 * 60)
    try:
        n = cache.incr(key)
    except ValueError:
        return
    if n >= _limit(SIGNUPS_PER_IP):
        cache.set(f'security:signup-paused:{ip}', 1, SIGNUP_PAUSE)
        raise_event('signup_burst', f'{n} accounts made from {ip} in an hour; sign-ups from it paused '
                    f'for an hour.', ip=ip, severity='medium')


def prune(now=None):
    """Sign-in records older than KEEP_DAYS, and blocks that ran out."""
    from .models import BlockedIP, LoginAttempt
    now = now or timezone.now()
    gone = LoginAttempt.objects.filter(created_at__lt=now - timedelta(days=KEEP_DAYS)).delete()[0]
    BlockedIP.objects.filter(expires_at__lte=now).delete()
    forget_blocks()
    return gone
