"""Promotions, the admins' controls and the owner's first step: choose what
to promote (own things only), plans added/changed/hidden/deleted, a running
promotion paused/resumed/stopped, and the till relayed to the ticketing
server."""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from songs import promotions as promo
from songs.models import Promotion, PromotionPackage, SocialPost, User

KEY = 'k' * 40


@override_settings(TICKETING_SERVICE_KEY=KEY, TICKETING_API_URL='https://tickets.test')
class ControlTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.other = User.objects.create_user('other', 'p@x.com', 'x')
        self.admin = User.objects.create_user('boss', 'b@x.com', 'x')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.post = SocialPost.objects.create(user=self.owner, content_type='image', media_file='https://m/1.jpg',
                                              caption='Choir night')
        SocialPost.objects.create(user=self.owner, content_type='image', media_file='https://m/2.jpg',
                                  visibility='followers')
        SocialPost.objects.create(user=self.other, content_type='image', media_file='https://m/3.jpg')

    def live(self, **extra):
        pkg = PromotionPackage.objects.get(key='standard')
        now = timezone.now()
        return Promotion.objects.create(owner=self.owner, kind='post', post=self.post, package=pkg, price=500,
                                        views_target=3000, days=5, status='active', starts_at=now,
                                        ends_at=now + timedelta(days=5), **extra)

    def test_first_choose_what_only_my_own_public_things(self):
        self.client.force_authenticate(self.owner)
        rows = self.client.get('/api/promotions/promotable/?kind=post').data
        self.assertEqual([r['id'] for r in rows], [self.post.id])
        self.assertFalse(rows[0]['busy'])
        self.live()
        self.assertTrue(self.client.get('/api/promotions/promotable/?kind=post').data[0]['busy'])
        me = self.client.get('/api/promotions/promotable/?kind=profile').data
        self.assertEqual(me[0]['title'], '@owner')
        self.assertEqual(self.client.get('/api/promotions/promotable/?kind=spaceship').status_code, 400)

    def test_pause_resume_stop(self):
        p = self.live()
        self.client.force_authenticate(self.admin)
        end = Promotion.objects.get(pk=p.pk).ends_at
        self.assertEqual(self.client.post(f'/api/admin/promotions/{p.pk}/pause/').data['status'], 'paused')
        # Paused: not shown.
        self.assertEqual(promo.serve(self.other), [])
        Promotion.objects.filter(pk=p.pk).update(paused_at=timezone.now() - timedelta(hours=10))
        res = self.client.post(f'/api/admin/promotions/{p.pk}/resume/')
        self.assertEqual(res.data['status'], 'active')
        self.assertGreater(Promotion.objects.get(pk=p.pk).ends_at, end + timedelta(hours=9))   # the days waited
        with mock.patch('songs.push.notify_user') as push:
            res = self.client.post(f'/api/admin/promotions/{p.pk}/stop/', {'note': 'Complaints'}, format='json')
        self.assertEqual((res.data['status'], res.data['refund_due'], res.data['refund_owed']), ('done', True, 500))
        push.assert_called_once()
        # Paused counts as live: no second promotion of the same post meanwhile.
        q = self.live()
        promo.pause(q)
        self.client.force_authenticate(self.owner)
        res = self.client.post('/api/promotions/', {'kind': 'post', 'target_id': self.post.id, 'package': 'starter'},
                               format='json')
        self.assertEqual(res.data['code'], 'already')

    def test_plans_added_changed_hidden_deleted(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/admin/promotion-packages/', {
            'name': 'Mega Week', 'description': 'A big push', 'price': 2000, 'views': 15000, 'days': 7,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        key = res.data['key']
        self.assertEqual(key, 'mega-week')
        self.client.force_authenticate(self.owner)
        self.assertIn('mega-week', [p['key'] for p in self.client.get('/api/promotions/packages/').data['packages']])

        self.client.force_authenticate(self.admin)
        self.client.patch(f'/api/admin/promotion-packages/{key}/', {'is_active': False}, format='json')
        self.client.force_authenticate(self.owner)
        self.assertNotIn('mega-week', [p['key'] for p in self.client.get('/api/promotions/packages/').data['packages']])

        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f'/api/admin/promotion-packages/{key}/').status_code, 204)
        # A plan someone bought can only be hidden.
        self.live()
        res = self.client.delete('/api/admin/promotion-packages/standard/')
        self.assertEqual((res.status_code, res.data['code']), (409, 'in_use'))
        self.assertEqual(self.client.post('/api/admin/promotion-packages/', {'name': 'x', 'price': 1, 'views': 1000,
                                          'days': 3}, format='json').status_code, 400)

    def test_the_till_goes_through_the_ticketing_server(self):
        self.client.force_authenticate(self.admin)
        with mock.patch('songs.ticketing_staff.call', return_value={'till': '8821774', 'source': 'saved'}) as call:
            res = self.client.put('/api/admin/promotion-till/', {'till': '8821774'}, format='json')
        self.assertEqual(res.data['till'], '8821774')
        self.assertEqual(call.call_args.args[1:3], ('PUT', 'platform-till/'))
        with mock.patch('songs.ticketing_staff.call', return_value={'status': 'pending'}) as call:
            self.client.post('/api/admin/promotion-till/test/', {'till': '8821774', 'phone': '0712345678'},
                             format='json')
        self.assertEqual(call.call_args.kwargs['body'], {'till': '8821774', 'phone': '0712345678'})
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/admin/promotion-till/').status_code, 403)
