from .common import *  # noqa: F401,F403  (serializers, models, SimpleUserSerializer, timezone)
from ..models import AdminActionLog


class AdminUserSerializer(serializers.ModelSerializer):
    """Full user row for the admin user-management screen."""
    profile_picture = serializers.SerializerMethodField()
    posts_count = serializers.SerializerMethodField()
    followers_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'admin_role',
            'is_active', 'is_suspended', 'is_currently_suspended',
            'suspension_reason', 'suspended_at', 'suspended_until', 'strikes',
            'is_email_verified', 'is_superuser',
            'posts_count', 'followers_count', 'profile_picture', 'date_joined',
        ]

    def get_profile_picture(self, obj):
        try:
            return SimpleUserSerializer(obj).data.get('profile_picture')
        except Exception:
            return None

    def get_posts_count(self, obj):
        return obj.social_posts.count()

    def get_followers_count(self, obj):
        return obj.followers.count()


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
