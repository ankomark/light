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


class NoticeSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None
    )
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Notice
        fields = [
            'id', 'title', 'body', 'is_pinned',
            'created_by', 'created_by_username', 'can_manage',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def get_can_manage(self, obj):
        request = self.context.get('request')
        # Admin gating is interim (User.is_staff); richer roles come later.
        return bool(request and request.user.is_authenticated and request.user.is_staff)


class AdminNoteSerializer(serializers.ModelSerializer):
    """Note from a user to the admins. `sender` info is exposed only to admins
    (the create response is the only time a non-admin sees their own note)."""
    sender_username = serializers.CharField(
        source='sender.username', read_only=True, default=None
    )

    class Meta:
        model = AdminNote
        fields = ['id', 'body', 'sender', 'sender_username', 'is_read', 'created_at']
        # is_read stays writable so admins can mark notes read/unread on update;
        # creation forces it false in the viewset so a sender can't pre-set it.
        read_only_fields = ['sender', 'created_at']


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ['likes', 'comments', 'follows', 'messages', 'groups', 'communities', 'live', 'updated_at']
        read_only_fields = ['updated_at']


class ChurchSerializer(serializers.ModelSerializer):
    image = CloudinaryFieldSerializer(read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_by_picture = serializers.SerializerMethodField()

    class Meta:
        model = Church
        fields = '__all__'
        read_only_fields = ('created_by', 'created_at', 'updated_at', 'id')

    def get_created_by_picture(self, obj):
        # Null-safe: a creator may not have a profile or a picture set.
        profile = getattr(obj.created_by, 'profile', None)
        if profile and profile.picture:
            request = self.context.get('request')
            url = profile.picture.url
            return request.build_absolute_uri(url) if request else url
        return None


# Add to existing serializers
# from .models import Videostudio, Audiostudio, Choir



class VideoStudioSerializer(serializers.ModelSerializer):
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    service_types = serializers.ListField(
        child=serializers.ChoiceField(choices=Videostudio.SERVICE_TYPES), default=list
    )

    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)


class VideoStudioListSerializer(serializers.ModelSerializer):
    """Lightweight list payload: logo/cover return as cacheable URLs (served by
    the `logo`/`cover` actions) instead of full base64, so the list stays small
    and fast. The client reads `logo` / `cover_image` exactly as before."""
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    logo = serializers.SerializerMethodField()
    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)

    def _image_url(self, obj, kind):
        # kind is 'logo' or 'cover'; empty stored blob → empty string.
        field = 'logo' if kind == 'logo' else 'cover_image'
        if not getattr(obj, field, ''):
            return ''
        ver = int(obj.updated_at.timestamp()) if obj.updated_at else 0  # cache-bust on edit
        path = f'/api/video-studios/{obj.id}/{kind}/?v={ver}'
        request = self.context.get('request')
        return request.build_absolute_uri(path) if request else path

    def get_logo(self, obj):
        return self._image_url(obj, 'logo')

    def get_cover_image(self, obj):
        return self._image_url(obj, 'cover')


class ChoirSerializer(serializers.ModelSerializer):
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Choir
        fields = '__all__'
        read_only_fields = ('created_by', 'members_count')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)


class ChoirListSerializer(serializers.ModelSerializer):
    """Lightweight list payload: the profile/cover images are returned as
    cacheable URLs (served by the `cover`/`profile` actions) instead of the full
    base64 data URIs, so the list stays small and fast — and the client never
    has to decode 20 huge images at once. The client reads `profile_image` /
    `cover_image` exactly as before; they're just URLs now."""
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    profile_image = serializers.SerializerMethodField()
    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Choir
        fields = '__all__'
        read_only_fields = ('created_by', 'members_count')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)

    def _image_url(self, obj, kind):
        # kind is 'profile' or 'cover'; empty stored blob → empty string.
        if not getattr(obj, f'{kind}_image', ''):
            return ''
        ver = int(obj.updated_at.timestamp()) if obj.updated_at else 0  # cache-bust on edit
        path = f'/api/choirs/{obj.id}/{kind}/?v={ver}'
        request = self.context.get('request')
        return request.build_absolute_uri(path) if request else path

    def get_profile_image(self, obj):
        return self._image_url(obj, 'profile')

    def get_cover_image(self, obj):
        return self._image_url(obj, 'cover')


