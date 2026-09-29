"""Live Bible Battle over REST: every step is decided here (songs/battle.py);
the socket only carries the news of it."""
from .common import *  # noqa: F401,F403
from rest_framework.exceptions import NotFound

from .. import battle as engine
from ..models import Battle

REFUSED_STATUS = {'not_host': status.HTTP_403_FORBIDDEN, 'not_player': status.HTTP_403_FORBIDDEN}


def _refused(exc):
    return Response({'error': 'Not now.', 'code': exc.code},
                    status=REFUSED_STATUS.get(exc.code, status.HTTP_400_BAD_REQUEST))


def _index(request):
    try:
        return int(request.data.get('index'))
    except (TypeError, ValueError):
        raise ValidationError({'index': 'Which question?'})


class BattleViewSet(viewsets.GenericViewSet):
    """POST /quiz-battles/ host · POST join/ · GET <code>/ · POST <code>/start|answer|reveal|next/"""
    permission_classes = [IsAuthenticated]
    lookup_field = 'code'

    def get_object(self):
        battle = Battle.objects.filter(code=str(self.kwargs['code']).upper()).select_related('host').first()
        if not battle:
            raise NotFound('No battle with that code.')
        return battle

    def create(self, request):
        try:
            seconds = int(request.data.get('seconds') or 20)
        except (TypeError, ValueError):
            seconds = 20
        lang = request.data.get('language') if request.data.get('language') in ('en', 'sw') else 'en'
        try:
            battle = engine.create(request.user, request.data.get('title') or '', seconds, lang)
        except ValueError as exc:
            raise APIException(str(exc))
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(engine.state(battle, request.user), status=status.HTTP_201_CREATED)

    def retrieve(self, request, code=None):
        return Response(engine.state(self.get_object(), request.user))

    @action(detail=False, methods=['post'])
    def join(self, request):
        self.kwargs['code'] = request.data.get('code') or ''
        battle = self.get_object()
        try:
            engine.join(battle, request.user)
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(engine.state(battle, request.user))

    @action(detail=True, methods=['post'])
    def start(self, request, code=None):
        battle = self.get_object()
        try:
            engine.start(battle, request.user)
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(engine.state(battle, request.user))

    @action(detail=True, methods=['post'])
    def answer(self, request, code=None):
        battle = self.get_object()
        try:
            out = engine.answer(battle, request.user, _index(request), request.data.get('choice'))
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(out)

    @action(detail=True, methods=['post'])
    def reveal(self, request, code=None):
        battle = self.get_object()
        try:
            engine.reveal(battle, request.user, _index(request))
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(engine.state(battle, request.user))

    @action(detail=True, methods=['post'], url_path='next')
    def next_question(self, request, code=None):
        battle = self.get_object()
        try:
            engine.advance(battle, request.user, _index(request))
        except engine.BattleRefused as exc:
            return _refused(exc)
        return Response(engine.state(battle, request.user))
