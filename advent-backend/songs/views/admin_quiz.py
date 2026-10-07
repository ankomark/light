"""The quiz, run from the admin app (manage_quiz).

- /admin/quiz-daily/          a day's quiz with its answers; rebuild it
- /admin/quiz-reports/        players' "this question is wrong" queue
- /admin/quiz-stats/          how each kind of question is answered, and
                              runs too good to be honest
- /admin/quiz-battles/        live battles, and ending one
- /admin/story-packs/         the story journey: add, edit, feature, retire
- /admin/quiz-bank/draft/     (in admin_tools) Claude drafts for review

Every change goes in the audit log, through the same gate as every admin power.
"""
from datetime import date as date_cls, timedelta

from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ..days import local_day_start, local_today
from ..models import (
    BankQuestion, Battle, DailyQuiz, QuestionReport, QuizAnswer, QuizAttempt, QuizSession,
    StoryPack,
)
from ..modes import DAILY
from ..scoring import PRACTICE_COINS_PER_DAY
from .admin import log_admin_action
from .common import Cap, StandardPagination

LANGS = ('en', 'sw')


def _day(raw):
    if not raw:
        return local_today()
    try:
        return date_cls.fromisoformat(str(raw))
    except ValueError:
        raise ValidationError({'date': 'Use YYYY-MM-DD.'})


# ── A day's quiz ─────────────────────────────────────────────────────────────
class AdminQuizDailyView(APIView):
    """GET ?date=&language= — the day's quiz with every answer, its theme, and
    how many have played it (built now if it was not yet). POST {date,
    language} rebuilds it: only while nobody has played it, so no score on the
    board is ever for questions that no longer exist. Tomorrow may be read,
    to check a day before it opens."""
    permission_classes = [Cap('manage_quiz')]

    def _quiz(self, day, language):
        from ..quiz import generate_for_date
        if day > local_today() + timedelta(days=1):
            raise ValidationError({'date': 'Today or tomorrow at the latest.'})
        try:
            return generate_for_date(day, language=language)
        except ValueError as exc:
            raise ValidationError({'detail': str(exc)})

    def _body(self, quiz):
        return {
            'id': quiz.id, 'date': quiz.date, 'language': quiz.language, 'theme': quiz.theme,
            'attempts': quiz.attempts.count(),
            'playing': quiz.starts.filter(play_started_at__isnull=False).count(),
            'questions': [
                {'id': q.id, 'order': q.order, 'kind': q.kind, 'difficulty': q.difficulty,
                 'category': q.category, 'prompt': q.prompt, 'passage': q.passage,
                 'choices': q.choices, 'answer_index': q.answer_index, 'reference': q.reference,
                 'explanation': q.explanation, 'bank_question': q.bank_question_id}
                for q in quiz.questions.all()
            ],
        }

    def get(self, request):
        language = request.query_params.get('language') if request.query_params.get('language') in LANGS else 'en'
        return Response(self._body(self._quiz(_day(request.query_params.get('date')), language)))

    def post(self, request):
        from ..quiz import generate_for_date
        language = request.data.get('language') if request.data.get('language') in LANGS else 'en'
        day = _day(request.data.get('date'))
        quiz = self._quiz(day, language)
        if quiz.attempts.exists():
            return Response({'error': 'People have already played this quiz.', 'code': 'played'},
                            status=status.HTTP_409_CONFLICT)
        # Someone mid-quiz holds these questions: rebuilt under them, their
        # answers would be to questions that no longer exist.
        if quiz.starts.filter(play_started_at__isnull=False).exists():
            return Response({'error': 'Someone is playing this quiz right now.', 'code': 'in_play'},
                            status=status.HTTP_409_CONFLICT)
        quiz = generate_for_date(day, force=True, language=quiz.language)
        log_admin_action(request.user, 'rebuild_daily_quiz', 'dailyquiz', quiz.id, reason=str(day))
        return Response(self._body(quiz))


# ── Reported questions ───────────────────────────────────────────────────────
class QuestionReportSerializer(serializers.ModelSerializer):
    reporter = serializers.CharField(source='user.username', read_only=True)
    reports_on_question = serializers.SerializerMethodField()

    class Meta:
        model = QuestionReport
        fields = ['id', 'reporter', 'question', 'bank_question', 'kind', 'language', 'prompt', 'passage',
                  'choices', 'answer_index', 'reference', 'reason', 'note', 'status', 'created_at',
                  'resolved_at', 'reports_on_question']

    def get_reports_on_question(self, obj):
        """How many people reported the same question — five reports is a
        different thing from one."""
        if obj.bank_question_id:
            return QuestionReport.objects.filter(bank_question_id=obj.bank_question_id).count()
        return 1 if not obj.question_id else QuestionReport.objects.filter(question_id=obj.question_id).count()


