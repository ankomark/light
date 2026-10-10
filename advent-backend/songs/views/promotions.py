"""Paid promotions over REST (the rules are in songs/promotions.py).

Owners:  GET  promotions/packages/          the packages, and the counties to pick from
         GET  promotions/                   mine
         POST promotions/                   {kind, target_id?, package, counties?} -> one, unpaid
         GET  promotions/<id>/              one of mine (a payment waiting on M-Pesa is checked)
         POST promotions/<id>/pay/          {phone} -> the M-Pesa prompt
         POST promotions/<id>/cancel/       an unpaid one
Viewers: GET  promotions/serve/?n=2         a couple to place in the feed
         POST promotions/<id>/seen/         it was on screen
         POST promotions/<id>/tap/          {action: open|follow}
Admins:  GET  admin/promotions/?status=     the queue (manage_promotions)
         POST admin/promotions/<id>/<approve|reject|pause|resume|stop|refunded>/  {note?}
         GET/POST admin/promotion-packages/, PATCH/DELETE admin/promotion-packages/<key>/
         GET/PUT admin/promotion-till/, POST/GET admin/promotion-till/test/
"""
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import promotions as promo
from ..models import Promotion, PromotionPackage
from .admin import log_admin_action
from .common import Cap, IsNotSuspended


def _refused(exc):
    code = status.HTTP_503_SERVICE_UNAVAILABLE if exc.code == 'unavailable' else status.HTTP_400_BAD_REQUEST
    return Response({'error': str(exc), 'code': exc.code}, status=code)


def _package(p):
    return {'key': p.key, 'name': p.name, 'description': p.description, 'price': p.price, 'views': p.views,
            'days': p.days, 'is_active': p.is_active, 'order': p.order}


def _mine(request, pk):
    return get_object_or_404(
        Promotion.objects.select_related('package', 'owner', 'post', 'product', 'publication', 'service'),
        pk=pk, owner=request.user)


