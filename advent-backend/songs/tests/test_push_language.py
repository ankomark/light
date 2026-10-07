"""Pushes in the language the reader's app is in (songs/push_text.py).

    python manage.py test songs.tests.test_push_language --settings=music.settings_test
"""
from unittest import mock

from rest_framework.test import APITestCase

from songs.models import DeviceToken, NotificationPreference, User
from songs.push import notify_many, notify_user
from songs.push_text import message_for


def _sync(fn, *args, **kwargs):
    return fn(*args, **kwargs)


@mock.patch('songs.tasks.run_in_background', side_effect=_sync)
class PushLanguageTests(APITestCase):
    def setUp(self):
        self.sw = User.objects.create_user('amani', 'a@x.com', 'pw12345!')
        self.en = User.objects.create_user('grace', 'g@x.com', 'pw12345!')
        NotificationPreference.objects.create(user=self.sw, language='sw')
        NotificationPreference.objects.create(user=self.en, language='en')
        DeviceToken.objects.create(user=self.sw, token='ExponentPushToken[sw]')
        DeviceToken.objects.create(user=self.en, token='ExponentPushToken[en]')

    def _sent(self, send):
        return {tuple(c.args[0]): (c.args[1], c.args[2]) for c in send.call_args_list}

    def test_one_reader_gets_their_language(self, _bg):
        with mock.patch('songs.push.send_expo_push') as send:
            notify_user(self.sw, 'follow', 'mark started following you')
            notify_user(self.en, 'follow', 'mark started following you')
        sent = self._sent(send)
        self.assertEqual(sent[('ExponentPushToken[sw]',)], ('\U0001f464 Mfuasi mpya', 'mark ameanza kukufuata'))
        self.assertEqual(sent[('ExponentPushToken[en]',)][1], 'mark started following you')

    def test_a_group_push_is_split_by_language(self, _bg):
        with mock.patch('songs.push.send_expo_push') as send:
            notify_many([self.sw.pk, self.en.pk], 'group_mention', 'mark mentioned you in Choir: practice at six')
        sent = self._sent(send)
        self.assertEqual(sent[('ExponentPushToken[sw]',)][1], 'mark amekutaja kwenye Choir: practice at six')
        self.assertEqual(sent[('ExponentPushToken[en]',)][1], 'mark mentioned you in Choir: practice at six')

    def test_a_title_the_sender_wrote_is_kept(self, _bg):
        with mock.patch('songs.push.send_expo_push') as send:
            notify_user(self.sw, 'weather_briefing', 'Good morning', title='Habari, Amani')
        self.assertEqual(send.call_args.args[1], 'Habari, Amani')


class MessageForTests(APITestCase):
    def test_a_message_with_no_line_stays_in_english(self):
        self.assertEqual(message_for('Something brand new happened', 'sw'), 'Something brand new happened')

    def test_names_and_titles_are_carried_across_untranslated(self):
        self.assertEqual(message_for('mark rated “Grace Abounding” 5★', 'sw'), 'mark amekipa “Grace Abounding” nyota 5★')
        self.assertEqual(message_for('mark solved your puzzle in 2:05 with 3 stars. They beat you.', 'sw'),
                         'mark ametatua fumbo lako kwa 2:05, nyota 3. Amekushinda.')
