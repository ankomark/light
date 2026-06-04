from .common import *  # noqa: F401,F403


class TrackSerializer(serializers.ModelSerializer):
     likes_count = serializers.SerializerMethodField()
     is_liked = serializers.SerializerMethodField()
    #  favorite = serializers.SerializerMethodField()
     artist = UserSerializer(read_only=True)  # Include full artist detai
     is_owner = serializers.SerializerMethodField() 
     audio_file = CloudinaryFieldSerializer()
     cover_image = CloudinaryFieldSerializer(required=False)
     class Meta:
        model = Track
        fields = [
            'id', 'title', 'artist', 'album', 'audio_file','is_owner',
            'cover_image', 'lyrics', 'slug', 
            'views', 'downloads','likes_count','is_liked', 'created_at', 'updated_at'
        ]
        read_only_fields = ['artist', 'slug', 'views', 'downloads', 'created_at', 'updated_at']
        # extra_kwargs = {
        #     'title': {'required': True, 'max_length': 200},
        #     'lyrics': {'allow_blank': True}
        # }
     def validate_title(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Title cannot be empty")
        return value.strip()
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
  
     def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.artist == request.user
     def get_is_favorite(self, obj):
        user = self.context['request'].user
        return user.is_authenticated and obj.favorites.filter(id=user.id).exists()



class PlaylistSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    tracks = TrackSerializer(many=True, read_only=True)
    class Meta:
        model = Playlist
        fields = ('id', 'name', 'user', 'tracks', 'created_at', 'updated_at')



class CommentSerializer(serializers.ModelSerializer):
    user = DetailedUserSerializer(read_only=True) 
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



class AvatarUploadSerializer(serializers.Serializer):
    avatar = serializers.ImageField(
        write_only=True,
        required=True,
        validators=[FileSizeValidator(max_size_mb=5)],
        help_text="Image file for avatar upload (max 5MB)"
    )



class TrackUploadSerializer(serializers.Serializer):
    audio_file = serializers.FileField(
        write_only=True,
        required=True,
        validators=[FileSizeValidator(max_size_mb=20)],
        help_text="Audio file upload (max 20MB)"
    )
    cover_image = serializers.ImageField(
        write_only=True,
        required=False,
        validators=[FileSizeValidator(max_size_mb=5)],
        help_text="Optional cover image (max 5MB)"
    )

