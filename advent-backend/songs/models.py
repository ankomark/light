from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.utils.text import slugify
from django.core.validators import FileExtensionValidator
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator
from django.utils import timezone
from urllib.parse import urlparse, parse_qs
from datetime import timedelta
import re
import logging
import os

logger = logging.getLogger(__name__)


# Delegatable admin capabilities. A Role is a named bundle of these; super
# admins implicitly have all of them (plus role management, which is not
# delegatable). Keys are stable identifiers; labels are for the UI.
ADMIN_CAPABILITIES = (
    ('view_analytics', 'View analytics'),
    ('handle_reports', 'Handle reports'),
    ('remove_content', 'Remove / restore content'),
    ('manage_users', 'Suspend & warn users'),
    ('ban_users', 'Ban users'),
    ('manage_appeals', 'Review appeals'),
    ('view_audit_log', 'View audit log'),
    ('manage_wallpapers', 'Manage app wallpapers'),
)
ADMIN_CAPABILITY_KEYS = [key for key, _label in ADMIN_CAPABILITIES]


# Custom User Model
class User(AbstractUser):
    # Email is the account-recovery key, so it must be unique.
    email = models.EmailField('email address', unique=True)
    bio = models.TextField(blank=True)
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    avatar = models.CharField(max_length=500, blank=True, null=True)
    followers = models.ManyToManyField(
        'self', symmetrical=False, related_name='followed_by', blank=True
    )
    is_email_verified = models.BooleanField(default=False)
    # is_artist = models.BooleanField(default=False)

    # ── Platform admin role (in-app moderation panel) ─────────────────────────
    # Distinct from Django's is_staff/is_superuser and from per-group is_admin.
    ADMIN_ROLE_CHOICES = (
        ('', 'None'),
        ('moderator', 'Moderator'),
        ('super_admin', 'Super Admin'),
    )
    admin_role = models.CharField(max_length=20, choices=ADMIN_ROLE_CHOICES, default='', blank=True)
    # Granular role (a named bundle of capabilities) for non-super-admin staff.
    role = models.ForeignKey('Role', null=True, blank=True, on_delete=models.SET_NULL, related_name='users')
    # Soft moderation state. "Ban" uses Django's is_active (blocks auth);
    # "suspend" is a reversible flag enforced on content-creating actions.
    is_suspended = models.BooleanField(default=False)
    suspension_reason = models.CharField(max_length=255, blank=True, default='')
    suspended_at = models.DateTimeField(null=True, blank=True)
    # When set, a suspension auto-expires at this time (temporary suspension).
    # Null while suspended means indefinite.
    suspended_until = models.DateTimeField(null=True, blank=True)
    # Escalating moderation warnings (warn -> temp suspend -> ban).
    strikes = models.PositiveIntegerField(default=0)

    # Self-service "deactivate" — a reversible hide the user controls themselves
    # (distinct from the moderation is_suspended and the is_active ban). The
    # account can still authenticate; logging back in auto-reactivates it.
    is_deactivated = models.BooleanField(default=False)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    @property
    def is_super_admin(self):
        return self.is_superuser or self.admin_role == 'super_admin'

    @property
    def capabilities(self):
        """Effective admin capabilities. Super admins (and legacy 'moderator'
        users) get the full set; granular staff get their role's bundle."""
        if self.is_super_admin or self.admin_role == 'moderator':
            return list(ADMIN_CAPABILITY_KEYS)
        if self.role_id and self.role:
            return [c for c in (self.role.capabilities or []) if c in ADMIN_CAPABILITY_KEYS]
        return []

    def has_capability(self, cap):
        if self.is_super_admin or self.admin_role == 'moderator':
            return True
        if self.role_id and self.role:
            return cap in (self.role.capabilities or [])
        return False

    @property
    def is_platform_admin(self):
        # Any staff member: super admin, legacy moderator, or a role with caps.
        return self.is_super_admin or self.admin_role == 'moderator' or bool(self.capabilities)

    @property
    def is_currently_suspended(self):
        """True only while a suspension is active — a past `suspended_until`
        means it has lapsed, so the user is treated as free again."""
        if not self.is_suspended:
            return False
        if self.suspended_until is not None:
            from django.utils import timezone
            return self.suspended_until > timezone.now()
        return True

    groups = models.ManyToManyField(
        Group,
        related_name='custom_user_set',
        blank=True,
        help_text='The groups this user belongs to.',
    )
    user_permissions = models.ManyToManyField(
        Permission,
        related_name='custom_user_set',
        blank=True,
        help_text='Specific permissions for this user.',
    )

    def __str__(self):
        return self.username


class EmailVerification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='verification_codes')
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def is_valid(self):
        from django.utils import timezone
        return not self.used and self.expires_at > timezone.now()

    def __str__(self):
        return f"{self.user.email} — {self.code}"


class PasswordResetCode(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_reset_codes')
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def is_valid(self):
        from django.utils import timezone
        return not self.used and self.expires_at > timezone.now()


# Track Model
class Track(models.Model):
    title = models.CharField(max_length=100)
    artist = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tracks')
    album = models.CharField(max_length=100, blank=True, null=True)
    # audio_file = models.FileField(upload_to='audio/')  
    # cover_image = models.ImageField(upload_to='covers/', blank=True, null=True)
    # Media references: absolute URL (R2) or legacy Cloudinary public_id.
    audio_file = models.CharField(max_length=500)
    cover_image = models.CharField(max_length=500, blank=True, null=True)
    lyrics = models.TextField(blank=True, null=True)
    slug = models.SlugField(unique=True)
    views = models.PositiveIntegerField(default=0)
    downloads = models.PositiveIntegerField(default=0)
    # Soft moderation takedown — hidden from public lists, kept for admin/audit.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # A user's "favorites" are the tracks they've liked (the Like model);
    # there is no separate favorite relation.
    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} by {self.artist.username}"
   

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.title} - {self.artist.username}'


# Playlist Model
class Playlist(models.Model):
    name = models.CharField(max_length=100)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='playlists')
    tracks = models.ManyToManyField(Track, related_name='playlists', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} by {self.user.username}'


# Comment Model
class Comment(models.Model):
    content = models.TextField()
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    # Soft moderation takedown — hidden from public track-comment lists.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Newest first + a composite index so "a track's comments, newest first
        # + paginate" is an index range scan instead of a full table sort.
        ordering = ['-created_at']
        indexes = [models.Index(fields=['track', '-created_at'], name='trackcomment_track_created_idx')]

    def __str__(self):
        return f'Comment by {self.user.username} on {self.track.title}'


