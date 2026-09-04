"""Send each person their morning weather line.

Same shape as send_quiz_reminders, deliberately: a morning window so a
mis-scheduled cron cannot push at midnight, one row per person per day so a
cron that fires twice cannot push twice, and an opt-out that is honoured.

    0 4 * * *  python manage.py send_weather_briefings

Forecasts are fetched once per location, not once per person. A congregation
in one town is one call to Open-Meteo, not two hundred.
"""
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from songs.models import DeviceToken, NotificationPreference, WeatherBriefing, WeatherPlace
from songs.push import notify_user
from songs.weather import briefing_text, day_ahead, greeting_for

DEFAULT_TZ = 'Africa/Nairobi'
MORNING_START, MORNING_END = 5, 11

# Coordinates are rounded to this many decimals before grouping. Two places
# within about a kilometre share a forecast, which is well inside the accuracy
# of the forecast itself and saves a great many calls.
LOCATION_PRECISION = 2


class Command(BaseCommand):
    help = "Send the morning weather briefing to everyone who has chosen a place."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Report who would be told what, send nothing.')
        parser.add_argument('--force', action='store_true',
                            help='Send even outside the morning window.')
        parser.add_argument('--tz', default=None,
                            help='Timezone the morning window is judged in (default %s).' % DEFAULT_TZ)

    def handle(self, *args, **options):
        tz_name = options['tz'] or getattr(settings, 'QUIZ_REMINDER_TZ', DEFAULT_TZ)
        try:
            tz = ZoneInfo(tz_name)
        except Exception:                                    # noqa: BLE001
            tz, tz_name = ZoneInfo(DEFAULT_TZ), DEFAULT_TZ

        local_now = timezone.now().astimezone(tz)
        if not options['force'] and not (MORNING_START <= local_now.hour < MORNING_END):
            self.stdout.write(self.style.WARNING(
                'It is %s in %s — outside the %02d:00-%02d:00 morning window. '
                'Nothing sent. Use --force to override.'
                % (local_now.strftime('%H:%M'), tz_name, MORNING_START, MORNING_END)
            ))
            return

        # The app's day, not the local clock's — the same rule the quiz reminder
        # follows, so the two cannot disagree about what "today" means.
        today = timezone.localdate()

        already = set(
            WeatherBriefing.objects.filter(date=today).values_list('user_id', flat=True)
        )
        reachable = set(
            DeviceToken.objects.filter(is_active=True).values_list('user_id', flat=True)
        )
        opted_out = set(
            NotificationPreference.objects.filter(weather=False).values_list('user_id', flat=True)
        )

        places = [
            p for p in WeatherPlace.objects.filter(briefing=True).select_related('user')
            if p.user_id in reachable and p.user_id not in already and p.user_id not in opted_out
        ]
        if not places:
            self.stdout.write(self.style.SUCCESS(
                'Nobody to brief at %s %s.' % (local_now.strftime('%H:%M'), tz_name)))
            return

        # One fetch per location, shared by everyone who lives there.
        forecasts = {}
        for place in places:
            key = (round(place.latitude, LOCATION_PRECISION),
                   round(place.longitude, LOCATION_PRECISION))
            if key not in forecasts:
                forecasts[key] = day_ahead(place.latitude, place.longitude)

        sent = unavailable = 0
        for place in places:
            key = (round(place.latitude, LOCATION_PRECISION),
                   round(place.longitude, LOCATION_PRECISION))
            message = briefing_text(place.name, forecasts.get(key), place.region)
            if not message:
                # No forecast for this place this morning. Say nothing rather
                # than push an empty promise, and try again tomorrow.
                unavailable += 1
                continue

            if options['dry_run']:
                self.stdout.write('  %s -> %s | %s'
                                  % (place.user.username, greeting_for(place.user), message))
                sent += 1
                continue

            try:
                # The greeting is the heading and the forecast is the body, so
                # a truncated notification still shows the weather rather than
                # only a hello.
                notify_user(place.user, 'weather_briefing', message,
                            data={'type': 'weather_briefing'},
                            title=greeting_for(place.user))
                WeatherBriefing.objects.get_or_create(user=place.user, date=today)
                sent += 1
            except Exception as exc:                          # noqa: BLE001
                self.stderr.write('  %s failed: %s' % (place.user.username, exc))

        verb = 'Would brief' if options['dry_run'] else 'Briefed'
        self.stdout.write(self.style.SUCCESS(
            '%s %d of %d people from %d location(s) at %s %s.%s'
            % (verb, sent, len(places), len(forecasts),
               local_now.strftime('%H:%M'), tz_name,
               ' %d had no forecast available.' % unavailable if unavailable else '')
        ))
