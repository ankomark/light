"""Getting an account back (admin phase 6).

Three ways in:

  "This wasn't me"   the owner, warned of a new sign-in, says it was not them:
                     every other device is signed out at once and the admins
                     are told; the app takes them straight to a new password;
  reset by email     unchanged (views/auth.py ForgotPassword/ResetPassword);
  a recovery case    the owner cannot get in at all (the password and perhaps
                     the email changed by someone else): they ask for help,
                     and an admin who has checked it is theirs moves the
                     account to their email, sends a reset, signs everyone
                     else out.

Every change that matters to an account's safety — a new sign-in, a new
password, a new email — is also emailed to the owner, so a takeover cannot
happen silently.
"""
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)


def _site():
    return getattr(settings, 'SITE_NAME', 'Adventist Life')


def security_email(to, subject, body, background=True):
    """A plain security note by email; off the request unless asked."""
    if not to:
        return

    def _send():
        from django.core.mail import send_mail
        send_mail(subject=f'{_site()} — {subject}', message=f'{body}\n\n— {_site()} Team',
                  from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[to], fail_silently=True)
    if background:
        from .tasks import run_in_background
        run_in_background(_send)
    else:
        _send()


def send_reset_code(user):
    """A new password-reset code to the account's email. Raises when the
    mail server refuses (the caller says so)."""
    from django.core.mail import send_mail
    from .models import PasswordResetCode
    from .views.auth import _reset_failures_key
    code = f'{secrets.randbelow(1000000):06d}'
    PasswordResetCode.objects.create(user=user, code=code, expires_at=timezone.now() + timedelta(minutes=15))
    cache.delete(_reset_failures_key(user))
    send_mail(
        subject=f'{_site()} — Password Reset Code',
        message=(f'Hi {user.username},\n\nYour password reset code is: {code}\n\n'
                 f'This code expires in 15 minutes.\n\n'
                 f"If you didn't request this, you can ignore this email.\n\n— {_site()} Team"),
        from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[user.email], fail_silently=False,
    )
    return True


def tell_new_sign_in(user, device=''):
    """The owner hears of every new sign-in — by push (with "This wasn't me")
    and by email."""
    from .push import notify_user
    where = f' on {device}' if device else ''
    try:
        notify_user(user, 'security', f'New sign-in to your Adventist Life account{where}.',
                    data={'type': 'security_sign_in', 'device': device[:80],
                          'at': timezone.now().isoformat()})
    except Exception:  # noqa: BLE001 — telling never breaks signing in
        logger.exception('sign-in push failed')
    security_email(user.email, 'New sign-in',
                   f'Hi {user.username},\n\nYour account was just signed in to{where}.\n\n'
                   "If this was you, there is nothing to do. If it wasn't, open the app and choose "
                   '"This wasn\'t me" on the sign-in notice, or reset your password with "Forgot password" '
                   'on the sign-in screen.')