class AdminQuestionReportViewSet(viewsets.ReadOnlyModelViewSet):
    """The queue: open first. POST <id>/resolve/ {status: fixed|dismissed,
    retire: bool} — `retire` switches the written question off (it can be
    fixed in the bank and brought back)."""
    serializer_class = QuestionReportSerializer
    permission_classes = [Cap('manage_quiz')]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = QuestionReport.objects.select_related('user').order_by('-created_at')
        st = self.request.query_params.get('status') or QuestionReport.OPEN
        if st in dict(QuestionReport.STATUS_CHOICES):
            qs = qs.filter(status=st)
        return qs

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        report = self.get_object()
        outcome = request.data.get('status')
        if outcome not in (QuestionReport.FIXED, QuestionReport.DISMISSED):
            raise ValidationError({'status': 'fixed or dismissed.'})
        same = QuestionReport.objects.filter(status=QuestionReport.OPEN)
        same = (same.filter(bank_question_id=report.bank_question_id) if report.bank_question_id
                else same.filter(pk=report.pk))
        # One decision settles every open report of the same written question.
        same.update(status=outcome, resolved_by=request.user, resolved_at=timezone.now())
        if request.data.get('retire') and report.bank_question_id:
            BankQuestion.objects.filter(pk=report.bank_question_id).update(is_active=False)
        log_admin_action(request.user, f'question_report_{outcome}', 'questionreport', report.id,
                         reason=report.prompt[:120])
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)


# ── How questions are answered ───────────────────────────────────────────────
class AdminQuizStatsView(APIView):
    """GET → {kinds, open_reports, review_drafts, calibrated, suspicious}.

    `kinds`: per kind and difficulty of question, over the last 30 days, how
    often it is answered right and how long it takes — a generator that makes
    unfair questions shows here as a kind nobody gets right.
    `suspicious`: daily runs this week too quick for twenty questions to have
    been read, and who has hit the day's practice ceiling — for a person to
    look at, never acted on automatically."""
    permission_classes = [Cap('manage_quiz')]
    DAYS = 30
    # Twenty questions read and answered, nearly all right, in this long or less.
    TOO_FAST_SECONDS = 60

    def get(self, request):
        since = timezone.now() - timedelta(days=self.DAYS)
        rows = (QuizAnswer.objects.filter(Q(attempt__completed_at__gte=since) | Q(session__started_at__gte=since))
                .values('question__kind', 'question__difficulty')
                .annotate(answered=Count('id'), right=Count('id', filter=Q(is_correct=True)),
                          seconds=Avg('response_seconds'))
                .order_by('question__kind', 'question__difficulty'))
        kinds = [{
            'kind': r['question__kind'], 'difficulty': r['question__difficulty'],
            'answered': r['answered'], 'accuracy': round(r['right'] / r['answered'], 3) if r['answered'] else None,
            'seconds': round(r['seconds'], 1) if r['seconds'] is not None else None,
        } for r in rows]

        week = local_today() - timedelta(days=7)
        fast = (QuizAttempt.objects.filter(quiz__date__gte=week, duration_seconds__isnull=False,
                                           duration_seconds__lte=self.TOO_FAST_SECONDS, score__gte=18)
                .select_related('user', 'quiz').order_by('duration_seconds')[:30])
        capped = (QuizSession.objects.filter(started_at__gte=local_day_start()).exclude(mode=DAILY)
                  .values('user__id', 'user__username').annotate(coins=Sum('points'))
                  .filter(coins__gte=PRACTICE_COINS_PER_DAY).order_by('-coins')[:30])
        return Response({
            'kinds': kinds,
            'open_reports': QuestionReport.objects.filter(status=QuestionReport.OPEN).count(),
            'review_drafts': BankQuestion.objects.filter(needs_review=True).count(),
            'calibrated': BankQuestion.objects.exclude(calibrated_from='').count(),
            'suspicious': {
                'fast_daily': [{'user': a.user.username, 'user_id': a.user_id, 'date': a.quiz.date,
                                'score': a.score, 'total': a.total, 'seconds': a.duration_seconds}
                               for a in fast],
                'practice_capped': [{'user': r['user__username'], 'user_id': r['user__id'], 'coins': r['coins']}
                                    for r in capped],
            },
        })


