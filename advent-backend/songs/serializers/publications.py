from django.utils import timezone

from .common import *  # noqa: F401,F403
from ..models import Publication, Chapter, PublicationLike, PublicationBookmark, ReadingProgress

WORDS_PER_MIN = 200


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

    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'body', 'status', 'version', 'is_removed']
        read_only_fields = ['version', 'is_removed']


class ChapterTocSerializer(serializers.ModelSerializer):
    """A chapter in the table of contents: no body (bodies can carry large
    inline images; the reader fetches one chapter at a time). `version`
    tells a phone whether the copy it kept is still current."""
    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'word_count', 'version', 'status', 'is_removed']
        read_only_fields = fields


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

    class Meta:
        model = Publication
        fields = [
            'id', 'title', 'summary', 'cover', 'category', 'status', 'author', 'is_owner',
            'chapter_count', 'likes_count', 'is_liked', 'is_bookmarked', 'created_at', 'updated_at',
        ]

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
    author_is_following = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = [
            'id', 'title', 'summary', 'cover', 'theme', 'category', 'status',
            'author', 'chapters', 'is_owner', 'reading_minutes',
            'likes_count', 'is_liked', 'is_bookmarked', 'last_read_chapter', 'last_read_position',
            'author_is_following',
            'created_at', 'updated_at', 'published_at',
        ]
        read_only_fields = ['author', 'created_at', 'updated_at', 'published_at']

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
        from ..publishing import sync_chapters
        chapters = sorted(chapters, key=lambda ch: ch.get('order') or 0) if all(
            ch.get('order') for ch in chapters) else chapters
        sync_chapters(publication, chapters, _request_user(self))

    def create(self, validated_data):
        chapters = validated_data.pop('chapters', [])
        if validated_data.get('status') == 'published':
            validated_data['published_at'] = timezone.now()
        publication = Publication.objects.create(**validated_data)
        self._sync_chapters(publication, chapters)
        return publication

    def update(self, instance, validated_data):
        chapters = validated_data.pop('chapters', None)
        new_status = validated_data.get('status', instance.status)
        if new_status == 'published' and not instance.published_at:
            instance.published_at = timezone.now()
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if chapters is not None:
            self._sync_chapters(instance, chapters)
        return instance
