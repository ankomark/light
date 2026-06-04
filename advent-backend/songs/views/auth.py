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

    run_in_background(
        send_mail,
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
            _send_verification_email(user)
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
        _send_verification_email(request.user)
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
            # Return success even for unknown emails (prevents email enumeration)
            return Response({'message': 'If that email exists, a reset code has been sent.'})

        code = f"{random.randint(0, 999999):06d}"
        expires_at = timezone.now() + timedelta(minutes=15)
        PasswordResetCode.objects.create(user=user, code=code, expires_at=expires_at)

        run_in_background(
            send_mail,
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
        return Response({'message': 'If that email exists, a reset code has been sent.'})



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

