"""Events & Tickets in the admin area: Streams admins acting on the ticketing
server's staff API, server to server, by the `manage_tickets` capability.

    python manage.py test songs.tests.test_admin_tickets --settings=music.settings_test
"""
from unittest import mock

import requests
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from songs.models import AdminActionLog, Role, User

KEY = 'k' * 40


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


def answer(status=200, body=None):
    response = mock.Mock(status_code=status)
    response.json.return_value = body if body is not None else {}
    return response


@override_settings(TICKETING_API_URL='https://tickets.test', TICKETING_SERVICE_KEY=KEY)
class AdminTicketsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make('mark', role=Role.objects.create(name='Tickets', capabilities=['manage_tickets']))
        self.client.force_authenticate(self.admin)
        patcher = mock.patch('songs.ticketing_staff.requests.request')
        self.request = patcher.start()
        self.addCleanup(patcher.stop)

    def sent(self, n=0):
        args, kwargs = self.request.call_args_list[n]
        return args[0], args[1], kwargs

    def test_only_with_the_capability_or_as_super_admin(self):
        self.request.return_value = answer(body={'events_to_review': 0})
        self.client.force_authenticate(make('member'))
        self.assertEqual(self.client.get('/api/admin/tickets/stats/').status_code, 403)
        self.client.force_authenticate(make('mod', role=Role.objects.create(name='Mods', capabilities=['manage_users'])))
        self.assertEqual(self.client.get('/api/admin/tickets/stats/').status_code, 403)
        self.request.assert_not_called()

        self.client.force_authenticate(make('boss', admin_role='super_admin'))
        self.assertEqual(self.client.get('/api/admin/tickets/stats/').status_code, 200)

    def test_calls_the_staff_api_with_the_key_and_the_admins_name(self):
        self.request.return_value = answer(body={'count': 1, 'results': [{'id': 3}]})
        res = self.client.get('/api/admin/tickets/events/', {'review': 'pending', 'evil': 'x'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['results'], [{'id': 3}])
        method, url, kwargs = self.sent()
        self.assertEqual((method, url), ('GET', 'https://tickets.test/api/v1/staff/events/'))
        self.assertEqual(kwargs['params'], {'review': 'pending'})        # only what the staff API reads
        self.assertEqual(kwargs['headers']['Authorization'], f'Service {KEY}')
        self.assertEqual(kwargs['headers']['X-Acting-Admin'], f'streams:{self.admin.pk} mark')

    def test_an_action_is_passed_on_and_logged_here_once_it_succeeds(self):
        self.request.return_value = answer(body={'id': 5, 'title': 'Gospel Night', 'review_status': 'rejected'})
        res = self.client.post('/api/admin/tickets/events/5/reject/',
                               {'note': 'Poster uses a copyrighted logo', 'review_status': 'approved'}, format='json')
        self.assertEqual(res.status_code, 200)
        method, url, kwargs = self.sent()
        self.assertEqual((method, url), ('POST', 'https://tickets.test/api/v1/staff/events/5/reject/'))
        self.assertEqual(kwargs['json'], {'note': 'Poster uses a copyrighted logo'})   # nothing else rides along
        log = AdminActionLog.objects.get()
        self.assertEqual((log.action, log.target_type, log.target_id), ('ticket_event_reject', 'ticket_event', 5))
        self.assertEqual(log.reason, 'Gospel Night — Poster uses a copyrighted logo')

    def test_the_ticket_servers_refusal_is_shown_as_it_said_it(self):
        self.request.return_value = answer(400, {'detail': 'Send a KES 1 test first.'})
        res = self.client.post('/api/admin/tickets/tills/2/activate/')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['detail'], 'Send a KES 1 test first.')
        self.assertFalse(AdminActionLog.objects.exists())

    def test_a_till_test_sends_only_the_phone(self):
        self.request.return_value = answer(body={'id': 2, 'till_number': '5123456', 'last_test': {'result': 'pending'}})
        self.client.post('/api/admin/tickets/tills/2/test/', {'phone': '0722000111', 'amount': 1000}, format='json')
        self.assertEqual(self.sent()[2]['json'], {'phone': '0722000111'})
        self.assertEqual(AdminActionLog.objects.get().reason, '5123456')

    def test_unknown_actions_go_nowhere(self):
        self.assertEqual(self.client.post('/api/admin/tickets/tills/2/delete/').status_code, 404)
        self.assertEqual(self.client.post('/api/admin/tickets/events/2/activate/').status_code, 404)
        self.request.assert_not_called()

    def test_server_trouble_is_a_clear_503_or_502(self):
        self.request.side_effect = requests.ConnectionError('down')
        res = self.client.get('/api/admin/tickets/stats/')
        self.assertEqual((res.status_code, res.data['code']), (503, 'ticketing_unavailable'))

        self.request.side_effect = None
        self.request.return_value = answer(401, {'detail': 'Invalid service key.'})
        res = self.client.get('/api/admin/tickets/stats/')
        self.assertEqual(res.status_code, 503)
        self.assertIn('TICKETING_SERVICE_KEY', res.data['detail'])

        self.request.return_value = answer(502, {'detail': 'M-Pesa refused the test: bad till'})
        self.assertEqual(self.client.post('/api/admin/tickets/tills/2/test/', {'phone': '0722000111'},
                                          format='json').status_code, 502)

    @override_settings(TICKETING_SERVICE_KEY='')
    def test_without_a_key_it_says_it_is_not_connected(self):
        res = self.client.get('/api/admin/tickets/tills/')
        self.assertEqual(res.status_code, 503)
        self.request.assert_not_called()

    @override_settings(ADMIN_2FA_REQUIRED=True)
    def test_activating_a_till_needs_a_fresh_code(self):
        self.request.return_value = answer(body={'id': 2})
        res = self.client.post('/api/admin/tickets/tills/2/activate/')
        self.assertEqual(res.status_code, 403)
        self.assertIn(res.data['code'], ('admin_session_required', 'reauth_required'))
        self.request.assert_not_called()

    def test_warn_pause_resume_and_remove_pass_through_with_the_note_only(self):
        self.request.return_value = answer(body={'id': 5, 'title': 'Gospel Night'})
        for action, body in (('warn', {'note': 'Wrong date on the poster'}), ('pause', {'note': 'Checking a complaint'}),
                             ('resume', {}), ('remove', {'note': 'Fraudulent event'})):
            res = self.client.post(f'/api/admin/tickets/events/5/{action}/', {**body, 'status': 'published'}, format='json')
            self.assertEqual(res.status_code, 200, action)
            method, url, kwargs = self.sent(len(self.request.call_args_list) - 1)
            self.assertEqual(url, f'https://tickets.test/api/v1/staff/events/5/{action}/')
            self.assertEqual(kwargs['json'], body)
        self.assertEqual(list(AdminActionLog.objects.order_by('id').values_list('action', flat=True)), [
            'ticket_event_warn', 'ticket_event_pause', 'ticket_event_resume', 'ticket_event_remove',
        ])

    def test_the_view_tabs_reach_the_staff_api(self):
        self.request.return_value = answer(body={'count': 0, 'results': []})
        self.client.get('/api/admin/tickets/events/', {'view': 'drafts'})
        self.assertEqual(self.sent()[2]['params'], {'view': 'drafts'})

    @override_settings(ADMIN_2FA_REQUIRED=True)
    def test_removing_for_good_needs_a_fresh_code(self):
        self.request.return_value = answer(body={'id': 5})
        res = self.client.post('/api/admin/tickets/events/5/remove/', {'note': 'Fraudulent event'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.request.assert_not_called()

