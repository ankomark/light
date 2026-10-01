"""Admin phase 3: the parts of the app admins run, reachable from the app
(they were only in Django's admin, or nowhere).

- /admin/quiz-bank/        the written questions (manage_quiz)
- /admin/puzzle-themes/    the word puzzle's subjects (manage_puzzles)
- /admin/verify/           the verified tick: artists, sellers, services,
                           organizations (verify_accounts)

Every change is in the tamper-evident audit log, through the same gate as
every admin power (standing, capability, two-step admin session).
"""
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
            'accuracy', 'created_at', 'updated_at',
        ]
        read_only_fields = ['retired_reason', 'times_asked', 'times_correct', 'created_at', 'updated_at']

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
        q.save(update_fields=['is_active', 'retired_reason', 'times_asked', 'times_correct'])
        log_admin_action(request.user, 'activate_question', 'bankquestion', q.id)
        return Response(self.get_serializer(q).data)


# ── The word puzzle's themes ────────────────────────────────────────────────
class PuzzleThemeAdminSerializer(serializers.ModelSerializer):
    puzzle_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = PuzzleTheme
        fields = ['id', 'name', 'slug', 'description', 'name_sw', 'description_sw', 'icon', 'source',
                  'order', 'is_active', 'puzzle_count']
        read_only_fields = ['slug']

    def validate_source(self, value):
        kind = (value or {}).get('kind')
        if kind == PuzzleTheme.BOOKS:
            first, last = value.get('first'), value.get('last')
            if not (isinstance(first, int) and isinstance(last, int) and 1 <= first <= last <= 66):
                raise serializers.ValidationError('Books: first and last, 1 to 66, first not after last.')
        elif kind == PuzzleTheme.PASSAGE:
            if not (value.get('book') and isinstance(value.get('chapter'), int) and value['chapter'] >= 1):
                raise serializers.ValidationError('Passage: a book and a chapter.')
        elif kind == PuzzleTheme.TOPIC:
            if not str(value.get('term') or '').strip():
                raise serializers.ValidationError('Topic: the word to search scripture for.')
        else:
            raise serializers.ValidationError('kind: books, passage or topic.')
        return value

    def validate(self, data):
        # Levels already built come from the theme's source: changing where
        # the words come from would change what those levels mean.
        if self.instance and 'source' in data and data['source'] != self.instance.source \
                and self.instance.puzzles.exists():
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
        obj = qs.filter(pk=request.data.get('id')).first()
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
