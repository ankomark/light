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
        fields = ['id', 'date', 'questions', 'my_attempt', 'counts']

    def get_my_attempt(self, obj):
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return None
        attempt = obj.attempts.filter(user=request.user).first()
        return QuizAttemptSerializer(attempt).data if attempt else None

    def get_counts(self, obj):
        """How many of each difficulty, so the client can show the split."""
        out = {}
        for difficulty, _ in QuizQuestion.DIFFICULTY_CHOICES:
            out[difficulty] = obj.questions.filter(difficulty=difficulty).count()
        return out


class QuizAttemptSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = QuizAttempt
        fields = [
            'id', 'user', 'score', 'total', 'points', 'longest_streak',
            'duration_seconds', 'completed_at',
        ]


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
        return QuizQuestionSerializer(remaining, many=True).data

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
