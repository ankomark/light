"""
Events & Tickets in the admin area: Streams admins acting as Skylink's.

    GET  /api/admin/tickets/stats/                      what is waiting, what has sold
    GET  /api/admin/tickets/events/?view=review         the review queue; also live, approved,
                                                        drafts, paused, rejected, removed
    GET  /api/admin/tickets/events/<id>/
    POST /api/admin/tickets/events/<id>/approve/
    POST /api/admin/tickets/events/<id>/reject/         {note}   (also takes down one on sale)
    POST /api/admin/tickets/events/<id>/warn/           {note}   the organiser sees it; still sells
    POST /api/admin/tickets/events/<id>/pause/          {note}   off sale until resumed
    POST /api/admin/tickets/events/<id>/resume/
    POST /api/admin/tickets/events/<id>/remove/         {note}   for good ("burn"), with a fresh code
    GET  /api/admin/tickets/tills/?status=pending
    GET  /api/admin/tickets/tills/<id>/                 polled while a test push is out
    POST /api/admin/tickets/tills/<id>/submit/
    POST /api/admin/tickets/tills/<id>/test/            {phone}  KES 1 to the admin's phone
    POST /api/admin/tickets/tills/<id>/activate/        only after a paid test
    POST /api/admin/tickets/tills/<id>/reject/          {note}
    GET  /api/admin/tickets/audit/

Each is passed to the ticketing server's staff API (songs/ticketing_staff.py)
as this admin. Who may: `manage_tickets` (super admins always), through the
same admin gate as the rest of the admin area. Every action is also logged
here in AdminActionLog.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import ticketing_staff
from .admin import log_admin_action
from .common import Cap

# Only what the staff API reads; anything else in the query string stays here.
LIST_PARAMS = {'status', 'review', 'view', 'kind', 'search', 'page', 'page_size'}

# Actions, and what each is called in this server's audit log.
EVENT_ACTIONS = {
    'approve': 'ticket_event_approve', 'reject': 'ticket_event_reject', 'warn': 'ticket_event_warn',
    'pause': 'ticket_event_pause', 'resume': 'ticket_event_resume', 'remove': 'ticket_event_remove',
}
TILL_ACTIONS = {
    'submit': 'ticket_till_submit', 'test': 'ticket_till_test',
    'activate': 'ticket_till_activate', 'reject': 'ticket_till_reject',
}
# What each action may send on: a note, or the tester's phone. Nothing else.
ACTION_FIELDS = {'reject': ('note',), 'warn': ('note',), 'pause': ('note',), 'remove': ('note',), 'test': ('phone',)}


def _relay(fn):
    """Run a staff API call; its errors become this server's answers."""
    try:
        return Response(fn())
    except ticketing_staff.TicketingUnavailable as exc:
        return Response({'detail': str(exc), 'code': 'ticketing_unavailable'},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except ticketing_staff.TicketingError as exc:
        # The ticketing server's own words ("Send a KES 1 test first…"),
        # with its status where it is the admin's to fix, 502 where it isn't.
        code = exc.status if exc.status < 500 else status.HTTP_502_BAD_GATEWAY
        return Response(exc.body, status=code)


class _TicketsView(APIView):
    permission_classes = [Cap('manage_tickets')]


class AdminTicketsStats(_TicketsView):
    def get(self, request):
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', 'stats/'))


class AdminTicketsAudit(_TicketsView):
    def get(self, request):
        params = {k: v for k, v in request.query_params.items() if k in LIST_PARAMS}
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', 'audit/', params=params))


class AdminTicketsList(_TicketsView):
    """Events or tills, as the ticketing server lists them."""
    kind = None  # 'events' | 'tills'

    def get(self, request):
        params = {k: v for k, v in request.query_params.items() if k in LIST_PARAMS}
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', f'{self.kind}/', params=params))


class AdminTicketsDetail(_TicketsView):
    kind = None

    def get(self, request, pk):
        return _relay(lambda: ticketing_staff.call(request.user, 'GET', f'{self.kind}/{pk}/'))


class AdminTicketsAction(_TicketsView):
    """One action on an event or a till, logged here once it has succeeded."""
    kind = None
    actions = {}

    def post(self, request, pk, action):
        if action not in self.actions:
            return Response({'detail': 'Unknown action.'}, status=status.HTTP_404_NOT_FOUND)
        body = {f: request.data.get(f) for f in ACTION_FIELDS.get(action, ()) if request.data.get(f) is not None}
        response = _relay(lambda: ticketing_staff.call(request.user, 'POST', f'{self.kind}/{pk}/{action}/', body=body))
        if response.status_code == 200:
            data = response.data or {}
            # A line a person can read later: the event's title, or the till.
            what = data.get('title') or data.get('till_number') or ''
            log_admin_action(request.user, self.actions[action], target_type=f'ticket_{self.kind[:-1]}',
                             target_id=pk, reason=' — '.join(x for x in (what, body.get('note', '')) if x))
        return response


class AdminTicketEvents(AdminTicketsList):
    kind = 'events'


class AdminTicketTills(AdminTicketsList):
    kind = 'tills'


class AdminTicketEvent(AdminTicketsDetail):
    kind = 'events'


class AdminTicketTill(AdminTicketsDetail):
    kind = 'tills'


class AdminTicketEventAction(AdminTicketsAction):
    kind = 'events'
    actions = EVENT_ACTIONS

    def get_permissions(self):
        # Removing an event for good can't be undone from the app: a fresh
        # authenticator code, like activating a till.
        if self.kwargs.get('action') == 'remove':
            return [Cap('manage_tickets', recent=True)()]
        return super().get_permissions()


class AdminTicketTillAction(AdminTicketsAction):
    kind = 'tills'
    actions = TILL_ACTIONS

    def get_permissions(self):
        # Activating switches real money on for a till: a fresh authenticator
        # code, as the rest of the admin area asks for its dangerous actions.
        # (The app asks for it and retries by itself: services/api.js.)
        if self.kwargs.get('action') == 'activate':
            return [Cap('manage_tickets', recent=True)()]
        return super().get_permissions()
