from .common import *  # noqa: F401,F403


def _send_verification_email(user):
    """Generate a 6-digit code and email it to the user. Returns the code."""
    import random
    from django.core.mail import send_mail
    from django.utils import timezone
    from datetime import timedelta

    code = f"{random.randint(0, 999999):06d}"
    expires_at = timezone.now() + timedelta(minutes=15)
    EmailVerification.objects.create(user=user, code=code, expires_at=expires_at)

    # Synchronous so the caller can surface a real SMTP failure (raises on error).
    send_mail(
        subject=f"{settings.SITE_NAME} — Verify your email",
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
    )
    return code



class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login endpoint with a tight per-IP rate limit to deter credential stuffing.
    On a successful login it fires a best-effort security alert to the account's
    already-registered devices (so a sign-in on a new device is visible)."""
    throttle_scope = 'auth'

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            try:
                from .common import notify_user
                username = request.data.get('username')
                user = User.objects.filter(username=username).first()
                if user:
                    # Logging back in auto-reactivates a self-deactivated account.
                    if user.is_deactivated:
                        user.is_deactivated = False
                        user.deactivated_at = None
                        user.save(update_fields=['is_deactivated', 'deactivated_at'])
                    notify_user(user, 'security', 'New sign-in to your Adventist Life account.')
            except Exception:
                pass  # never let alerting break login
        return response



class SignUpView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = UserSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            # Account is created regardless; a failed verification email can be
            # resent later (and verification is gated off until SMTP is ready).
            try:
                _send_verification_email(user)
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
        code = request.data.get('code', '').strip()
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
        import random
        from django.core.mail import send_mail
        from datetime import timedelta

        email = request.data.get('email', '').strip()
        if not email:
            return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Product choice: give clear feedback for a community app. (This trades
            # off email-enumeration protection — switch back to a generic success
            # message if that ever becomes a concern.)
            return Response(
                {'error': 'No account is registered with this email address.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        code = f"{random.randint(0, 999999):06d}"
        expires_at = timezone.now() + timedelta(minutes=15)
        PasswordResetCode.objects.create(user=user, code=code, expires_at=expires_at)

        # Send synchronously so a real SMTP failure surfaces to the user instead
        # of a false "code sent" (auth emails must be reliable, not fire-and-forget).
        try:
            send_mail(
                subject=f"{settings.SITE_NAME} — Password Reset Code",
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
            )
        except Exception as exc:  # noqa: BLE001 — surface the real send failure
            logger.error("Password reset email failed for %s: %s", user.email, exc)
            return Response(
                {'error': 'We could not send the reset email right now. Please try again shortly.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({'message': 'A reset code has been sent to your email.'})



class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'password_reset'

    def post(self, request):
        email = request.data.get('email', '').strip()
        code = request.data.get('code', '').strip()
        new_password = request.data.get('new_password', '')

        if not all([email, code, new_password]):
            return Response({'error': 'email, code, and new_password are required'}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 8:
            return Response({'error': 'Password must be at least 8 characters'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid code'}, status=status.HTTP_400_BAD_REQUEST)

        reset = PasswordResetCode.objects.filter(user=user, code=code, used=False).first()
        if not reset or not reset.is_valid():
            return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)

        reset.used = True
        reset.save()
        user.set_password(new_password)
        user.save()
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


def _revoke_other_sessions(user, keep_jti=None):
    """Blacklist every active refresh token for `user` except the one matching
    keep_jti (so the calling device stays signed in). Returns the count revoked."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
    blacklisted = set(BlacklistedToken.objects.values_list('token_id', flat=True))
    revoked = 0
    for ot in OutstandingToken.objects.filter(user=user).exclude(id__in=blacklisted):
        if keep_jti and ot.jti == keep_jti:
            continue
        BlacklistedToken.objects.get_or_create(token=ot)
        revoked += 1
    return revoked


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
            return Response({'error': 'Current password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new_password, request.user)
        except DjangoValidationError as e:
            return Response({'error': ' '.join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save()
        # Security: revoke every other session, keeping the current device signed
        # in when it supplies its refresh token.
        revoked = _revoke_other_sessions(request.user, keep_jti=_refresh_jti(request.data.get('refresh')))
        return Response({'message': 'Password updated successfully.', 'sessions_revoked': revoked})


class SessionsView(APIView):
    """List the user's active sessions (non-blacklisted, unexpired refresh
    tokens)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        from django.utils import timezone
        blacklisted = set(BlacklistedToken.objects.values_list('token_id', flat=True))
        rows = (
            OutstandingToken.objects
            .filter(user=request.user, expires_at__gt=timezone.now())
            .exclude(id__in=blacklisted)
            .order_by('-created_at')
        )
        current_jti = _refresh_jti(request.query_params.get('refresh'))
        sessions = [{
            'id': r.id,
            'created_at': r.created_at,
            'expires_at': r.expires_at,
            'current': bool(current_jti and r.jti == current_jti),
        } for r in rows]
        return Response({'count': len(sessions), 'sessions': sessions})


class RevokeSessionView(APIView):
    """Revoke (blacklist) a single session by its outstanding-token id."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
        tid = request.data.get('id')
        if not tid:
            return Response({'error': 'id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ot = OutstandingToken.objects.get(id=tid, user=request.user)
        except OutstandingToken.DoesNotExist:
            return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
        BlacklistedToken.objects.get_or_create(token=ot)
        return Response({'status': 'revoked'})


class RevokeOtherSessionsView(APIView):
    """Log out of all other devices, keeping the current one (which sends its
    refresh token) signed in."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        revoked = _revoke_other_sessions(request.user, keep_jti=_refresh_jti(request.data.get('refresh')))
        return Response({'status': 'ok', 'revoked': revoked})


class ExportDataView(APIView):
    """Return a JSON snapshot of the user's own data (account, profile, posts,
    comments, playlists, tracks) — a lightweight GDPR-style export."""
    permission_classes = [IsAuthenticated]

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
        return Response(data)


class DeactivateAccountView(APIView):
    """Reversible self-deactivation: hides the user's content/profile while
    letting them sign back in to reactivate. Password-confirmed; revokes other
    sessions so the account goes dark everywhere."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.utils import timezone
        password = request.data.get('password', '')
        if not password:
            return Response({'error': 'password is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(password):
            return Response({'error': 'Password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)

        request.user.is_deactivated = True
        request.user.deactivated_at = timezone.now()
        request.user.save(update_fields=['is_deactivated', 'deactivated_at'])
        _revoke_other_sessions(request.user)  # sign out everywhere; re-login reactivates
        return Response({'status': 'deactivated'})


class DeleteAccountView(APIView):
    """Self-service account deletion. Requires the current password as a
    confirmation, then permanently removes the account (cascades to the user's
    content via the related models' on_delete rules)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        password = request.data.get('password', '')
        if not password:
            return Response({'error': 'password is required to delete your account'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(password):
            return Response({'error': 'Password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)

        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    """Revoke a refresh token by blacklisting it. AllowAny: possession of a
    valid refresh token is sufficient (and the auth header is stripped for
    /auth/ routes client-side anyway)."""
    permission_classes = [AllowAny]

    def post(self, request):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.exceptions import TokenError

        refresh = request.data.get('refresh')
        if not refresh:
            return Response({'error': 'refresh token is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            RefreshToken(refresh).blacklist()
        except TokenError:
            # Already expired/blacklisted/invalid — the goal (revoked) holds.
            pass
        return Response({'message': 'Logged out'}, status=status.HTTP_205_RESET_CONTENT)

