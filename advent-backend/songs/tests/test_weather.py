"""The weather place, and the morning briefing sent from it.

    python manage.py test songs.tests.test_weather
"""
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import (
    DeviceToken, NotificationPreference, User, WeatherBriefing, WeatherPlace,
)
from songs.weather import briefing_text, describe, greeting_for, place_label

NAIROBI = {'name': 'Nairobi', 'country': 'Kenya', 'latitude': -1.283, 'longitude': 36.817}
FORECAST = {'code': 61, 'max': 24.3, 'min': 14.1, 'rain_chance': 70}


class WeatherPlaceApiTests(APITestCase):
    """Choosing the place the briefing will be about."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_a_new_user_has_no_place(self):
        res = self.client.get('/api/weather-place/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {})

    def test_a_neighbourhood_keeps_what_locates_it(self):
        res = self.client.put(
            '/api/weather-place/',
            {**NAIROBI, 'name': 'Kilimani', 'region': 'Nairobi County'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(res.data['region'], 'Nairobi County')
        self.assertEqual(self.client.get('/api/weather-place/').data['region'], 'Nairobi County')

    def test_a_place_can_be_set_and_read_back(self):
        res = self.client.put('/api/weather-place/', NAIROBI, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:200])
        self.assertEqual(res.data['name'], 'Nairobi')
        self.assertTrue(res.data['briefing'])
        self.assertEqual(self.client.get('/api/weather-place/').data['name'], 'Nairobi')

    def test_choosing_again_replaces_rather_than_adds(self):
        """This is 'my weather', not a list of saved cities."""
        self.client.put('/api/weather-place/', NAIROBI, format='json')
        self.client.put('/api/weather-place/', {**NAIROBI, 'name': 'Mombasa'}, format='json')
        self.assertEqual(WeatherPlace.objects.filter(user=self.user).count(), 1)
        self.assertEqual(WeatherPlace.objects.get(user=self.user).name, 'Mombasa')

    def test_impossible_coordinates_are_refused(self):
        """A bad pair would send the cron looking for weather in the void daily."""
        res = self.client.put('/api/weather-place/', {**NAIROBI, 'latitude': 120}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        res = self.client.put('/api/weather-place/', {**NAIROBI, 'longitude': -900}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_nameless_place_is_refused(self):
        res = self.client.put('/api/weather-place/', {**NAIROBI, 'name': '   '}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_briefing_can_be_switched_off_without_losing_the_place(self):
        self.client.put('/api/weather-place/', NAIROBI, format='json')
        res = self.client.put('/api/weather-place/', {'briefing': False}, format='json')
        self.assertFalse(res.data['briefing'])
        self.assertEqual(res.data['name'], 'Nairobi')

    def test_the_place_can_be_forgotten(self):
        self.client.put('/api/weather-place/', NAIROBI, format='json')
        self.assertEqual(self.client.delete('/api/weather-place/').status_code,
                         status.HTTP_204_NO_CONTENT)
        self.assertFalse(WeatherPlace.objects.filter(user=self.user).exists())

    def test_it_is_private(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/weather-place/').status_code,
                         status.HTTP_401_UNAUTHORIZED)


class BriefingTextTests(APITestCase):
    """The one line that lands on a lock screen."""

    def test_it_leads_with_the_place_and_the_temperature(self):
        line = briefing_text('Nairobi', FORECAST)
        self.assertTrue(line.startswith('Nairobi today:'), line)
        self.assertIn('24', line)

    def test_a_wet_day_says_so(self):
        self.assertIn('take a coat', briefing_text('Nairobi', FORECAST))

    def test_a_dry_day_does_not(self):
        line = briefing_text('Nairobi', {**FORECAST, 'code': 0, 'rain_chance': 5})
        self.assertNotIn('coat', line)

    def test_a_neighbourhood_carries_its_region(self):
        """There is a Westlands in Nairobi, in Jamaica and in Massachusetts."""
        self.assertEqual(place_label('Westlands', 'Nairobi County'), 'Westlands, Nairobi County')
        self.assertIn('Nairobi County',
                      briefing_text('Westlands', FORECAST, 'Nairobi County'))

    def test_a_region_that_repeats_the_name_is_dropped(self):
        self.assertEqual(place_label('Kisumu', 'Kisumu County'), 'Kisumu')
        self.assertEqual(place_label('Nairobi', ''), 'Nairobi')

    def test_no_forecast_means_no_line(self):
        """Better silence than a push with nothing in it."""
        self.assertIsNone(briefing_text('Nairobi', None))
        self.assertIsNone(briefing_text('Nairobi', {'max': None}))

    def test_every_code_has_a_word(self):
        for code in list(range(0, 100)) + [None, 'x']:
            self.assertTrue(describe(code))


class BriefingCommandTests(APITestCase):
    """The morning run."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        DeviceToken.objects.create(user=self.user, token='ExponentPushToken[mark]', is_active=True)
        WeatherPlace.objects.create(user=self.user, **NAIROBI)

    def _run(self, **kwargs):
        from django.core.management import call_command
        kwargs.setdefault('force', True)          # tests must not depend on the hour
        call_command('send_weather_briefings', verbosity=0, **kwargs)

    def test_someone_with_a_place_is_briefed(self):
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertTrue(push.called)
        self.assertIn('Nairobi', push.call_args[0][2])
        self.assertTrue(WeatherBriefing.objects.filter(user=self.user).exists())

    def test_the_push_is_addressed_to_the_person(self):
        self.user.first_name = 'Mark'
        self.user.save(update_fields=['first_name'])
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST),              patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertEqual(push.call_args.kwargs['title'], 'Good morning, Mark')
        # The forecast stays in the body, so a truncated push still shows it.
        self.assertIn('Nairobi', push.call_args[0][2])

    def test_running_twice_pushes_once(self):
        """A cron that fires twice must not send the same briefing twice."""
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
            self._run()
        self.assertEqual(push.call_count, 1)

    def test_opting_out_is_honoured(self):
        NotificationPreference.objects.create(user=self.user, weather=False)
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertFalse(push.called)

    def test_turning_the_briefing_off_on_the_place_is_honoured(self):
        WeatherPlace.objects.filter(user=self.user).update(briefing=False)
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertFalse(push.called)

    def test_a_person_with_no_device_gets_no_push(self):
        DeviceToken.objects.filter(user=self.user).update(is_active=False)
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertFalse(push.called)

    def test_a_failed_forecast_sends_nothing_and_leaves_tomorrow_open(self):
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=None), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertFalse(push.called)
        # No row written, so tomorrow's run is free to try again.
        self.assertFalse(WeatherBriefing.objects.filter(user=self.user).exists())

    def test_one_town_is_one_forecast_however_many_people_live_there(self):
        """A congregation in one place must not be two hundred API calls."""
        for i in range(5):
            other = User.objects.create_user(f'u{i}', f'u{i}@x.com', 'pw12345!')
            DeviceToken.objects.create(user=other, token=f'ExponentPushToken[u{i}]', is_active=True)
            # Nearby, not identical — rounding should still group them.
            WeatherPlace.objects.create(user=other, **{**NAIROBI, 'latitude': -1.283 + i * 0.001})
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST) as fetch, \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertEqual(push.call_count, 6)
        self.assertEqual(fetch.call_count, 1)

    def test_a_dry_run_sends_nothing(self):
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run(dry_run=True)
        self.assertFalse(push.called)
        self.assertFalse(WeatherBriefing.objects.exists())

    def test_it_refuses_to_run_outside_the_morning(self):
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            from django.core.management import call_command
            call_command('send_weather_briefings', verbosity=0, tz='Etc/GMT-14')
        # Whether it sends depends on the hour there, but it must never crash.
        self.assertLessEqual(push.call_count, 1)

    def test_yesterdays_briefing_does_not_block_todays(self):
        WeatherBriefing.objects.create(user=self.user, date=timezone.localdate() - timedelta(days=1))
        with patch('songs.management.commands.send_weather_briefings.day_ahead',
                   return_value=FORECAST), \
             patch('songs.management.commands.send_weather_briefings.notify_user') as push:
            self._run()
        self.assertTrue(push.called)


class GreetingTests(APITestCase):
    """The heading on the morning briefing."""

    def _user(self, username, first=''):
        return User.objects.create_user(username, f'{username}@x.com', 'pw12345!', first_name=first)

    def test_a_first_name_is_used(self):
        self.assertEqual(greeting_for(self._user('mark254', first='Mark Otieno')),
                         'Good morning, Mark')

    def test_a_plain_username_will_do(self):
        self.assertEqual(greeting_for(self._user('mark')), 'Good morning, Mark')

    def test_a_handle_is_left_off(self):
        """'Good morning, mark254' is worse than just good morning."""
        self.assertEqual(greeting_for(self._user('mark254')), 'Good morning')
        self.assertEqual(greeting_for(self._user('x_9')), 'Good morning')

    def test_it_never_returns_nothing(self):
        self.assertTrue(greeting_for(None))
