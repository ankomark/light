from .common import *  # noqa: F401,F403


class GroupSerializer(serializers.ModelSerializer):
    creator = SimpleUserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    has_pending_request = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    cover_image = MediaReferenceImageField(required=False, allow_null=True)
    is_private = serializers.BooleanField(default=False)
    # Override the model field: the invite token is only ever revealed to admins.
    invite_code = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['creator', 'slug', 'created_at', 'updated_at']

    @staticmethod
    def _upload_cover(validated_data):
        """An uploaded cover file becomes an R2 URL before it reaches the model
        (the column stores string references, not files)."""
        cover = validated_data.get('cover_image')
        if cover is not None and hasattr(cover, 'read'):
            validated_data['cover_image'] = r2.upload_file(cover, 'group_covers')
        return validated_data

    def create(self, validated_data):
        return super().create(self._upload_cover(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._upload_cover(validated_data))

    def get_invite_code(self, obj):
        # Prefer the list annotation to avoid a per-row membership query; fall
        # back to a live lookup for un-annotated detail responses.
        is_admin = getattr(obj, 'anno_is_admin', None)
        if is_admin is None:
            m = self._membership(obj)
            is_admin = bool(m and m.is_admin)
        if is_admin and obj.invite_code:
            return str(obj.invite_code)
        return None

    def _membership(self, obj):
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return None
        return GroupMember.objects.filter(group=obj, user=request.user).first()

    # The list view annotates these (anno_*) as subqueries so the list is a
    # handful of queries instead of ~6 per row; detail responses aren't
    # annotated, so each getter falls back to a live lookup.
    def get_member_count(self, obj):
        v = getattr(obj, 'anno_member_count', None)
        return v if v is not None else obj.members.count()

    def _is_super(self):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and request.user.is_super_admin)

    def get_is_member(self, obj):
        # Super admins hold a master key — treated as a member of every group so
        # the app unlocks the chat for them (drives the frontend, no app update).
        if self._is_super():
            return True
        v = getattr(obj, 'anno_is_member', None)
        return v if v is not None else (self._membership(obj) is not None)

    def get_is_admin(self, obj):
        if self._is_super():
            return True
        v = getattr(obj, 'anno_is_admin', None)
        if v is not None:
            return v
        m = self._membership(obj)
        return bool(m and m.is_admin)

    def get_has_pending_request(self, obj):
        v = getattr(obj, 'anno_has_pending', None)
        if v is not None:
            return v
        request = self.context.get('request')
        if not (request and request.user.is_authenticated):
            return False
        return GroupJoinRequest.objects.filter(
            group=obj, user=request.user, status='pending'
        ).exists()

    def get_unread_count(self, obj):
        # Only members carry an unread count (mirrors the live path's gate); the
        # annotation is 0 for a super admin who isn't actually a member.
        if hasattr(obj, 'anno_unread'):
            return obj.anno_unread if getattr(obj, 'anno_is_member', False) else 0
        member = self._membership(obj)
        if not member:
            return 0
        request = self.context.get('request')
        hidden = self.context.get('hide_super_ids') or ()
        qs = (obj.posts.exclude(user=request.user).exclude(message_type='system')
              .exclude(user_id__in=hidden))
        if member.last_read_at:
            qs = qs.filter(created_at__gt=member.last_read_at)
        return qs.count()

    def get_last_message(self, obj):
        if hasattr(obj, 'anno_last_id'):
            if obj.anno_last_id is None:
                return None
            return {
                'id': obj.anno_last_id,
                'content': obj.anno_last_content,
                'message_type': obj.anno_last_type,
                'file_name': obj.anno_last_file,
                'sender_username': obj.anno_last_sender,
                'created_at': obj.anno_last_at,
            }
        hidden = self.context.get('hide_super_ids') or ()
        last = obj.posts.exclude(user_id__in=hidden).order_by('-created_at').first()
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
                'picture': media.resolve(obj.user.profile.picture) if obj.user.profile and obj.user.profile.picture else None
            }
        }



class GroupJoinRequestSerializer(serializers.ModelSerializer):
    # Use the lightweight user serializer: the full UserSerializer embeds the
    # requester's entire social-post feed, which made this list slow and huge.
    user = SimpleUserSerializer(read_only=True)
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
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = GroupPost
        fields = [
            'id', 'content', 'message_type', 'attachment', 'file_name', 'duration',
            'reply_to', 'reply_to_id', 'created_at', 'updated_at', 'group', 'user',
            'attachments', 'is_owner', 'reactions',
        ]
        read_only_fields = ['group', 'user', 'created_at', 'updated_at', 'attachments', 'reply_to']
        extra_kwargs = {'content': {'required': False, 'allow_blank': True}}

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.user_id == request.user.id)

    def get_reactions(self, obj):
        """Aggregate emoji → count, plus the caller's own pick. Relies on the
        view prefetching `reactions` to avoid N+1 queries."""
        request = self.context.get('request')
        uid = request.user.id if request and request.user.is_authenticated else None
        # Super admins react invisibly: skip their reactions for regular clients.
        hidden = self.context.get('hide_super_ids') or ()
        counts, mine = {}, None
        for r in obj.reactions.all():
            if r.user_id in hidden:
                continue
            counts[r.emoji] = counts.get(r.emoji, 0) + 1
            if uid and r.user_id == uid:
                mine = r.emoji
        summary = [{'emoji': e, 'count': c}
                   for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        return {'summary': summary, 'mine': mine}


# Add to existing serializers.py

