import re

from ..models import ServiceReview, ServiceBooking

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
        fields = [
            'likes', 'comments', 'follows', 'messages', 'groups', 'communities',
            'live', 'quiz', 'weather', 'verse', 'books', 'updated_at',
        ]
        read_only_fields = ['updated_at']


DAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
GALLERY_MAX = 12
_HHMM = re.compile(r'^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$')


class VideoStudioSerializer(serializers.ModelSerializer):
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    # Free-form tags (max 50 chars each). The frontend suggests category-specific
    # options, but the backend accepts any so new categories need no enum change.
    service_types = serializers.ListField(
        child=serializers.CharField(max_length=50), default=list, required=False,
    )
    organization_slug = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified', 'featured_at', 'organization')

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)

    def validate_organization_slug(self, slug):
        """Listed under an organisation its owner belongs to ('' = their own)."""
        from ..models import Organization
        from ..organizations import can_publish_under
        if not slug:
            return None
        org = Organization.objects.filter(slug=slug).first()
        request = self.context.get('request')
        if org is None or not can_publish_under(getattr(request, 'user', None), org):
            raise serializers.ValidationError('You can list only under an organisation you belong to.')
        return org

    def validate(self, attrs):
        if 'organization_slug' in attrs:
            attrs['organization'] = attrs.pop('organization_slug')
        return attrs

    def validate_gallery(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('A list of pictures.')
        if len(value) > GALLERY_MAX:
            raise serializers.ValidationError(f'Up to {GALLERY_MAX} pictures.')
        return [self._ours(str(u)) for u in value if u]

    def validate_opening_hours(self, value):
        """{day: [open, close]}: days mon to sun, times HH:MM, closing after
        opening (24:00 for until midnight). A day left out is closed."""
        if value in (None, ''):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError('Opening hours are {day: [open, close]}.')
        out = {}
        for day, span in value.items():
            if day not in DAYS:
                raise serializers.ValidationError(f'Unknown day: {day}.')
            ok = (isinstance(span, (list, tuple)) and len(span) == 2
                  and all(isinstance(x, str) and _HHMM.match(x) for x in span) and span[0] < span[1])
            if not ok:
                raise serializers.ValidationError(f'{day}: opening and closing times as HH:MM, closing after opening.')
            out[day] = [span[0], span[1]]
        return out

    # Pictures are our own uploads — not any address on the internet (which
    # would let a listing see who looks at it).
    def _ours(self, value):
        from .. import r2
        if value and not r2.is_r2_url(value):
            raise serializers.ValidationError('Upload the picture from the app.')
        return value

    def validate_logo(self, value):
        return self._ours(value)

    def validate_cover_image(self, value):
        return self._ours(value)


class VideoStudioListSerializer(serializers.ModelSerializer):
    """Lightweight list payload. logo/cover_image are R2 URLs served directly."""
    created_by = SimpleUserSerializer(read_only=True)
    is_owner = serializers.SerializerMethodField()
    logo = serializers.SerializerMethodField()
    cover_image = serializers.SerializerMethodField()
    gallery = serializers.SerializerMethodField()

    class Meta:
        model = Videostudio
        fields = '__all__'
        read_only_fields = ('created_by', 'is_verified', 'featured_at')

    def get_gallery(self, obj):
        return [u for u in (media.resolve(x) for x in (obj.gallery or [])) if u]

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.created_by_id == request.user.id)

    def get_logo(self, obj):
        return media.resolve(obj.logo) or ''

    def get_cover_image(self, obj):
        return media.resolve(obj.cover_image) or ''

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # Trust, at a glance: the stars (the view counts them in its query),
        # how long they've been here, and who runs it.
        avg = getattr(obj, 'rating_avg_anno', None)
        data['rating_avg'] = round(avg, 1) if avg is not None else None
        data['rating_count'] = getattr(obj, 'rating_count_anno', 0) or 0
        joined = getattr(obj.created_by, 'date_joined', None)
        data['member_since'] = joined.year if joined else None
        from ..organizations import mini
        data['organization'] = mini(obj.organization) if obj.organization_id else None
        data['is_saved'] = bool(getattr(obj, 'saved_by_me', False))
        # How far from the viewer (when they said where they are).
        near = self.context.get('near')
        if near and obj.latitude is not None and obj.longitude is not None:
            from ..services_directory import km_between
            data['distance_km'] = round(km_between(near, (obj.latitude, obj.longitude)), 1)
        else:
            data['distance_km'] = None
        return data


