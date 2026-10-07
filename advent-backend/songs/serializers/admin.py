from collections import defaultdict

from .common import *  # noqa: F401,F403  (serializers, models, SimpleUserSerializer, timezone)
from ..models import AdminActionLog, Appeal, Role, ADMIN_CAPABILITY_KEYS
from ..models import Album, BookReview, ChapterComment, SinglesProfile, SinglesReply, SinglesTopic


# ── Report target previews (batched) ─────────────────────────────────────────
# One formatter per content type, shared by the per-row fallback and the batched
# prefetch so the shape is identical either way.
def _format_post(p):
    return {
        'type': 'post', 'id': p.id, 'caption': (p.caption or '')[:140],
        'content_type': p.content_type,
        'author': SimpleUserSerializer(p.user).data,
        'is_removed': p.is_removed,
    }


def _format_comment(c):
    return {
        'type': 'comment', 'id': c.id, 'content': (c.content or '')[:200],
        'post_id': c.post_id,
        'author': SimpleUserSerializer(c.user).data,
        'is_removed': c.is_removed,
    }


def _format_track(t):
    return {
        'type': 'track', 'id': t.id, 'title': t.title,
        'author': SimpleUserSerializer(t.artist).data,
        'is_removed': t.is_removed,
    }


def _format_user(u):
    return {
        'type': 'user', 'id': u.id, 'username': u.username,
        'author': SimpleUserSerializer(u).data,
        'is_suspended': u.is_suspended, 'is_active': u.is_active,
    }


def _format_group(g):
    return {'type': 'group', 'id': g.id, 'name': getattr(g, 'name', '')}


def _format_singles_profile(p):
    photo = next((ph.url for ph in p.photos.all() if ph.status == 'approved'), None)
    return {'type': 'singlesprofile', 'id': p.id, 'name': p.first_name, 'status': p.status,
            'photo': photo, 'about': (p.about or '')[:140], 'author': SimpleUserSerializer(p.user).data}


def _format_singles_text(kind):
    def fmt(x):
        return {'type': kind, 'id': x.id, 'body': (x.body or '')[:140], 'is_removed': x.is_removed,
                'author': SimpleUserSerializer(x.author.user).data}
    return fmt


def _format_book_words(kind):
    """A reported review or chapter comment: what was written, on which book."""
    def fmt(x):
        return {'type': kind, 'id': x.id, 'body': (x.body or '')[:140], 'is_removed': x.is_removed,
                'book': getattr(x.publication, 'title', ''), 'rating': getattr(x, 'rating', None),
                'author': SimpleUserSerializer(x.user).data}
    return fmt


def _format_publication(p):
    return {
        'type': 'publication', 'id': p.id, 'title': (p.title or '')[:140],
        'author': SimpleUserSerializer(p.author).data,
        'is_removed': p.is_removed,
    }


def _format_chapter(c):
    pub = c.publication
    return {
        'type': 'chapter', 'id': c.id,
        'title': f"{(pub.title or '')[:100]} · {(c.title or f'Chapter {c.order}')[:60]}",
        'publication_id': pub.id,
        'author': SimpleUserSerializer(pub.author).data,
        'is_removed': c.is_removed,
    }


def _chapters_by_id(ids):
    from ..models import Chapter
    return Chapter.objects.filter(id__in=ids).select_related('publication__author__profile')


def _format_album(a):
    return {
        'type': 'album', 'id': a.id, 'title': (a.title or '')[:140],
        'author': SimpleUserSerializer(a.artist).data,
        'is_removed': a.is_removed,
    }


def _format_playlist(p):
    return {
        'type': 'playlist', 'id': p.id, 'title': (p.name or '')[:140],
        'author': SimpleUserSerializer(p.user).data,
        'is_removed': p.is_removed,
    }


def _format_product(p):
    return {
        'type': 'product', 'id': p.id, 'title': (p.title or '')[:140],
        'author': SimpleUserSerializer(p.seller).data,
        'is_removed': p.is_removed,
    }


