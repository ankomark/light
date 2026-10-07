"""The Security Centre (admin phase 5): what the attack rules saw, and the
admin's hands on it.

- GET  /admin/security-centre/                 the picture: open events, sign-in
                                               failures, blocked addresses, lockdown
- GET  /admin/security-centre/attempts/        sign-ins, by ?user= or ?ip=
- POST /admin/security-centre/block/           {network, reason, hours?}
- POST /admin/security-centre/unblock/         {network}
- POST /admin/security-centre/resolve/         {id}
- POST /admin/security-centre/lockdown/        {signups_paused?, strict?}
- POST /admin/security-centre/lock-account/    {user_id, reason}
- POST /admin/security-centre/unlock-account/  {user_id}
- POST /admin/security-centre/force-reset/     {user_id, reason}

Everything that changes something wants manage_security and a code entered
in the last minutes, and is written in the audit log.
"""
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .. import security
from ..models import BlockedIP, LoginAttempt, RecoveryCase, SecurityEvent, User
from .admin import log_admin_action, notify_moderation, reason_of
from .common import Cap


def _event(e):
    return {
        'id': e.id, 'kind': e.kind, 'severity': e.severity, 'ip': e.ip, 'detail': e.detail, 'count': e.count,
        'user': {'id': e.user_id, 'username': e.user.username} if e.user_id else None,
        'created_at': e.created_at, 'last_seen_at': e.last_seen_at, 'resolved_at': e.resolved_at,
    }


def _block(b):
    return {'network': b.network, 'reason': b.reason, 'automatic': b.automatic,
            'by': b.created_by.username if b.created_by_id else None,
            'created_at': b.created_at, 'expires_at': b.expires_at}


def _attempt(a):
    return {'id': a.id, 'username': a.username, 'outcome': a.outcome, 'ip': a.ip, 'device': a.device_name,
            'created_at': a.created_at}