# Like Model
class Like(models.Model):
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='likes')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='likes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('track', 'user')  # Prevent duplicate likes

    def __str__(self):
        return f'Like by {self.user.username} on {self.track.title}'


# Category Model
class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    
    tracks = models.ManyToManyField(Track, related_name='categories', blank=True)

    def __str__(self):
        return self.name


# Profile Model (Extended Features for Users)
class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    # picture = models.ImageField(upload_to='profiles/', blank=True, null=True)
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    picture = models.CharField(max_length=500, blank=True, default='')


    bio = models.TextField(blank=True, null=True)
    birth_date = models.DateField(blank=True, null=True)
    location = models.CharField(max_length=100, blank=True, null=True)
    
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Profile of {self.user.username}'


class SocialPost(models.Model):
    CONTENT_TYPES = (
        ('video', 'Video'),
        ('image', 'Image'),
    )
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='social_posts')
    content_type = models.CharField(max_length=5, choices=CONTENT_TYPES)
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    media_file = models.CharField(max_length=500, blank=True, null=True)
    # Poster frame (R2 URL) for video posts, generated on-device at upload.
    # R2 stores bytes verbatim, so there's no server-side frame extraction —
    # the client grabs the first frame and uploads it alongside the clip.
    thumbnail = models.CharField(max_length=500, blank=True, null=True)
    song = models.ForeignKey(Track, null=True, blank=True, on_delete=models.SET_NULL)
    # Carousel of 1–4 images for image posts: list of {public_id, width, height}.
    # Empty for legacy/single-image posts (which fall back to media_file) and for
    # video posts. media_file mirrors the first image for backward compatibility.
    gallery = models.JSONField(default=list, blank=True)
    # Denormalised playback info for an image post's accompanying audio. Covers
    # both library tracks (song FK set) and user-uploaded local audio (no Track).
    # Times are in seconds; the trimmed clip is capped at 30s by the serializer.
    song_audio_url = models.URLField(max_length=500, blank=True, null=True)
    song_title = models.CharField(max_length=200, blank=True)
    song_artist = models.CharField(max_length=200, blank=True)
    song_start_time = models.FloatField(null=True, blank=True)
    song_end_time = models.FloatField(null=True, blank=True)
    # Video trim window (seconds). Delivery is trimmed to [start, end] and
    # compressed via Cloudinary URL transforms; capped at 30s by the serializer.
    video_start_time = models.FloatField(null=True, blank=True)
    video_end_time = models.FloatField(null=True, blank=True)

    caption = models.TextField(blank=True)
    tags = models.CharField(max_length=200, blank=True)
    location = models.CharField(max_length=100, blank=True)
    duration = models.DurationField(
        null=True,
        blank=True,
        help_text="Duration for video posts (max 1 minute)"
    )
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)
    # Denormalised engagement counters, kept in sync by signals on PostLike /
    # PostComment. The feed reads these directly instead of running two DISTINCT
    # COUNT joins per query — the main scalability win for large datasets.
    likes_count = models.PositiveIntegerField(default=0)
    comments_count = models.PositiveIntegerField(default=0)
    # Soft moderation takedown — hidden from public feed/explore, kept for admin.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Feed queries order by -created_at; index it for fast pagination.
        indexes = [models.Index(fields=['-created_at'])]

    def __str__(self):
        return f"{self.user.username}'s {self.content_type} post"

    def clean(self):
        """Comprehensive validation handling Cloudinary resources"""
        try:
            logger.info(f"Starting clean() for SocialPost. Content type: {self.content_type}")
            
            # Log media file details
            media_info = {
                'media_file': str(self.media_file),
                'type': str(type(self.media_file)),
                'exists': bool(self.media_file)
            }
            logger.info(f"Media file info: {media_info}")
            
            if self.content_type == 'video':
                logger.info("Validating video content")
                
                # Get filename or public_id
                filename = str(self.media_file)
                
                # Extract extension safely
                _, ext = os.path.splitext(filename)
                ext = (ext or '').lower()
                logger.info(f"Detected video extension: {ext}")
                
                # Validate extension
                if ext not in ['.mp4', '.mov', '.avi']:
                    error_msg = f"Invalid video format: {ext}. Allowed: .mp4, .mov, .avi"
                    logger.error(error_msg)
                    raise ValidationError(_(error_msg))
                
                # Validate duration
                if self.duration and self.duration > timedelta(minutes=1):
                    error_msg = "Video cannot exceed 1 minute"
                    logger.error(error_msg)
                    raise ValidationError(_(error_msg))
                    
            elif self.content_type == 'image' and self.song:
                logger.info("Validating image with song")
                
                # Validate song audio file
                if not hasattr(self.song, 'audio_file'):
                    error_msg = "Associated song has no audio file"
                    logger.error(error_msg)
                    raise ValidationError(_(error_msg))
                
                # Get filename or public_id for audio
                filename = str(self.song.audio_file)
                
                # Extract extension
                _, ext = os.path.splitext(filename)
                ext = (ext or '').lower()
                logger.info(f"Detected audio extension: {ext}")
                
                # Validate extension
                if ext not in ['.mp3', '.wav', '.ogg']:
                    error_msg = f"Invalid audio format: {ext}. Allowed: .mp3, .wav, .ogg"
                    logger.error(error_msg)
                    raise ValidationError(_(error_msg))
                    
        except ValidationError as ve:
            logger.exception("Validation error in SocialPost.clean()")
            raise
        except Exception as e:
            logger.exception("Unexpected error in SocialPost.clean()")
            raise ValidationError(_("An unexpected error occurred while validating the post"))

class PostLike(models.Model):
    post = models.ForeignKey(SocialPost, on_delete=models.CASCADE, related_name='likes')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='social_likes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('post', 'user')

class PostComment(models.Model):
    post = models.ForeignKey(SocialPost, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='social_comments')
    content = models.TextField()
    # Soft moderation takedown — hidden from public comment lists.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest first (matches the app's optimistic top-insert), and the
        # composite index makes "comments for a post, newest first + paginate"
        # an index-only range scan instead of a full table sort.
        ordering = ['-created_at']
        indexes = [models.Index(fields=['post', '-created_at'], name='postcomment_post_created_idx')]

class PostSave(models.Model):
    post = models.ForeignKey(SocialPost, on_delete=models.CASCADE, related_name='saves')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_posts')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('post', 'user')

