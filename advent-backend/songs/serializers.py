from rest_framework import serializers
from .models import User
from .models import User,Track,Playlist,Profile,Comment,Like,Category,SocialPost,PostLike,PostComment,PostSave,Notification,Church,Choir,Group,Videostudio,Choir, GroupMember, GroupJoinRequest, GroupPost,GroupPostAttachment


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    followers_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()
    class Meta:
        model = User
        fields = ('id', 'username', 'email',  'password','profile','followers_count', 'following_count', 'is_following')
    
    def get_followers_count(self, obj):
        return obj.followers.count()

    def get_following_count(self, obj):
        return obj.followed_by.count()

    def get_is_following(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.followers.filter(id=request.user.id).exists()
        return False
    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            # is_artist=validated_data.get('is_artist', False)
        )
        return user
class TrackSerializer(serializers.ModelSerializer):
     likes_count = serializers.SerializerMethodField()
     is_liked = serializers.SerializerMethodField()
    #  favorite = serializers.SerializerMethodField()
     artist = UserSerializer(read_only=True)  # Include full artist detai
     is_owner = serializers.SerializerMethodField() 
     audio_file = serializers.FileField(required=False, allow_null=True)
     cover_image = serializers.ImageField(required=False, allow_null=True)
     class Meta:
        model = Track
        fields = [
            'id', 'title', 'artist', 'album', 'audio_file','is_owner',
            'cover_image', 'lyrics', 'slug', 
            'views', 'downloads','likes_count','is_liked', 'created_at', 'updated_at'
        ]
        read_only_fields = ['artist', 'slug', 'views', 'downloads', 'created_at', 'updated_at']
     def get_favorite(self, obj):
        user = self.context['request'].user
        return Like.objects.filter(user=user, track=obj).exists()
     def get_likes_count(self, obj):
      return obj.likes.count()
     def get_is_liked(self, obj):
        user = self.context['request'].user
        if user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False
    #  def get_serializer_context(self):
    #     context = super().get_serializer_context()
    #     context['request'] = self.request
    #     # Add owner flag for direct API use
    #     if self.action == 'retrieve':
    #         context['is_owner'] = self.get_object().artist == self.request.user
    #     return context
     def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.artist == request.user
     def get_is_favorite(self, obj):
        user = self.context['request'].user
        return user.is_authenticated and obj.favorites.filter(id=user.id).exists()

    #  def update(self, instance, validated_data):
    #     # Handle partial updates
    #     instance.title = validated_data.get('title', instance.title)
    #     instance.album = validated_data.get('album', instance.album)
    #     instance.lyrics = validated_data.get('lyrics', instance.lyrics)
    #     instance.save()
    #     return instance 
        

class PlaylistSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    class Meta:
        model = Playlist
        fields = ('id', 'name', 'user', 'tracks', 'created_at', 'updated_at')


class ProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.ReadOnlyField(source='user.id')
    class Meta:
        model = Profile
        fields = ['bio','user_id', 'birth_date', 'location', 'is_public', 'picture',]

    def create(self, validated_data):
        user = self.context['request'].user  # Access user from request
        # Remove 'user' from validated_data if it exists
        profile = Profile.objects.create(user=user, **validated_data)
        return profile
    def get_picture(self, obj):
        if obj.picture:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.picture.url) if request else obj.picture.url
        return None

class CommentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    track = TrackSerializer(read_only=True)
    class Meta:
        model = Comment
        fields = ('id', 'content', 'user', 'track', 'created_at', 'updated_at')


class LikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    track = TrackSerializer(read_only=True)
    class Meta:
        model = Like
        fields = ('id', 'user', 'track', 'created_at')


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ('id', 'name', 'created_at', 'updated_at')






# Add these new serializers after your existing ones

class SocialPostSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    song = TrackSerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    media_url = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = SocialPost
        fields = [
            'id', 'user', 'content_type', 'media_file', 'media_url', 'song',
            'caption', 'tags', 'location', 'duration', 'created_at', 'updated_at',
            'likes_count', 'comments_count', 'is_liked', 'is_saved','can_edit'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at','content_type', 'media_file']
    
    def get_can_edit(self, obj):
        request = self.context.get('request')
        return request and request.user == obj.user

    def get_media_url(self, obj):
        request = self.context.get('request')
        if obj.media_file and request:
            return request.build_absolute_uri(obj.media_file.url)
        return None

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_comments_count(self, obj):
        return obj.comments.count()

    def get_is_liked(self, obj):
        user = self.context.get('request').user
        if user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False

    def get_is_saved(self, obj):
        user = self.context.get('request').user
        if user.is_authenticated:
            return obj.saves.filter(user=user).exists()
        return False

    def validate(self, data):
        if data.get('content_type') == 'video' and 'media_file' in data:
            # Add video validation logic here
            pass
        return data


class PostLikeSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostLike
        fields = ['id', 'user', 'post', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']


class PostCommentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'user', 'post', 'content', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']


class PostSaveSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True)

    class Meta:
        model = PostSave
        fields = ['id', 'user', 'post', 'created_at']
        read_only_fields = ['user', 'post', 'created_at']


# Update UserSerializer to include social posts
class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    social_posts = serializers.SerializerMethodField()
    profile = ProfileSerializer(read_only=True)
    followers_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'username', 'email', 'password', 
            'social_posts', 'profile','followers_count',
            'following_count', 'is_following'
        )

    def get_followers_count(self, obj):
        return obj.followers.count()

    def get_following_count(self, obj):
        return obj.followed_by.count()

    def get_is_following(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.followers.filter(id=request.user.id).exists()
        return False






    def get_social_posts(self, obj):
        posts = obj.social_posts.all()[:5]  # Get latest 5 posts
        return SocialPostSerializer(posts, many=True, context=self.context).data

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
        )
        return user



class NotificationSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    post = SocialPostSerializer(read_only=True, required=False)
    track = TrackSerializer(read_only=True, required=False)
    related_comment = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ['id', 'sender', 'message', 'read', 'notification_type', 
                 'post', 'track', 'created_at','related_comment']
    def get_related_comment(self, obj):
        if obj.notification_type == 'comment':
            comment = PostComment.objects.filter(
                post=obj.post,
                user=obj.sender
            ).first()
            return comment.content if comment else None
        return None



class ChurchSerializer(serializers.ModelSerializer):
    image = serializers.ImageField(max_length=None, use_url=True, required=False)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Church
        fields = '__all__'
        read_only_fields = ('created_by', 'created_at', 'updated_at', 'id')

    def get_created_by_picture(self, obj):
        # Ensure we're returning a complete URL
        if hasattr(obj.created_by, 'profile') and obj.created_by.profile.picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.created_by.profile.picture.url)
            return obj.created_by.profile.picture.url
        return None


# Add to existing serializers
# from .models import Videostudio, Audiostudio, Choir

class VideoStudioSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    logo_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = serializers.SerializerMethodField(read_only=True)  # Only one definition
    service_types = serializers.ListField(child=serializers.ChoiceField(choices=Videostudio.SERVICE_TYPES),default=list)
    
    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified')
    
    def get_logo_url(self, obj):
        if obj.logo:
            return self.context['request'].build_absolute_uri(obj.logo.url)
        return None
    
    def get_cover_image_url(self, obj):
        if obj.cover_image:
            return self.context['request'].build_absolute_uri(obj.cover_image.url)
        return None

    def get_created_by_picture(self, obj):
        # Add null checks for safety
        if obj.created_by and hasattr(obj.created_by, 'profile') and obj.created_by.profile.picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.created_by.profile.picture.url)
            return obj.created_by.profile.picture.url
        return None

    # ... rest of the serializer ...
class ChoirSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    profile_image_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    
    class Meta:
        model = Choir
        fields = '__all__'
        read_only_fields = ('created_by', 'members_count')
    
    def get_profile_image_url(self, obj):
        if obj.profile_image:
            return self.context['request'].build_absolute_uri(obj.profile_image.url)
        return None
    
    def get_cover_image_url(self, obj):
        if obj.cover_image:
            return self.context['request'].build_absolute_uri(obj.cover_image.url)
        return None
    
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
    user = serializers.StringRelatedField()
    
    class Meta:
        model = GroupMember
        fields = ['id', 'user', 'is_admin', 'joined_at']

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




















