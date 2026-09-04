"""Send the day's verse each morning.

The same shape as the weather briefing and the quiz reminder: a morning window
so a mis-scheduled cron cannot push at midnight, one row per person per day so
a cron firing twice cannot push twice, and an opt-out that is honoured.

    0 4 * * *  python manage.py send_verse_of_the_day

The verse is the same for everyone, so it is resolved once and the text is
reused for every recipient.
"""
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from songs.devotion import verse_for_date
from songs.models import DeviceToken, NotificationPreference, VerseSend
from songs.push import notify_user

DEFAULT_TZ = 'Africa/Nairobi'
MORNING_START, MORNING_END = 5, 11

# A push body longer than this is truncated by the platform anyway, and a verse
# cut mid-clause reads worse than one that says "read the rest".
MAX_BODY = 160


class Command(BaseCommand):
    help = "Send the verse of the day to everyone who has not opted out."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Report who would receive it, send nothing.')
        parser.add_argument('--force', action='store_true',
                            help='Send even outside the morning window.')
        parser.add_argument('--tz', default=None,
                            help='Timezone the morning window is judged in (default %s).' % DEFAULT_TZ)

    def handle(self, *args, **options):
        tz_name = options['tz'] or getattr(settings, 'QUIZ_REMINDER_TZ', DEFAULT_TZ)
        try:
            tz = ZoneInfo(tz_name)
        except Exception:                                   # noqa: BLE001
            tz, tz_name = ZoneInfo(DEFAULT_TZ), DEFAULT_TZ

        local_now = timezone.now().astimezone(tz)
        if not options['force'] and not (MORNING_START <= local_now.hour < MORNING_END):
            self.stdout.write(self.style.WARNING(
                'It is %s in %s — outside the %02d:00-%02d:00 morning window. '
                'Nothing sent. Use --force to override.'
                % (local_now.strftime('%H:%M'), tz_name, MORNING_START, MORNING_END)
            ))
            return

        today = timezone.localdate()
        verse = verse_for_date(today)
        if not verse:
            self.stderr.write('No verse available — has the Bible been imported?')
            return

        body = verse.text
        if len(body) > MAX_BODY:
            cut = body[:MAX_BODY].rsplit(' ', 1)[0]
            body = f'{cut}…'

        already = set(VerseSend.objects.filter(date=today).values_list('user_id', flat=True))
        opted_out = set(
            NotificationPreference.objects.filter(verse=False).values_list('user_id', flat=True)
        )
        recipients = [
            uid for uid in
            DeviceToken.objects.filter(is_active=True)
            .values_list('user_id', flat=True).distinct()
            if uid not in already and uid not in opted_out
        ]
        if not recipients:
            self.stdout.write(self.style.SUCCESS(
                'Nobody to send to at %s %s.' % (local_now.strftime('%H:%M'), tz_name)))
            return

        from songs.models import User
        users = User.objects.in_bulk(recipients)

        sent = 0
        for uid in recipients:
            user = users.get(uid)
            if not user:
                continue
            if options['dry_run']:
                sent += 1
                continue
            try:
                notify_user(user, 'verse_of_the_day', body,
                            data={'type': 'verse_of_the_day', 'reference': verse.reference},
                            title=verse.reference)
                VerseSend.objects.get_or_create(user=user, date=today)
                sent += 1
            except Exception as exc:                        # noqa: BLE001
                self.stderr.write('  %s failed: %s' % (user.username, exc))

        verb = 'Would send' if options['dry_run'] else 'Sent'
        self.stdout.write(self.style.SUCCESS(
            '%s %s to %d of %d people at %s %s.'
            % (verb, verse.reference, sent, len(recipients),
               local_now.strftime('%H:%M'), tz_name)))