# content_type -> (queryset builder, formatter). select_related pulls the
# author (+ its profile for the avatar) so a page of targets is a query per
# TYPE, not per report.
_TARGET_FETCHERS = {
    'post':    (lambda ids: SocialPost.objects.filter(id__in=ids).select_related('user__profile'),   _format_post),
    'comment': (lambda ids: PostComment.objects.filter(id__in=ids).select_related('user__profile'),  _format_comment),
    'track':   (lambda ids: Track.objects.filter(id__in=ids).select_related('artist__profile'),      _format_track),
    'user':    (lambda ids: User.objects.filter(id__in=ids).select_related('profile'),               _format_user),
    'group':   (lambda ids: Group.objects.filter(id__in=ids),                                        _format_group),
    'publication': (lambda ids: Publication.objects.filter(id__in=ids).select_related('author__profile'), _format_publication),
    'chapter': (_chapters_by_id, _format_chapter),
    'product': (lambda ids: Product.objects.filter(id__in=ids).select_related('seller__profile'),    _format_product),
    'album':   (lambda ids: Album.objects.filter(id__in=ids).select_related('artist__profile'),      _format_album),
    'playlist': (lambda ids: Playlist.objects.filter(id__in=ids).select_related('user__profile'),    _format_playlist),
    'bookreview': (lambda ids: BookReview.objects.filter(id__in=ids).select_related('user__profile', 'publication'),
                   _format_book_words('bookreview')),
    'chaptercomment': (lambda ids: ChapterComment.objects.filter(id__in=ids).select_related('user__profile', 'publication'),
                       _format_book_words('chaptercomment')),
    'singlesprofile': (lambda ids: SinglesProfile.objects.filter(id__in=ids).select_related('user__profile')
                       .prefetch_related('photos'), _format_singles_profile),
    'singlestopic': (lambda ids: SinglesTopic.objects.filter(id__in=ids).select_related('author__user__profile'),
                     _format_singles_text('singlestopic')),
    'singlesreply': (lambda ids: SinglesReply.objects.filter(id__in=ids).select_related('author__user__profile'),
                     _format_singles_text('singlesreply')),
}


def build_report_targets(reports):
    """Given the reports on a page, fetch every target with one query per content
    type and return a {(content_type, object_id): preview} map. Pass this to
    AdminReportSerializer via context['report_targets'] to avoid the per-row
    target query (the reports list's only N+1)."""
    ids_by_type = defaultdict(set)
    for r in reports:
        if r.content_type in _TARGET_FETCHERS:
            ids_by_type[r.content_type].add(r.object_id)
    out = {}
    for ctype, ids in ids_by_type.items():
        build_qs, fmt = _TARGET_FETCHERS[ctype]
        for obj in build_qs(ids):
            try:
                out[(ctype, obj.id)] = fmt(obj)
            except Exception:
                out[(ctype, obj.id)] = None
    return out


class RoleSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ['id', 'name', 'capabilities', 'user_count', 'created_at']

    def get_user_count(self, obj):
        return obj.users.count()

    def validate_capabilities(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('capabilities must be a list.')
        bad = [c for c in value if c not in ADMIN_CAPABILITY_KEYS]
        if bad:
            raise serializers.ValidationError(f'Unknown capabilities: {bad}')
        return value

    def validate_name(self, value):
        return (value or '').strip()


class AdminUserSerializer(serializers.ModelSerializer):
    """Full user row for the admin user-management screen."""
    profile_picture = serializers.SerializerMethodField()
    posts_count = serializers.SerializerMethodField()
    followers_count = serializers.SerializerMethodField()
    is_super_admin = serializers.ReadOnlyField()
    role = serializers.SerializerMethodField()
    capabilities = serializers.ReadOnlyField()
    # Whether the admin asking may warn / suspend / ban this account: not
    # themselves, never someone of their rank or above.
    can_act = serializers.SerializerMethodField()
    two_factor_enabled = serializers.SerializerMethodField()
    # What the profile says, for a moderator deciding whether to clear it.
    profile_text = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'admin_role', 'is_super_admin',
            'role', 'capabilities',
            'is_active', 'is_suspended', 'is_currently_suspended',
            'suspension_reason', 'suspended_at', 'suspended_until', 'strikes',
            'ban_reason', 'banned_at', 'banned_until',
            'is_email_verified', 'is_superuser',
            'posts_count', 'followers_count', 'profile_picture', 'date_joined',
            'can_act', 'two_factor_enabled', 'profile_text',
        ]

    def get_profile_text(self, obj):
        prof = getattr(obj, 'profile', None)
        if prof is None:
            return None
        return {'display_name': prof.display_name or '', 'bio': prof.bio or '',
                'website': prof.website or '', 'location': prof.location or ''}

    def get_can_act(self, obj):
        from ..admin_security import outranks
        request = self.context.get('request')
        actor = getattr(request, 'user', None)
        return bool(actor and actor.is_authenticated and actor.pk != obj.pk and outranks(actor, obj))

    def get_two_factor_enabled(self, obj):
        if not obj.is_platform_admin:
            return None
        tf = getattr(obj, 'admin_two_factor', None)
        return bool(tf and tf.confirmed_at)

    def get_role(self, obj):
        return {'id': obj.role_id, 'name': obj.role.name} if obj.role_id else None

    def get_profile_picture(self, obj):
        # Resolve the avatar directly off the prefetched profile — building a
        # nested SimpleUserSerializer per row was needless overhead on the list.
        try:
            prof = getattr(obj, 'profile', None)
            return media.resolve(prof.picture) if prof and prof.picture else None
        except Exception:
            return None

    def get_posts_count(self, obj):
        # Prefer the list annotation (anno_posts_count) to avoid a COUNT per row.
        v = getattr(obj, 'anno_posts_count', None)
        return v if v is not None else obj.social_posts.count()

    def get_followers_count(self, obj):
        v = getattr(obj, 'anno_followers_count', None)
        return v if v is not None else obj.followers.count()


