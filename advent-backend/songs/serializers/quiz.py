from django.db.models import Count

from .common import *  # noqa: F401,F403

from ..models import DailyQuiz, QuizAttempt, QuizQuestion, QuizSession


class QuizQuestionSerializer(serializers.ModelSerializer):
    """The playable shape of a question.

    `answer_index` is deliberately absent — the client never receives the answer
    before it submits, or the quiz is a formality. The reference is withheld for
    the same reason: it names the verse, which gives away the book and chapter
    questions outright. Both come back in the submit response.
    """

    class Meta:
        model = QuizQuestion
        # `explanation` is withheld with the answer — for a blanked verse it is
        # the restored verse, which would give the answer away outright.
        fields = [
            'id', 'order', 'difficulty', 'category', 'kind', 'prompt',
            'passage', 'choices', 'base_points',
        ]


class DailyQuizSerializer(serializers.ModelSerializer):
    questions = QuizQuestionSerializer(many=True, read_only=True)
    my_attempt = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()

    class Meta:
        model = DailyQuiz
        fields = ['id', 'date', 'language', 'questions', 'my_attempt', 'counts']

    def get_my_attempt(self, obj):
        """Their attempt, with its review once it exists.

        The answers are only secret until someone has played: after that the
        review is theirs to come back to all day, not something shown once in
        the submit response and lost when the screen closes.
        """
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return None
        attempt = obj.attempts.filter(user=request.user).first()
        if not attempt:
            return None
        return {**QuizAttemptSerializer(attempt).data, 'results': review_for(attempt)}

    def get_counts(self, obj):
        """How many of each difficulty, so the client can show the split —
        one grouped query rather than one per difficulty."""
        found = dict(obj.questions.values_list('difficulty').annotate(n=Count('id')))
        return {d: found.get(d, 0) for d, _ in QuizQuestion.DIFFICULTY_CHOICES}


def review_for(attempt):
    """The per-question review of a daily attempt, from its stored answers —
    the same shape the submit response gives, less the points breakdown."""
    rows = (attempt.answer_rows.select_related('question')
            .order_by('question__order', 'question_id'))
    return [
        {
            'question_id': r.question_id,
            'chosen_index': r.chosen_index,
            'answer_index': r.question.answer_index,
            'correct': r.is_correct,
            'reference': r.question.reference,
            'explanation': r.question.explanation,
            'points_earned': r.points_earned,
            'streak_after': r.streak_after,
        }
        for r in rows
    ]


class QuizAttemptSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = QuizAttempt
        fields = [
            'id', 'user', 'score', 'total', 'points', 'longest_streak',
            'duration_seconds', 'completed_at',
        ]


class PracticeQuestionSerializer(QuizQuestionSerializer):
    """A practice question, with its answer.

    Practice is told right or wrong the moment a choice is tapped — waiting
    on a round trip for that made every answer lag. So the answer travels
    with the question and the app judges at once; the server still scores
    every answer itself (the app's verdict is only what is shown), and the
    daily limit on runs caps what reading answers out of the app could earn.
    The daily quiz, which is ranked and says nothing until submitted, never
    sends its answers.
    """

    class Meta(QuizQuestionSerializer.Meta):
        fields = QuizQuestionSerializer.Meta.fields + ['answer_index', 'reference', 'explanation']


class QuizSessionSerializer(serializers.ModelSerializer):
    """A practice run. Unanswered questions travel with it; answered ones are
    dropped, so the client cannot re-read a question it has already been told
    the answer to."""
    questions = serializers.SerializerMethodField()
    mode_config = serializers.SerializerMethodField()
    total_questions = serializers.SerializerMethodField()

    class Meta:
        model = QuizSession
        fields = [
            'id', 'mode', 'mode_config', 'score', 'answered', 'points',
            'streak', 'longest_streak', 'is_finished', 'total_questions',
            'questions', 'started_at', 'finished_at',
        ]

    def get_total_questions(self, obj):
        return obj.questions.count()

    def get_questions(self, obj):
        answered = set(
            obj.answer_rows.values_list('question_id', flat=True)
        )
        remaining = [q for q in obj.questions.all() if q.id not in answered]
        return PracticeQuestionSerializer(remaining, many=True).data

    def get_mode_config(self, obj):
        """The dials the client needs: how long per question, how many there are."""
        from ..modes import config
        cfg = config(obj.mode)
        return {
            'label': cfg['label'],
            'time_limit': cfg['time_limit'],
            'ends_on_wrong': cfg['ends_on_wrong'],
            'questions': cfg['questions'],
        }
