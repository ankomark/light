from .common import *  # noqa: F401,F403


class GroupSerializer(serializers.ModelSerializer):
    creator = UserSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    cover_image = serializers.ImageField(required=False, allow_null=True) 
    is_private = serializers.BooleanField(default=False)  # Ensure default is False

    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['creator', 'slug', 'created_at', 'updated_at']
    
    def get_member_count(self, obj):
        return obj.members.count()
    
    def get_is_member(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(group=obj, user=request.user).exists()
        return False
    
    def get_is_admin(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return GroupMember.objects.filter(
                group=obj, 
                user=request.user, 
                is_admin=True
            ).exists()
        return False



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



class GroupPostSerializer(serializers.ModelSerializer):
    # user = serializers.StringRelatedField(read_only=True)
    user = UserSerializer(read_only=True)
    attachments = GroupPostAttachmentSerializer(many=True, read_only=True, required=False)
    
    class Meta:
        model = GroupPost
        fields = ['id', 'content', 'created_at', 'updated_at', 'group', 'user', 'attachments']
        read_only_fields = ['group', 'user', 'created_at', 'updated_at', 'attachments']
        extra_kwargs = {
            'content': {'required': False, 'allow_blank': True}
        }


# Add to existing serializers.py

