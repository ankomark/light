from .common import *  # noqa: F401,F403


class NotificationPostSerializer(serializers.ModelSerializer):
    """Lightweight post reference for notifications.

    Intentionally avoids the full SocialPostSerializer, whose nested
    ``song -> artist -> social_posts -> song ...`` chain recurses infinitely.
    """
    class Meta:
        model = SocialPost
        fields = ['id', 'content_type', 'caption', 'created_at']


class NotificationTrackSerializer(serializers.ModelSerializer):
    """Lightweight track reference for notifications (no nested artist)."""
    class Meta:
        model = Track
        fields = ['id', 'title', 'slug']


class NotificationSerializer(serializers.ModelSerializer):
    sender = DetailedUserSerializer(read_only=True)
    post = NotificationPostSerializer(read_only=True, required=False)
    track = NotificationTrackSerializer(read_only=True, required=False)
    related_comment = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id', 'sender', 'message', 'read', 
            'notification_type', 'post', 'track', 
            'created_at', 'related_comment'
        ]
    
    def get_related_comment(self, obj):
        if obj.notification_type == 'comment':
            from ..models import PostComment  # Import here to avoid circular imports
            comment = PostComment.objects.filter(
                post=obj.post,
                user=obj.sender
            ).first()
            return comment.content if comment else None
        return None



class MessageSerializer(serializers.ModelSerializer):
    sender = SimpleUserSerializer(read_only=True)

    class Meta:
        model = Message
        fields = ['id', 'sender', 'content', 'read', 'created_at']
        read_only_fields = ['id', 'sender', 'read', 'created_at']



class ConversationSerializer(serializers.ModelSerializer):
    other_participant = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ['id', 'other_participant', 'last_message', 'unread_count', 'updated_at']

    def get_other_participant(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        other = obj.participants.exclude(id=request.user.id).first()
        return SimpleUserSerializer(other, context=self.context).data if other else None

    def get_last_message(self, obj):
        last = obj.messages.last()
        return MessageSerializer(last).data if last else None

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0
        return obj.messages.filter(read=False).exclude(sender=request.user).count()

