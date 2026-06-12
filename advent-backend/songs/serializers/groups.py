from .common import *  # noqa: F401,F403


class GroupSerializer(serializers.ModelSerializer):
    creator = SimpleUserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    has_pending_request = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    cover_image = serializers.ImageField(required=False, allow_null=True)
    is_private = serializers.BooleanField(default=False)

    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['creator', 'slug', 'created_at', 'updated_at']

    def _membership(self, obj):
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return None
        return GroupMember.objects.filter(group=obj, user=request.user).first()

    def get_member_count(self, obj):
        return obj.members.count()

    def get_is_member(self, obj):
        return self._membership(obj) is not None

    def get_is_admin(self, obj):
        m = self._membership(obj)
        return bool(m and m.is_admin)

    def get_has_pending_request(self, obj):
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return False
        return GroupJoinRequest.objects.filter(
            group=obj, user=request.user, status='pending'
        ).exists()

    def get_unread_count(self, obj):
        member = self._membership(obj)
        if not member:
            return 0
        request = self.context.get('request')
        qs = obj.posts.exclude(user=request.user).exclude(message_type='system')
        if member.last_read_at:
            qs = qs.filter(created_at__gt=member.last_read_at)
        return qs.count()

    def get_last_message(self, obj):
        last = obj.posts.order_by('-created_at').first()
        if not last:
            return None
        return {
            'id': last.id,
            'content': last.content,
            'message_type': last.message_type,
            'file_name': last.file_name,
            'sender_username': last.user.username if last.user_id else None,
            'created_at': last.created_at,
        }



class GroupMemberSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    
    class Meta:
        model = GroupMember
        fields = ['id', 'user', 'is_admin', 'joined_at']
    
    def get_user(self, obj):
        return {
            'id': obj.user.id,
            'username': obj.user.username,
            'profile': {
                'picture': obj.user.profile.picture.url if obj.user.profile and obj.user.profile.picture else None
            }
        }



class GroupJoinRequestSerializer(serializers.ModelSerializer):
    # user = serializers.StringRelatedField(read_only=True)
    user = UserSerializer(read_only=True)
    group = serializers.StringRelatedField(read_only=True)
    
    class Meta:
        model = GroupJoinRequest
        fields = '__all__'
        read_only_fields = ['status', 'created_at']
        extra_kwargs = {
            'message': {'required': False, 'allow_blank': True}
        }



class GroupPostAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupPostAttachment  # Make sure this model is imported
        fields = ['id', 'file', 'file_type', 'created_at']
        read_only_fields = ['file_type', 'created_at']



class ReplyPreviewSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = GroupPost
        fields = ['id', 'content', 'message_type', 'file_name', 'sender_username']


class GroupPostSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)
    attachments = GroupPostAttachmentSerializer(many=True, read_only=True, required=False)
    reply_to = ReplyPreviewSerializer(read_only=True)
    reply_to_id = serializers.PrimaryKeyRelatedField(
        queryset=GroupPost.objects.all(), source='reply_to',
        write_only=True, required=False, allow_null=True,
    )
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = GroupPost
        fields = [
            'id', 'content', 'message_type', 'attachment', 'file_name', 'duration',
            'reply_to', 'reply_to_id', 'created_at', 'updated_at', 'group', 'user',
            'attachments', 'is_owner',
        ]
        read_only_fields = ['group', 'user', 'created_at', 'updated_at', 'attachments', 'reply_to']
        extra_kwargs = {'content': {'required': False, 'allow_blank': True}}

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.user_id == request.user.id)


# Add to existing serializers.py

