from .common import *  # noqa: F401,F403  (serializers, SimpleUserSerializer)
from ..models import LiveBroadcast, CoHostRequest, FollowRequest


class LiveBroadcastSerializer(serializers.ModelSerializer):
    host = SimpleUserSerializer(read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True)
    # Whether the requesting viewer already follows the host — drives the
    # Follow / Following button in the live room. False for the host themselves
    # and when there's no authenticated request in context.
    is_following = serializers.SerializerMethodField()
    # 'following' | 'requested' | 'none' — lets the button show a pending request
    # (private host) rather than snapping back to Follow.
    follow_status = serializers.SerializerMethodField()

    class Meta:
        model = LiveBroadcast
        fields = [
            'id', 'host', 'kind', 'title', 'status', 'viewer_count',
            'peak_viewer_count', 'duration_seconds', 'started_at', 'ended_at',
            'like_count', 'is_following', 'follow_status',
        ]
        read_only_fields = fields

    def get_is_following(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated or request.user.id == obj.host_id:
            return False
        return obj.host.followers.filter(id=request.user.id).exists()

    def get_follow_status(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated or request.user.id == obj.host_id:
            return 'none'
        if obj.host.followers.filter(id=request.user.id).exists():
            return 'following'
        if FollowRequest.objects.filter(requester=request.user, target=obj.host, status='pending').exists():
            return 'requested'
        return 'none'


class LiveBroadcastListSerializer(LiveBroadcastSerializer):
    """Hub/discovery rows. Drops the per-viewer follow fields (is_following /
    follow_status) — the hub doesn't render a follow button, so computing them
    per row would be a needless query per broadcast."""
    class Meta(LiveBroadcastSerializer.Meta):
        fields = [
            f for f in LiveBroadcastSerializer.Meta.fields
            if f not in ('is_following', 'follow_status')
        ]
        read_only_fields = fields


class CoHostRequestSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = CoHostRequest
        fields = ['id', 'broadcast', 'user', 'status', 'created_at']
        read_only_fields = ['id', 'broadcast', 'user', 'status', 'created_at']
