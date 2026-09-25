"""Services, phases 4 and 5: finding the right one (near me, filters, sort,
saved) and the provider's side (bookings and quotes, how they're found and
reached, how quickly they answer).

- Distance: approximate in the database (to sort), exact for the card.
- Events: page views, calls, WhatsApp, messages, directions, shares — counted
  per service per day; a person's view counts once a day.
- Insights: those totals over 7 / 30 / 90 days, views per day, bookings.
- Response time: how long the provider usually takes to answer a request.
"""
import math
import statistics
from datetime import timedelta

from django.core.cache import cache
from django.db.models import F, FloatField, Sum, Value
from django.utils import timezone

from .models import ServiceBooking, ServiceEvent

EARTH_KM = 6371.0
RESPONSE_MIN_REQUESTS = 3
RESPONSE_WINDOW_DAYS = 90
DAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')


def parse_point(value):
    """'lat,lng' → (lat, lng), or None."""
    try:
        lat, lng = (float(x) for x in str(value or '').split(',')[:2])
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def with_distance(qs, point):
    """Annotate `dist2`: a squared distance in degrees, scaled for latitude —
    enough to sort by, in any database. Listings without a pin get none."""
    lat, lng = point
    k = math.cos(math.radians(lat))
    dlat = F('latitude') - Value(lat)
    dlng = (F('longitude') - Value(lng)) * Value(k)
    return qs.annotate(dist2=(dlat * dlat + dlng * dlng) * Value(1.0, output_field=FloatField()))


def km_between(a, b):
    """Great-circle distance (km) between two (lat, lng) points."""
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def open_at_q(value):
    """'mon,14:30' (the viewer's own day and time) → a Q for listings open
    then, or None."""
    from django.db.models import Q
    try:
        day, hhmm = str(value).split(',')
    except ValueError:
        return None
    if day not in DAYS or len(hhmm) != 5:
        return None
    return Q(**{f'opening_hours__{day}__0__lte': hhmm, f'opening_hours__{day}__1__gt': hhmm})


# ── Events ──────────────────────────────────────────────────────────────────

def record(service, kind, who):
    """Count one event. A view counts once a day per person (or address)."""
    if kind not in ServiceEvent.KINDS:
        return False
    today = timezone.localdate()
    if kind == 'view':
        key = f'svcview:{service.pk}:{who}:{today.isoformat()}'
        if not cache.add(key, 1, 26 * 3600):
            return False
    row, _ = ServiceEvent.objects.get_or_create(service=service, kind=kind, day=today)
    ServiceEvent.objects.filter(pk=row.pk).update(count=F('count') + 1)
    return True


def responds_in_hours(service):
    """How long the provider usually takes to answer a request (the median,
    in hours) — once there are a few answers to go on; else None."""
    since = timezone.now() - timedelta(days=RESPONSE_WINDOW_DAYS)
    rows = list(ServiceBooking.objects.filter(service=service, responded_at__isnull=False, created_at__gte=since)
                .values_list('created_at', 'responded_at')[:200])
    if len(rows) < RESPONSE_MIN_REQUESTS:
        return None
    return round(statistics.median((b - a).total_seconds() / 3600 for a, b in rows), 1)


def insights(service, days=30):
    """The owner's numbers: totals of each event, views per day, requests."""
    days = days if days in (7, 30, 90) else 30
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    events = ServiceEvent.objects.filter(service=service, day__gte=start)
    totals = {k: 0 for k in ServiceEvent.KINDS}
    totals.update(dict(events.order_by().values('kind').annotate(n=Sum('count')).values_list('kind', 'n')))
    per_day = dict(events.filter(kind='view').values_list('day', 'count'))
    daily = [{'day': (start + timedelta(days=i)).isoformat(), 'readers': per_day.get(start + timedelta(days=i), 0)}
             for i in range(days)]
    bookings = ServiceBooking.objects.filter(service=service, created_at__date__gte=start)
    return {
        'days': days,
        'totals': totals,
        'daily': daily,                               # the chart's shape (BookCharts' DailyColumns)
        'requests': bookings.count(),
        'accepted': bookings.filter(status=ServiceBooking.ACCEPTED).count(),
        'waiting': ServiceBooking.objects.filter(service=service, status=ServiceBooking.PENDING).count(),
        'responds_in_hours': responds_in_hours(service),
    }
