"""Admin: music, run from the app.

- GET  /admin/music/                 listening at a glance (view_analytics):
                                     plays and listeners a day, the most
                                     listened songs, how fresh the charts are,
                                     songs waiting for (or failed) processing,
                                     the genres and the editor's picks
- POST /admin/music/genres/          add a genre {name, slug?}, or set the
                                     whole order {order: [ids]} (manage_app)
- POST /admin/music/genres/<id>/     rename / reorder one {name?, position?}
- POST /admin/music/picks/           the Editor's picks rail {tracks: [ids]}

Genres and picks change what everyone sees on the Music home, so they need
manage_app; every change is in the audit log.
"""
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count, Max
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Category, ChartEntry, PlayEvent, SiteSetting, Track
from .admin import log_admin_action
from .common import Cap

PICKS_KEY = 'music_picks'
PICKS_MAX = 20
PICKS_CACHE = 'music:picks'


def editors_picks():
    """The track ids admins picked for the Music home, in their order."""
    ids = cache.get(PICKS_CACHE)
    if ids is None:
        row = SiteSetting.objects.filter(key=PICKS_KEY).values_list('value', flat=True).first() or {}
        ids = [int(i) for i in (row.get('tracks') or []) if str(i).isdigit()]
        cache.set(PICKS_CACHE, ids, 10 * 60)
    return ids


def _genres():
    return list(
        Category.objects.exclude(slug__isnull=True)
        .annotate(track_count=Count('tracks', distinct=True))
        .order_by('position', 'name').values('id', 'slug', 'name', 'position', 'track_count'))


class AdminMusicView(APIView):
    permission_classes = [Cap('view_analytics', 'manage_app')]

    def get(self, request):
        try:
            days = max(7, min(int(request.query_params.get('days') or 14), 90))
        except (TypeError, ValueError):
            days = 14
        now = timezone.now()
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        counted = PlayEvent.objects.filter(counted=True, started_at__gte=start)

        by_day = {r['d']: r for r in (counted.annotate(d=TruncDate('started_at')).values('d')
                                      .annotate(plays=Count('id'), listeners=Count('user', distinct=True)))}
        series = []
        for i in range(days):
            day = (start + timedelta(days=i)).date()
            row = by_day.get(day) or {}
            series.append({'date': day.isoformat(), 'plays': row.get('plays', 0),
                           'listeners': row.get('listeners', 0)})

        # Most listened: by people, not plays (a song on repeat is one person).
        top = list(counted.values('track_id', 'track__title', 'track__artist__username')
                   .annotate(listeners=Count('user', distinct=True), plays=Count('id'))
                   .order_by('-listeners', '-plays')[:10])
        last_chart = ChartEntry.objects.aggregate(at=Max('computed_at'))['at']
        processing = dict(Track.objects.filter(is_removed=False).values_list('processing_status')
                          .annotate(n=Count('id')).values_list('processing_status', 'n'))
        picks = editors_picks()
        pick_rows = {t['id']: t for t in Track.objects.filter(id__in=picks)
                     .values('id', 'title', 'artist__username', 'is_removed')}
        return Response({
            'days': days,
            'series': series,
            'totals': {'plays': sum(d['plays'] for d in series),
                       'listeners': counted.values('user').distinct().count()},
            'top': [{'id': r['track_id'], 'title': r['track__title'], 'artist': r['track__artist__username'],
                     'listeners': r['listeners'], 'plays': r['plays']} for r in top],
            'charts': {'computed_at': last_chart,
                       'countries': sorted(set(ChartEntry.objects.exclude(country='')
                                               .values_list('country', flat=True)))},
            'processing': {'pending': processing.get('pending', 0), 'failed': processing.get('failed', 0),
                           'ready': processing.get('ready', 0)},
            'genres': _genres(),
            'picks': [{'id': i, 'title': pick_rows[i]['title'], 'artist': pick_rows[i]['artist__username'],
                       'is_removed': pick_rows[i]['is_removed']} for i in picks if i in pick_rows],
        })


def _forget_home_caches():
    cache.delete('music:home:genres')
    cache.delete(PICKS_CACHE)


class AdminMusicGenresView(APIView):
    permission_classes = [Cap('manage_app')]

    def post(self, request, pk=None):
        name = str(request.data.get('name') or '').strip()[:100]
        order = request.data.get('order')
        if pk is None and isinstance(order, list):
            ids = [int(i) for i in order if str(i).isdigit()]
            for position, gid in enumerate(ids, start=1):
                Category.objects.filter(pk=gid).update(position=position)
            log_admin_action(request.user, 'order_genres', 'genre', None, reason=f'{len(ids)} genres')
        elif pk is None:
            if not name:
                return Response({'name': ['Give the genre a name.']}, status=status.HTTP_400_BAD_REQUEST)
            slug = slugify(request.data.get('slug') or name)[:60]
            if Category.objects.filter(name__iexact=name).exists() or Category.objects.filter(slug=slug).exists():
                return Response({'name': ['That genre already exists.']}, status=status.HTTP_400_BAD_REQUEST)
            position = (Category.objects.aggregate(m=Max('position'))['m'] or 0) + 1
            genre = Category.objects.create(name=name, slug=slug, position=position)
            log_admin_action(request.user, 'add_genre', 'genre', genre.id, reason=name)
        else:
            genre = Category.objects.filter(pk=pk).first()
            if genre is None:
                return Response({'error': 'No such genre.'}, status=status.HTTP_404_NOT_FOUND)
            fields = []
            if name and name != genre.name:
                if Category.objects.filter(name__iexact=name).exclude(pk=pk).exists():
                    return Response({'name': ['That genre already exists.']}, status=status.HTTP_400_BAD_REQUEST)
                genre.name = name   # the slug stays: it is the key the app translates by
                fields.append('name')
            if 'position' in request.data:
                try:
                    genre.position = max(0, min(int(request.data['position']), 32000))
                    fields.append('position')
                except (TypeError, ValueError):
                    return Response({'position': ['A number.']}, status=status.HTTP_400_BAD_REQUEST)
            if fields:
                genre.save(update_fields=fields)
                log_admin_action(request.user, 'edit_genre', 'genre', genre.id, reason=genre.name)
        _forget_home_caches()
        return Response({'genres': _genres()})


class AdminMusicPicksView(APIView):
    permission_classes = [Cap('manage_app')]

    def post(self, request):
        raw = request.data.get('tracks')
        if not isinstance(raw, list):
            return Response({'tracks': ['A list of song ids.']}, status=status.HTTP_400_BAD_REQUEST)
        ids = list(dict.fromkeys(int(i) for i in raw if str(i).isdigit()))[:PICKS_MAX]
        live = set(Track.objects.filter(id__in=ids, is_removed=False).values_list('id', flat=True))
        ids = [i for i in ids if i in live]
        SiteSetting.objects.update_or_create(key=PICKS_KEY, defaults={'value': {'tracks': ids},
                                                                     'updated_by': request.user})
        _forget_home_caches()
        log_admin_action(request.user, 'set_music_picks', 'music', None, reason=f'{len(ids)} songs')
        return Response({'picks': ids})