class Story(models.Model):
    CONTENT_TYPES = [('image', 'Image'), ('video', 'Video')]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stories')
    media_file = models.CharField(max_length=500, blank=True)  # Cloudinary public_id
    media_url = models.URLField(max_length=1000, blank=True)
    content_type = models.CharField(max_length=10, choices=CONTENT_TYPES, default='image')
    caption = models.CharField(max_length=200, blank=True)
    # Soft moderation takedown — hidden from the public story feed.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'stories'
        # The story feed filters on expires_at > now on every load.
        indexes = [models.Index(fields=['expires_at'])]

    def save(self, *args, **kwargs):
        if not self.expires_at:
            from datetime import timedelta
            self.expires_at = timezone.now() + timedelta(hours=24)
        super().save(*args, **kwargs)

    def is_active(self):
        return timezone.now() < self.expires_at

    def __str__(self):
        return f"{self.user.username}'s story ({self.created_at:%Y-%m-%d})"


class StoryView(models.Model):
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name='views')
    viewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='story_views')
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('story', 'viewer')


class Report(models.Model):
    REASON_CHOICES = [
        ('spam', 'Spam'),
        ('hate', 'Hate Speech'),
        ('violence', 'Violence or Threats'),
        ('inappropriate', 'Inappropriate Content'),
        ('misinformation', 'Misinformation'),
        ('copyright', 'Copyright Violation'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending Review'),
        ('reviewed', 'Under Review'),
        ('resolved', 'Resolved'),
        ('dismissed', 'Dismissed'),
    ]

    reporter = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reports_filed')
    content_type = models.CharField(max_length=20)
    object_id = models.PositiveIntegerField()
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    # Moderation workflow: assignment, internal notes, and resolution record.
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='assigned_reports')
    moderator_notes = models.TextField(blank=True, default='')
    resolved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='resolved_reports')
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('reporter', 'content_type', 'object_id')
        ordering = ['-created_at']

    def __str__(self):
        return f"Report by {self.reporter.username}: {self.content_type} #{self.object_id}"


class AdminActionLog(models.Model):
    """Audit trail for every moderation action taken from the admin panel."""
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='admin_actions')
    action = models.CharField(max_length=40)  # e.g. resolve_report, remove_post, suspend_user, set_role
    target_type = models.CharField(max_length=20, blank=True, default='')
    target_id = models.PositiveIntegerField(null=True, blank=True)
    reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['-created_at'])]

    def __str__(self):
        actor = self.actor.username if self.actor else 'system'
        return f"{actor} {self.action} {self.target_type}#{self.target_id}"


class Appeal(models.Model):
    """A suspended user's request to have their moderation action reviewed."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='appeals')
    message = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='reviewed_appeals')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at'])]

    def __str__(self):
        return f"Appeal by {self.user.username} ({self.status})"


class Role(models.Model):
    """A named bundle of admin capabilities a super admin assigns to staff."""
    name = models.CharField(max_length=50, unique=True)
    capabilities = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Notification(models.Model):
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_notifications')
    message = models.TextField()
    read = models.BooleanField(default=False)
    notification_type = models.CharField(max_length=50)  # e.g., 'like', 'comment', 'follow'
    post = models.ForeignKey(SocialPost, null=True, blank=True, on_delete=models.CASCADE)
    track = models.ForeignKey(Track, null=True, blank=True, on_delete=models.CASCADE)
    # Set on group-related notifications (join request / approval / rejection) so
    # the client can deep-link the tap to the right group screen.
    group = models.ForeignKey('Group', null=True, blank=True, on_delete=models.CASCADE, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Hot paths: unread_count filters (recipient, read); list orders by
        # -created_at per recipient. Both polled every ~15s by the client.
        indexes = [
            models.Index(fields=['recipient', 'read']),
            models.Index(fields=['recipient', '-created_at']),
        ]

    def __str__(self):
        return f"{self.sender.username} -> {self.recipient.username}: {self.message}"


class Conversation(models.Model):
    participants = models.ManyToManyField(User, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Conversation {self.id}"


class Message(models.Model):
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
        ('audio', 'Voice note'),
    ]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField(blank=True, default='')
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    # Attachment stored as a base64 data URI (image/file/audio).
    attachment = models.TextField(blank=True, default='')
    file_name = models.CharField(max_length=255, blank=True, default='')
    duration = models.FloatField(null=True, blank=True)  # seconds, for voice notes
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.sender.username}: {(self.content or self.message_type)[:50]}"


class DeviceToken(models.Model):
    PLATFORM_CHOICES = [('ios', 'iOS'), ('android', 'Android'), ('web', 'Web')]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='device_tokens')
    token = models.CharField(max_length=500)
    platform = models.CharField(max_length=10, choices=PLATFORM_CHOICES, default='android')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'token')

    def __str__(self):
        return f"{self.user.username} - {self.platform} - {self.token[:30]}..."


class Church(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    name = models.CharField(max_length=200)
    country = models.CharField(max_length=100)
    county = models.CharField(max_length=100, blank=True, null=True)
    conference = models.CharField(max_length=200)
    district = models.CharField(max_length=200, blank=True, null=True)
    location = models.CharField(max_length=300)
    members = models.PositiveIntegerField(default=0)
    pastor = models.CharField(max_length=200, blank=True, null=True)
    contact = models.CharField(max_length=100, blank=True, null=True)
    # WhatsApp-style "Only admins can send messages" lock for the church community chat.
    only_admins_can_post = models.BooleanField(default=False)
    # image = models.ImageField(upload_to='churches/', blank=True, null=True)
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    image = models.CharField(max_length=500, blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='churches')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']


class Notice(models.Model):
    """Notice board posts. Read by everyone; only staff/admins may post
    (admin-role gating to be expanded later — currently uses User.is_staff)."""
    title = models.CharField(max_length=200)
    body = models.TextField()
    is_pinned = models.BooleanField(default=False)
    created_by = models.ForeignKey('User', on_delete=models.SET_NULL, null=True, related_name='notices')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_pinned', '-created_at']

    def __str__(self):
        return self.title


class Wallpaper(models.Model):
    """An app-wide background image, managed by admins and served to every
    screen that renders RotatingBackground. Replaces the hardcoded R2 URL list
    the client used to ship with; that list stays in the app as the fallback for
    a cold start or an empty/unreachable table, so the background is never blank.
    """
    # Which surface this wallpaper belongs to. The music tab has always had its
    # own set; keeping them separate preserves that instead of merging every
    # image into one rotation.
    SCOPE_CHOICES = (
        ('general', 'General (most screens)'),
        ('music', 'Music'),
    )

    # Media reference: absolute R2 URL, uploaded via the presigned PUT flow.
    image = models.CharField(max_length=500)
    title = models.CharField(max_length=120, blank=True)
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default='general', db_index=True)
    # Deactivate to pull a wallpaper from rotation without deleting the file.
    is_active = models.BooleanField(default=True)
    # Lower sorts first; ties fall back to upload order for a stable rotation.
    sort_order = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True, related_name='wallpapers'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'created_at']

    def __str__(self):
        return self.title or f'Wallpaper {self.pk}'


class AdminNote(models.Model):
    """A private note any signed-in user can write to the admins.
    Only staff/admins may read these; the sender can submit but not view them
    (admin-role gating is interim — currently uses User.is_staff)."""
    body = models.TextField()
    sender = models.ForeignKey('User', on_delete=models.SET_NULL, null=True, related_name='admin_notes')
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['is_read', '-created_at']

    def __str__(self):
        who = self.sender.username if self.sender else 'Unknown'
        return f"Note from {who} ({self.created_at:%Y-%m-%d})"


class NotificationPreference(models.Model):
    """Per-user push opt-outs by category. A missing row means everything is on
    (the default), so absence is treated as all-enabled in the send path."""
    user = models.OneToOneField('User', on_delete=models.CASCADE, related_name='notification_preference')
    likes = models.BooleanField(default=True)
    comments = models.BooleanField(default=True)
    follows = models.BooleanField(default=True)
    messages = models.BooleanField(default=True)
    groups = models.BooleanField(default=True)
    communities = models.BooleanField(default=True)
    live = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Notification prefs for {self.user.username}"


class Block(models.Model):
    """A one-directional block record. Enforcement is symmetric: if either side
    has blocked the other, they don't see each other's content and can't DM."""
    blocker = models.ForeignKey('User', on_delete=models.CASCADE, related_name='blocks_made')
    blocked = models.ForeignKey('User', on_delete=models.CASCADE, related_name='blocks_received')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('blocker', 'blocked')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.blocker_id} blocked {self.blocked_id}"


