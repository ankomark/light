from .common import *  # noqa: F401,F403  (serializers, models, SimpleUserSerializer, timezone)
from ..models import AdminActionLog, Appeal, Role, ADMIN_CAPABILITY_KEYS


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
        try:
            if ct == 'post':
                p = SocialPost.objects.filter(id=oid).select_related('user').first()
                if not p:
                    return None
                return {
                    'type': 'post', 'id': p.id, 'caption': (p.caption or '')[:140],
                    'content_type': p.content_type,
                    'author': SimpleUserSerializer(p.user).data,
                    'is_removed': p.is_removed,
                }
            if ct == 'comment':
                c = PostComment.objects.filter(id=oid).select_related('user').first()
                if not c:
                    return None
                return {
                    'type': 'comment', 'id': c.id, 'content': (c.content or '')[:200],
                    'post_id': c.post_id,
                    'author': SimpleUserSerializer(c.user).data,
                    'is_removed': c.is_removed,
                }
            if ct == 'track':
                t = Track.objects.filter(id=oid).select_related('artist').first()
                if not t:
                    return None
                return {
                    'type': 'track', 'id': t.id, 'title': t.title,
                    'author': SimpleUserSerializer(t.artist).data,
                    'is_removed': t.is_removed,
                }
            if ct == 'user':
                u = User.objects.filter(id=oid).first()
                if not u:
                    return None
                return {
                    'type': 'user', 'id': u.id, 'username': u.username,
                    'author': SimpleUserSerializer(u).data,
                    'is_suspended': u.is_suspended, 'is_active': u.is_active,
                }
            if ct == 'group':
                g = Group.objects.filter(id=oid).first()
                if not g:
                    return None
                return {'type': 'group', 'id': g.id, 'name': getattr(g, 'name', '')}
        except Exception:
            return None
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
