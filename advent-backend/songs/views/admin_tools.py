"""Admin phase 3: the parts of the app admins run, reachable from the app
(they were only in Django's admin, or nowhere).

- /admin/quiz-bank/        the written questions (manage_quiz)
- /admin/puzzle-themes/    the word puzzle's subjects (manage_puzzles)
- /admin/verify/           the verified tick: artists, sellers, services,
                           organizations (verify_accounts)

Every change is in the tamper-evident audit log, through the same gate as
every admin power (standing, capability, two-step admin session).
"""
import re

from django.db.models import Count, Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from ..models import BankQuestion, Organization, PuzzleTheme, QuizQuestion, SellerProfile, User, Videostudio
from .common import Cap, StandardPagination
from .admin import log_admin_action, reason_of


# ── The quiz's question bank ────────────────────────────────────────────────
class BankQuestionSerializer(serializers.ModelSerializer):
    accuracy = serializers.SerializerMethodField()

    class Meta:
        model = BankQuestion
        fields = [
            'id', 'kind', 'language', 'difficulty', 'category', 'prompt', 'choices', 'answer_index',
            'explanation', 'reference', 'is_active', 'retired_reason', 'times_asked', 'times_correct',
            'accuracy', 'origin', 'needs_review', 'calibrated_from', 'created_at', 'updated_at',
        ]
        read_only_fields = ['retired_reason', 'times_asked', 'times_correct', 'origin', 'needs_review',
                            'calibrated_from', 'created_at', 'updated_at']

    def get_accuracy(self, obj):
        return round(obj.accuracy, 3) if obj.accuracy is not None else None

    def validate(self, data):
        from django.core.exceptions import ValidationError as DjangoValidationError
        merged = {**{f: getattr(self.instance, f) for f in ('kind', 'choices', 'answer_index')}, **data} \
            if self.instance else data
        if isinstance(merged.get('choices'), list):
            merged['choices'] = [str(c).strip() for c in merged['choices']]
            if 'choices' in data:            # an edit that leaves them is not to empty them
                data['choices'] = merged['choices']
        probe = BankQuestion(kind=merged.get('kind', ''), choices=merged.get('choices') or [],
                             answer_index=merged.get('answer_index', 0) or 0)
        try:
            probe.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict)
        if not (data.get('prompt', getattr(self.instance, 'prompt', '')) or '').strip():
            raise serializers.ValidationError({'prompt': 'Write the question.'})
        return data