class AdminSecurityCentreViewSet(viewsets.ViewSet):
    READS = ('list', 'attempts', 'recovery')

    def get_permissions(self):
        return [Cap('manage_security', recent=self.action not in self.READS)()]

    def list(self, request):
        now = timezone.now()
        day = now - timedelta(days=1)
        attempts = LoginAttempt.objects.filter(created_at__gte=day)
        failed = attempts.exclude(outcome=LoginAttempt.OK)
        open_events = SecurityEvent.objects.filter(resolved_at__isnull=True).select_related('user')[:50]
        blocks = BlockedIP.objects.filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).select_related(
            'created_by')[:100]
        top_ips = list(failed.exclude(ip='').values('ip').annotate(n=Count('id'),
                                                                   accounts=Count('username', distinct=True))
                       .order_by('-n')[:8])
        top_accounts = list(failed.values('username').annotate(n=Count('id')).order_by('-n')[:8])
        return Response({
            'lockdown': security.lockdown(),
            'day': {
                'sign_ins': attempts.filter(outcome=LoginAttempt.OK).count(),
                'failed': failed.count(),
                'locked': attempts.filter(outcome=LoginAttempt.LOCKED).count(),
                'signups': User.objects.filter(date_joined__gte=day).count(),
            },
            'events': [_event(e) for e in open_events],
            'blocked': [_block(b) for b in blocks],
            'top_failing_ips': top_ips,
            'top_failing_accounts': top_accounts,
            'recovery_open': RecoveryCase.objects.filter(status=RecoveryCase.OPEN).count(),
        })

    # ── Account recovery (phase 6) ──────────────────────────────────────────
    @action(detail=False, methods=['get'])
    def recovery(self, request):
        """The recovery cases (?status=open by default), with what the
        account looks like now — enough to check the asker is its owner."""
        st = request.query_params.get('status') or RecoveryCase.OPEN
        rows = RecoveryCase.objects.filter(status=st).select_related('user', 'handled_by')[:100]
        return Response([{
            'id': c.id, 'account': c.account, 'contact_email': c.contact_email, 'details': c.details,
            'status': c.status, 'note': c.note, 'created_at': c.created_at, 'ip': c.ip,
            'handled_by': c.handled_by.username if c.handled_by_id else None,
            'user': None if not c.user_id else {
                'id': c.user.id, 'username': c.user.username, 'email': c.user.email,
                'joined': c.user.date_joined, 'last_seen_at': c.user.last_seen_at, 'is_active': c.user.is_active,
                'email_matches': c.user.email.lower() == c.contact_email.lower(),
            },
        } for c in rows])

    @action(detail=False, methods=['post'], url_path='recovery-close')
    def recovery_close(self, request):
        """{id, status: resolved|rejected, note}: the case closed, the asker told."""
        try:
            case = RecoveryCase.objects.get(pk=int(request.data.get('id')), status=RecoveryCase.OPEN)
        except (TypeError, ValueError, RecoveryCase.DoesNotExist):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        st = request.data.get('status')
        if st not in (RecoveryCase.RESOLVED, RecoveryCase.REJECTED):
            return Response({'error': 'status: resolved or rejected'}, status=status.HTTP_400_BAD_REQUEST)
        note = str(request.data.get('note') or '').strip()[:500]
        case.status, case.note, case.handled_by, case.closed_at = st, note, request.user, timezone.now()
        case.save(update_fields=['status', 'note', 'handled_by', 'closed_at'])
        from ..recovery import security_email
        security_email(case.contact_email, 'Your account recovery request',
                       ('We have helped with your account. Check your email for a password reset code and sign in.'
                        if st == RecoveryCase.RESOLVED else
                        'We could not confirm the account is yours, so we have not changed it.')
                       + (f'\n\n{note}' if note else ''))
        log_admin_action(request.user, f'recovery_{st}', 'recoverycase', case.id, reason=note or case.account)
        return Response({'id': case.id, 'status': case.status})

    @action(detail=False, methods=['post'], url_path='change-email')
    def change_email(self, request):
        """{user_id, email, reason}: the account moved to an email its owner
        can reach (theirs was lost, or changed by someone else). Both the old
        and the new address are told."""
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjangoValidationError
        user, refused = self._user(request)
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        email = str(request.data.get('email') or '').strip()
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response({'error': 'A valid email.'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
            return Response({'error': 'Another account uses that email.', 'code': 'taken'},
                            status=status.HTTP_400_BAD_REQUEST)
        old = user.email
        user.email, user.is_email_verified = email, True     # an admin has checked it is theirs
        user.save(update_fields=['email', 'is_email_verified'])
        from ..recovery import security_email
        security_email(old, 'The email of your account was changed',
                       f'The account @{user.username} now uses a different email, changed by our team after a '
                       "recovery request. If you did not ask for this, reply to this email at once.")
        security_email(email, 'Your account now uses this email',
                       f'The account @{user.username} now uses this email. Sign in, or set a new password with '
                       '"Forgot password".')
        log_admin_action(request.user, 'change_email', 'user', user.id, reason=f'{old} -> {email} — {reason}')
        return Response({'email': email})

    @action(detail=False, methods=['post'], url_path='send-reset')
    def send_reset(self, request):
        """{user_id}: a password-reset code to the account's email now."""
        user, refused = self._user(request)
        if refused:
            return refused
        from ..recovery import send_reset_code
        try:
            send_reset_code(user)
        except Exception:  # noqa: BLE001 — say the mail server failed, not that it went
            return Response({'error': 'The email could not be sent just now.', 'code': 'mail_failed'},
                            status=status.HTTP_502_BAD_GATEWAY)
        log_admin_action(request.user, 'send_password_reset', 'user', user.id)
        return Response({'sent_to': user.email})

    @action(detail=False, methods=['get'])
    def attempts(self, request):
        qs = LoginAttempt.objects.all()
        if request.query_params.get('user'):
            qs = qs.filter(username__iexact=request.query_params['user'].lstrip('@'))
        if request.query_params.get('ip'):
            qs = qs.filter(ip=request.query_params['ip'])
        if request.query_params.get('failed') == '1':
            qs = qs.exclude(outcome=LoginAttempt.OK)
        return Response([_attempt(a) for a in qs[:100]])

    @action(detail=False, methods=['post'])
    def block(self, request):
        from ..admin_security import client_ip
        net = security.parse_network(request.data.get('network'))
        if net is None:
            return Response({'error': 'An address (41.90.1.2) or a range (41.90.0.0/16).'},
                            status=status.HTTP_400_BAD_REQUEST)
        # A range wider than a /16 (or /48) would shut out a whole country's network.
        if net.prefixlen < (16 if net.version == 4 else 48):
            return Response({'error': 'That range is too wide.', 'code': 'too_wide'},
                            status=status.HTTP_400_BAD_REQUEST)
        mine = client_ip(request)
        if mine and security.parse_network(mine) and security.parse_network(mine).network_address in net:
            return Response({'error': 'That would block you too.', 'code': 'self'},
                            status=status.HTTP_400_BAD_REQUEST)
        reason, refused = reason_of(request)
        if refused:
            return refused
        try:
            hours = max(0, min(int(request.data.get('hours') or 0), 24 * 365))
        except (TypeError, ValueError):
            hours = 0
        row = security.block(str(net), reason, user=request.user, hours=hours or None)
        log_admin_action(request.user, 'block_ip', 'ip', None, reason=f'{net} — {reason}')
        return Response(_block(row), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def unblock(self, request):
        net = security.parse_network(request.data.get('network'))
        if net is None:
            return Response({'error': 'network'}, status=status.HTTP_400_BAD_REQUEST)
        gone = BlockedIP.objects.filter(network=str(net)).delete()[0]
        security.forget_blocks()
        if gone:
            log_admin_action(request.user, 'unblock_ip', 'ip', None, reason=str(net))
        return Response({'removed': gone})

    @action(detail=False, methods=['post'])
    def resolve(self, request):
        try:
            event = SecurityEvent.objects.get(pk=int(request.data.get('id')))
        except (TypeError, ValueError, SecurityEvent.DoesNotExist):
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        event.resolved_at, event.resolved_by = timezone.now(), request.user
        event.save(update_fields=['resolved_at', 'resolved_by'])
        log_admin_action(request.user, 'resolve_security_event', 'securityevent', event.id, reason=event.kind)
        return Response(_event(event))

    @action(detail=False, methods=['post'])
    def lockdown(self, request):
        changes = {k: request.data[k] for k in ('signups_paused', 'strict') if k in request.data}
        if not changes:
            return Response({'error': 'signups_paused and/or strict'}, status=status.HTTP_400_BAD_REQUEST)
        state = security.set_lockdown(changes, request.user)
        log_admin_action(request.user, 'security_lockdown', 'app', None,
                         reason=', '.join(f'{k}={"on" if v else "off"}' for k, v in state.items()))
        return Response(state)

    def _user(self, request):
        from ..admin_security import outranks
        try:
            user = User.objects.get(pk=int(request.data.get('user_id')))
        except (TypeError, ValueError, User.DoesNotExist):
            return None, Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if user.pk == request.user.pk or not outranks(request.user, user):
            return None, Response({'error': 'Not an account you can act on.', 'code': 'rank'},
                                  status=status.HTTP_403_FORBIDDEN)
        return user, None

    @action(detail=False, methods=['post'], url_path='lock-account')
    def lock_account(self, request):
        user, refused = self._user(request)
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        try:
            hours = max(1, min(int(request.data.get('hours') or 24), 24 * 30))
        except (TypeError, ValueError):
            hours = 24
        security.lock_account(user.username, hours * 3600)
        from ..admin_security import cut_off
        cut_off(user, 'locked by an admin')
        log_admin_action(request.user, 'lock_account', 'user', user.id, reason=f'{hours}h — {reason}')
        return Response({'locked_hours': hours})

    @action(detail=False, methods=['post'], url_path='unlock-account')
    def unlock_account(self, request):
        user, refused = self._user(request)
        if refused:
            return refused
        security.unlock_account(user.username)
        log_admin_action(request.user, 'unlock_account', 'user', user.id)
        return Response({'status': 'unlocked'})

    @action(detail=False, methods=['post'], url_path='force-reset')
    def force_reset(self, request):
        """The password stops working and every device is signed out: the
        owner sets a new one by email (Forgot password). For an account that
        may be in someone else's hands."""
        user, refused = self._user(request)
        if refused:
            return refused
        reason, refused = reason_of(request)
        if refused:
            return refused
        user.set_unusable_password()
        user.save(update_fields=['password'])
        from ..admin_security import cut_off
        cut_off(user, 'password reset forced')
        notify_moderation(user, 'Set a new password',
                          'To keep your account safe, its password was reset by our team. Open the app, tap '
                          '"Forgot password" and set a new one with the code we email you.')
        log_admin_action(request.user, 'force_password_reset', 'user', user.id, reason=reason)
        return Response({'status': 'reset'})