class FollowRequest(models.Model):
    """A pending request to follow a private account. Public accounts never
    create one — following them is immediate, as before. Mirrors the
    Group/Choir/ChurchJoinRequest pattern."""
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )

    requester = models.ForeignKey('User', on_delete=models.CASCADE, related_name='follow_requests_made')
    target = models.ForeignKey('User', on_delete=models.CASCADE, related_name='follow_requests_received')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('requester', 'target')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.requester.username} -> {self.target.username} ({self.status})"


def can_view_profile(viewer, target):
    """Whether `viewer` may see `target`'s profile detail and posts.

    Public accounts are visible to everyone (including anonymous). A private
    account is visible only to itself and to followers it has approved."""
    if target is None:
        return False
    profile = getattr(target, 'profile', None)
    # No profile row yet → treat as public, matching the field default.
    if profile is None or profile.is_public:
        return True
    if not getattr(viewer, 'is_authenticated', False):
        return False
    if viewer.pk == target.pk:
        return True
    return target.followers.filter(pk=viewer.pk).exists()


def hidden_private_author_ids(user):
    """Ids of private-account users whose posts `user` may NOT see: every private
    account they don't already follow (and aren't). Mirrors blocked_ids_for() so
    feed queries can exclude both in one step.

    Only private accounts are loaded — the overwhelming majority are public, so
    this stays small. Move to a SQL-side exclude if that ever stops being true."""
    private_ids = set(
        Profile.objects.filter(is_public=False).values_list('user_id', flat=True)
    )
    if not private_ids:
        return set()
    if not getattr(user, 'is_authenticated', False):
        return private_ids
    # `followed_by` is the reverse of `followers`, i.e. the people `user` follows.
    following = set(user.followed_by.values_list('id', flat=True))
    return private_ids - following - {user.pk}


def blocked_ids_for(user):
    """The set of user ids hidden from `user`: everyone they blocked plus
    everyone who blocked them. Empty for anonymous users."""
    if not getattr(user, 'is_authenticated', False):
        return set()
    made = Block.objects.filter(blocker=user).values_list('blocked_id', flat=True)
    received = Block.objects.filter(blocked=user).values_list('blocker_id', flat=True)
    return set(made) | set(received)


def is_blocked_between(a, b):
    """True if either user has blocked the other (symmetric check)."""
    if not a or not b:
        return False
    return Block.objects.filter(
        models.Q(blocker=a, blocked=b) | models.Q(blocker=b, blocked=a)
    ).exists()


class NotInterested(models.Model):
    """A private "not interested" signal on a post. Low-volume explicit intent
    (unlike ephemeral impressions), so it lives in the DB: the post is hidden
    from the user's feeds, and its author/tags become a negative signal that
    demotes similar content in the ranked feed."""
    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='not_interested')
    post = models.ForeignKey('SocialPost', on_delete=models.CASCADE, related_name='not_interested_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'post')
        indexes = [models.Index(fields=['user', 'post'])]


class WatchEvent(models.Model):
    """How long a user actually dwelled on a post (ms in viewport). Written in
    batches by the client, so the write cost stays low. A strong implicit
    interest signal — long dwells feed the taste profile like soft likes — and
    the training data for a future learned ranker."""
    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='watch_events')
    post = models.ForeignKey('SocialPost', on_delete=models.CASCADE, related_name='watch_events')
    dwell_ms = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['user', '-created_at'])]