class AdminQuizBankViewSet(viewsets.ModelViewSet):
    """The written questions: filter, write, edit, retire and bring back. A
    question retired by itself (almost everyone right, or almost everyone
    wrong) says so, so its answer can be checked before it comes back."""
    serializer_class = BankQuestionSerializer
    permission_classes = [Cap('manage_quiz')]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = BankQuestion.objects.all().order_by('-updated_at')
        p = self.request.query_params
        if p.get('language') in ('en', 'sw'):
            qs = qs.filter(language=p['language'])
        if p.get('difficulty') in dict(QuizQuestion.DIFFICULTY_CHOICES):
            qs = qs.filter(difficulty=p['difficulty'])
        state = p.get('state')
        if state == 'active':
            qs = qs.filter(is_active=True)
        elif state == 'retired':
            qs = qs.filter(is_active=False).exclude(retired_reason='')
        elif state == 'off':
            qs = qs.filter(is_active=False)
        elif state == 'review':
            # Claude's drafts, waiting for a person to read them.
            qs = qs.filter(needs_review=True)
        if (p.get('q') or '').strip():
            qs = qs.filter(Q(prompt__icontains=p['q'].strip()) | Q(reference__icontains=p['q'].strip()))
        return qs

    def perform_create(self, serializer):
        q = serializer.save()
        log_admin_action(self.request.user, 'create_question', 'bankquestion', q.id, reason=q.prompt[:120])

    def perform_update(self, serializer):
        q = serializer.save()
        log_admin_action(self.request.user, 'edit_question', 'bankquestion', q.id, reason=q.prompt[:120])

    def destroy(self, request, *args, **kwargs):
        # Kept, not deleted: its answers stay counted, and it can come back.
        q = self.get_object()
        q.is_active = False
        q.save(update_fields=['is_active'])
        log_admin_action(request.user, 'retire_question', 'bankquestion', q.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Back into the quizzes, its retirement (and the counts that caused
        it) cleared, so a fixed answer gets a fair new start."""
        q = self.get_object()
        q.is_active = True
        q.retired_reason = ''
        q.times_asked = 0
        q.times_correct = 0
        # Switching a draft on is the review it was waiting for.
        q.needs_review = False
        q.save(update_fields=['is_active', 'retired_reason', 'times_asked', 'times_correct', 'needs_review'])
        log_admin_action(request.user, 'activate_question', 'bankquestion', q.id)
        return Response(self.get_serializer(q).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """A draft not worth keeping: off for good, out of the review list."""
        q = self.get_object()
        BankQuestion.objects.filter(pk=q.pk).update(is_active=False, needs_review=False)
        log_admin_action(request.user, 'reject_question_draft', 'bankquestion', q.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def draft(self, request):
        """Claude drafts questions on a passage, saved switched off for review.
        POST {language, book_number, chapter_start, chapter_end, count, difficulty}
        → {created: [...]}. Nothing drafted is asked until an admin activates it."""
        from ..book_ai import AiFailed, AiOff
        from ..quiz_drafts import DraftRefused, draft_questions

        def number(field, default=None):
            try:
                return int(request.data.get(field, default))
            except (TypeError, ValueError):
                return None

        language = request.data.get('language') if request.data.get('language') in ('en', 'sw') else 'en'
        try:
            made = draft_questions(language, number('book_number'), number('chapter_start'),
                                   number('chapter_end'), number('count', 5) or 5,
                                   request.data.get('difficulty') or '')
        except DraftRefused as refused:
            return Response({'error': 'That passage cannot be drafted from.', 'code': refused.code},
                            status=status.HTTP_400_BAD_REQUEST)
        except AiOff:
            return Response({'error': 'AI is not available.', 'code': 'ai_off'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except AiFailed:
            return Response({'error': 'Claude could not draft just now.', 'code': 'ai_failed'},
                            status=status.HTTP_502_BAD_GATEWAY)
        log_admin_action(request.user, 'draft_questions', 'bankquestion', None,
                         reason=f"book {request.data.get('book_number')} {len(made)} drafts")
        return Response({'created': self.get_serializer(made, many=True).data},
                        status=status.HTTP_201_CREATED)


# ── The word puzzle's themes ────────────────────────────────────────────────
class PuzzleThemeAdminSerializer(serializers.ModelSerializer):
    puzzle_count = serializers.IntegerField(read_only=True, required=False)
    # What the boards will be built around, the automatic words included
    # (book names, the curated list) — so an admin sees what a theme is about
    # before adding to it.
    theme_words = serializers.SerializerMethodField()

    class Meta:
        model = PuzzleTheme
        fields = ['id', 'name', 'slug', 'description', 'name_sw', 'description_sw', 'icon', 'source',
                  'order', 'is_active', 'puzzle_count', 'theme_words']
        read_only_fields = ['slug']

    def get_theme_words(self, obj):
        from ..puzzle import PUZZLE_LANGUAGES, language_available
        from ..puzzle_signatures import signature_words
        return {lang: signature_words(obj, lang) for lang in PUZZLE_LANGUAGES
                if lang == 'en' or language_available(lang)}

    @classmethod
    def _fixed(cls, source):
        return {k: v for k, v in (source or {}).items() if k not in cls.FREE_KEYS}

    def validate_source(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('source: an object.')
        kind = value.get('kind')
        if self.instance and self._fixed(value) == self._fixed(self.instance.source):
            # Where the words come from is unchanged (an older theme may
            # predate today's checks): only the free keys are looked at.
            return self._clean_words(value)
        if kind == PuzzleTheme.BOOKS:
            first, last = value.get('first'), value.get('last')
            if not (isinstance(first, int) and isinstance(last, int) and 1 <= first <= last <= 66):
                raise serializers.ValidationError('Books: first and last, 1 to 66, first not after last.')
        elif kind == PuzzleTheme.PASSAGE:
            from ..bible_books import BOOKS_BY_NAME
            if not (value.get('book') and isinstance(value.get('chapter'), int) and value['chapter'] >= 1):
                raise serializers.ValidationError('Passage: a book and a chapter.')
            book = BOOKS_BY_NAME.get(value['book']) or next(
                (b for b in BOOKS_BY_NAME.values() if b['name'].lower() == str(value['book']).strip().lower()), None)
            if not book:
                raise serializers.ValidationError('Passage: "%s" is not a book of the Bible.' % value['book'])
            if value['chapter'] > book['chapters']:
                raise serializers.ValidationError('Passage: %s has %d chapters.' % (book['name'], book['chapters']))
            value['book'] = book['name']
        elif kind == PuzzleTheme.TOPIC:
            if not str(value.get('term') or '').strip():
                raise serializers.ValidationError('Topic: the word to search scripture for.')
        else:
            raise serializers.ValidationError('kind: books, passage or topic.')
        return self._clean_words(value)

    def _clean_words(self, value):
        # The theme's own words (puzzle_signatures.py): a list, or one line
        # with commas — kept as a clean list of letters-only words.
        for key in self.WORD_KEYS:
            words = value.get(key)
            if words in (None, '', []):
                value.pop(key, None)
                continue
            if isinstance(words, str):
                words = re.split(r'[,\s]+', words)
            if not isinstance(words, list):
                raise serializers.ValidationError(f'{key}: a list of words.')
            clean = []
            for w in words:
                w = re.sub(r'[^A-Za-z]', '', str(w)).upper()
                if len(w) >= 3 and w not in clean:
                    clean.append(w)
            if len(clean) > 60:
                raise serializers.ValidationError(f'{key}: at most 60 words.')
            value[key] = clean
        return value

    # Keys that only steer levels not built yet, so they stay editable on a
    # theme that already has levels: its words, and the Swahili search term.
    WORD_KEYS = ('words', 'words_sw')
    FREE_KEYS = WORD_KEYS + ('term_sw',)

    def validate(self, data):
        # Levels already built come from the theme's source: changing where
        # the words come from would change what those levels mean. The theme
        # words and the Swahili term are let through — they only shape levels
        # still to come.
        if self.instance and 'source' in data and self.instance.puzzles.exists():
            if self._fixed(data['source']) != self._fixed(self.instance.source):
                raise serializers.ValidationError({'source': 'This theme has levels already; make a new theme instead.'})
        return data

    def create(self, validated):
        from django.utils.text import slugify
        base = slugify(validated['name'])[:50] or 'theme'
        slug, n = base, 2
        while PuzzleTheme.objects.filter(slug=slug).exists():
            slug, n = f'{base}-{n}', n + 1
        return PuzzleTheme.objects.create(slug=slug, **validated)


class AdminPuzzleThemeViewSet(viewsets.ModelViewSet):
    serializer_class = PuzzleThemeAdminSerializer
    permission_classes = [Cap('manage_puzzles')]
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return PuzzleTheme.objects.annotate(puzzle_count=Count('puzzles')).order_by('order', 'name')

    def perform_create(self, serializer):
        theme = serializer.save()
        log_admin_action(self.request.user, 'create_puzzle_theme', 'puzzletheme', theme.id, reason=theme.name)

    def perform_update(self, serializer):
        theme = serializer.save()
        log_admin_action(self.request.user, 'edit_puzzle_theme', 'puzzletheme', theme.id, reason=theme.name)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """{ids: [...]}: the themes in the order they are offered."""
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            return Response({'error': 'ids: the theme ids in order'}, status=status.HTTP_400_BAD_REQUEST)
        for position, theme_id in enumerate(ids):
            PuzzleTheme.objects.filter(pk=theme_id).update(order=position)
        log_admin_action(request.user, 'reorder_puzzle_themes', 'puzzletheme', None, reason=f'{len(ids)} themes')
        return Response({'status': 'ok'})


# ── The verified tick ───────────────────────────────────────────────────────
# kind -> (queryset, name of it, who it belongs to, how it is searched)
def _verify_kinds():
    return {
        'artist': (
            User.objects.annotate(n=Count('tracks', distinct=True)).filter(n__gt=0, is_active=True),
            lambda u: u.username, lambda u: u, 'is_verified_artist', ['username__icontains'],
        ),
        'seller': (
            SellerProfile.objects.select_related('user'),
            lambda s: s.user.username, lambda s: s.user, 'is_verified', ['user__username__icontains'],
        ),
        'service': (
            Videostudio.objects.filter(is_removed=False).select_related('created_by'),
            lambda v: v.name, lambda v: v.created_by, 'is_verified', ['name__icontains', 'location__icontains'],
        ),
        'organization': (
            Organization.objects.select_related('created_by'),
            lambda o: o.name, lambda o: o.created_by, 'is_verified', ['name__icontains'],
        ),
    }


class AdminVerifyViewSet(viewsets.ViewSet):
    """Who carries the verified tick: list by kind (search, ticked or not),
    and give or take the tick, with a reason, logged."""
    permission_classes = [Cap('verify_accounts')]

    def list(self, request):
        kinds = _verify_kinds()
        kind = request.query_params.get('kind', 'artist')
        if kind not in kinds:
            return Response({'error': f'kind must be one of {list(kinds)}'}, status=status.HTTP_400_BAD_REQUEST)
        qs, name_of, owner_of, field, search = kinds[kind]
        q = (request.query_params.get('q') or '').strip()
        if q:
            cond = Q()
            for lookup in search:
                cond |= Q(**{lookup: q})
            qs = qs.filter(cond)
        state = request.query_params.get('state')
        if state in ('verified', 'unverified'):
            qs = qs.filter(**{field: state == 'verified'})
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs.order_by('-pk'), request)
        rows = []
        for obj in page:
            owner = owner_of(obj)
            rows.append({
                'id': obj.pk, 'kind': kind, 'name': name_of(obj), 'verified': bool(getattr(obj, field)),
                'owner': owner.username if owner else None,
                'detail': getattr(obj, 'location', '') or getattr(obj, 'kind', '') or '',
            })
        return paginator.get_paginated_response(rows)

    @action(detail=False, methods=['post'])
    def set(self, request):
        """{kind, id, verified, reason}."""
        kinds = _verify_kinds()
        kind = request.data.get('kind')
        if kind not in kinds:
            return Response({'error': f'kind must be one of {list(kinds)}'}, status=status.HTTP_400_BAD_REQUEST)
        qs, name_of, owner_of, field, _ = kinds[kind]
        try:
            oid = int(request.data.get('id'))
        except (TypeError, ValueError):
            # Not a number: it reached the database and failed as a 500.
            return Response({'error': 'id: a number'}, status=status.HTTP_400_BAD_REQUEST)
        obj = qs.filter(pk=oid).first()
        if obj is None:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        verified = bool(request.data.get('verified'))
        reason, refused = reason_of(request, required=not verified)
        if refused:
            return refused
        setattr(obj, field, verified)
        obj.save(update_fields=[field])
        log_admin_action(request.user, f"{'verify' if verified else 'unverify'}_{kind}", kind, obj.pk,
                         reason=reason or name_of(obj))
        owner = owner_of(obj)
        if owner:
            from ..push import notify_user
            try:
                notify_user(owner, 'system', (
                    f'{name_of(obj)} now has the verified tick.' if verified
                    else f'The verified tick was taken from {name_of(obj)}.' + (f' Reason: {reason}' if reason else '')))
            except Exception:  # noqa: BLE001 — telling them never undoes it
                pass
        return Response({'id': obj.pk, 'kind': kind, 'verified': verified})
