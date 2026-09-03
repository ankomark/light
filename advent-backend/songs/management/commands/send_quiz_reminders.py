"""Nudge people about today's Bible quiz, in the morning.

Only two kinds of person are worth a push: someone with a streak that will
break today, and someone who plays regularly but has not opened it yet. Nobody
who has never played gets nagged — a reminder for something you have never
chosen is spam, and it is how an app gets its notifications muted for good.

Scheduling: this deploy has no scheduler, so run it from a cron service. The
server clock is UTC and the audience is East Africa, so 07:00 local is 04:00
UTC:

    0 4 * * *  python manage.py send_quiz_reminders

The command refuses to run outside a morning window in QUIZ_REMINDER_TZ, so a
mis-scheduled cron cannot push at midnight. --force overrides it for testing.

    python manage.py send_quiz_reminders --dry-run
    python manage.py send_quiz_reminders --force
"""
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from songs.models import DeviceToken, PlayDay, QuizReminder, User
from songs.push import notify_user

# The audience is East African; a reminder should land over breakfast.
DEFAULT_TZ = 'Africa/Nairobi'
MORNING_START, MORNING_END = 5, 11

# Someone who last played this long ago has drifted away — a daily nudge would
# be pestering rather than reminding.
DORMANT_AFTER_DAYS = 14


class Command(BaseCommand):
    help = "Send the morning 'today's quiz is ready' push to lapsed and streak-holding players."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Report who would be reminded, send nothing.')
        parser.add_argument('--force', action='store_true',
                            help='Send even outside the morning window.')
        parser.add_argument('--tz', default=None,
                            help='Timezone the morning window is judged in (default %s).' % DEFAULT_TZ)

    def handle(self, *args, **options):
        tz_name = options['tz'] or getattr(settings, 'QUIZ_REMINDER_TZ', DEFAULT_TZ)
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo(DEFAULT_TZ)
            tz_name = DEFAULT_TZ

        local_now = timezone.now().astimezone(tz)
        if not options['force'] and not (MORNING_START <= local_now.hour < MORNING_END):
            self.stdout.write(self.style.WARNING(
                'It is %s in %s — outside the %02d:00-%02d:00 morning window. '
                'Nothing sent. Use --force to override.'
                % (local_now.strftime('%H:%M'), tz_name, MORNING_START, MORNING_END)
            ))
            return

        # The window is judged in local time — a push should land over
        # breakfast — but the *day* is the app's day, which everything else
        # (the quiz's date, the streak) is keyed on. For the three hours after
        # local midnight the two disagree, and dating a reminder by the local
        # clock would nag someone about a quiz they had already played.
        today = timezone.localdate()
        cutoff = today - timedelta(days=DORMANT_AFTER_DAYS)

        # Everyone who has played recently — anything, not just the quiz. The
        # streak spans both games, so someone who spent yesterday on the word
        # puzzle has a streak to protect and is worth reminding.
        recent = PlayDay.objects.filter(date__gte=cutoff).values_list('user_id', 'date')
        last_played = {}
        for user_id, day in recent:
            if day and (user_id not in last_played or day > last_played[user_id]):
                last_played[user_id] = day

        # Not those who already played today, nor those already reminded today.
        played_today = set(
            PlayDay.objects.filter(date=today).values_list('user_id', flat=True)
        )
        already_reminded = set(
            QuizReminder.objects.filter(date=today).values_list('user_id', flat=True)
        )
        # A push with nowhere to go is not worth a query.
        reachable = set(
            DeviceToken.objects.filter(is_active=True).values_list('user_id', flat=True)
        )

        candidates = [
            (uid, day) for uid, day in last_played.items()
            if uid not in played_today and uid not in already_reminded and uid in reachable
        ]

        if options['dry_run']:
            at_risk = sum(1 for _, day in candidates if (today - day).days == 1)
            self.stdout.write(self.style.SUCCESS(
                'Would remind %d people (%d with a streak breaking today). '
                'Window %s in %s.'
                % (len(candidates), at_risk, local_now.strftime('%H:%M'), tz_name)
            ))
            return

        users = User.objects.in_bulk([uid for uid, _ in candidates])
        sent = 0
        for user_id, day in candidates:
            user = users.get(user_id)
            if not user:
                continue
            streak_breaks_today = (today - day).days == 1
            message = (
                'Your streak ends today unless you play. Twenty new questions are waiting.'
                if streak_breaks_today
                else 'Today\'s Bible quiz is ready — twenty new questions.'
            )
            try:
                notify_user(user, 'quiz_reminder', message, data={'type': 'quiz_reminder'})
                # Recorded even if the push is later dropped downstream: the
                # point is that this person has had their one nudge today.
                QuizReminder.objects.get_or_create(user=user, date=today)
                sent += 1
            except Exception as exc:                      # noqa: BLE001
                self.stderr.write('  %s failed: %s' % (user.username, exc))

        self.stdout.write(self.style.SUCCESS(
            'Reminded %d of %d candidates at %s %s.'
            % (sent, len(candidates), local_now.strftime('%H:%M'), tz_name)
        ))
