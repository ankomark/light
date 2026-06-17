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
    """Login endpoint with a tight per-IP rate limit to deter credential stuffing."""
    throttle_scope = 'auth'



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

