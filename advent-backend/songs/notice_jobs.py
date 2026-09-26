"""Background jobs for the notice board (run by `manage.py run_worker`)."""
from .jobs import handler


@handler('announce_notice')
def announce_scheduled_notice(notice_id):
    """A scheduled notice's time has come: tell everyone (once)."""
    from .models import Notice
    from .views.directory import announce_notice, live_notices_q
    notice = Notice.objects.filter(pk=notice_id).filter(live_notices_q()).first()
    if notice:
        announce_notice(notice)