# ── Choir community (membership / requests / chat) ────────────────────────────
class ChoirMembershipSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = ChoirMembership
        fields = ['id', 'user', 'role', 'joined_at']
        read_only_fields = fields


class ChoirJoinRequestSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = ChoirJoinRequest
        fields = ['id', 'user', 'message', 'status', 'created_at']
        read_only_fields = ['id', 'user', 'status', 'created_at']


class ChoirMessageSerializer(serializers.ModelSerializer):
    sender = SimpleUserSerializer(read_only=True)
    reply_to = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = ChoirMessage
        fields = [
            'id', 'sender', 'content', 'message_type', 'attachment',
            'file_name', 'duration', 'reply_to', 'reactions', 'created_at',
        ]
        read_only_fields = ['id', 'sender', 'created_at']

    def get_reply_to(self, obj):
        if not obj.reply_to_id:
            return None
        r = obj.reply_to
        return {
            'id': r.id,
            'sender': r.sender.username,
            'message_type': r.message_type,
            # A short preview only — never echo a full base64 attachment back.
            'content': (r.content or r.message_type)[:120],
        }

    def get_reactions(self, obj):
        """Aggregate emoji → count, plus the current user's own pick (if any).
        Relies on the view prefetching `reactions` to avoid N+1 queries."""
        request = self.context.get('request')
        uid = request.user.id if request and request.user.is_authenticated else None
        counts, mine = {}, None
        for r in obj.reactions.all():
            counts[r.emoji] = counts.get(r.emoji, 0) + 1
            if uid and r.user_id == uid:
                mine = r.emoji
        summary = [{'emoji': e, 'count': c}
                   for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        return {'summary': summary, 'mine': mine}


# ── Church community (membership / requests / chat) ───────────────────────────
class ChurchMembershipSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = ChurchMembership
        fields = ['id', 'user', 'role', 'joined_at']
        read_only_fields = fields


class ChurchJoinRequestSerializer(serializers.ModelSerializer):
    user = SimpleUserSerializer(read_only=True)

    class Meta:
        model = ChurchJoinRequest
        fields = ['id', 'user', 'message', 'status', 'created_at']
        read_only_fields = ['id', 'user', 'status', 'created_at']


class ChurchMessageSerializer(serializers.ModelSerializer):
    sender = SimpleUserSerializer(read_only=True)
    reply_to = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = ChurchMessage
        fields = [
            'id', 'sender', 'content', 'message_type', 'attachment',
            'file_name', 'duration', 'reply_to', 'reactions', 'created_at',
        ]
        read_only_fields = ['id', 'sender', 'created_at']

    def get_reply_to(self, obj):
        if not obj.reply_to_id:
            return None
        r = obj.reply_to
        return {
            'id': r.id,
            'sender': r.sender.username,
            'message_type': r.message_type,
            # A short preview only — never echo a full base64 attachment back.
            'content': (r.content or r.message_type)[:120],
        }

    def get_reactions(self, obj):
        """Aggregate emoji → count, plus the current user's own pick. Relies on
        the view prefetching `reactions` to avoid N+1 queries."""
        request = self.context.get('request')
        uid = request.user.id if request and request.user.is_authenticated else None
        counts, mine = {}, None
        for r in obj.reactions.all():
            counts[r.emoji] = counts.get(r.emoji, 0) + 1
            if uid and r.user_id == uid:
                mine = r.emoji
        summary = [{'emoji': e, 'count': c}
                   for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        return {'summary': summary, 'mine': mine}


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