class ServiceBookingSerializer(serializers.ModelSerializer):
    """A request to a service (booking or quote), for either side."""
    customer = SimpleUserSerializer(read_only=True)
    service_info = serializers.SerializerMethodField()
    is_provider = serializers.SerializerMethodField()

    class Meta:
        model = ServiceBooking
        fields = ['id', 'service', 'service_info', 'customer', 'kind', 'date', 'time', 'note', 'status', 'reply_note',
                  'responded_at', 'is_provider', 'created_at', 'updated_at']
        read_only_fields = ['id', 'service', 'service_info', 'customer', 'status', 'reply_note', 'responded_at',
                            'is_provider', 'created_at', 'updated_at']

    def to_internal_value(self, data):
        # No day (a quote): '' as well as null.
        if hasattr(data, 'get') and data.get('date') == '':
            data = {**data, 'date': None}
        return super().to_internal_value(data)

    def get_service_info(self, obj):
        s = obj.service
        return {'id': s.id, 'name': s.name, 'logo': media.resolve(s.logo) or '', 'category': s.category,
                'location': s.location}

    def get_is_provider(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.service.created_by_id == request.user.id)

    def validate_time(self, v):
        if v and not _HHMM.match(v):
            raise serializers.ValidationError('A time as HH:MM.')
        return v

    def validate_date(self, v):
        from django.utils import timezone
        if v and v < timezone.localdate():
            raise serializers.ValidationError('That day has passed.')
        return v

    def validate(self, attrs):
        if attrs.get('kind', ServiceBooking.BOOKING) == ServiceBooking.BOOKING and not attrs.get('date'):
            raise serializers.ValidationError({'date': 'A booking needs a day.'})
        if not (attrs.get('note') or '').strip() and attrs.get('kind') == ServiceBooking.QUOTE:
            raise serializers.ValidationError({'note': 'Say what you need a quote for.'})
        return attrs


class ServiceReviewSerializer(serializers.ModelSerializer):
    """A review of a service (and its owner's reply)."""
    user = SimpleUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = ServiceReview
        fields = ['id', 'user', 'rating', 'body', 'reply', 'replied_at', 'is_mine', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'reply', 'replied_at', 'is_mine', 'created_at', 'updated_at']

    def get_is_mine(self, obj):
        request = self.context.get('request')
        return bool(request and request.user.is_authenticated and obj.user_id == request.user.id)

    def validate_rating(self, v):
        if not 1 <= int(v) <= 5:
            raise serializers.ValidationError('A rating is 1 to 5 stars.')
        return v


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



class WallpaperSerializer(serializers.ModelSerializer):
    """An app-wide background. `image` is the public R2 URL the client already
    holds after its presigned PUT; `image_url` is the resolved form the app
    renders (stray non-URL leftovers resolve to None rather than a broken src)."""
    image_url = serializers.SerializerMethodField()
    uploaded_by_username = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None
    )

    class Meta:
        model = Wallpaper
        fields = [
            'id', 'image', 'image_url', 'title', 'scope', 'is_active', 'sort_order',
            'uploaded_by', 'uploaded_by_username', 'created_at',
        ]
        read_only_fields = ['uploaded_by', 'created_at']
        extra_kwargs = {'image': {'write_only': True}}

    def get_image_url(self, obj):
        return media.resolve(obj.image)

    def validate_image(self, value):
        # The client uploads straight to R2 and posts back the public URL, so
        # anything else is a malformed payload rather than a usable reference.
        if not media.is_absolute(value):
            raise serializers.ValidationError(
                'Expected the public URL returned by the upload.'
            )
        if len(value) > 500:
            raise serializers.ValidationError('Image URL is too long.')
        return value


class WeatherPlaceSerializer(serializers.ModelSerializer):
    """The one place a person wants their weather for.

    Coordinates are validated rather than trusted. They arrive from a search on
    the device, and a bad pair would send the morning cron looking for weather
    in the middle of the ocean every day until somebody noticed.
    """

    class Meta:
        model = WeatherPlace
        fields = [
            'name', 'region', 'country', 'latitude', 'longitude',
            'briefing', 'updated_at',
        ]
        read_only_fields = ['updated_at']

    def validate_latitude(self, value):
        if not -90 <= value <= 90:
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_longitude(self, value):
        if not -180 <= value <= 180:
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value

    def validate_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('A place needs a name.')
        return name
