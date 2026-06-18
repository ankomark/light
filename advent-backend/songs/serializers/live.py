from .common import *  # noqa: F401,F403  (serializers, SimpleUserSerializer)
from ..models import LiveBroadcast, CoHostRequest


class LiveBroadcastSerializer(serializers.ModelSerializer):
    host = SimpleUserSerializer(read_only=True)

    class Meta:
        model = LiveBroadcast
        fields = ['id', 'host', 'kind', 'title', 'status', 'viewer_count', 'started_at', 'ended_at']
        read_only_fields = ['id', 'host', 'status', 'viewer_count', 'started_at', 'ended_at']


class CoHostRequestSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = CoHostRequest
        fields = ['id', 'broadcast', 'user', 'status', 'created_at']
        read_only_fields = ['id', 'broadcast', 'user', 'status', 'created_at']
