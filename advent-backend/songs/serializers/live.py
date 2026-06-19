from .common import *  # noqa: F401,F403  (serializers, SimpleUserSerializer)
from ..models import LiveBroadcast, CoHostRequest


class LiveBroadcastSerializer(serializers.ModelSerializer):
    host = SimpleUserSerializer(read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = LiveBroadcast
        fields = [
            'id', 'host', 'kind', 'title', 'status', 'viewer_count',
            'peak_viewer_count', 'duration_seconds', 'started_at', 'ended_at',
        ]
        read_only_fields = fields


class CoHostRequestSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = CoHostRequest
        fields = ['id', 'broadcast', 'user', 'status', 'created_at']
        read_only_fields = ['id', 'broadcast', 'user', 'status', 'created_at']
