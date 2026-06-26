"""Security gate — asserts the access boundaries that, if broken, leak data or
allow unauthorized moderation. These are the bug classes that have bitten before
(private content readable by non-members, admin pages reachable by clients).

    python manage.py test songs.tests.test_security_gate
"""
from rest_framework.test import APITestCase

from songs.models import User, Conversation, Message, Profile


class DirectMessageSecurityTests(APITestCase):
    """Direct messages are participant-only on every path."""

    def setUp(self):
        self.alice = User.objects.create_user('sec_alice', 'sa@x.com', 'x')
        self.bob = User.objects.create_user('sec_bob', 'sb@x.com', 'x')
        self.intruder = User.objects.create_user('sec_intruder', 'si@x.com', 'x')
        self.convo = Conversation.objects.create()
        self.convo.participants.add(self.alice, self.bob)
        Message.objects.create(conversation=self.convo, sender=self.alice, content='secret hello')

    def test_non_participant_cannot_read_messages(self):
        self.client.force_authenticate(self.intruder)
        r = self.client.get(f'/api/conversations/{self.convo.id}/messages/')
        self.assertIn(r.status_code, (403, 404), r.content[:200])
        self.assertNotIn(b'secret hello', r.content)

    def test_non_participant_cannot_send(self):
        self.client.force_authenticate(self.intruder)
        r = self.client.post(
            f'/api/conversations/{self.convo.id}/send_message/',
            {'content': 'sneaky'}, format='json',
        )
        self.assertIn(r.status_code, (403, 404))
        self.assertFalse(Message.objects.filter(content='sneaky').exists())

    def test_conversation_list_scoped_to_participant(self):
        self.client.force_authenticate(self.intruder)
        body = self.client.get('/api/conversations/').json()
        rows = body.get('results', body) if isinstance(body, dict) else body
        self.assertNotIn(self.convo.id, [c['id'] for c in rows])

    def test_participant_can_read_their_own_thread(self):
        self.client.force_authenticate(self.bob)
        r = self.client.get(f'/api/conversations/{self.convo.id}/messages/')
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'secret hello', r.content)


class AdminPanelGateTests(APITestCase):
    """The moderation panel is staff-only; regular clients are locked out."""

    ADMIN_PATHS = [
        '/api/admin/dashboard/',
        '/api/admin/users/',
        '/api/admin/reports/',
        '/api/admin/content/',
        '/api/admin/logs/',
        '/api/admin/appeals/',
        '/api/admin/roles/',
    ]

    def setUp(self):
        self.user = User.objects.create_user('sec_regular', 'sr@x.com', 'x')
        self.boss = User.objects.create_user('sec_boss', 'sboss@x.com', 'x')
        self.boss.admin_role = 'super_admin'
        self.boss.is_superuser = True
        self.boss.save(update_fields=['admin_role', 'is_superuser'])

    def test_regular_user_blocked_from_every_admin_endpoint(self):
        self.client.force_authenticate(self.user)
        for path in self.ADMIN_PATHS:
            self.assertEqual(self.client.get(path).status_code, 403, f'leaked: {path}')

    def test_anonymous_blocked(self):
        for path in self.ADMIN_PATHS:
            self.assertIn(self.client.get(path).status_code, (401, 403), path)

    def test_super_admin_allowed(self):
        self.client.force_authenticate(self.boss)
        self.assertEqual(self.client.get('/api/admin/dashboard/').status_code, 200)


class AccountTakeoverTests(APITestCase):
    """A user can only ever mutate their own account — never another user's
    credentials or profile through the users/profiles collections."""

    def setUp(self):
        self.attacker = User.objects.create_user('atk_user', 'atk@x.com', 'pw')
        self.victim = User.objects.create_user('victim_user', 'victim@x.com', 'pw')

    def test_cannot_change_another_users_password_or_email(self):
        self.client.force_authenticate(self.attacker)
        r = self.client.patch(
            f'/api/users/{self.victim.id}/',
            {'password': 'hacked123', 'email': 'stolen@x.com'},
        )
        self.assertEqual(r.status_code, 405, r.content[:200])
        self.victim.refresh_from_db()
        self.assertFalse(self.victim.check_password('hacked123'))
        self.assertEqual(self.victim.email, 'victim@x.com')

    def test_cannot_delete_another_user(self):
        self.client.force_authenticate(self.attacker)
        self.assertEqual(self.client.delete(f'/api/users/{self.victim.id}/').status_code, 405)
        self.assertTrue(User.objects.filter(id=self.victim.id).exists())

    def test_cannot_delete_another_users_profile(self):
        prof = Profile.objects.create(user=self.victim)
        self.client.force_authenticate(self.attacker)
        self.assertEqual(self.client.delete(f'/api/profiles/{prof.id}/').status_code, 405)
        self.assertTrue(Profile.objects.filter(id=prof.id).exists())
