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
    class Meta:
        model = Chapter
        fields = ['id', 'order', 'title', 'body']
        extra_kwargs = {'id': {'read_only': True}}


class PublicationListSerializer(serializers.ModelSerializer):
    """Lightweight row for the list — no chapter bodies, cover as a URL not base64."""
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
        # Cacheable URL instead of the inline base64 blob; version-busted on edit.
        if not obj.cover:
            return ''
        ver = int(obj.updated_at.timestamp()) if obj.updated_at else 0
        path = f'/api/publications/{obj.id}/cover/?v={ver}'
        request = self.context.get('request')
        return request.build_absolute_uri(path) if request else path

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.author_id == request.user.id)

    def get_chapter_count(self, obj):
        return getattr(obj, 'chapter_count_anno', None) or obj.chapters.count()

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
    """Full publication with nested chapters — used for reading and editing."""
    author = SimpleUserSerializer(read_only=True)
    chapters = ChapterSerializer(many=True)
    is_owner = serializers.SerializerMethodField()
    reading_minutes = serializers.SerializerMethodField()
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    last_read_chapter = serializers.SerializerMethodField()
    author_is_following = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = [
            'id', 'title', 'summary', 'cover', 'theme', 'category', 'status',
            'author', 'chapters', 'is_owner', 'reading_minutes',
            'likes_count', 'is_liked', 'is_bookmarked', 'last_read_chapter', 'author_is_following',
            'created_at', 'updated_at', 'published_at',
        ]
        read_only_fields = ['author', 'created_at', 'updated_at', 'published_at']

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.author_id == request.user.id)

    def get_reading_minutes(self, obj):
        words = sum(len((c.body or '').split()) for c in obj.chapters.all())
        return max(1, round(words / WORDS_PER_MIN)) if words else 0

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_is_liked(self, obj):
        user = _request_user(self)
        return bool(user and obj.likes.filter(user=user).exists())

    def get_is_bookmarked(self, obj):
        user = _request_user(self)
        return bool(user and obj.bookmarks.filter(user=user).exists())

    def get_last_read_chapter(self, obj):
        user = _request_user(self)
        if not user:
            return 0
        rp = obj.progresses.filter(user=user).first()
        return rp.last_chapter if rp else 0

    def get_author_is_following(self, obj):
        user = _request_user(self)
        if user and user.id != obj.author_id:
            return obj.author.followers.filter(id=user.id).exists()
        return False

    def _sync_chapters(self, publication, chapters):
        publication.chapters.all().delete()
        for i, ch in enumerate(chapters, start=1):
            Chapter.objects.create(
                publication=publication,
                order=ch.get('order', i),
                title=ch.get('title', ''),
                body=ch.get('body', ''),
            )

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