class AdminReportSerializer(serializers.ModelSerializer):
    """A report plus a lightweight preview of the content it targets, so the
    moderator can see what they're acting on without extra round-trips."""
    reporter = SimpleUserSerializer(read_only=True)
    assigned_to = SimpleUserSerializer(read_only=True)
    resolved_by = SimpleUserSerializer(read_only=True)
    target = serializers.SerializerMethodField()
    duplicate_count = serializers.SerializerMethodField()
    # Whether the reported thing can be taken down from the report: the
    # server's own list, so the app never falls out of step with it.
    can_remove = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            'id', 'reporter', 'content_type', 'object_id', 'reason',
            'description', 'status', 'created_at', 'target',
            'assigned_to', 'moderator_notes', 'resolved_by', 'resolved_at',
            'duplicate_count', 'can_remove',
        ]

    def get_can_remove(self, obj):
        from ..views.admin import _CONTENT_MODELS
        target = self.get_target(obj)
        return obj.content_type in _CONTENT_MODELS and bool(target) and not target.get('is_removed')

    def get_duplicate_count(self, obj):
        # How many reports (incl. this one) target the same content — surfaces
        # "5 people reported this" in the queue. Prefer an annotation if present.
        val = getattr(obj, 'dup_count', None)
        if val is not None:
            return val
        return Report.objects.filter(
            content_type=obj.content_type, object_id=obj.object_id
        ).count()

    def get_target(self, obj):
        ct, oid = obj.content_type, obj.object_id
        # Prefer the batched map (one query per type for the whole page); it maps
        # every (type, id) on the page, so a miss here means the target is gone.
        prefetched = self.context.get('report_targets')
        if prefetched is not None:
            return prefetched.get((ct, oid))
        # Fallback for un-prefetched callers: fetch + format this one target.
        fetcher = _TARGET_FETCHERS.get(ct)
        if not fetcher:
            return None
        build_qs, fmt = fetcher
        try:
            obj_ = build_qs([oid]).first()
            return fmt(obj_) if obj_ else None
        except Exception:
            return None


class AdminActionLogSerializer(serializers.ModelSerializer):
    actor = SimpleUserSerializer(read_only=True)

    class Meta:
        model = AdminActionLog
        fields = ['id', 'actor', 'actor_name', 'action', 'target_type', 'target_id', 'reason',
                  'ip', 'user_agent', 'entry_hash', 'created_at']


class AppealSerializer(serializers.ModelSerializer):
    """User-facing view of one's own appeal."""
    class Meta:
        model = Appeal
        fields = ['id', 'message', 'status', 'review_notes', 'reviewed_at', 'created_at']
        read_only_fields = ['id', 'status', 'review_notes', 'reviewed_at', 'created_at']


class AdminAppealSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    reviewed_by = SimpleUserSerializer(read_only=True)
    # A song dispute: which song, and why it was taken down.
    track = serializers.SerializerMethodField()

    class Meta:
        model = Appeal
        fields = ['id', 'kind', 'user', 'track', 'message', 'status', 'reviewed_by', 'reviewed_at',
                  'review_notes', 'created_at']

    def get_track(self, obj):
        t = obj.track
        if t is None:
            return None
        return {'id': t.id, 'title': t.title, 'removed_reason': t.removed_reason,
                'removal_note': t.removal_note, 'rights_holder': t.rights_holder,
                'composer': t.composer, 'isrc': t.isrc, 'license': t.license}


# ── Content-management list serializers ──────────────────────────────────────
class AdminContentPostSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = SocialPost
        fields = ['id', 'caption', 'content_type', 'is_removed',
                  'likes_count', 'comments_count', 'created_at', 'author']


class AdminContentTrackSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='artist', read_only=True)

    class Meta:
        model = Track
        fields = ['id', 'title', 'is_removed', 'views', 'created_at', 'author']


class AdminContentCommentSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'content', 'post', 'is_removed', 'created_at', 'author']


class AdminContentTrackCommentSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = Comment
        fields = ['id', 'content', 'track', 'is_removed', 'created_at', 'author']


class AdminContentGroupSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='creator', read_only=True)

    class Meta:
        model = Group
        fields = ['id', 'name', 'description', 'is_private', 'is_removed', 'created_at', 'author']


class AdminContentStorySerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = Story
        fields = ['id', 'caption', 'content_type', 'is_removed', 'created_at', 'author']


# ── Content-management serializers for the extended moderation set ────────────
# (publications, marketplace, community chat, directory listings). Each exposes
# author + a preview field + is_removed, matching the shape the admin panel
# renders (caption|content|title|name).
from ..models import Publication  # not in the common star import
from ..models import BookClub, LiveBroadcast, Organization


class AdminContentPublicationSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(read_only=True)

    class Meta:
        model = Publication
        fields = ['id', 'title', 'summary', 'status', 'is_removed', 'created_at', 'author']


class AdminContentProductSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='seller', read_only=True)

    class Meta:
        model = Product
        fields = ['id', 'title', 'price', 'currency', 'is_removed', 'created_at', 'author']


class AdminContentProductReviewSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='reviewer', read_only=True)
    content = serializers.CharField(source='comment', read_only=True)

    class Meta:
        model = ProductReview
        fields = ['id', 'content', 'rating', 'product', 'is_removed', 'created_at', 'author']


class AdminContentGroupPostSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = GroupPost
        fields = ['id', 'content', 'message_type', 'group', 'is_removed', 'created_at', 'author']


class AdminContentVideostudioSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='created_by', read_only=True)

    class Meta:
        model = Videostudio
        fields = ['id', 'name', 'location', 'is_removed', 'created_at', 'author']


class AdminContentMediaStationSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='created_by', read_only=True)

    class Meta:
        model = MediaStation
        fields = ['id', 'name', 'type', 'is_removed', 'created_at', 'author']


class AdminContentOrganizationSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='created_by', read_only=True)

    class Meta:
        model = Organization
        fields = ['id', 'name', 'slug', 'kind', 'location', 'is_verified', 'is_removed', 'created_at', 'author']


class AdminContentBookClubSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='created_by', read_only=True)
    name = serializers.CharField(source='group.name', read_only=True)
    book = serializers.CharField(source='publication.title', read_only=True)

    class Meta:
        model = BookClub
        fields = ['id', 'name', 'book', 'starts_on', 'is_removed', 'created_at', 'author']


class AdminContentAlbumSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='artist', read_only=True)

    class Meta:
        model = Album
        fields = ['id', 'title', 'description', 'cover_image', 'is_removed', 'created_at', 'author']


class AdminContentPlaylistSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='user', read_only=True)

    class Meta:
        model = Playlist
        fields = ['id', 'name', 'description', 'cover_image', 'visibility', 'is_removed', 'created_at', 'author']


class AdminContentLiveBroadcastSerializer(serializers.ModelSerializer):
    author = SimpleUserSerializer(source='host', read_only=True)
    created_at = serializers.DateTimeField(source='started_at', read_only=True)

    class Meta:
        model = LiveBroadcast
        fields = ['id', 'title', 'kind', 'status', 'singles_only', 'is_removed', 'created_at', 'author']