class MediaStation(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    STATION_TYPES = [('TV', 'TV'), ('Radio', 'Radio'), ('Podcast', 'Podcast')]

    name = models.CharField(max_length=200)
    type = models.CharField(max_length=10, choices=STATION_TYPES, default='TV')
    # Media reference: absolute URL (R2), or blank to use a default icon.
    logo = models.CharField(max_length=500, blank=True)
    website = models.URLField(max_length=500, blank=True)
    youtube = models.URLField(max_length=500, blank=True)
    facebook = models.URLField(max_length=500, blank=True)
    instagram = models.URLField(max_length=500, blank=True)
    whatsapp = models.URLField(max_length=500, blank=True)
    # Null for seeded/built-in stations (system-owned, read-only to everyone).
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='media_stations'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Videostudio(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    SERVICE_TYPES = (
        ('music_video', 'Music Video Production'),
        ('live_event', 'Live Event Coverage'),
        ('editing', 'Video Editing'),
        ('other', 'Other Video Services'),
        ('recording', 'Audio Recording'),
        ('mixing', 'Mixing & Mastering'),
        ('voice_over', 'Voice Over Recording'),
        ('podcast', 'Podcast Production'),
        ('documentary', 'Documentary Production'),  
    )
    
    SERVICE_TYPE_CHOICES = [choice[0] for choice in SERVICE_TYPES]

    # This directory started as media studios but is the app's general "Services"
    # listing. `category` is the top-level bucket; per-category service tags live
    # in `service_types` (free-form now, so new categories need no schema change).
    SERVICE_CATEGORIES = (
        ('media', 'Media & Production'),
        ('hospitality', 'Hospitality'),
        ('health', 'Health & Wellness'),
        ('professional', 'Professional'),
        ('home', 'Home & Trades'),
    )
    category = models.CharField(
        max_length=20, choices=SERVICE_CATEGORIES, default='media', db_index=True,
    )

    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    location = models.CharField(max_length=300)
    contact_phone = models.CharField(max_length=20, blank=True, null=True)
    contact_email = models.EmailField(blank=True, null=True)
    # Images stored as base64 data URIs (or blank to use a default).
    # Media references: absolute URLs (R2).
    logo = models.CharField(max_length=500, blank=True, default='')
    cover_image = models.CharField(max_length=500, blank=True, default='')
    whatsapp_number = models.CharField(max_length=20, blank=True, null=True)
    currency = models.CharField(max_length=8, blank=True, default='USD')
    rate_description = models.CharField(max_length=200, blank=True, default='')
    service_types = models.JSONField(
        default=list,
        blank=True,
        null=True,
        help_text="List of service types the studio offers (stored as JSON array)"
    )
    youtube_link = models.URLField(blank=True, null=True)
    # Optional social / web presence — all blank by default.
    website_link = models.URLField(blank=True, null=True)
    facebook_link = models.URLField(blank=True, null=True)
    instagram_link = models.URLField(blank=True, null=True)
    tiktok_link = models.URLField(blank=True, null=True)
    twitter_link = models.URLField(blank=True, null=True)
    service_rates = models.DecimalField(max_digits=8, decimal_places=2, blank=True, null=True)
    is_verified = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='videostudios')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    def clean(self):
        """Validate service_types before saving"""
        super().clean()
        
        if self.service_types is not None:
            # Ensure it's a list
            if not isinstance(self.service_types, list):
                raise ValidationError({
                    'service_types': 'Must be a list of service type strings'
                })

            # Tags are free-form now (the directory covers many categories, each
            # with its own service types suggested by the frontend). We only guard
            # the shape: non-empty strings, max 50 chars — no fixed enum.
            bad = [s for s in self.service_types
                   if not isinstance(s, str) or not s.strip() or len(s) > 50]
            if bad:
                raise ValidationError({
                    'service_types': 'Each service type must be a non-empty string of at most 50 characters.'
                })

    def save(self, *args, **kwargs):
        """Ensure validation runs on every save"""
        self.full_clean()
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "Video Studio"
        verbose_name_plural = "Video Studios"
        ordering = ['-created_at']

class Choir(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    GENRE_CHOICES = (
        ('gospel', 'Gospel'),
        ('contemporary', 'Contemporary Christian'),
        ('traditional', 'Traditional Hymns'),
        ('mixed', 'Mixed Repertoire'),
    )
    
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    church = models.ForeignKey(Church, on_delete=models.SET_NULL, null=True, blank=True, related_name='choirs')
    location = models.CharField(max_length=300)
    contact_phone = models.CharField(max_length=20, blank=True, null=True)
    contact_email = models.EmailField(blank=True, null=True)
    genre = models.CharField(max_length=50, choices=GENRE_CHOICES, default='gospel')
    members_count = models.PositiveIntegerField(default=0)
    # Images stored as base64 data URIs (or blank to use a default).
    # Media references: absolute URLs (R2).
    profile_image = models.CharField(max_length=500, blank=True, default='')
    cover_image = models.CharField(max_length=500, blank=True, default='')
    founded_date = models.DateField(blank=True, null=True)
    youtube_link = models.URLField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    # WhatsApp-style "Only admins can send messages" lock for the choir community chat.
    only_admins_can_post = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choirs')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name_plural = "Choirs"
        ordering = ['-created_at']


class ChoirMembership(models.Model):
    """A person's place in a choir community. The creator is 'admin'; people who
    request and are approved become 'friend'; the admin may add core 'member's.
    All roles can read and post in the choir chat — role only governs moderation."""
    ROLE_CHOICES = (('admin', 'Admin'), ('member', 'Member'), ('friend', 'Friend'))
    choir = models.ForeignKey(Choir, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choir_memberships')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='friend')
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(null=True, blank=True)  # for unread counts

    class Meta:
        unique_together = ('choir', 'user')
        indexes = [models.Index(fields=['choir', 'role'])]

    def __str__(self):
        return f"{self.user.username} in {self.choir.name} ({self.role})"


class ChoirJoinRequest(models.Model):
    """A request to become a friend of a choir (community access)."""
    STATUS_CHOICES = (('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'))
    choir = models.ForeignKey(Choir, on_delete=models.CASCADE, related_name='join_requests')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choir_join_requests')
    message = models.TextField(blank=True, default='')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('choir', 'user')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} -> {self.choir.name} ({self.status})"


class ChoirMessage(models.Model):
    """A message in a choir community chat (text / image / file / voice note /
    system notice). Attachments ride as base64 data URIs, matching GroupPost."""
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
        ('audio', 'Voice note'),
        ('system', 'System'),
    ]
    choir = models.ForeignKey(Choir, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choir_messages')
    content = models.TextField(blank=True, default='')
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    attachment = models.TextField(blank=True, default='')  # base64 data URI
    file_name = models.CharField(max_length=255, blank=True, default='')
    duration = models.FloatField(null=True, blank=True)  # seconds, for voice notes
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['choir', 'created_at'])]

    def __str__(self):
        return f"{self.sender.username} in {self.choir.name}"


