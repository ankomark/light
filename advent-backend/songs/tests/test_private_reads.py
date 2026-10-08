"""Nobody reads another member's private things by trying ids.

The owner's messages, notifications, orders, notes to the admins and appeals
are fetched by someone else, by id: every answer must be a refusal or "not
found", and no body may carry the owner's words.

    python manage.py test songs.tests.test_private_reads --settings=music.settings_test
"""
from django.core.cache import cache
from rest_framework.test import APITestCase

from songs import models as m

SECRET = 'my private words 7f3a'


class PrivateReadTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = m.User.objects.create_user('owner', 'o@x.com', 'pw-12345678', is_email_verified=True)
        self.friend = m.User.objects.create_user('friend', 'f@x.com', 'pw-12345678', is_email_verified=True)
        self.snoop = m.User.objects.create_user('snoop', 's@x.com', 'pw-12345678', is_email_verified=True)

    def test_someone_else_gets_nothing(self):
        o = self.owner
        convo = m.Conversation.objects.create()
        convo.participants.add(o, self.friend)
        m.Message.objects.create(conversation=convo, sender=o, content=SECRET)
        note = m.Notification.objects.create(recipient=o, sender=self.friend, message=SECRET,
                                             notification_type='message')
        order = m.Order.objects.create(buyer=o, total_amount=100, shipping_address=SECRET)
        admin_note = m.AdminNote.objects.create(sender=o, body=SECRET)
        appeal = m.Appeal.objects.create(user=o, message=SECRET)

        # The test can see a leak: the owner does get their own words back.
        self.client.force_authenticate(o)
        for url in (f'/api/conversations/{convo.pk}/messages/', f'/api/notifications/{note.pk}/',
                    f'/api/marketplace/orders/{order.pk}/', '/api/appeals/mine/'):
            self.assertIn(SECRET, self.client.get(url).content.decode(errors='ignore'), url)

        self.client.force_authenticate(self.snoop)
        leaks = []
        for url in (f'/api/conversations/{convo.pk}/', f'/api/conversations/{convo.pk}/messages/',
                    f'/api/notifications/{note.pk}/', f'/api/marketplace/orders/{order.pk}/',
                    f'/api/admin-notes/{admin_note.pk}/', f'/api/appeals/{appeal.pk}/',
                    '/api/notifications/', '/api/conversations/', '/api/marketplace/orders/',
                    '/api/admin-notes/mine/', '/api/appeals/mine/'):
            r = self.client.get(url)
            if SECRET in r.content.decode(errors='ignore'):
                leaks.append(f'{url} -> {r.status_code}')
        self.assertEqual(leaks, [])

        # Nor change them.
        for url in (f'/api/notifications/{note.pk}/mark_as_read/',):
            self.client.post(url)
        note.refresh_from_db()
        self.assertFalse(getattr(note, 'is_read', False))
