"""A morning note to the super admins: yesterday at a glance (new accounts,
reports and appeals waiting, failed sign-ins, open security events, failed
background jobs).

    python manage.py admin_daily_summary          (once a day, e.g. 07:00)
    python manage.py admin_daily_summary --print  (just show it)
"""
from django.core.management.base import BaseCommand

from songs.admin_alerts import super_admin_ids
from songs.monitor import daily_summary
from songs.push import notify_many


class Command(BaseCommand):
    help = 'Push yesterday at a glance to the super admins.'

    def add_arguments(self, parser):
        parser.add_argument('--print', action='store_true', help='Print it instead of sending.')

    def handle(self, *args, **options):
        text = daily_summary()
        if options['print']:
            self.stdout.write(text)
            return
        sent = notify_many(super_admin_ids(), 'system', text, title='\U0001f4ca Adventist Life — daily summary')
        self.stdout.write(self.style.SUCCESS(f'Sent to {sent} device(s): {text}'))
