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
    group_slug = serializers.CharField(source='group.slug', read_only=True, default=None)
    group_name = serializers.CharField(source='group.name', read_only=True, default=None)

    class Meta:
        model = Notification
        fields = [
            'id', 'sender', 'message', 'read',
            'notification_type', 'post', 'track',
            'group_slug', 'group_name',
            'created_at', 'related_comment', 'related_comment_id'
        ]

    def _triggering_comment(self, obj):
        # Resolve the comment that triggered this notification once, then cache it
        # on the instance so the two method fields below don't double-query.
        if hasattr(obj, '_trig_comment'):
            return obj._trig_comment
        comment = None
        if obj.comment_id:
            # Stored on the notification since comment threads: exact.
            comment = obj.comment
        elif obj.track_comment_id:
            comment = obj.track_comment
        elif obj.notification_type == 'comment' and obj.post_id:
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
    reply_to = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id', 'sender', 'content', 'message_type', 'attachment',
            'file_name', 'duration', 'read', 'created_at',
            'client_id', 'reply_to', 'reactions', 'edited_at', 'is_deleted',
        ]
        read_only_fields = ['id', 'sender', 'read', 'created_at']

    def get_reply_to(self, obj):
        from ..messaging import preview_of
        return preview_of(obj.reply_to) if obj.reply_to_id else None

    def get_reactions(self, obj):
        """[{emoji, count, mine}] — from the prefetched reactions."""
        request = self.context.get('request')
        me = request.user.id if request and request.user.is_authenticated else None
        counts, mine = {}, None
        for r in obj.reactions.all():
            counts[r.emoji] = counts.get(r.emoji, 0) + 1
            if r.user_id == me:
                mine = r.emoji
        return [{'emoji': e, 'count': n, 'mine': e == mine} for e, n in counts.items()]

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # Deleted for everyone (or taken down): the bubble stays, the words go.
        if obj.is_deleted or obj.is_removed:
            data.update(content='', attachment='', file_name='', is_deleted=True, reactions=[])
        return data



class ConversationSerializer(serializers.ModelSerializer):
    other_participant = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ['id', 'other_participant', 'last_message', 'unread_count', 'updated_at']

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # This person's side of it, and whether the other is here.
        from ..messaging import is_online
        data['is_request'] = getattr(obj, 'st_accepted', True) is False
        data['muted'] = bool(getattr(obj, 'st_muted', False))
        data['archived'] = bool(getattr(obj, 'st_archived', False))
        other = data.get('other_participant') or {}
        if other.get('id'):
            data['online'] = is_online(other['id'])
        last = data.get('last_message')
        if last and getattr(obj, 'last_msg_deleted', False):
            last.update(content='', is_deleted=True)
        return data

    def get_other_participant(self, obj):
        request = self.context.get('request')
        if not request:
            return None
        # Use the prefetched participants (no extra query); fall back to a query
        # for non-annotated instances (e.g. the create() path).
        me = request.user.id
        participants = obj.participants.all()
        other = next((p for p in participants if p.id != me), None)
        return SimpleUserSerializer(other, context=self.context).data if other else None

    def get_last_message(self, obj):
        # Prefer the list-query subquery annotations (no N+1).
        if hasattr(obj, 'last_msg_id'):
            if obj.last_msg_id is None:
                return None
            return {
                'id': obj.last_msg_id,
                'content': obj.last_msg_content,
                'message_type': obj.last_msg_type,
                'file_name': obj.last_msg_file,
                'sender_id': obj.last_msg_sender,
                'created_at': obj.last_msg_at,
            }
        last = obj.messages.last()
        if not last:
            return None
        return {
            'id': last.id, 'content': last.content, 'message_type': last.message_type,
            'file_name': last.file_name, 'sender_id': last.sender_id, 'created_at': last.created_at,
        }

    def get_unread_count(self, obj):
        if hasattr(obj, 'unread_n'):
            return obj.unread_n or 0
        request = self.context.get('request')
        if not request:
            return 0
        return obj.messages.filter(read=False).exclude(sender=request.user).count()

