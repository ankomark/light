"""
The ticketing server's staff API, called on behalf of a Streams admin.

Events & Tickets runs on its own server (tickets.smartbillsolution.com). Its
staff API — approving events, walking organisers' M-Pesa tills through
linking — trusts this server through a shared key (TICKETING_SERVICE_KEY,
which is STAFF_SERVICE_KEY there) and records the Streams admin named in
X-Acting-Admin. So a Streams admin with `manage_tickets` needs no account
there, and the key never reaches the app: only these two servers hold it.

Which admins may is decided here (views/admin_tickets.py: Cap('manage_tickets')
through the usual admin gate); the ticketing server keeps its own audit log of
what they did, and this server logs it in AdminActionLog as well.
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT = 20


class TicketingUnavailable(Exception):
    """Not configured, or the ticketing server couldn't be reached."""


class TicketingError(Exception):
    """The ticketing server answered with an error: passed on as it said it."""

    def __init__(self, status, body):
        super().__init__(body.get('detail') if isinstance(body, dict) else str(body))
        self.status = status
        self.body = body if isinstance(body, dict) else {'detail': str(body)}


def configured():
    return bool(settings.TICKETING_SERVICE_KEY and settings.TICKETING_API_URL)


def acting_as(user):
    """How the ticketing server's audit log names a Streams admin."""
    return f'streams:{user.pk} {user.username}'[:160]


def call(user, method, path, *, params=None, body=None):
    """One staff API call as `user`. Returns the decoded JSON body."""
    if not configured():
        raise TicketingUnavailable('Events & Tickets is not connected on this server (TICKETING_SERVICE_KEY).')
    url = f'{settings.TICKETING_API_URL}/api/v1/staff/{path.lstrip("/")}'
    try:
        response = requests.request(
            method, url, params=params, json=body, timeout=TIMEOUT,
            headers={
                'Authorization': f'Service {settings.TICKETING_SERVICE_KEY}',
                'X-Acting-Admin': acting_as(user),
                'Accept': 'application/json',
            },
        )
    except requests.RequestException as exc:
        logger.warning('[ticketing] %s %s failed: %s', method, path, exc)
        raise TicketingUnavailable('The ticket server could not be reached. Try again in a moment.') from exc

    try:
        data = response.json()
    except ValueError:
        data = {'detail': f'The ticket server answered HTTP {response.status_code}.'}

    if response.status_code in (401, 403):
        # Our key, not the admin: the admin already passed this server's check.
        logger.error('[ticketing] staff API refused the service key (%s): %s', response.status_code, data)
        raise TicketingUnavailable('The ticket server refused this server\'s key. Check TICKETING_SERVICE_KEY.')
    if response.status_code >= 400:
        raise TicketingError(response.status_code, data)
    return data