class PromotionPackages(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({
            'packages': [_package(p) for p in PromotionPackage.objects.filter(is_active=True)],
            'counties': list(promo.KENYA_COUNTIES),
        })


class PromotionPromotable(APIView):
    """GET ?kind=post|product|book|service|profile: my things that can be
    promoted (the first step of promoting, as on TikTok: choose what)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            return Response(promo.promotable(request.user, request.query_params.get('kind', 'post')))
        except promo.Refused as exc:
            return _refused(exc)


class Promotions(APIView):
    permission_classes = [permissions.IsAuthenticated, IsNotSuspended]

    def get_throttles(self):
        # Making promotions is limited ('promotion'); looking at mine is not —
        # a list reloaded on every visit must never use up the payments.
        if self.request.method == 'POST':
            self.throttle_scope = 'promotion'
        return super().get_throttles()

    def get(self, request):
        promo.reconcile_payments(owner=request.user, limit=3)
        rows = Promotion.objects.filter(owner=request.user).exclude(status=Promotion.CANCELLED).select_related(
            'package', 'owner', 'post', 'product', 'publication', 'service')[:100]
        return Response([promo.summary(p) for p in rows])

    def post(self, request):
        try:
            p = promo.create(request.user, request.data.get('kind'), request.data.get('target_id'),
                             request.data.get('package'), request.data.get('counties'))
        except promo.Refused as exc:
            return _refused(exc)
        return Response(promo.summary(p), status=status.HTTP_201_CREATED)


class PromotionDetail(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        return Response(promo.summary(promo.check_payment(_mine(request, pk))))


class PromotionPay(APIView):
    permission_classes = [permissions.IsAuthenticated, IsNotSuspended]
    throttle_scope = 'promotion'

    def post(self, request, pk):
        p = _mine(request, pk)
        phone = str(request.data.get('phone') or '').strip()
        if not phone:
            return Response({'error': 'Enter the M-Pesa number to pay from.', 'code': 'phone'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            p = promo.pay(p, phone)
        except promo.Refused as exc:
            return _refused(exc)
        return Response(promo.summary(p))


class PromotionCancel(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            return Response(promo.summary(promo.cancel(_mine(request, pk))))
        except promo.Refused as exc:
            return _refused(exc)


class PromotionServe(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            n = int(request.query_params.get('n', 2))
        except (TypeError, ValueError):
            n = 2
        return Response(promo.serve(request.user, n, request))


class PromotionSeen(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        p = get_object_or_404(Promotion, pk=pk)
        return Response({'counted': promo.seen(p, request.user)})


class PromotionTap(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        p = get_object_or_404(Promotion, pk=pk, status=Promotion.ACTIVE)
        action = request.data.get('action') if request.data.get('action') in ('open', 'follow') else 'open'
        promo.tapped(p, request.user, action)
        return Response({'ok': True})


# ── admins ───────────────────────────────────────────────────────────────────

class AdminPromotions(APIView):
    permission_classes = [Cap('manage_promotions')]

    def get(self, request):
        promo.reconcile_payments(limit=5)   # the rest by cron (finish_promotions)
        rows = Promotion.objects.exclude(status__in=(Promotion.UNPAID, Promotion.CANCELLED)).select_related(
            'package', 'owner', 'post', 'product', 'publication', 'service')
        wanted = request.query_params.get('status')
        if wanted == 'refunds':
            rows = rows.filter(refund_due=True)
        elif wanted:
            rows = rows.filter(status=wanted)
        return Response([promo.summary(p) for p in rows.order_by('paid_at', 'pk')[:200]])


class AdminPromotionAction(APIView):
    permission_classes = [Cap('manage_promotions')]

    def post(self, request, pk, action):
        p = get_object_or_404(Promotion.objects.select_related('package', 'owner'), pk=pk)
        note = str(request.data.get('note') or '').strip()
        try:
            if action == 'approve':
                promo.approve(p, request.user)
            elif action == 'reject':
                promo.reject(p, request.user, note)
            elif action == 'pause':
                promo.pause(p)
            elif action == 'resume':
                promo.resume(p)
            elif action == 'stop':
                promo.stop(p, note)
            elif action == 'refunded':
                # The money went back by M-Pesa, by hand: recorded here.
                if not p.refund_due:
                    return Response({'error': 'Nothing is owed on this one.', 'code': 'state'},
                                    status=status.HTTP_400_BAD_REQUEST)
                p.refund_due = False
                p.review_note = (f'{p.review_note} · Refunded: {note}' if p.review_note else f'Refunded: {note}')[:500]
                p.save(update_fields=['refund_due', 'review_note', 'updated_at'])
            else:
                return Response(status=status.HTTP_404_NOT_FOUND)
        except promo.Refused as exc:
            return _refused(exc)
        log_admin_action(request.user, f'promotion_{action}', 'promotion', p.pk, note[:200])
        p.refresh_from_db()
        return Response(promo.summary(p))


PACKAGE_LIMITS = (('price', 10, 150_000), ('views', 100, 1_000_000), ('days', 1, 60))


class AdminPromotionPackages(APIView):
    """The plans: list, add, change, hide, delete."""
    permission_classes = [Cap('manage_promotions')]

    def get(self, request):
        return Response([_package(p) for p in PromotionPackage.objects.all()])

    def post(self, request):
        from django.utils.text import slugify
        name = str(request.data.get('name') or '').strip()[:60]
        if not name:
            return Response({'error': 'Give the plan a name.'}, status=status.HTTP_400_BAD_REQUEST)
        values = {}
        for field, lo, hi in PACKAGE_LIMITS:
            try:
                value = int(request.data.get(field))
            except (TypeError, ValueError):
                return Response({'error': f'{field} must be a number.'}, status=status.HTTP_400_BAD_REQUEST)
            if not lo <= value <= hi:
                return Response({'error': f'{field} must be between {lo:,} and {hi:,}.'},
                                status=status.HTTP_400_BAD_REQUEST)
            values[field] = value
        base = slugify(name)[:24] or 'plan'
        key, n = base, 2
        while PromotionPackage.objects.filter(key=key).exists():
            key, n = f'{base}-{n}', n + 1
        last = PromotionPackage.objects.order_by('-order').values_list('order', flat=True).first() or 0
        p = PromotionPackage.objects.create(
            key=key, name=name, description=str(request.data.get('description') or '').strip()[:160],
            order=last + 1, is_active=bool(request.data.get('is_active', True)), **values)
        log_admin_action(request.user, 'promotion_package_add', 'promotionpackage', p.pk, name)
        return Response(_package(p), status=status.HTTP_201_CREATED)

    def delete(self, request, key):
        p = get_object_or_404(PromotionPackage, key=key)
        if p.promotions.exists():
            # Bought before: its promotions keep pointing at it. Hidden instead.
            return Response({'error': 'People have bought this plan, so it can only be hidden, not deleted.',
                             'code': 'in_use'}, status=status.HTTP_409_CONFLICT)
        log_admin_action(request.user, 'promotion_package_delete', 'promotionpackage', p.pk, p.name)
        p.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request, key):
        p = get_object_or_404(PromotionPackage, key=key)
        changed = []
        for field, lo, hi in PACKAGE_LIMITS + (('order', 0, 1000),):
            if field in request.data:
                try:
                    value = int(request.data[field])
                except (TypeError, ValueError):
                    return Response({'error': f'{field} must be a number.'}, status=status.HTTP_400_BAD_REQUEST)
                if not lo <= value <= hi:
                    return Response({'error': f'{field} must be between {lo:,} and {hi:,}.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                setattr(p, field, value)
                changed.append(f'{field}={value}')
        if 'is_active' in request.data:
            p.is_active = bool(request.data['is_active'])
            changed.append(f'active={p.is_active}')
        if 'name' in request.data and str(request.data['name']).strip():
            p.name = str(request.data['name']).strip()[:60]
            changed.append('name')
        if 'description' in request.data:
            p.description = str(request.data['description'] or '').strip()[:160]
            changed.append('description')
        p.save()
        log_admin_action(request.user, 'promotion_package', 'promotionpackage', p.pk, ', '.join(changed)[:200])
        return Response(_package(p))


# ── where the money goes: the platform till, kept on the ticketing server ────

class AdminPromotionTill(APIView):
    """GET: the till promotion payments go to. PUT {till}: change it, only
    to a till that passed a KES 1 test in the last 24 hours (POST test/), the
    proof Safaricom has linked it, as for organisers' tills."""
    permission_classes = [Cap('manage_promotions')]

    def get(self, request):
        from .admin_tickets import _relay
        from .. import ticketing_staff
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', 'platform-till/'))

    def put(self, request):
        from .admin_tickets import _relay
        from .. import ticketing_staff
        till = str(request.data.get('till') or '').strip()
        res = _relay(lambda: ticketing_staff.call(request.user, 'PUT', 'platform-till/', body={'till': till}))
        if res.status_code == 200:
            log_admin_action(request.user, 'promotion_till', 'platformtill', 0, till)
        return res


class AdminPromotionTillTest(APIView):
    """POST {till, phone}: a KES 1 prompt to `phone`, paying into `till`.
    GET ?till=: how the latest test of that till went."""
    permission_classes = [Cap('manage_promotions')]

    def post(self, request):
        from .admin_tickets import _relay
        from .. import ticketing_staff
        body = {'till': str(request.data.get('till') or '').strip(),
                'phone': str(request.data.get('phone') or '').strip()}
        return _relay(lambda: ticketing_staff.call(request.user, 'POST', 'platform-till/test/', body=body))

    def get(self, request):
        from .admin_tickets import _relay
        from .. import ticketing_staff
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', 'platform-till/test/',
                                                   params={'till': request.query_params.get('till', '')}))
