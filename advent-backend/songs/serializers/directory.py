from .common import *  # noqa: F401,F403


class MediaStationSerializer(serializers.ModelSerializer):
    is_owner = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None
    )

    class Meta:
        model = MediaStation
        fields = [
            'id', 'name', 'type', 'logo',
            'website', 'youtube', 'facebook', 'instagram', 'whatsapp',
            'created_by', 'created_by_username', 'is_owner', 'created_at',
        ]
        read_only_fields = ('created_by', 'created_at')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(
            request and request.user.is_authenticated and obj.created_by_id == request.user.id
        )


class ChurchSerializer(serializers.ModelSerializer):
    image = CloudinaryFieldSerializer(read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = CloudinaryFieldSerializer(source='created_by.profile.picture', read_only=True)
    
    
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
    logo = CloudinaryFieldSerializer(read_only=True)
    cover_image = CloudinaryFieldSerializer(read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = CloudinaryFieldSerializer(source='created_by.profile.picture', read_only=True)
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
    profile_image = CloudinaryFieldSerializer(read_only=True)
    cover_image = CloudinaryFieldSerializer(read_only=True)
    
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



class LiveEventSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    embed_url = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    viewers_count = serializers.IntegerField(read_only=True)
    
    class Meta:
        model = LiveEvent
        fields = [
            'id', 'user', 'youtube_url', 'title', 'description',
            'thumbnail', 'is_live', 'start_time', 'end_time',
            'viewers_count', 'embed_url', 'is_owner', 'duration',
            'is_active'
        ]
        read_only_fields = [
            'user', 'thumbnail', 'is_live', 'start_time',
            'end_time', 'viewers_count', 'embed_url', 'is_owner',
            'duration', 'is_active'
        ]
        extra_kwargs = {
            'youtube_url': {
                'help_text': "Must be a valid YouTube live stream URL (e.g., https://www.youtube.com/live/VIDEO_ID)"
            },
            'title': {
                'max_length': 200,
                'help_text': "Maximum 200 characters"
            }
        }
    
    def get_user(self, obj):
        return UserSerializer(obj.user, context=self.context).data
    
    def get_embed_url(self, obj):
        return obj.get_embed_url()
    
    def get_is_owner(self, obj):
        request = self.context.get('request')
        return request and obj.user == request.user
    
    def get_duration(self, obj):
        if obj.end_time:
            return (obj.end_time - obj.start_time).total_seconds()
        elif obj.is_live:
            return (timezone.now() - obj.start_time).total_seconds()
        return 0
    
    def get_is_active(self, obj):
        """Simplified active check"""
        if obj.is_live:
            return True
        if obj.end_time:
            return (timezone.now() - obj.end_time).total_seconds() < 86400  # 24 hours
        return False
    
    def validate_youtube_url(self, value):
        """Comprehensive YouTube URL validation"""
        if not value:
            raise serializers.ValidationError("YouTube URL is required")
        
        # Normalize URL by adding https:// if missing
        if not value.startswith(('http://', 'https://')):
            value = f'https://{value}'
        
        # Validate URL structure
        if not any(domain in value for domain in ['youtube.com', 'youtu.be']):
            raise serializers.ValidationError(
                "URL must be from youtube.com or youtu.be"
            )
        
        # Extract and validate video ID
        video_id = self.extract_youtube_id(value)
        if not video_id:
            raise serializers.ValidationError(
                "Could not extract video ID. Valid formats:\n"
                "- https://www.youtube.com/live/VIDEO_ID\n"
                "- https://youtu.be/VIDEO_ID\n"
                "- https://www.youtube.com/watch?v=VIDEO_ID"
            )
        
        # Additional validation for live streams
        if not self.is_live_stream_url(value):
            raise serializers.ValidationError(
                "URL must be a YouTube live stream (should contain /live/ or livestream parameters)"
            )
        
        return value
    
    @staticmethod
    def extract_youtube_id(url):
        """
        Extract YouTube ID from various URL formats
        Returns None if no valid ID found
        """
        patterns = [
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([^?]{11})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    @staticmethod
    def is_live_stream_url(url):
        """Check if URL appears to be a live stream"""
        live_indicators = [
            '/live/',
            '&feature=youtu.be',
            '&livestream=1',
            '&live=1'
        ]
        return any(indicator in url for indicator in live_indicators)
    
    def validate(self, data):
        """Final validation before saving"""
        # Ensure title is provided
        if not data.get('title'):
            raise serializers.ValidationError({
                'title': 'Title is required'
            })
        
        # Ensure description is not too long
        if data.get('description', '').strip() and len(data['description']) > 1000:
            raise serializers.ValidationError({
                'description': 'Description cannot exceed 1000 characters'
            })
        
        return data
    
    def create(self, validated_data):
        """Custom create method with all necessary fields"""
        request = self.context.get('request')
        url = validated_data['youtube_url']
        video_id = self.extract_youtube_id(url)
        
        if not video_id:
            raise serializers.ValidationError({
                'youtube_url': 'Could not extract valid video ID'
            })
        
        # Create the event instance
        event = LiveEvent.objects.create(
            user=request.user,
            youtube_url=url,
            title=validated_data['title'],
            description=validated_data.get('description', ''),
            thumbnail=f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            is_live=True,
            start_time=timezone.now(),
            viewers_count=0
        )
        
        # Return the fully serialized event
        return LiveEvent.objects.get(id=event.id)

