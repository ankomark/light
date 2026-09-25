from django.utils import timezone
from rest_framework.exceptions import APIException

from .common import *  # noqa: F401,F403
from ..models import (
    Publication, Chapter, PublicationLike, PublicationBookmark, ReadingProgress, BookHighlight, BookReview,
    ChapterComment,
)

WORDS_PER_MIN = 200


class ChaptersChangedElsewhere(APIException):
    """409: chapters were changed (a co-author, another phone) since the
    writer opened them. The body names them; resend with force to keep yours.
    The view answers with `payload` as is (DRF would turn ids into text)."""
    status_code = 409
    default_detail = 'Some chapters were changed elsewhere.'
    default_code = 'conflict'

    def __init__(self, payload):
        super().__init__(payload.get('error'))
        self.payload = payload


def _request_user(serializer):
    request = serializer.context.get('request')
    if request and request.user.is_authenticated:
        return request.user
    return None


class ChapterSerializer(serializers.ModelSerializer):
    """A chapter in the editor. `id` is sent back on save so the chapter is
    updated in place (its history and readers' places kept), not recreated."""
    id = serializers.IntegerField(required=False)
    status = serializers.ChoiceField(choices=Chapter.STATUS_CHOICES, required=False)
    # Sent back as the version the writer started from: a chapter changed
    # elsewhere since isn't silently overwritten (songs/publishing.py).
    version = serializers.IntegerField(required=False)
    publish_at = serializers.DateTimeField(required=False, allow_null=True)

    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'body', 'status', 'version', 'is_removed', 'publish_at']
        read_only_fields = ['is_removed']


class ChapterTocSerializer(serializers.ModelSerializer):
    """A chapter in the table of contents: no body (bodies can carry large
    inline images; the reader fetches one chapter at a time). `version`
    tells a phone whether the copy it kept is still current."""
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'word_count', 'version', 'status', 'is_removed', 'comment_count', 'publish_at']
        read_only_fields = fields

    def get_comment_count(self, obj):
        return getattr(obj, 'comment_count_anno', 0) or 0


class ChapterReadSerializer(serializers.ModelSerializer):
    """One chapter for the reader."""
    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'body', 'word_count', 'version', 'status']
        read_only_fields = fields


class PublicationListSerializer(serializers.ModelSerializer):
    """Lightweight row for the list — no chapter bodies. cover is an R2 URL."""
    author = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    chapter_count = serializers.SerializerMethodField()
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    cover = serializers.SerializerMethodField()
    # The reader's own place in it (null when never opened / not signed in).
    my_percent = serializers.SerializerMethodField()
    my_finished = serializers.SerializerMethodField()
    rating_avg = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = [
            'id', 'title', 'summary', 'cover', 'category', 'status', 'author', 'is_owner',
            'chapter_count', 'likes_count', 'is_liked', 'is_bookmarked', 'created_at', 'updated_at',
            'my_percent', 'my_finished', 'rating_avg', 'rating_count',
        ]

    def get_rating_avg(self, obj):
        v = getattr(obj, 'rating_avg_anno', None)
        return round(v, 1) if v is not None else None

    def get_rating_count(self, obj):
        return getattr(obj, 'rating_count_anno', 0) or 0

    def get_my_percent(self, obj):
        return getattr(obj, 'my_percent', None)

    def get_my_finished(self, obj):
        return getattr(obj, 'my_finished_at', None) is not None

    def get_cover(self, obj):
        return media.resolve(obj.cover) or ''

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.author_id == request.user.id)

    def get_chapter_count(self, obj):
        anno = getattr(obj, 'chapter_count_anno', None)   # 0 is an answer too
        return anno if anno is not None else obj.chapters.count()

    def get_likes_count(self, obj):
        anno = getattr(obj, 'likes_total', None)
        return anno if anno is not None else obj.likes.count()

    def get_is_liked(self, obj):
        if hasattr(obj, 'liked_by_me'):
            return obj.liked_by_me
        user = _request_user(self)
        return bool(user and obj.likes.filter(user=user).exists())

    def get_is_bookmarked(self, obj):
        if hasattr(obj, 'bookmarked_by_me'):
            return obj.bookmarked_by_me
        user = _request_user(self)
        return bool(user and obj.bookmarks.filter(user=user).exists())


class BookReviewSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = BookReview
        fields = ['id', 'user', 'rating', 'body', 'is_mine', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'is_mine', 'created_at', 'updated_at']

    def get_is_mine(self, obj):
        user = _request_user(self)
        return bool(user and obj.user_id == user.id)

    def validate_rating(self, v):
        if not 1 <= v <= 5:
            raise serializers.ValidationError('A rating is 1 to 5 stars.')
        return v


class ChapterCommentSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    is_author = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()

    class Meta:
        model = ChapterComment
        fields = ['id', 'user', 'body', 'parent', 'is_mine', 'is_author', 'created_at', 'replies']
        read_only_fields = fields

    def get_is_mine(self, obj):
        user = _request_user(self)
        return bool(user and obj.user_id == user.id)

    def get_is_author(self, obj):
        # The book's author, marked in their own discussions.
        return obj.user_id == self.context.get('author_id')

    def get_replies(self, obj):
        kids = self.context.get('replies', {}).get(obj.id, [])
        return ChapterCommentSerializer(kids, many=True, context={**self.context, 'replies': {}}).data


class BookHighlightSerializer(serializers.ModelSerializer):
    """A reader's highlight or note, with enough of its book to list it in
    the library (title, cover, the chapter's title) without another request."""
    publication_title = serializers.CharField(source='publication.title', read_only=True)
    publication_cover = serializers.SerializerMethodField()
    chapter_id = serializers.IntegerField(read_only=True)
    chapter_title = serializers.SerializerMethodField()

    class Meta:
        model = BookHighlight
        fields = [
            'client_id', 'publication', 'publication_title', 'publication_cover', 'chapter_id', 'chapter_title',
            'block', 'quote', 'color', 'note', 'collection', 'deleted', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_publication_cover(self, obj):
        return media.resolve(obj.publication.cover) or ''

    def get_chapter_title(self, obj):
        return obj.chapter.title if obj.chapter_id and obj.chapter else ''


class PublicationDetailSerializer(serializers.ModelSerializer):
    """Full publication with nested chapters — used for editing (and by app
    builds from before the reader loaded chapters one at a time).

    With context['toc'] the chapters come without their bodies: what the
    book page needs, a small fraction of the bytes."""
    author = SimpleUserSerializer(read_only=True)
    chapters = ChapterSerializer(many=True)
    is_owner = serializers.SerializerMethodField()
    reading_minutes = serializers.SerializerMethodField()
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    last_read_chapter = serializers.SerializerMethodField()
    last_read_position = serializers.SerializerMethodField()
    my_percent = serializers.SerializerMethodField()
    my_finished = serializers.SerializerMethodField()
    rating_avg = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()
    author_is_following = serializers.SerializerMethodField()
    upcoming = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    collaborators_count = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = [
            'id', 'title', 'summary', 'cover', 'theme', 'category', 'status',
            'author', 'chapters', 'is_owner', 'reading_minutes',
            'likes_count', 'is_liked', 'is_bookmarked', 'last_read_chapter', 'last_read_position',
            'my_percent', 'my_finished', 'rating_avg', 'rating_count', 'author_is_following',
            'upcoming', 'my_role', 'collaborators_count', 'rights_confirmed_at',
            'created_at', 'updated_at', 'published_at',
        ]
        read_only_fields = ['author', 'created_at', 'updated_at', 'published_at', 'rights_confirmed_at']

    def get_fields(self):
        fields = super().get_fields()
        if self.context.get('toc'):
            # Swapped, not filtered after: a body must never even be read.
            fields['chapters'] = ChapterTocSerializer(many=True, read_only=True)
        return fields

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.author_id == request.user.id)

    # The view annotates what it can (one query for the lot); these fall back
    # to a query each for an object that didn't come through it.
    def get_reading_minutes(self, obj):
        words = getattr(obj, 'words_total', None)
        if words is None:
            words = sum(c.word_count for c in obj.chapters.all())
        return max(1, round(words / WORDS_PER_MIN)) if words else 0

    def get_likes_count(self, obj):
        anno = getattr(obj, 'likes_total', None)
        return anno if anno is not None else obj.likes.count()

    def get_is_liked(self, obj):
        if hasattr(obj, 'liked_by_me'):
            return obj.liked_by_me
        user = _request_user(self)
        return bool(user and obj.likes.filter(user=user).exists())

    def get_is_bookmarked(self, obj):
        if hasattr(obj, 'bookmarked_by_me'):
            return obj.bookmarked_by_me
        user = _request_user(self)
        return bool(user and obj.bookmarks.filter(user=user).exists())

    def get_last_read_chapter(self, obj):
        if hasattr(obj, 'my_last_chapter'):
            return obj.my_last_chapter or 0
        user = _request_user(self)
        if not user:
            return 0
        rp = obj.progresses.filter(user=user).first()
        return rp.last_chapter if rp else 0

    def get_last_read_position(self, obj):
        if hasattr(obj, 'my_last_position'):
            return obj.my_last_position or 0
        user = _request_user(self)
        rp = obj.progresses.filter(user=user).first() if user else None
        return rp.position if rp else 0

    def get_my_percent(self, obj):
        return getattr(obj, 'my_percent', None)

    def get_my_finished(self, obj):
        return getattr(obj, 'my_finished_at', None) is not None

    def get_rating_avg(self, obj):
        v = getattr(obj, 'rating_avg_anno', None)
        return round(v, 1) if v is not None else None

    def get_rating_count(self, obj):
        return getattr(obj, 'rating_count_anno', 0) or 0

    def get_upcoming(self, obj):
        """Scheduled chapters, for readers: "coming Friday". (The author and
        collaborators have them among the chapters, as drafts with a time.)"""
        if obj.status != 'published':
            return []
        # Chapter.objects, not obj.chapters: the page prefetches the chapters
        # a reader may see, and filtering that would inherit "no drafts".
        rows = (Chapter.objects.filter(publication=obj, status=Chapter.DRAFT, is_removed=False,
                                       publish_at__gt=timezone.now())
                .order_by('publish_at').values('id', 'title', 'publish_at')[:10])
        return list(rows)

    def get_my_role(self, obj):
        user = _request_user(self)
        if user and obj.author_id == user.id:
            return 'owner'
        if hasattr(obj, 'my_collab_role'):
            return obj.my_collab_role
        from ..writer_studio import role_of
        return role_of(user, obj)

    def get_collaborators_count(self, obj):
        anno = getattr(obj, 'collab_count', None)
        return anno if anno is not None else obj.collaborators.filter(accepted_at__isnull=False).count()

    def get_author_is_following(self, obj):
        user = _request_user(self)
        if not user or user.id == obj.author_id:
            return False
        if hasattr(obj, 'following_author'):
            return obj.following_author
        return obj.author.followers.filter(id=user.id).exists()

    def _sync_chapters(self, publication, chapters):
        # In place, keeping history (songs/publishing.py). Chapters come in
        # reading order; `order` from the client is taken from their place.
        from ..publishing import sync_chapters, ChapterConflict
        chapters = sorted(chapters, key=lambda ch: ch.get('order') or 0) if all(
            ch.get('order') for ch in chapters) else chapters
        force = str(self.initial_data.get('force', '')).lower() in ('1', 'true') if hasattr(self, 'initial_data') else False
        try:
            return sync_chapters(publication, chapters, _request_user(self), force=force)
        except ChapterConflict as c:
            raise ChaptersChangedElsewhere({'error': 'Some chapters were changed elsewhere since you opened them.',
                                            'code': 'conflict', 'chapters': c.chapters})

    def _confirm_rights(self, instance, validated_data):
        """Publishing (the first time, and after being unpublished) needs the
        author to confirm the words are theirs to publish — once; it's kept."""
        going_out = validated_data.get('status') == 'published' and (instance is None or instance.status != 'published')
        if not going_out or (instance is not None and instance.rights_confirmed_at):
            return
        if str(self.initial_data.get('rights_confirmed', '')).lower() not in ('1', 'true'):
            raise serializers.ValidationError({
                'rights_confirmed': 'Confirm that you wrote this, or have permission to publish it.',
                'code': 'rights_required',
            })
        validated_data['rights_confirmed_at'] = timezone.now()

    # A book goes out once (published_at is set the first time): that's news
    # to the author's followers. Chapters added to a book already out are news
    # to its readers too (songs/book_community.py).
    def create(self, validated_data):
        from ..book_community import announce
        chapters = validated_data.pop('chapters', [])
        self._confirm_rights(None, validated_data)
        if validated_data.get('status') == 'published':
            validated_data['published_at'] = timezone.now()
        publication = Publication.objects.create(**validated_data)
        self._sync_chapters(publication, chapters)
        announce(publication, was_published=False, newly_visible_chapters=[])
        return publication

    def update(self, instance, validated_data):
        # One transaction: a chapter conflict leaves the book as it was,
        # its title and settings included.
        from django.db import transaction
        with transaction.atomic():
            return self._update(instance, validated_data)

    def _update(self, instance, validated_data):
        from ..book_community import announce
        chapters = validated_data.pop('chapters', None)
        self._confirm_rights(instance, validated_data)
        was_published = bool(instance.published_at)
        new_status = validated_data.get('status', instance.status)
        if new_status == 'published' and not instance.published_at:
            instance.published_at = timezone.now()
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        appeared = self._sync_chapters(instance, chapters) if chapters is not None else []
        announce(instance, was_published=was_published, newly_visible_chapters=appeared)
        return instance
