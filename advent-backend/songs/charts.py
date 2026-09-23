"""Music charts, from listens (PlayEvent) — not likes.

  trending — plays this week
  top      — plays over the last four weeks ("Top 50")

each for the whole world and for every country with enough listening (the
country is the listener's phone region). A play is a counted listen (30s+,
see PlayEvent), so skips and seeks don't move a chart.

The job worker recomputes them every hour into ChartEntry, so reading a chart
is a small indexed read. Until the worker has run (or on a server without
one) a chart is computed on the spot and cached for a while instead.
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Max
from django.utils import timezone

from .jobs import enqueue, handler
from .models import ChartEntry, PlayEvent

logger = logging.getLogger(__name__)

WINDOWS = {ChartEntry.TRENDING: timedelta(days=7), ChartEntry.TOP: timedelta(days=28)}
SIZE = 50
# A country gets its own charts once this many plays came from it in four weeks.
MIN_COUNTRY_PLAYS = 30
REFRESH_EVERY = timedelta(hours=1)
LIVE_CACHE_SECONDS = 15 * 60


def compute(chart, country='', now=None):
    """[(track_id, plays)] for a chart, best first."""
    now = now or timezone.now()
    qs = PlayEvent.objects.filter(counted=True, started_at__gte=now - WINDOWS[chart], track__is_removed=False)
    if country:
        qs = qs.filter(country=country)
    rows = (qs.values('track_id').annotate(n=Count('id'), last=Max('started_at'))
            .order_by('-n', '-last', 'track_id')[:SIZE])
    return [(r['track_id'], r['n']) for r in rows]


def chart_countries(now=None):
    now = now or timezone.now()
    return list(
        PlayEvent.objects.filter(counted=True, started_at__gte=now - WINDOWS[ChartEntry.TOP])
        .exclude(country='').values('country').annotate(n=Count('id'))
        .filter(n__gte=MIN_COUNTRY_PLAYS).values_list('country', flat=True)
    )


def refresh_all(now=None):
    """Recompute every chart into ChartEntry. Returns the number of charts."""
    now = now or timezone.now()
    keys = [(chart, '') for chart in WINDOWS] + [
        (chart, c) for c in chart_countries(now) for chart in WINDOWS]
    with transaction.atomic():
        ChartEntry.objects.all().delete()
        rows = [
            ChartEntry(chart=chart, country=country, position=i + 1, track_id=tid, plays=n, computed_at=now)
            for chart, country in keys
            for i, (tid, n) in enumerate(compute(chart, country, now))
        ]
        ChartEntry.objects.bulk_create(rows, batch_size=500)
    for chart, country in keys:
        cache.delete(_cache_key(chart, country))
    return len(keys)


def _cache_key(chart, country):
    return f'music:chart:{chart}:{country or "world"}'


def read(chart, country='', limit=SIZE):
    """[(track_id, plays)] for a chart. From the last refresh when there has
    been one; otherwise computed now and cached. A country without its own
    chart yet returns []."""
    if chart not in WINDOWS:
        return []
    country = (country or '').upper()
    if ChartEntry.objects.exists():
        rows = ChartEntry.objects.filter(chart=chart, country=country).order_by('position')
        return [(r.track_id, r.plays) for r in rows[:limit]]
    key = _cache_key(chart, country)
    rows = cache.get(key)
    if rows is None:
        if country and country not in chart_countries():
            rows = []
        else:
            rows = compute(chart, country)
        cache.set(key, rows, LIVE_CACHE_SECONDS)
    return rows[:limit]


@handler('refresh_charts')
def refresh_charts_job():
    """Recompute, then book the next run. Never raises: a failed refresh
    keeps the last charts and simply tries again next hour (a retry of its
    own would start a second chain of hourly jobs)."""
    try:
        refresh_all()
    except Exception:
        logger.exception('chart refresh failed')
    finally:
        enqueue('refresh_charts', key='charts', run_after=timezone.now() + REFRESH_EVERY)