# ── Live battles ─────────────────────────────────────────────────────────────
class AdminBattleViewSet(viewsets.ViewSet):
    """GET — battles not finished, newest first. POST <code>/end/ — end one
    (a room left open, or one being misused); its players are told."""
    permission_classes = [Cap('manage_quiz')]

    def list(self, request):
        battles = (Battle.objects.exclude(status=Battle.FINISHED).select_related('host')
                   .annotate(n=Count('players')).order_by('-created_at')[:100])
        return Response([{
            'code': b.code, 'title': b.title, 'host': b.host.username, 'status': b.status,
            'players': b.n, 'current': b.current, 'language': b.language, 'created_at': b.created_at,
        } for b in battles])

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        from .. import battle as engine
        b = Battle.objects.filter(code=str(pk).upper()).first()
        if not b:
            return Response({'error': 'No such battle.'}, status=status.HTTP_404_NOT_FOUND)
        if b.status != Battle.FINISHED:
            Battle.objects.filter(pk=b.pk).update(status=Battle.FINISHED, finished_at=timezone.now())
            b.refresh_from_db()
            engine.announce(b, {'type': 'finished', 'ranking': engine.ranking(b)})
            log_admin_action(request.user, 'end_battle', 'battle', b.id, reason=b.code)
        return Response({'code': b.code, 'status': b.status})


# ── The story journey ────────────────────────────────────────────────────────
class StoryPackSerializer(serializers.ModelSerializer):
    runs = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = StoryPack
        fields = ['id', 'slug', 'title', 'title_sw', 'summary', 'summary_sw', 'book_number',
                  'chapter_start', 'chapter_end', 'icon', 'order', 'is_active', 'is_featured', 'runs']
        read_only_fields = ['slug']

    def validate(self, data):
        from ..bible_books import BIBLE_BOOKS
        merged = {f: data.get(f, getattr(self.instance, f, None))
                  for f in ('book_number', 'chapter_start', 'chapter_end')}
        book = next((b for b in BIBLE_BOOKS if b['number'] == merged['book_number']), None)
        if not book:
            raise serializers.ValidationError({'book_number': 'A book from 1 (Genesis) to 66 (Revelation).'})
        first, last = merged['chapter_start'], merged['chapter_end']
        if not (first and last and 1 <= first <= last <= book['chapters']):
            raise serializers.ValidationError(
                {'chapter_end': f"{book['name']} has {book['chapters']} chapters; first no later than last."})
        return data

    def create(self, validated):
        from django.utils.text import slugify
        base = slugify(validated['title'])[:34] or 'story'
        slug, n = base, 2
        while StoryPack.objects.filter(slug=slug).exists():
            slug, n = f'{base}-{n}', n + 1
        return StoryPack.objects.create(slug=slug, **validated)


class AdminStoryPackViewSet(viewsets.ModelViewSet):
    """The stories, in journey order. Featuring one (this week's Sabbath
    School passage, a camp's theme) takes it out of the journey and opens it
    to everyone; featuring another unfeatures the last."""
    serializer_class = StoryPackSerializer
    permission_classes = [Cap('manage_quiz')]
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return StoryPack.objects.order_by('order', 'id')

    def list(self, request, *args, **kwargs):
        packs = list(self.get_queryset())
        runs = dict(QuizSession.objects.filter(mode='story').values_list('topic').annotate(n=Count('id')))
        data = self.get_serializer(packs, many=True).data
        for row in data:
            row['runs'] = runs.get(row['slug'], 0)
        return Response(data)

    def _one_featured(self, pack):
        if pack.is_featured:
            StoryPack.objects.exclude(pk=pack.pk).filter(is_featured=True).update(is_featured=False)

    def perform_create(self, serializer):
        pack = serializer.save()
        self._one_featured(pack)
        log_admin_action(self.request.user, 'create_story_pack', 'storypack', pack.id, reason=pack.title)

    def perform_update(self, serializer):
        pack = serializer.save()
        self._one_featured(pack)
        log_admin_action(self.request.user, 'edit_story_pack', 'storypack', pack.id, reason=pack.title)
