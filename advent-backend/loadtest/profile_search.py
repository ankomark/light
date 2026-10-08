"""Inside the container: the queries one search makes, grouped by shape."""
from collections import Counter

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from songs.models import User

c = APIClient()
c.force_authenticate(User.objects.get(username='loadtester'))
c.get('/api/explore/search/?q=grace', HTTP_HOST='localhost')
with CaptureQueriesContext(connection) as ctx:
    c.get('/api/explore/search/?q=grace', HTTP_HOST='localhost')
shapes = Counter()
for q in ctx.captured_queries:
    sql = q['sql']
    frm = sql.split(' FROM ', 1)[1][:80] if ' FROM ' in sql else sql[:80]
    shapes[sql[:30] + ' ... FROM ' + frm] += 1
print('total', len(ctx.captured_queries))
for s, n in shapes.most_common(8):
    print(n, s)
