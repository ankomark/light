from .common import *  # noqa: F401,F403


def _send_verification_email(user, background=False):
    """Generate a 6-digit code and email it to the user. Returns the code.

    The code row is always written synchronously — it has to exist before the
    email can be acted on. Only the SMTP round trip is optional.

    `background=True` hands that round trip to the task pool. Use it where a
    send failure is already being swallowed, because there the synchronous call
    buys nothing and costs the user the whole SMTP handshake: with a real mail
    backend that is a connect + TLS + auth to the provider, seconds on a bad
    day, and it lands on signup — the slowest, most abandonable moment in the
    app. Callers that actually SHOW the user a send failure (resend, password
    reset) must stay synchronous; they cannot report what they did not wait for.
    """
    import secrets
    from ..emails import send_branded_mail
    from django.utils import timezone
    from datetime import timedelta

    # From the OS's secure source: `random` is predictable from its own
    # earlier outputs, and these codes stand in for a password.
    code = f"{secrets.randbelow(1000000):06d}"
    expires_at = timezone.now() + timedelta(minutes=15)
    EmailVerification.objects.create(user=user, code=code, expires_at=expires_at)

    def _send():
        send_branded_mail(
            subject=f"{code} is your {settings.SITE_NAME} verification code",
            message=(
                f"Hi {user.username},\n\n"
                f"Your verification code is: {code}\n\n"
                f"This code expires in 15 minutes.\n\n"
                f"If you didn't create an account, you can ignore this email.\n\n"
                f"— {settings.SITE_NAME} Team"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
            code=code,
        )

    if background:
        from ..tasks import run_in_background
        run_in_background(_send)
    else:
        _send()
    return code



def _device_fields(request):
    """What the phone says it is (display text only, never trusted for
    anything): headers set by the app, cut to size and stripped of control
    characters."""
    def clean(header, limit):
        value = str(request.headers.get(header) or '')
        return ''.join(ch for ch in value if ch.isprintable()).strip()[:limit]
    platform = clean('X-Device-Platform', 10).lower()
    return {
        'name': clean('X-Device-Name', 80),
        'platform': platform if platform in ('ios', 'android', 'web') else '',
        'app_version': clean('X-App-Version', 20),
    }


def _record_device(request, user_id, refresh_str, previous_jti=None):
    """The session `refresh_str` belongs to is on this phone. On a refresh
    (`previous_jti`) the existing row moves to the new token instead."""
    from ..models import SessionDevice
    jti = _refresh_jti(refresh_str)
    if not (jti and user_id):
        return
    fields = {k: v for k, v in _device_fields(request).items() if v}
    if previous_jti and SessionDevice.objects.filter(jti=previous_jti, user_id=user_id).update(jti=jti, **fields):
        return
    SessionDevice.objects.update_or_create(jti=jti, defaults={'user_id': user_id, **fields})


def _forget_devices(jtis):
    from ..models import SessionDevice
    SessionDevice.objects.filter(jti__in=[j for j in jtis if j]).delete()


class DeviceTokenRefreshView(TokenRefreshView):
    """The usual refresh, keeping track of which phone the session is on as
    its token rotates."""

    def post(self, request, *args, **kwargs):
        old = _refresh_jti(request.data.get('refresh'))   # before rotation blacklists it
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200 and old and response.data.get('refresh'):
            try:
                from rest_framework_simplejwt.tokens import RefreshToken
                user_id = RefreshToken(response.data['refresh']).get('user_id')
                _record_device(request, user_id, response.data['refresh'], previous_jti=old)
            except Exception:  # noqa: BLE001 — naming a device never breaks a refresh
                pass
        return response


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login endpoint with a tight per-IP rate limit to deter credential stuffing.
    On a successful login it fires a best-effort security alert to the account's
    already-registered devices (so a sign-in on a new device is visible)."""
    throttle_scope = 'auth'

    @staticmethod
    def canonical_username(typed):
        """The account's stored username for what was typed: "Mark" signs in
        "mark" (sign-up keeps names unique whatever the capitals, but sign-in
        compared them exactly - a capital from the phone's keyboard read as a
        wrong password), and an email address signs in its account. Left as
        typed when nothing (or more than one old account) matches."""
        typed = (typed or '').strip()
        if not typed or User.objects.filter(username=typed).exists():
            return typed
        field = 'email__iexact' if '@' in typed else 'username__iexact'
        names = list(User.objects.filter(**{field: typed}).values_list('username', flat=True)[:2])
        return names[0] if len(names) == 1 else typed

    def post(self, request, *args, **kwargs):
        from .. import security
        from ..models import LoginAttempt
        # One spelling per account from here on: the wrong-password lock and
        # the records count "Mark", "mark" and "MARK" as the one account
        # (cycling capitals got three times the guesses).
        typed = str(request.data.get('username') or '')[:150]
        canonical = self.canonical_username(typed)
        if canonical != request.data.get('username'):
            data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
            data['username'] = canonical
            request._full_data = data
        # A ban with an end date that has passed is lifted as they sign in.
        username = canonical
        if username:
            from django.utils import timezone as tz
            User.objects.filter(username=username, is_active=False, banned_until__isnull=False,
                                banned_until__lte=tz.now()).update(
                is_active=True, ban_reason='', banned_at=None, banned_until=None)
            # Locked after too many wrong passwords (songs/security.py): not
            # even the right one opens it until the lock runs out — the owner
            # can still reset their password by email.
            from ..admin_security import client_ip
            left = security.login_refusal(username, client_ip(request))
            if left:
                security.record_login(request, username, None, LoginAttempt.LOCKED)
                return Response({'detail': 'Too many wrong passwords. Try again later or reset your password.',
                                 'code': 'account_locked', 'retry_after': left},
                                status=status.HTTP_403_FORBIDDEN)
        def failed():
            # Every failed sign-in is written down, and counted towards
            # spotting a password being guessed or stolen ones being tried.
            if not username:
                return
            try:
                who = User.objects.filter(username=username).first()
                outcome = (LoginAttempt.UNKNOWN if who is None
                           else LoginAttempt.BANNED if not who.is_active else LoginAttempt.BAD_PASSWORD)
                security.record_login(request, username, who, outcome)
                security.after_failure(request, username, who)
            except Exception:  # noqa: BLE001 — watching never breaks signing in
                logger.exception('could not record a failed sign-in')

        # A wrong password comes back as an exception, not a response.
        from rest_framework.exceptions import AuthenticationFailed
        from rest_framework_simplejwt.exceptions import InvalidToken
        try:
            response = super().post(request, *args, **kwargs)
        except (AuthenticationFailed, InvalidToken):
            failed()
            raise
        if response.status_code != 200:
            failed()
        if response.status_code == 200:
            try:
                from .common import notify_user
                username = request.data.get('username')
                user = User.objects.filter(username=username).first()
                if user:
                    security.record_login(request, username, user, LoginAttempt.OK)
                    security.after_success(request, user)
                    _record_device(request, user.pk, response.data.get('refresh'))
                    # Logging back in auto-reactivates a self-deactivated account.
                    if user.is_deactivated:
                        user.is_deactivated = False
                        user.deactivated_at = None
                        user.save(update_fields=['is_deactivated', 'deactivated_at'])
                    from ..recovery import tell_new_sign_in
                    tell_new_sign_in(user, str(request.headers.get('X-Device-Name') or '')[:80])
            except Exception:
                pass  # never let alerting break login
        return response



class SignUpView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        from .. import security
        # Paused by an admin during an attack, or too many accounts from this
        # address in the last hour (songs/security.py).
        refused = security.signup_refusal(request)
        if refused:
            return Response({'error': 'New accounts cannot be made just now. Please try again later.',
                             'code': f'signups_{refused}'}, status=status.HTTP_403_FORBIDDEN)
        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            try:
                security.after_signup(request, user)
            except Exception:  # noqa: BLE001 — watching never breaks signing up
                logger.exception('could not check a new sign-up')
            # Account is created regardless; a failed verification email can be
            # resent later (and verification is gated off until SMTP is ready).
            #
            # Backgrounded precisely BECAUSE the failure is swallowed here: the
            # response is identical either way, so waiting out the SMTP
            # handshake only delays the account the user just asked for. The
            # task pool logs anything that goes wrong, and "Resend code" is the
            # recovery path — that one still waits, and still reports.
            try:
                _send_verification_email(user, background=True)
            except Exception as exc:  # noqa: BLE001
                logger.error("Verification email failed at signup for %s: %s", user.email, exc)
            return Response(
                {"message": "Account created. Please check your email to verify."},
                status=status.HTTP_201_CREATED
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)



class VerifyEmailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'email_verify'

    def post(self, request):
        code = str(request.data.get('code') or '').strip()[:20]
        if not code:
            return Response({'error': 'Code is required'}, status=status.HTTP_400_BAD_REQUEST)

        verification = EmailVerification.objects.filter(
            user=request.user, code=code, used=False
        ).first()

        if not verification or not verification.is_valid():
            return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)

        verification.used = True
        verification.save()
        request.user.is_email_verified = True
        request.user.save(update_fields=['is_email_verified'])
        return Response({'message': 'Email verified successfully'})



class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'email_verify'

    def post(self, request):
        if request.user.is_email_verified:
            return Response({'message': 'Email already verified'})
        try:
            _send_verification_email(request.user)
        except Exception as exc:  # noqa: BLE001 — surface the real send failure
            logger.error("Resend verification email failed for %s: %s", request.user.email, exc)
            return Response(
                {'error': 'We could not send the verification email right now. Please try again shortly.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({'message': 'Verification code sent'})



class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        import secrets
        from ..emails import send_branded_mail
        from datetime import timedelta

        email = str(request.data.get('email') or '').strip()[:254]
        if not email:
            return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

        # The same answer whether or not the email has an account: saying "no
        # account" let anyone test which addresses are members here.
        sent = Response({'message': 'If an account uses this email, a reset code has been sent to it.'})
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return sent

        code = f"{secrets.randbelow(1000000):06d}"
        expires_at = timezone.now() + timedelta(minutes=15)
        PasswordResetCode.objects.create(user=user, code=code, expires_at=expires_at)
        cache.delete(_reset_failures_key(user))

        # Send synchronously so a real SMTP failure surfaces to the user instead
        # of a false "code sent" (auth emails must be reliable, not fire-and-forget).
        try:
            send_branded_mail(
                subject=f"{code} is your {settings.SITE_NAME} password reset code",
                message=(
                    f"Hi {user.username},\n\n"
                    f"Your password reset code is: {code}\n\n"
                    f"This code expires in 15 minutes.\n\n"
                    f"If you didn't request this, you can ignore this email.\n\n"
                    f"— {settings.SITE_NAME} Team"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
                code=code,
            )
        except Exception as exc:  # noqa: BLE001 — surface the real send failure
            logger.error("Password reset email failed for %s: %s", user.email, exc)
            return Response(
                {'error': 'We could not send the reset email right now. Please try again shortly.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return sent



# Wrong reset codes allowed per account before every code it holds stops
# working. The per-IP throttle alone let someone with many addresses keep
# guessing at a six-digit code; this caps the guesses at the account.
RESET_MAX_FAILURES = 5


def _reset_failures_key(user):
    return f'reset-failures:{user.pk}'


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        # str(): a number or a list sent here was a 500, not a 400.
        email = str(request.data.get('email') or '').strip()[:254]
        code = str(request.data.get('code') or '').strip()[:20]
        new_password = str(request.data.get('new_password') or '')

        if not all([email, code, new_password]):
            return Response({'error': 'email, code, and new_password are required'}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 8:
            return Response({'error': 'Password must be at least 8 characters'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid code'}, status=status.HTTP_400_BAD_REQUEST)

        failures_key = _reset_failures_key(user)
        if (cache.get(failures_key) or 0) >= RESET_MAX_FAILURES:
            return Response({'error': 'Too many wrong codes. Ask for a new code.', 'code': 'too_many'},
                            status=status.HTTP_400_BAD_REQUEST)
        reset = PasswordResetCode.objects.filter(user=user, code=code, used=False).first()
        if not reset or not reset.is_valid():
            if not cache.add(failures_key, 1, 60 * 60):
                try:
                    cache.incr(failures_key)
                except ValueError:
                    cache.set(failures_key, 1, 60 * 60)
            if (cache.get(failures_key) or 0) >= RESET_MAX_FAILURES:
                # Every code out for this account stops working at once.
                PasswordResetCode.objects.filter(user=user, used=False).update(used=True)
            return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)

        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            validate_password(new_password, user)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        reset.used = True
        reset.save()
        user.set_password(new_password)
        user.save()
        cache.delete(failures_key)
        # A reset is how someone takes their account back: whoever else was
        # signed in to it is signed out, and their phones stop getting its pushes.
        _revoke_other_sessions(user, all_devices=True)
        from ..recovery import security_email
        security_email(user.email, 'Your password was reset',
                       f'Hi {user.username},\n\nYour password was just reset with a code sent to this email, and '
                       "every device was signed out. If this wasn't you, ask us for help from the sign-in screen.")
        return Response({'message': 'Password reset successfully. Please log in with your new password.'})



def _refresh_jti(refresh_str):
    """Extract the jti from a refresh token string, or None if it's invalid."""
    if not refresh_str:
        return None
    from rest_framework_simplejwt.tokens import RefreshToken
    from rest_framework_simplejwt.exceptions import TokenError
    try:
        return RefreshToken(refresh_str).get('jti')
    except TokenError:
        return None


def _revoke_other_sessions(user, keep_jti=None, keep_device=None, all_devices=False):
    """Blacklist every active refresh token for `user` except the one matching
    keep_jti (so the calling device stays signed in). Returns the count revoked.

    Phones signed out this way stop getting the account's pushes too: a
    stolen phone signed out of the app went on showing message previews on
    its lock screen. The calling phone names its own push token
    (`keep_device`) to keep it; `all_devices` stops every one. With neither
    (an older app), pushes are left alone rather than cutting off the caller."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
    from ..admin_security import end_sessions
    # Signed out elsewhere (a new password, "sign out everywhere"): the admin
    # tools ask for a code again too.
    end_sessions(user, 'signed out elsewhere')
    revoked = 0
    gone = []
    for ot in OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True):
        if keep_jti and ot.jti == keep_jti:
            continue
        BlacklistedToken.objects.get_or_create(token=ot)
        gone.append(ot.jti)
        revoked += 1
    _forget_devices(gone)
    if all_devices or keep_device:
        from ..models import DeviceToken
        devices = DeviceToken.objects.filter(user=user, is_active=True)
        if not all_devices:
            devices = devices.exclude(token=keep_device)
        devices.update(is_active=False)
    return revoked


def _device_token(request):
    """The push token the calling phone sends, to keep its own notifications."""
    return str(request.data.get('device_token') or '').strip() or None


class ChangePasswordView(APIView):
    """Authenticated password change: verify the current password, then set a new
    one. Unlike the email-code reset flow, this is for users who are signed in.
    On success, all *other* sessions are revoked (the current device stays in if
    it sends its refresh token)."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        current = request.data.get('current_password', '')
        new_password = request.data.get('new_password', '')

        if not current or not new_password:
            return Response(
                {'error': 'current_password and new_password are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not request.user.check_password(current):
            return Response({'error': 'Current password is incorrect', 'code': 'wrong_password'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new_password, request.user)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save()
        # Security: revoke every other session, keeping the current device signed
        # in when it supplies its refresh token.
        revoked = _revoke_other_sessions(request.user, keep_jti=_refresh_jti(request.data.get('refresh')),
                                         keep_device=_device_token(request))
        from ..recovery import security_email
        security_email(request.user.email, 'Your password was changed',
                       f'Hi {request.user.username},\n\nThe password of your account was just changed and other '
                       "devices were signed out. If this wasn't you, reset your password now with \"Forgot "
                       'password" on the sign-in screen, or ask us for help from there.')
        return Response({'message': 'Password updated successfully.', 'sessions_revoked': revoked})


class SessionsView(APIView):
    """List the user's active sessions (non-blacklisted, unexpired refresh
    tokens)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        from django.utils import timezone
        # Only this person's tokens, joined to the blacklist — reading every
        # revoked token of every user into memory grew with the whole app.
        rows = (
            OutstandingToken.objects
            .filter(user=request.user, expires_at__gt=timezone.now(), blacklistedtoken__isnull=True)
            .order_by('-created_at')
        )
        # From a header: a token in the URL is written into every access log
        # between the phone and here. The query parameter is still read for
        # app builds from before the header.
        current_jti = _refresh_jti(request.headers.get('X-Refresh-Token')
                                   or request.query_params.get('refresh'))
        from ..models import SessionDevice
        rows = list(rows)
        devices = {d.jti: d for d in SessionDevice.objects.filter(jti__in=[r.jti for r in rows])}
        sessions = []
        for r in rows:
            device = devices.get(r.jti)
            sessions.append({
                'id': r.id,
                # Signed in on that phone (a refresh renews the token, not the sign-in).
                'created_at': device.created_at if device else r.created_at,
                'expires_at': r.expires_at,
                'current': bool(current_jti and r.jti == current_jti),
                'device_name': device.name if device else '',
                'platform': device.platform if device else '',
                'app_version': device.app_version if device else '',
                'last_seen_at': device.last_seen_at if device else r.created_at,
            })
        return Response({'count': len(sessions), 'sessions': sessions})


class RevokeSessionView(APIView):
    """Revoke (blacklist) a single session by its outstanding-token id."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        tid = request.data.get('id')
        if not str(tid or '').isdigit():
            return Response({'error': 'id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ot = OutstandingToken.objects.get(id=tid, user=request.user)
        except OutstandingToken.DoesNotExist:
            return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
        BlacklistedToken.objects.get_or_create(token=ot)
        _forget_devices([ot.jti])
        return Response({'status': 'revoked'})


class RevokeOtherSessionsView(APIView):
    """Log out of all other devices, keeping the current one (which sends its
    refresh token) signed in."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        revoked = _revoke_other_sessions(request.user, keep_jti=_refresh_jti(request.data.get('refresh')),
                                         keep_device=_device_token(request))
        return Response({'status': 'ok', 'revoked': revoked})


class ExportDataView(APIView):
    """Return a JSON snapshot of the user's own data (account, profile, posts,
    comments, playlists, tracks) — a lightweight GDPR-style export."""
    permission_classes = [IsAuthenticated]
    # A few thousand rows and a dozen counts: a person needs it now and then,
    # not in a loop.
    throttle_scope = 'data_export'

    def get(self, request):
        from django.utils import timezone
        u = request.user
        prof = getattr(u, 'profile', None)

        def iso(dt):
            return dt.isoformat() if dt else None

        data = {
            'exported_at': timezone.now().isoformat(),
            'account': {
                'username': u.username,
                'email': u.email,
                'date_joined': iso(u.date_joined),
                'is_email_verified': u.is_email_verified,
            },
            'profile': None if not prof else {
                'bio': prof.bio,
                'location': prof.location,
                'birth_date': iso(prof.birth_date),
                'is_public': prof.is_public,
            },
            'stats': {
                'followers': u.followers.count(),
                'following': u.followed_by.count(),
            },
            'posts': [
                {'id': p.id, 'caption': p.caption, 'content_type': p.content_type, 'created_at': iso(p.created_at)}
                for p in SocialPost.objects.filter(user=u).order_by('-created_at')[:1000]
            ],
            'comments': [
                {'id': c.id, 'content': c.content, 'created_at': iso(c.created_at)}
                for c in PostComment.objects.filter(user=u).order_by('-created_at')[:1000]
            ],
            'playlists': [
                {'id': pl.id, 'name': getattr(pl, 'name', getattr(pl, 'title', ''))}
                for pl in Playlist.objects.filter(user=u)
            ],
            'tracks': [
                {'id': t.id, 'title': t.title, 'created_at': iso(getattr(t, 'created_at', None))}
                for t in Track.objects.filter(artist=u)
            ],
        }
        data.update(_more_to_export(u, iso))
        data.update(_conversations_and_books(u, iso))
        return Response(data)


# The most of each kind an export carries: enough for anyone's real history,
# bounded so one request can never read a whole table.
EXPORT_MAX = 2000


def _conversations_and_books(u, iso):
    """What a person wrote to others and read: their side of direct messages
    (with whom, when), the groups they are in and what they posted there,
    their books, highlights and reading, their stories and quiz rounds.

    Only what they wrote themselves: the other side of a chat is the other
    person's, and is not handed over in someone else's export."""
    from ..models import (
        BookHighlight, GroupMember, GroupPost, Message, Publication, QuizSession, ReadingProgress, Story,
    )
    messages = (Message.objects.filter(sender=u, is_deleted=False)
                .select_related('conversation').prefetch_related('conversation__participants')
                .order_by('-created_at')[:EXPORT_MAX])
    return {
        'messages_sent': [{
            'to': sorted(p.username for p in m.conversation.participants.all() if p.pk != u.pk),
            'type': m.message_type, 'content': m.content, 'attachment': m.attachment or None,
            'created_at': iso(m.created_at), 'edited_at': iso(m.edited_at),
        } for m in messages],
        'groups': [{
            'name': gm.group.name, 'joined_at': iso(gm.joined_at),
            'admin': gm.is_admin, 'moderator': gm.is_moderator,
        } for gm in GroupMember.objects.filter(user=u).select_related('group').order_by('-joined_at')[:EXPORT_MAX]],
        'group_posts': [{
            'group': gp.group.name, 'type': gp.message_type, 'content': gp.content,
            'attachment': gp.attachment or None, 'created_at': iso(gp.created_at),
        } for gp in (GroupPost.objects.filter(user=u, is_removed=False).select_related('group')
                     .order_by('-created_at')[:EXPORT_MAX])],
        'books_written': [{
            'title': p.title, 'summary': p.summary, 'status': p.status,
            'created_at': iso(p.created_at), 'published_at': iso(p.published_at),
            'chapters': [{'order': c.order, 'title': c.title, 'body': c.body, 'status': c.status}
                         for c in p.chapters.filter(is_removed=False).order_by('order')],
        } for p in Publication.objects.filter(author=u).prefetch_related('chapters').order_by('-created_at')[:200]],
        'book_highlights': [{
            'book': h.publication.title, 'quote': h.quote, 'note': h.note,
            'collection': h.collection, 'created_at': iso(h.created_at),
        } for h in (BookHighlight.objects.filter(user=u, deleted=False).select_related('publication')
                    .order_by('-created_at')[:EXPORT_MAX])],
        'reading': [{
            'book': r.publication.title, 'percent': round(r.percent, 1),
            'finished_at': iso(r.finished_at), 'updated_at': iso(r.updated_at),
        } for r in ReadingProgress.objects.filter(user=u).select_related('publication').order_by('-updated_at')[:500]],
        'stories': [{
            'caption': s.caption, 'type': s.content_type, 'media': s.media_url or None,
            'created_at': iso(s.created_at),
        } for s in Story.objects.filter(user=u, is_removed=False).order_by('-created_at')[:500]],
        'quiz_rounds': [{
            'mode': q.mode, 'topic': q.topic or None, 'points': q.points,
            'started_at': iso(q.started_at), 'finished_at': iso(q.finished_at),
        } for q in QuizSession.objects.filter(user=u, is_finished=True).order_by('-started_at')[:500]],
    }


def _more_to_export(u, iso):
    """The rest of what is theirs: the marketplace (what they bought, what
    they sell, what they saved), the games, and their notification choices."""
    from ..models import (
        NotificationPreference, Order, Product, PuzzleProgress, QuizAttempt, Wishlist,
    )
    from ..scoring import coin_balance
    from ..streaks import streak_for
    prefs = NotificationPreference.objects.filter(user=u).first()
    earned, spent, balance = coin_balance(u)
    streak, best, _ = streak_for(u)
    wishlist = Wishlist.objects.filter(user=u).first()
    return {
        'orders': [{
            'id': o.id, 'status': o.status, 'created_at': iso(o.created_at),
            'items': [{'title': i.title, 'quantity': i.quantity, 'price': str(i.price_at_purchase),
                       'currency': i.currency} for i in o.items.all()],
        } for o in Order.objects.filter(buyer=u).prefetch_related('items').order_by('-created_at')[:500]],
        'products': [{
            'title': p.title, 'price': str(p.price), 'currency': p.currency, 'quantity': p.quantity,
            'created_at': iso(p.created_at),
        } for p in Product.objects.filter(seller=u).order_by('-created_at')[:500]],
        'wishlist': [p.title for p in (wishlist.products.all() if wishlist else [])],
        'games': {
            'coins_earned': earned, 'coins_spent': spent, 'coins': balance,
            'day_streak': streak, 'best_day_streak': best,
            'daily_quizzes': QuizAttempt.objects.filter(user=u).count(),
            'puzzle_levels_finished': PuzzleProgress.objects.filter(user=u, is_complete=True).count(),
        },
        'notification_preferences': None if not prefs else {
            f.name: getattr(prefs, f.name) for f in prefs._meta.fields
            if f.name not in ('id', 'user', 'updated_at')
        },
    }


class TestPushView(APIView):
    """POST /auth/test-push/ — a push to my own devices, to see that they
    arrive. Not held back by quiet hours or switches: it was asked for."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from ..models import DeviceToken
        from ..push import notify_user
        devices = DeviceToken.objects.filter(user=request.user, is_active=True).count()
        if not devices:
            return Response({'devices': 0, 'code': 'no_devices'})
        if not cache.add(f'test-push:{request.user.pk}', 1, 30):
            return Response({'error': 'Wait a moment before sending another.', 'code': 'too_soon'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        notify_user(request.user, 'test', 'Notifications are working on this device.')
        return Response({'devices': devices})


def open_orders_of(user):
    """Marketplace orders still under way that `user` is in, as buyer or as a
    seller with a part not yet delivered or called off. Leaving with one open
    strands the other side: a buyer who may have paid, with no seller; or a
    seller whose sale vanishes with the buyer's account."""
    from ..models import Order, OrderItem
    buying = Order.objects.filter(buyer=user).exclude(status__in=('DELIVERED', 'CANCELLED', 'REFUNDED'))
    selling = (OrderItem.objects.filter(seller=user, cancelled_at__isnull=True, delivered_at__isnull=True)
               .exclude(order__status__in=('DELIVERED', 'CANCELLED', 'REFUNDED')))
    return buying.count() + selling.values('order').distinct().count()


def _refuse_with_open_orders(user):
    n = open_orders_of(user)
    if not n:
        return None
    return Response({
        'error': f'You have {n} marketplace order(s) still under way. Finish or cancel them first, '
                 'so no buyer or seller is left waiting.',
        'code': 'open_orders', 'open_orders': n,
    }, status=status.HTTP_409_CONFLICT)


class DeactivateAccountView(APIView):
    """Reversible self-deactivation: hides the user's content/profile while
    letting them sign back in to reactivate. Password-confirmed; revokes other
    sessions so the account goes dark everywhere."""
    permission_classes = [IsAuthenticated]
    # A password check: not to be guessed at, even with a stolen session.
    throttle_scope = 'account_leave'

    def post(self, request):
        from django.utils import timezone
        password = request.data.get('password', '')
        if not password:
            return Response({'error': 'password is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(password):
            return Response({'error': 'Password is incorrect', 'code': 'wrong_password'}, status=status.HTTP_400_BAD_REQUEST)
        refused = _refuse_with_open_orders(request.user)
        if refused:
            return refused

        request.user.is_deactivated = True
        request.user.deactivated_at = timezone.now()
        request.user.save(update_fields=['is_deactivated', 'deactivated_at'])
        # Dark everywhere, pushes included; signing back in reactivates.
        _revoke_other_sessions(request.user, all_devices=True)
        return Response({'status': 'deactivated'})


class DeleteAccountView(APIView):
    """Self-service account deletion. Requires the current password as a
    confirmation, then permanently removes the account (cascades to the user's
    content via the related models' on_delete rules)."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'account_leave'

    def post(self, request):
        password = request.data.get('password', '')
        if not password:
            return Response({'error': 'password is required to delete your account'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(password):
            return Response({'error': 'Password is incorrect', 'code': 'wrong_password'}, status=status.HTTP_400_BAD_REQUEST)
        refused = _refuse_with_open_orders(request.user)
        if refused:
            return refused

        # Their files go too (songs/account_purge.py): found before the rows
        # that name them are gone, removed after, off the request thread.
        from ..account_purge import files_of, purge
        from ..tasks import run_in_background
        try:
            files = files_of(request.user)
        except Exception:  # noqa: BLE001 — finding the files never blocks leaving
            logger.exception('could not list the files of account %s', request.user.pk)
            files = set()
        request.user.delete()
        if files:
            run_in_background(purge, sorted(files))
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotMeView(APIView):
    """POST /auth/not-me/ {refresh, device_token}: the owner, warned of a new
    sign-in, says it was not them. Every other device is signed out now and
    stops getting the account's notifications, the admins are told, and the
    app takes them to a new password (someone else knows the old one)."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'account_leave'

    def post(self, request):
        from .. import security
        from ..admin_security import client_ip
        revoked = _revoke_other_sessions(request.user, keep_jti=_refresh_jti(request.data.get('refresh')),
                                         keep_device=_device_token(request))
        security.raise_event('account_takeover', f'@{request.user.username} says a sign-in was not them; '
                             f'{revoked} other session(s) signed out.', ip=client_ip(request) or '',
                             user=request.user, severity='high')
        return Response({'revoked': revoked, 'next': 'change_password'})


class RecoveryRequestView(APIView):
    """POST /auth/recovery-request/ {account, contact_email, details}: someone
    who cannot get in at all asks for help. Always the same answer — whether
    an account matched is not said — and a case for the admins."""
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjangoValidationError
        from ..admin_security import client_ip
        from ..models import RecoveryCase
        account = str(request.data.get('account') or '').strip().lstrip('@')[:254]
        contact = str(request.data.get('contact_email') or '').strip()[:254]
        details = str(request.data.get('details') or '').strip()[:2000]
        if not account or len(details) < 20:
            return Response({'error': 'Tell us the account and what happened (a few sentences).',
                             'code': 'too_short'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(contact)
        except DjangoValidationError:
            return Response({'error': 'An email we can reach you at.', 'code': 'bad_email'},
                            status=status.HTTP_400_BAD_REQUEST)
        user = (User.objects.filter(username__iexact=account).first()
                or User.objects.filter(email__iexact=account).first())
        case = RecoveryCase.objects.create(user=user, account=account, contact_email=contact, details=details,
                                           ip=client_ip(request) or '')
        try:
            from ..admin_alerts import alert
            alert(f'recovery:{case.pk}', f'Account recovery asked for "{account}". See the Security centre.')
        except Exception:  # noqa: BLE001
            pass
        return Response({'message': 'We have your request. We will email you at the address you gave.'},
                        status=status.HTTP_201_CREATED)


class AuthStatusView(APIView):
    """Lightweight status for the signed-in user — works whether or not a
    profile exists yet, so the app can gate on email verification and route
    new users to verification / profile creation."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        require_verification = getattr(settings, 'REQUIRE_EMAIL_VERIFICATION', False)
        # When verification isn't required (no SMTP yet), report everyone as
        # "verified" so the app never gates on it.
        effective_verified = user.is_email_verified or not require_verification
        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_email_verified': effective_verified,
            'email_verified_actual': user.is_email_verified,
            'verification_required': require_verification,
            'has_profile': hasattr(user, 'profile') and user.profile is not None,
            'is_suspended': getattr(user, 'is_suspended', False),
            'suspension_reason': getattr(user, 'suspension_reason', ''),
            'admin_role': getattr(user, 'admin_role', ''),
        })


class LogoutView(APIView):
    """Revoke a refresh token by blacklisting it, and stop this phone's push
    notifications for the account — one call, so the app can sign out in a
    single request (and retry it later when it was offline).

    AllowAny: possession of a valid refresh token is sufficient (and the auth
    header is stripped for /auth/ routes client-side anyway). The device token
    is only switched off for the refresh token's own user.

    Body: {refresh, device_token?}"""
    permission_classes = [AllowAny]

    def post(self, request):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.exceptions import TokenError
        from songs.models import DeviceToken

        refresh = request.data.get('refresh')
        if not refresh:
            return Response({'error': 'refresh token is required'}, status=status.HTTP_400_BAD_REQUEST)
        user_id = None
        try:
            token = RefreshToken(refresh)
            user_id = token.get('user_id')
            # A deleted account's token has nothing left to revoke, and
            # blacklisting it would try to remake a row for a user that is gone.
            if User.objects.filter(pk=user_id).exists():
                token.blacklist()
                _forget_devices([token.get('jti')])
        except TokenError:
            # Already expired/blacklisted/invalid — the goal (revoked) holds.
            # Whose it was can't be trusted, so no device token is touched.
            pass
        device_token = str(request.data.get('device_token') or '').strip()
        if user_id and device_token:
            DeviceToken.objects.filter(user_id=user_id, token=device_token).update(is_active=False)
        return Response({'message': 'Logged out'}, status=status.HTTP_205_RESET_CONTENT)

