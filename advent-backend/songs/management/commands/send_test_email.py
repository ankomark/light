from django.core.management.base import BaseCommand, CommandError
from songs.emails import send_branded_mail
from django.conf import settings


class Command(BaseCommand):
    help = "Send a test email to verify the current EMAIL_* settings work."

    def add_arguments(self, parser):
        parser.add_argument('recipient', help='Email address to send the test to')

    def handle(self, *args, **options):
        recipient = options['recipient']
        backend = settings.EMAIL_BACKEND
        self.stdout.write(f"Backend:   {backend}")
        self.stdout.write(f"Host/User: {settings.EMAIL_HOST} / {settings.EMAIL_HOST_USER}")
        self.stdout.write(f"From:      {settings.DEFAULT_FROM_EMAIL}")
        self.stdout.write(f"Sending to {recipient} ...")

        try:
            sent = send_branded_mail(
                subject=f"{settings.SITE_NAME} — test email",
                message=("Hi there,\n\n"
                         "If you can read this, your email settings are working.\n\n"
                         "A code in a real email looks like this: 123456\n\n"
                         f"— {settings.SITE_NAME} Team"),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient],
                fail_silently=False,
                code='123456',
            )
        except Exception as exc:  # noqa: BLE001 — surface the real SMTP error
            raise CommandError(f"Failed to send: {exc}")

        if sent:
            self.stdout.write(self.style.SUCCESS(f"Sent {sent} email(s). Check the inbox (and spam)."))
        else:
            self.stdout.write(self.style.WARNING("send_mail returned 0 — nothing was sent."))
