"""Inside the container: Postgres's plan for the notifications list."""
from django.db import connection
from rest_framework.test import APIRequestFactory, force_authenticate

from songs.models import User
from songs.views.messaging import NotificationViewSet

me = User.objects.get(username='loadtester')
req = APIRequestFactory().get('/api/notifications/')
force_authenticate(req, user=me)
view = NotificationViewSet(action_map={'get': 'list'})
view.request = view.initialize_request(req)
view.request.user = me
view.format_kwarg = None
view.action = 'list'
qs = view.get_queryset()[:20]
sql, params = qs.query.sql_with_params()
with connection.cursor() as c:
    c.execute('EXPLAIN (ANALYZE, BUFFERS) ' + sql, params)
    for (line,) in c.fetchall():
        print(line[:170])
print('rows for me:', me.notifications.count() if hasattr(me, 'notifications') else '?')
