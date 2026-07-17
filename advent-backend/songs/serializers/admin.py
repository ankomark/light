from collections import defaultdict

from .common import *  # noqa: F401,F403  (serializers, models, SimpleUserSerializer, timezone)
from ..models import AdminActionLog, Appeal, Role, ADMIN_CAPABILITY_KEYS


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


# content_type -> (queryset builder, formatter). select_related pulls the
# author (+ its profile for the avatar) so a page of targets is a query per
# TYPE, not per report.
_TARGET_FETCHERS = {
    'post':    (lambda ids: SocialPost.objects.filter(id__in=ids).select_related('user__profile'),   _format_post),
    'comment': (lambda ids: PostComment.objects.filter(id__in=ids).select_related('user__profile'),  _format_comment),
    'track':   (lambda ids: Track.objects.filter(id__in=ids).select_related('artist__profile'),      _format_track),
    'user':    (lambda ids: User.objects.filter(id__in=ids).select_related('profile'),               _format_user),
    'group':   (lambda ids: Group.objects.filter(id__in=ids),                                        _format_group),
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

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'admin_role', 'is_super_admin',
            'role', 'capabilities',
            'is_active', 'is_suspended', 'is_currently_suspended',
            'suspension_reason', 'suspended_at', 'suspended_until', 'strikes',
            'is_email_verified', 'is_superuser',
            'posts_count', 'followers_count', 'profile_picture', 'date_joined',
        ]

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

    class Meta:
        model = Report
        fields = [
            'id', 'reporter', 'content_type', 'object_id', 'reason',
            'description', 'status', 'created_at', 'target',
            'assigned_to', 'moderator_notes', 'resolved_by', 'resolved_at',
            'duplicate_count',
        ]

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
        fields = ['id', 'actor', 'action', 'target_type', 'target_id', 'reason', 'created_at']


class AppealSerializer(serializers.ModelSerializer):
    """User-facing view of one's own appeal."""
    class Meta:
        model = Appeal
        fields = ['id', 'message', 'status', 'review_notes', 'reviewed_at', 'created_at']
        read_only_fields = ['id', 'status', 'review_notes', 'reviewed_at', 'created_at']


class AdminAppealSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    reviewed_by = SimpleUserSerializer(read_only=True)

    class Meta:
        model = Appeal
        fields = ['id', 'user', 'message', 'status', 'reviewed_by', 'reviewed_at',
                  'review_notes', 'created_at']


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