class ChoirMessageReaction(models.Model):
    """A single emoji reaction by one user on a choir message. WhatsApp-style:
    at most one reaction per user per message — re-reacting with a different
    emoji replaces it, re-reacting with the same emoji clears it."""
    message = models.ForeignKey(ChoirMessage, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choir_reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user')
        indexes = [models.Index(fields=['message'])]

    def __str__(self):
        return f"{self.user.username} {self.emoji} on msg {self.message_id}"


# ── Church community (mirrors the choir community: membership / requests / chat) ─
class ChurchMembership(models.Model):
    """A person's place in a church community. The creator is 'admin'; people who
    request and are approved become 'friend'; the admin may add core 'member's.
    All roles can read and post in the church chat — role only governs moderation."""
    ROLE_CHOICES = (('admin', 'Admin'), ('member', 'Member'), ('friend', 'Friend'))
    church = models.ForeignKey(Church, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='church_memberships')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='friend')
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(null=True, blank=True)  # for unread counts

    class Meta:
        unique_together = ('church', 'user')
        indexes = [models.Index(fields=['church', 'role'])]

    def __str__(self):
        return f"{self.user.username} in {self.church.name} ({self.role})"


class ChurchJoinRequest(models.Model):
    """A request to join a church community."""
    STATUS_CHOICES = (('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'))
    church = models.ForeignKey(Church, on_delete=models.CASCADE, related_name='join_requests')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='church_join_requests')
    message = models.TextField(blank=True, default='')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('church', 'user')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} -> {self.church.name} ({self.status})"


class ChurchMessage(models.Model):
    """A message in a church community chat (text / image / file / voice note /
    system notice). Attachments ride as base64 data URIs, matching ChoirMessage."""
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
        ('audio', 'Voice note'),
        ('system', 'System'),
    ]
    church = models.ForeignKey(Church, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='church_messages')
    content = models.TextField(blank=True, default='')
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    attachment = models.TextField(blank=True, default='')  # base64 data URI
    file_name = models.CharField(max_length=255, blank=True, default='')
    duration = models.FloatField(null=True, blank=True)  # seconds, for voice notes
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['church', 'created_at'])]

    def __str__(self):
        return f"{self.sender.username} in {self.church.name}"


class ChurchMessageReaction(models.Model):
    """A single emoji reaction by one user on a church message (one per user;
    re-reacting with a different emoji replaces it, the same emoji clears it)."""
    message = models.ForeignKey(ChurchMessage, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='church_reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user')
        indexes = [models.Index(fields=['message'])]

    def __str__(self):
        return f"{self.user.username} {self.emoji} on msg {self.message_id}"


class Group(models.Model):
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_groups')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # cover_image = models.ImageField(upload_to='group_covers/', blank=True, null=True)
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    cover_image = models.CharField(max_length=500, blank=True, null=True)
    is_private = models.BooleanField(default=True)
    # WhatsApp-style "Only admins can send messages" lock.
    only_admins_can_post = models.BooleanField(default=False)
    # Shareable invite token. Lets admins add people to a private group via a
    # link/code without exposing the group in public discovery. Null until an
    # admin generates one; rotating it invalidates old links.
    invite_code = models.UUIDField(null=True, blank=True, unique=True, db_index=True)
    # The one message an admin has pinned to the top of the chat (Telegram-style).
    pinned_post = models.ForeignKey(
        'GroupPost', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    # Optional prompt shown to someone requesting to join (their answer becomes the
    # join request's message). Blank = no question.
    join_question = models.CharField(max_length=200, blank=True, default='')
    # Soft moderation takedown — hidden from public group listings.
    is_removed = models.BooleanField(default=False)
    slug = models.SlugField(unique=True, max_length=100)

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 1
            while Group.objects.filter(slug=slug).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

class GroupMember(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='group_memberships')
    is_admin = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(null=True, blank=True)  # for unread counts

    class Meta:
        unique_together = ('group', 'user')

    def __str__(self):
        return f"{self.user.username} in {self.group.name}"

class GroupJoinRequest(models.Model):
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )
    
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='join_requests')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='group_join_requests')
    message = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)  # last status change (drives re-request cooldown)

    class Meta:
        unique_together = ('group', 'user')

    def __str__(self):
        return f"{self.user.username} -> {self.group.name} ({self.status})"

class GroupPost(models.Model):
    """A message in a group chat (text / image / file / voice / system notice)."""
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
        ('audio', 'Voice note'),
        ('system', 'System'),
    ]
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='posts')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField(blank=True, default='')
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    # Attachment stored as a base64 data URI (image/file/audio).
    attachment = models.TextField(blank=True, default='')
    file_name = models.CharField(max_length=255, blank=True, default='')
    # BlurHash of an image attachment — a ~30-char string the client encodes on
    # send and every viewer decodes into a colour-matched blur placeholder while
    # the real image downloads.
    attachment_blurhash = models.CharField(max_length=60, blank=True, default='')
    duration = models.FloatField(null=True, blank=True)  # seconds, for voice notes
    # Set when the author edits a text message; drives the "edited" label.
    edited_at = models.DateTimeField(null=True, blank=True)
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Message in {self.group.name} by {self.user.username}"

class GroupPostAttachment(models.Model):
    ATTACHMENT_TYPES = (
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('document', 'Document'),
    )
    
    post = models.ForeignKey(GroupPost, on_delete=models.CASCADE, related_name='attachments')
    # file = models.FileField(upload_to='group_posts/%Y/%m/%d/')
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    file = models.CharField(max_length=500)
    file_type = models.CharField(max_length=10, choices=ATTACHMENT_TYPES)
    created_at = models.DateTimeField(auto_now_add=True)


