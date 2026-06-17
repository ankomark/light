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
    related_comment_id = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id', 'sender', 'message', 'read',
            'notification_type', 'post', 'track',
            'created_at', 'related_comment', 'related_comment_id'
        ]

    def _triggering_comment(self, obj):
        # Resolve the comment that triggered this notification once, then cache it
        # on the instance so the two method fields below don't double-query.
        if hasattr(obj, '_trig_comment'):
            return obj._trig_comment
        comment = None
        if obj.notification_type == 'comment' and obj.post_id:
            from ..models import PostComment  # Import here to avoid circular imports
            # Comments order by -created_at, so .first() is the most recent comment
            # by this sender on the post — i.e. the one that raised the alert.
            comment = PostComment.objects.filter(
                post=obj.post,
                user=obj.sender,
            ).first()
        obj._trig_comment = comment
        return comment

    def get_related_comment(self, obj):
        comment = self._triggering_comment(obj)
        return comment.content if comment else None

    def get_related_comment_id(self, obj):
        comment = self._triggering_comment(obj)
        return comment.id if comment else None



class MessageSerializer(serializers.ModelSerializer):
    sender = SimpleUserSerializer(read_only=True)

    class Meta:
        model = Message
        fields = [
            'id', 'sender', 'content', 'message_type', 'attachment',
            'file_name', 'duration', 'read', 'created_at',
        ]
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
        if not last:
            return None
        # Lightweight preview — never include the base64 attachment here.
        return {
            'id': last.id,
            'content': last.content,
            'message_type': last.message_type,
            'file_name': last.file_name,
            'sender_id': last.sender_id,
            'created_at': last.created_at,
        }

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0
        return obj.messages.filter(read=False).exclude(sender=request.user).count()