class GroupPostReaction(models.Model):
    """A single emoji reaction by one user on a group message. WhatsApp-style:
    at most one reaction per user per post — re-reacting with a different emoji
    replaces it, re-reacting with the same emoji clears it."""
    post = models.ForeignKey(GroupPost, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='group_post_reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('post', 'user')
        indexes = [models.Index(fields=['post'])]

    def __str__(self):
        return f"{self.user.username} {self.emoji} on post {self.post_id}"

    def __str__(self):
        return f"Attachment for post {self.post.id}"









# Marketplace Category Model
class ProductCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(default=timezone.now)  # instead of auto_now_add
    updated_at = models.DateTimeField(auto_now=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    
    class Meta:
        verbose_name_plural = "Product Categories"
        ordering = ['name']
    
    def __str__(self):
        return self.name

# Product Model
class Product(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    CONDITION_CHOICES = [
        ('NEW', 'New'),
        ('USED', 'Used'),
        ('REFURBISHED', 'Refurbished'),
    ]
    
    currency = models.CharField(
        max_length=3, 
        default='USD',
        choices=[
            ('USD', 'US Dollar'),
            ('EUR', 'Euro'),
            ('GBP', 'British Pound'),
            ('KES', 'Kenyan Shilling'),
            ('NGN', 'Nigerian Naira')
        ]
    )
    seller = models.ForeignKey('User', on_delete=models.CASCADE, related_name='products_for_sale')
    title = models.CharField(max_length=200)
    description = models.TextField()
    price = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        validators=[MinValueValidator(0)]
    )
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default='NEW')
    quantity = models.PositiveIntegerField(default=1)
    category = models.ForeignKey(ProductCategory, on_delete=models.SET_NULL, null=True, related_name='products')
    is_digital = models.BooleanField(default=False)
    is_available = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    views = models.PositiveIntegerField(default=0)
    slug = models.SlugField(unique=True, max_length=255)
    whatsapp_number = models.CharField(max_length=20, blank=True, null=True)
    contact_number = models.CharField(max_length=20, blank=True, null=True)
    location = models.CharField(max_length=200, blank=True, null=True)

    # Seller-direct payment details (open-air market): the buyer pays the seller
    # directly via these channels; the app does not process the payment.
    mpesa_number = models.CharField(max_length=20, blank=True, null=True)
    till_number = models.CharField(max_length=30, blank=True, null=True)
    bank_details = models.CharField(max_length=255, blank=True, null=True)
    payment_instructions = models.TextField(blank=True, null=True)

    # Link to tracks if this is a music-related product
    track = models.ForeignKey('Track', on_delete=models.SET_NULL, null=True, blank=True, related_name='marketplace_products')
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.title} by {self.seller.username}"
    
    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.title)
            slug = base_slug
            counter = 1
            while Product.objects.filter(slug=slug).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)

# Product Image Model
class ProductImage(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='images')
    # image = models.ImageField(upload_to='products/images/', validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png'])])
    # Media reference: absolute URL (R2) or legacy Cloudinary public_id.
    image = models.CharField(max_length=500)
    is_primary = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['is_primary', 'uploaded_at']
    
    def __str__(self):
        return f"Image for {self.product.title}"

# Shopping Cart Model
class Cart(models.Model):
    user = models.OneToOneField('User', on_delete=models.CASCADE, related_name='shopping_cart')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Cart of {self.user.username}"
    
    @property
    def total_items(self):
        return self.items.aggregate(total=models.Sum('quantity'))['total'] or 0
    
    @property
    def subtotal(self):
        return sum(item.total_price for item in self.items.all())

# Cart Item Model
class CartItem(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField(default=1)
    added_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('cart', 'product')
        ordering = ['-added_at']
    
    def __str__(self):
        return f"{self.quantity} x {self.product.title}"
    
    @property
    def total_price(self):
        return self.product.price * self.quantity

# Order Model
class Order(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('PROCESSING', 'Processing'),
        ('SHIPPED', 'Shipped'),
        ('DELIVERED', 'Delivered'),
        ('CANCELLED', 'Cancelled'),
        ('REFUNDED', 'Refunded'),
    ]
    
    PAYMENT_STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('PAID', 'Paid'),
        ('FAILED', 'Failed'),
    ]

    buyer = models.ForeignKey('User', on_delete=models.CASCADE, related_name='purchases')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    # Authoritative payment state — only ever set to PAID by the Stripe webhook.
    payment_status = models.CharField(max_length=20, choices=PAYMENT_STATUS_CHOICES, default='PENDING')
    shipping_address = models.TextField(blank=True)
    payment_method = models.CharField(max_length=50, blank=True)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    transaction_id = models.CharField(max_length=100, blank=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Order #{self.id} by {self.buyer.username}"

# Order Item Model
class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True)
    quantity = models.PositiveIntegerField()
    price_at_purchase = models.DecimalField(max_digits=10, decimal_places=2)
    seller = models.ForeignKey('User', on_delete=models.SET_NULL, null=True, related_name='sales')
    # Direct-pay marketplace: buyers pay each seller off-platform (M-Pesa, till,
    # bank), so there is no payment webhook to trust. The seller confirming
    # receipt for their own lines is what marks this item paid.
    payment_confirmed_at = models.DateTimeField(null=True, blank=True)
    # Separate from the timestamp above so inventory can only ever move once,
    # whichever path (seller confirmation or Stripe) triggered it.
    stock_committed = models.BooleanField(default=False)

    class Meta:
        ordering = ['-id']

    def __str__(self):
        return f"{self.quantity} x {self.product.title if self.product else '[Deleted Product]'}"

    @property
    def total_price(self):
        return self.price_at_purchase * self.quantity

    def commit_stock(self):
        """Decrement this line's product inventory exactly once. Caller must
        already hold an atomic block. Returns True if it actually committed."""
        if self.stock_committed or self.product_id is None:
            return False
        locked = Product.objects.select_for_update().get(pk=self.product_id)
        locked.quantity = max(0, locked.quantity - self.quantity)
        locked.save(update_fields=['quantity'])
        self.stock_committed = True
        self.save(update_fields=['stock_committed'])
        return True

    def release_stock(self):
        """Give inventory back — an order cancelled after the seller had already
        confirmed payment. Caller must already hold an atomic block."""
        if not self.stock_committed or self.product_id is None:
            return False
        locked = Product.objects.select_for_update().get(pk=self.product_id)
        locked.quantity = locked.quantity + self.quantity
        locked.save(update_fields=['quantity'])
        self.stock_committed = False
        self.save(update_fields=['stock_committed'])
        return True

# Product Review Model
class ProductReview(models.Model):
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='reviews')
    reviewer = models.ForeignKey('User', on_delete=models.CASCADE, related_name='product_reviews')
    rating = models.PositiveIntegerField(choices=[(i, str(i)) for i in range(1, 6)])
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('product', 'reviewer')
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Review by {self.reviewer.username} for {self.product.title}"

# Wishlist Model
class Wishlist(models.Model):
    user = models.OneToOneField('User', on_delete=models.CASCADE, related_name='wishlist')
    products = models.ManyToManyField(Product, related_name='wishlisted_by')
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Wishlist of {self.user.username}"



class LiveEvent(models.Model):
    user = models.ForeignKey(
        'User', 
        on_delete=models.CASCADE, 
        related_name='live_events',
        help_text="The user who created this live event"
    )
    youtube_url = models.URLField(
        max_length=500,
        help_text="URL of the YouTube live stream"
    )
    title = models.CharField(
        max_length=200,
        help_text="Title of the live event"
    )
    description = models.TextField(
        blank=True, 
        null=True,
        help_text="Detailed description of the event"
    )
    thumbnail = models.URLField(
        blank=True, 
        null=True,
        help_text="Thumbnail image URL for the event"
    )
    is_live = models.BooleanField(
        default=True,
        help_text="Whether the event is currently live"
    )
    start_time = models.DateTimeField(
        auto_now_add=True,
        help_text="When the event started"
    )
    end_time = models.DateTimeField(
        blank=True, 
        null=True,
        help_text="When the event ended"
    )
    viewers_count = models.PositiveIntegerField(
        default=0,
        help_text="Number of viewers who watched this event"
    )
    
    class Meta:
        ordering = ['-start_time']
        verbose_name = "Live Event"
        verbose_name_plural = "Live Events"
        
    def __str__(self):
        return f"{self.title} by {self.user.username}"
    
    def clean(self):
        """Validate the YouTube URL before saving"""
        super().clean()
        if not self.extract_youtube_id(self.youtube_url):
            raise ValidationError({
                'youtube_url': "Please enter a valid YouTube URL in one of these formats:\n"
                "- https://www.youtube.com/watch?v=VIDEO_ID\n"
                "- https://www.youtube.com/live/VIDEO_ID\n"
                "- https://youtu.be/VIDEO_ID"
            })
    
    def is_active(self):
        """Model-level active check"""
        if self.is_live:
            return True
        if self.end_time:
            return (timezone.now() - self.end_time).total_seconds() < 86400
        return False
    @staticmethod
    def extract_youtube_id(url=None):
        """
        Extract YouTube ID from URL, works as both instance and static method
        """
        if url is None:
            raise ValueError("URL parameter is required when called as static method")
            
        if not url:
            return None
            
        patterns = [
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]{11})',
            r'(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]{11})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    def get_embed_url(self):
        """Generate YouTube embed URL with enhanced parameters"""
        video_id = self.extract_youtube_id(self.youtube_url)  # Pass the URL here
        if video_id:
            return (
                f"https://www.youtube.com/embed/{video_id}?"
                "autoplay=1&rel=0&modestbranding=1"
            )
        return None
    
    def save(self, *args, **kwargs):
        """Override save to ensure validation and set thumbnail"""
        self.full_clean()
        
        # Always try to set thumbnail if not provided
        if not self.thumbnail:
            video_id = self.extract_youtube_id(self.youtube_url)
            if video_id:
                # Try multiple thumbnail qualities
                thumbnail_options = [
                    f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
                    f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
                    f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                    f"https://img.youtube.com/vi/{video_id}/default.jpg"
                ]
                
                # Set the first available thumbnail
                for thumb_url in thumbnail_options:
                    if self.thumbnail_exists(thumb_url):
                        self.thumbnail = thumb_url
                        break
        
        super().save(*args, **kwargs)
    def thumbnail_exists(self, url):
        """Check if thumbnail URL is valid"""
        try:
            response = requests.head(url, timeout=2)
            return response.status_code == 200
        except:
            return False


class Publication(models.Model):
    """A long-form article / book that a user publishes. Content lives in
    ordered Chapters (markdown). Drafts are visible only to the author."""
    # Soft-removed by a moderator (remove_content). Excluded from public
    # queries; the row and its author survive so it can be restored.
    is_removed = models.BooleanField(default=False, db_index=True)
    STATUS_CHOICES = [('draft', 'Draft'), ('published', 'Published')]
    CATEGORY_CHOICES = [
        ('devotional', 'Devotional'),
        ('doctrine', 'Doctrine'),
        ('testimony', 'Testimony'),
        ('health', 'Health'),
        ('prophecy', 'Prophecy'),
        ('family', 'Family'),
        ('history', 'History'),
        ('other', 'Other'),
    ]

    title = models.CharField(max_length=200)
    summary = models.TextField(blank=True)
    # Cover stored as a small base64 data URI (or blank to use a default).
    # Media reference: absolute URL (R2). Inline article-body images remain
    # base64 data URIs for now.
    cover = models.CharField(max_length=500, blank=True)
    # Reading look chosen by the author: {bg, text, font, scale}. Empty = default.
    theme = models.JSONField(default=dict, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='other')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='publications')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class Chapter(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='chapters')
    order = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)  # markdown

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.publication_id} · {self.order}. {self.title}"


class PublicationLike(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='likes')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='publication_likes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('publication', 'user')


class PublicationBookmark(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='bookmarks')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='publication_bookmarks')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('publication', 'user')


class ReadingProgress(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='progresses')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reading_progress')
    last_chapter = models.PositiveIntegerField(default=0)  # chapter index
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('publication', 'user')


class LiveBroadcast(models.Model):
    """An in-app live broadcast (meet = audio, tv = video). Media is never stored
    — only this metadata. The actual audio/video flows through LiveKit (the SFU)."""
    KIND_CHOICES = [('meet', 'Meet'), ('tv', 'Go-Live')]
    STATUS_CHOICES = [('live', 'Live'), ('ended', 'Ended')]

    host = models.ForeignKey(User, on_delete=models.CASCADE, related_name='broadcasts')
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default='meet')
    title = models.CharField(max_length=200)
    room_name = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='live')
    viewer_count = models.PositiveIntegerField(default=0)
    peak_viewer_count = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    @property
    def duration_seconds(self):
        """Wall-clock length once ended; None while still live."""
        if not self.ended_at:
            return None
        return int((self.ended_at - self.started_at).total_seconds())

    class Meta:
        ordering = ['-started_at']
        indexes = [models.Index(fields=['status', '-started_at'])]

    def __str__(self):
        return f"{self.host.username} — {self.title} ({self.kind}, {self.status})"


class CoHostRequest(models.Model):
    """A viewer's request to join a broadcast as a co-host (TikTok-live style)."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('left', 'Left'),
    ]
    broadcast = models.ForeignKey(LiveBroadcast, on_delete=models.CASCADE, related_name='cohost_requests')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='cohost_requests')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['broadcast', 'status'])]
        # One request row per (broadcast, user) — get_or_create relies on this and
        # it prevents duplicate rows under concurrent requests.
        unique_together = ('broadcast', 'user')

    def __str__(self):
        return f"{self.user.username} -> {self.broadcast_id} ({self.status})"