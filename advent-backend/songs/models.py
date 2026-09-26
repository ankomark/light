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
    # The blue tick on an artist's profile: set by an admin (the Django admin)
    # once they've confirmed who the account belongs to.
    is_verified_artist = models.BooleanField(default=False)

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

    # Lifetime likes across everything this user has published — social posts,
    # tracks and publications — shown as a stat on the profile (TikTok-style).
    # Denormalised because the alternative is three aggregate queries on every
    # profile read, and UserSerializer is nested inside list payloads. Kept in
    # sync by signals on Like / PostLike / PublicationLike; `recount_total_likes`
    # rebuilds it from scratch if it ever drifts.
    total_likes = models.PositiveIntegerField(default=0)

    # Self-service "deactivate" — a reversible hide the user controls themselves
    # (distinct from the moderation is_suspended and the is_active ban). The
    # account can still authenticate; logging back in auto-reactivates it.
    is_deactivated = models.BooleanField(default=False)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    # When they were last connected (the chat header's "last seen").
    last_seen_at = models.DateTimeField(null=True, blank=True)

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
    # The album's name as shown on the song (kept in step with `album_ref`
    # when the song is on an album; free text on older songs).
    album = models.CharField(max_length=100, blank=True, null=True)
    album_ref = models.ForeignKey('Album', null=True, blank=True, on_delete=models.SET_NULL, related_name='tracks')
    track_number = models.PositiveSmallIntegerField(null=True, blank=True)

    # ── Rights (songs/rights.py) ──
    # When the uploader confirmed they own the song or have permission to
    # share it — required for every upload since it was introduced.
    rights_confirmed_at = models.DateTimeField(null=True, blank=True)
    LICENSE_ALL_RIGHTS = 'all_rights_reserved'
    LICENSE_CHOICES = [
        (LICENSE_ALL_RIGHTS, 'All rights reserved'),
        ('public_domain', 'Public domain'),
        ('creative_commons', 'Creative Commons'),
    ]
    license = models.CharField(max_length=20, choices=LICENSE_CHOICES, default=LICENSE_ALL_RIGHTS)
    # Optional credits.
    composer = models.CharField(max_length=150, blank=True, default='')
    producer = models.CharField(max_length=150, blank=True, default='')
    rights_holder = models.CharField(max_length=150, blank=True, default='')   # "© owner"
    isrc = models.CharField(max_length=12, blank=True, default='')
    # Why a moderator took it down ('copyright' | 'policy'), when, and their
    # note — shown to the uploader, who can dispute it (Appeal kind=copyright).
    removed_reason = models.CharField(max_length=20, blank=True, default='')
    removed_at = models.DateTimeField(null=True, blank=True)
    removal_note = models.CharField(max_length=500, blank=True, default='')
    # audio_file = models.FileField(upload_to='audio/')  
    # cover_image = models.ImageField(upload_to='covers/', blank=True, null=True)
    # Media references: absolute URL (R2) or legacy Cloudinary public_id.
    audio_file = models.CharField(max_length=500)
    cover_image = models.CharField(max_length=500, blank=True, null=True)
    lyrics = models.TextField(blank=True, null=True)
    slug = models.SlugField(unique=True)
    # The play count: listens of 30s or more, bumped by PlayEvent ingestion
    # (TrackViewSet.plays). The name predates plays being counted at all.
    views = models.PositiveIntegerField(default=0)
    # Length, so rows can show "3:42" and the player a full seek bar before the
    # audio loads. Sent by the app on upload, learned from the first play, or
    # backfilled from the file (manage.py backfill_track_durations).
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    # ── Processed versions (songs/audio_processing.py, run by the job worker) ──
    # The upload is kept as `audio_file` and plays until processing is done;
    # after it, the app streams one of three loudness-matched AAC versions by
    # connection and quality setting. Covers get two small sizes for lists.
    PROCESSING_PENDING = 'pending'
    PROCESSING_READY = 'ready'
    PROCESSING_FAILED = 'failed'
    PROCESSING_CHOICES = [
        (PROCESSING_PENDING, 'Pending'),
        (PROCESSING_READY, 'Ready'),
        (PROCESSING_FAILED, 'Failed'),
    ]
    processing_status = models.CharField(
        max_length=10, choices=PROCESSING_CHOICES, default=PROCESSING_PENDING)
    audio_low = models.CharField(max_length=500, blank=True, default='')        # 64 kbps
    audio_standard = models.CharField(max_length=500, blank=True, default='')   # 128 kbps
    audio_high = models.CharField(max_length=500, blank=True, default='')       # 256 kbps
    # Integrated loudness of the upload before normalising (LUFS), for stats.
    loudness_lufs = models.FloatField(null=True, blank=True)
    # ~100 peaks in 0..1 for a waveform seek bar (only on the track detail).
    waveform = models.JSONField(null=True, blank=True)
    # The spectrum visualizer's data file (bass → treble, 10 times a second),
    # next to the audio versions in R2; see audio_processing.spectrum.
    spectrum = models.CharField(max_length=500, blank=True, default='')
    cover_small = models.CharField(max_length=500, blank=True, default='')     # 200px
    cover_medium = models.CharField(max_length=500, blank=True, default='')    # 600px
    # The audio_file / cover_image the versions above were made from, so an
    # edit that replaces either is noticed and processed again.
    processed_source = models.CharField(max_length=1100, blank=True, default='')
    downloads = models.PositiveIntegerField(default=0)
    # Soft moderation takedown — hidden from public lists, kept for admin/audit.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Set by the app's background uploader, once per upload attempt chain. A
    # retried upload (network blip, app killed and resumed) re-sends the same
    # key and gets the track it already created instead of a duplicate.
    client_id = models.CharField(max_length=64, null=True, blank=True)
    # A user's "favorites" are the tracks they've liked (the Like model);
    # there is no separate favorite relation.
    class Meta:
        ordering = ['-created_at']
        # The library list is ordered by -created_at on every page; the default
        # ordering alone doesn't create an index, so this was sorting the whole
        # table per request.
        indexes = [models.Index(fields=['-created_at'],
                                name='track_created_idx')]
        constraints = [
            models.UniqueConstraint(
                fields=['artist', 'client_id'],
                condition=models.Q(client_id__isnull=False),
                name='track_artist_client_id_uniq',
            ),
        ]

    def __str__(self):
        return f"{self.title} by {self.artist.username}"
   

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = self._unique_slug()
        super().save(*args, **kwargs)

    def _unique_slug(self):
        # slug is unique, and it used to be slugify(title) verbatim — so the
        # second "Amazing Grace" anyone uploaded failed with an IntegrityError.
        base = (slugify(self.title) or 'track')[:40]
        slug, n = base, 2
        while Track.objects.filter(slug=slug).exclude(pk=self.pk).exists():
            slug = f'{base}-{n}'
            n += 1
        return slug

    def __str__(self):
        return f'{self.title} - {self.artist.username}'


class Album(models.Model):
    """A release: an artist's songs as a set, in order (Track.album_ref and
    track_number). Only the artist's own songs go on it."""
    artist = models.ForeignKey(User, on_delete=models.CASCADE, related_name='albums')
    title = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True, default='')
    cover_image = models.CharField(max_length=500, blank=True, default='')
    release_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-release_date', '-created_at']
        indexes = [models.Index(fields=['artist', '-created_at'], name='album_artist_idx')]

    def __str__(self):
        return f'{self.title} by {self.artist.username}'


# Playlist Model
class Playlist(models.Model):
    """A listener's list of songs, in the order they arranged them.

    Visibility: private (only the owner), unlisted (anyone with the link —
    not shown on the profile), public (on the owner's profile too)."""
    PRIVATE = 'private'
    UNLISTED = 'unlisted'
    PUBLIC = 'public'
    VISIBILITY_CHOICES = [(PRIVATE, 'Private'), (UNLISTED, 'Unlisted'), (PUBLIC, 'Public')]

    name = models.CharField(max_length=100)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='playlists')
    description = models.CharField(max_length=300, blank=True, default='')
    # Optional custom cover; without one the app shows a collage of the first
    # four songs' covers.
    cover_image = models.CharField(max_length=500, blank=True, default='')
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default=PRIVATE)
    tracks = models.ManyToManyField(Track, related_name='playlists', blank=True, through='PlaylistTrack')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} by {self.user.username}'


class PlaylistTrack(models.Model):
    """A song's place in a playlist. The table is the one the plain
    many-to-many always used (migration 0125 adopted it), now with the order
    and when each song was added."""
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name='items')
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='playlist_items')
    position = models.PositiveIntegerField(default=0)
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'songs_playlist_tracks'
        unique_together = ('playlist', 'track')
        ordering = ['position', 'id']
        indexes = [models.Index(fields=['playlist', 'position'], name='playlisttrack_order_idx')]


# Comment Model
class Comment(models.Model):
    """A comment on a track. Same shape as PostComment — one-level reply
    threads, @mentions, denormalised reply/reaction counts — so the app runs
    one comment section for both."""
    content = models.TextField()
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies')
    reply_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    mentions = models.ManyToManyField(User, related_name='mentioned_in_track_comments', blank=True)
    replies_count = models.PositiveIntegerField(default=0)
    reactions_count = models.PositiveIntegerField(default=0)
    # Soft moderation takedown — hidden from public track-comment lists.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Newest first + a composite index so "a track's comments, newest first
        # + paginate" is an index range scan instead of a full table sort.
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['track', '-created_at'], name='trackcomment_track_created_idx'),
            models.Index(fields=['parent', 'created_at'], name='trackcomment_parent_idx'),
        ]

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
    """A music genre (Gospel, Hymns, Choir...). A song has one, picked on
    upload; the Music home lists the genres that have songs. Managed in the
    admin (the API is read-only); `slug` is the stable key the app uses (and
    translates the name by), `position` the order they're shown in."""
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=60, unique=True, null=True, blank=True)
    position = models.PositiveSmallIntegerField(default=100)

    tracks = models.ManyToManyField(Track, related_name='categories', blank=True)

    class Meta:
        ordering = ['position', 'name']

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


class Hashtag(models.Model):
    """A #tag, stored lowercase without the '#'. Posts link to it through
    SocialPost.hashtags, written from the caption on create/edit."""
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'#{self.name}'


class SocialPost(models.Model):
    CONTENT_TYPES = (
        ('video', 'Video'),
        ('image', 'Image'),
        # A book (or a passage from one) shared to the feed: drawn as a book
        # card; media_file / thumbnail carry its cover for grids.
        ('book', 'Book'),
    )
    # Who can see the post. Enforced by visible_posts_q() on every read path.
    VISIBILITY_PUBLIC = 'public'
    VISIBILITY_FOLLOWERS = 'followers'
    VISIBILITY_PRIVATE = 'private'
    VISIBILITY_CHOICES = (
        (VISIBILITY_PUBLIC, 'Everyone'),
        (VISIBILITY_FOLLOWERS, 'Followers'),
        (VISIBILITY_PRIVATE, 'Only me'),
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
    # Book posts: the book, and a passage from it when one was shared (with
    # where it is, to open the book there).
    publication = models.ForeignKey('Publication', null=True, blank=True, on_delete=models.CASCADE,
                                    related_name='feed_posts')
    book_quote = models.TextField(max_length=2000, blank=True, default='')
    book_chapter = models.ForeignKey('Chapter', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    book_block = models.PositiveIntegerField(null=True, blank=True)

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
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default=VISIBILITY_PUBLIC)
    comments_enabled = models.BooleanField(default=True)
    hashtags = models.ManyToManyField(Hashtag, related_name='posts', blank=True)
    mentions = models.ManyToManyField(User, related_name='mentioned_in_posts', blank=True)
    # Idempotency key from the background uploader (see Track.client_id).
    client_id = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'client_id'],
                condition=models.Q(client_id__isnull=False),
                name='socialpost_user_client_id_uniq',
            ),
        ]
        # Feed queries order by -created_at; index it for fast pagination.
        indexes = [
            models.Index(fields=['-created_at']),
            # Every author-scoped read walks this: the Following feed
            # (user_id IN followees ORDER BY -created_at), the ranked feed's
            # candidate pools (same shape, plus a created_at window), and the
            # profile grid. Without it each one seq-scans posts and sorts.
            models.Index(fields=['user', '-created_at'],
                         name='socialpost_user_created_idx'),
        ]

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
    # Replies are one level deep, TikTok-style: a reply to a reply is stored
    # under the same top-level comment, with `reply_to` naming who it answers
    # (so the app can show "▸ name").
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies')
    reply_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    mentions = models.ManyToManyField(User, related_name='mentioned_in_comments', blank=True)
    # Denormalised, kept in step by signals — the list reads them per row
    # without a COUNT per comment.
    replies_count = models.PositiveIntegerField(default=0)
    reactions_count = models.PositiveIntegerField(default=0)
    # Soft moderation takedown — hidden from public comment lists.
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest first (matches the app's optimistic top-insert), and the
        # composite index makes "comments for a post, newest first + paginate"
        # an index-only range scan instead of a full table sort.
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['post', '-created_at'], name='postcomment_post_created_idx'),
            # "Replies to this comment, oldest first" — the thread view.
            models.Index(fields=['parent', 'created_at'], name='postcomment_parent_created_idx'),
        ]


class TrackCommentReaction(models.Model):
    """CommentReaction's twin for track comments (same emoji set, same one-
    per-person rule)."""
    comment = models.ForeignKey('Comment', on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='track_comment_reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['comment', 'user'], name='trackcmtreaction_one_per_user'),
        ]
        indexes = [models.Index(fields=['comment', 'emoji'], name='trackcmtreaction_emoji')]


class CommentReaction(models.Model):
    """One reaction per person per comment. The heart is the default ("like");
    a long-press picks another from REACTIONS. Changing it replaces the row."""
    REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👏', '🔥', '🙌']
    LIKE = '❤️'

    comment = models.ForeignKey(PostComment, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comment_reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['comment', 'user'], name='commentreaction_one_per_user'),
        ]
        indexes = [models.Index(fields=['comment', 'emoji'], name='commentreaction_comment_emoji')]

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
    """A request to have a moderation action reviewed: a suspended user's
    (kind 'suspension'), or an uploader disputing a song's takedown (kind
    'copyright', with `track`) — a counter-notice."""
    KIND_SUSPENSION = 'suspension'
    KIND_COPYRIGHT = 'copyright'
    KIND_CHOICES = [(KIND_SUSPENSION, 'Suspension'), (KIND_COPYRIGHT, 'Song takedown')]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='appeals')
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_SUSPENSION)
    track = models.ForeignKey('Track', null=True, blank=True, on_delete=models.CASCADE, related_name='appeals')
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
    # The comment a reply / mention / reaction is about, so the tap can open
    # the post with that comment in view.
    comment = models.ForeignKey('PostComment', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    track_comment = models.ForeignKey('Comment', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
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
    # The sender's own id for it, so a retried send (a flaky network) is the
    # same message, not a second one.
    client_id = models.CharField(max_length=64, null=True, blank=True)
    # An answer to an earlier message in the same chat.
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    edited_at = models.DateTimeField(null=True, blank=True)
    # Deleted for everyone by its sender (the row stays: "This message was
    # deleted"); or taken down by a moderator after a report.
    is_deleted = models.BooleanField(default=False)
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        # Every read of a chat is "this conversation's messages by time": the
        # inbox's latest-message subqueries, opening a chat (newest 100), the
        # 3-second poll and scroll-up history. With only the FK index each of
        # those sorted the conversation's whole history first. A b-tree scans
        # either direction, so one index serves ASC and DESC.
        indexes = [
            models.Index(fields=['conversation', 'created_at'], name='message_conv_created_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['sender', 'client_id'], condition=models.Q(client_id__isnull=False),
                                    name='message_sender_client_id_uniq'),
        ]

    def __str__(self):
        return f"{self.sender.username}: {(self.content or self.message_type)[:50]}"


class MessageReaction(models.Model):
    """An emoji on a message — one per person (a new one replaces it)."""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='+')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user')


class MessageHide(models.Model):
    """A message someone deleted for themselves only."""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='+')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='+')

    class Meta:
        unique_together = ('message', 'user')


class ConversationState(models.Model):
    """One person's side of a chat: whether they've accepted it (a first
    message from someone they don't follow is a request until they do),
    muted it, archived it, or cleared it (messages up to cleared_before_id
    are gone for them)."""
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='states')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversation_states')
    accepted = models.BooleanField(default=True)
    muted = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    cleared_before_id = models.PositiveBigIntegerField(default=0)

    class Meta:
        unique_together = ('conversation', 'user')


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
    quiz = models.BooleanField(default=True)
    weather = models.BooleanField(default=True)
    verse = models.BooleanField(default=True)
    # New books and chapters from authors followed, books saved and being read.
    books = models.BooleanField(default=True)
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


def visible_posts_q(user, prefix=''):
    """Q() for the posts `user` may see under each post's own visibility
    setting: everyone's public posts, followers-only posts from accounts they
    follow, and all of their own. `prefix` points it at a relation (e.g.
    'post__' from a comment).

    This is the per-POST rule. The per-ACCOUNT rules (blocks, private
    accounts, deactivation) are separate and still apply on top of it."""
    # A book post lives while its book is out (unpublished or taken down: gone).
    book_ok = ~models.Q(**{f'{prefix}content_type': 'book'}) | models.Q(**{
        f'{prefix}publication__status': 'published', f'{prefix}publication__is_removed': False})
    public = models.Q(**{f'{prefix}visibility': SocialPost.VISIBILITY_PUBLIC}) & book_ok
    if not getattr(user, 'is_authenticated', False):
        return public
    Follow = User.followers.through
    follows_author = models.Exists(Follow.objects.filter(
        from_user_id=models.OuterRef(f'{prefix}user_id'), to_user_id=user.pk,
    ))
    return book_ok & (
        public
        | models.Q(**{f'{prefix}user_id': user.pk})
        | (models.Q(**{f'{prefix}visibility': SocialPost.VISIBILITY_FOLLOWERS}) & models.Q(follows_author))
    )


def can_view_post(user, post):
    """Whether `user` could open `post` — every rule the post endpoints apply:
    the post is up, its author's account is active and not private to them
    (or blocked either way), and the post's own visibility lets them in.

    Used to decide who a mention may notify. It used to check only the post's
    own setting, so a public post on a PRIVATE account notified people who
    don't follow it — and the notification then opened a post they weren't
    allowed to see ("Failed to load post details")."""
    if post.is_removed or getattr(post.user, 'is_deactivated', False):
        return False
    if getattr(user, 'is_authenticated', False) and post.user_id == user.pk:
        return True
    if not can_view_profile(user, post.user):
        return False
    if getattr(user, 'is_authenticated', False) and is_blocked_between(user, post.user):
        return False
    if post.visibility == SocialPost.VISIBILITY_PUBLIC:
        return True
    if not getattr(user, 'is_authenticated', False):
        return False
    if post.visibility == SocialPost.VISIBILITY_FOLLOWERS:
        return post.user.followers.filter(pk=user.pk).exists()
    return False


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


class ChartEntry(models.Model):
    """One row of a music chart, as last computed (songs/charts.py):
    'trending' (plays this week) or 'top' (the last four weeks), for the
    world (country '') or one country."""
    TRENDING = 'trending'
    TOP = 'top'
    chart = models.CharField(max_length=12)
    country = models.CharField(max_length=2, blank=True, default='')
    position = models.PositiveSmallIntegerField()
    track = models.ForeignKey('Track', on_delete=models.CASCADE, related_name='chart_entries')
    plays = models.PositiveIntegerField(default=0)
    computed_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['position']
        indexes = [models.Index(fields=['chart', 'country', 'position'], name='chart_lookup_idx')]


class Job(models.Model):
    """A unit of background work, queued in Postgres and run by
    `manage.py run_worker` (songs/jobs.py).

    Unlike songs/tasks.py's in-process thread pool, a job survives restarts
    and deploys, is retried with backoff when it fails, and can run on a
    worker process separate from the web server — what audio processing (a
    minute of FFmpeg per song) needs. `key` dedupes: queuing work that's
    already queued is a no-op."""
    QUEUED = 'queued'
    RUNNING = 'running'
    DONE = 'done'
    FAILED = 'failed'
    STATUS_CHOICES = [(QUEUED, 'Queued'), (RUNNING, 'Running'), (DONE, 'Done'), (FAILED, 'Failed')]

    kind = models.CharField(max_length=40)
    key = models.CharField(max_length=120, blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    run_after = models.DateTimeField(default=timezone.now)
    locked_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['status', 'run_after'], name='job_ready_idx'),
            models.Index(fields=['kind', 'key', 'status'], name='job_dedupe_idx'),
        ]

    def __str__(self):
        return f'{self.kind}:{self.key or self.pk} ({self.status})'


class PlayEvent(models.Model):
    """One listen of a track: how much was heard and how it ended.

    The app reports a listen at the 30-second mark and again when it ends
    (finished, skipped, or the player moved on), both under the same client
    `play_id`, so a report retried from the phone's offline outbox updates the
    row instead of adding a second one. A listen of 30s+ adds one to the
    track's play count (Track.views), once.

    The raw material for play counts, "Recently played", trending by plays,
    completion/skip rates for recommendations, and artist stats."""
    COUNT_AFTER_MS = 30000

    user = models.ForeignKey('User', on_delete=models.CASCADE, related_name='play_events')
    track = models.ForeignKey('Track', on_delete=models.CASCADE, related_name='play_events')
    play_id = models.CharField(max_length=64)
    ms_played = models.PositiveIntegerField(default=0)
    completed = models.BooleanField(default=False)
    # Ended before the 30s mark without finishing: a strong "not for me".
    skipped = models.BooleanField(default=False)
    # Added to the track's play count (at most once per listen).
    counted = models.BooleanField(default=False)
    # Where the listen started (library, profile, for_you, ...) and on what
    # connection — both optional, for stats.
    source = models.CharField(max_length=24, blank=True, default='')
    network = models.CharField(max_length=12, blank=True, default='')
    # The phone's region (ISO code, e.g. KE), for country charts.
    country = models.CharField(max_length=2, blank=True, default='')
    started_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'play_id'], name='playevent_user_play_uniq'),
        ]
        indexes = [
            models.Index(fields=['user', '-started_at'], name='playevent_user_recent_idx'),
            models.Index(fields=['track', '-started_at'], name='playevent_track_recent_idx'),
        ]


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
    # Photos of their work (R2 URLs, up to 12) — the service page's gallery.
    gallery = models.JSONField(default=list, blank=True)
    # When they're open, the week through: {"mon": ["08:00", "17:00"], …};
    # a day left out is closed. Empty = hours not given.
    opening_hours = models.JSONField(default=dict, blank=True)
    # Featured on the Services home since this time (set by staff in the
    # Django admin); null = not featured.
    featured_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Where it is on the map (the owner pins it: their phone's location, or a
    # place found by name) — for "near me" and the distance on a card.
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    # Run by an organisation (a church clinic, a school): its name and tick
    # on the listing, the listing on its page. Null = the person's own.
    organization = models.ForeignKey('Organization', null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name='services')
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


class ServiceReview(models.Model):
    """A rating (1–5) and, if they like, a few words about a service — one per
    person per service, never its owner's. The owner may answer once, in
    public (and change the answer)."""
    service = models.ForeignKey(Videostudio, on_delete=models.CASCADE, related_name='reviews')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='service_reviews')
    rating = models.PositiveSmallIntegerField()
    body = models.TextField(max_length=2000, blank=True, default='')
    reply = models.TextField(max_length=2000, blank=True, default='')
    replied_at = models.DateTimeField(null=True, blank=True)
    is_removed = models.BooleanField(default=False)     # a moderator's takedown
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('service', 'user')
        ordering = ['-updated_at', '-id']


class ServiceVerification(models.Model):
    """A service's request for the verified tick: who they are (a registered
    name, a licence or registration number) and photos of the papers.
    Staff decide in the Django admin; approving gives the tick."""
    PENDING, APPROVED, REJECTED = 'pending', 'approved', 'rejected'
    STATUSES = [(PENDING, 'Pending'), (APPROVED, 'Approved'), (REJECTED, 'Rejected')]
    service = models.ForeignKey(Videostudio, on_delete=models.CASCADE, related_name='verifications')
    requested_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    legal_name = models.CharField(max_length=200)
    registration_number = models.CharField(max_length=100, blank=True, default='')
    note = models.TextField(max_length=2000, blank=True, default='')
    documents = models.JSONField(default=list, blank=True)            # R2 URLs, up to 4
    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING, db_index=True)
    decision_note = models.CharField(max_length=500, blank=True, default='')   # why, if refused
    decided_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.service_id} · {self.legal_name} · {self.status}'


class SavedService(models.Model):
    """A service someone kept to come back to."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_services')
    service = models.ForeignKey(Videostudio, on_delete=models.CASCADE, related_name='saves')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'service')
        ordering = ['-created_at']


class ServiceBooking(models.Model):
    """A request to a service: a booking (a day, perhaps a time) or a quote —
    with a note. The provider accepts or declines (with a word); the one who
    asked can cancel while it waits or after it's accepted."""
    BOOKING, QUOTE = 'booking', 'quote'
    KINDS = [(BOOKING, 'Booking'), (QUOTE, 'Quote')]
    PENDING, ACCEPTED, DECLINED, CANCELLED = 'pending', 'accepted', 'declined', 'cancelled'
    STATUSES = [(PENDING, 'Waiting'), (ACCEPTED, 'Accepted'), (DECLINED, 'Declined'), (CANCELLED, 'Cancelled')]
    service = models.ForeignKey(Videostudio, on_delete=models.CASCADE, related_name='bookings')
    customer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='service_bookings')
    kind = models.CharField(max_length=10, choices=KINDS, default=BOOKING)
    date = models.DateField(null=True, blank=True)
    time = models.CharField(max_length=5, blank=True, default='')           # HH:MM
    note = models.TextField(max_length=1000, blank=True, default='')
    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING, db_index=True)
    reply_note = models.CharField(max_length=500, blank=True, default='')
    responded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['service', '-created_at'], name='svcbook_svc_created_idx')]


class ServiceEvent(models.Model):
    """How a service is found and reached, counted per day: page views,
    calls, WhatsApp, messages, directions, shares. Totals only — never who."""
    KINDS = ('view', 'call', 'whatsapp', 'message', 'directions', 'share')
    service = models.ForeignKey(Videostudio, on_delete=models.CASCADE, related_name='events')
    kind = models.CharField(max_length=12)
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('service', 'kind', 'day')

class CommunityCategory(models.Model):
    """A kind of community — Church, Choir, News, Youth, and whatever people
    invent next. Communities used to be hardcoded as separate Choir/Church
    models, which meant shipping a migration to allow a new kind; a category is
    a row, so anyone can start one.

    `field_schema` describes the extra fields a community of this kind carries
    (a church has a conference and a pastor, a choir has a genre). It drives
    both the create form and the directory filters, so a user-created category
    gets the same treatment as a built-in one without any code change."""
    # Field descriptor keys: key, label, type (text|email|tel|url|date),
    # filterable (offered as a directory filter), searchable (included in ?search=).
    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True, default='')
    # Ionicons glyph name, so the picker and cards can show a per-kind icon.
    icon = models.CharField(max_length=40, blank=True, default='people')
    # Built-ins ship with the app and are protected from deletion; user-created
    # categories belong to their author.
    is_builtin = models.BooleanField(default=False)
    field_schema = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='community_categories',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_builtin', 'name']
        verbose_name_plural = 'Community categories'

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or 'category'
            slug, n = base, 1
            while CommunityCategory.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Group(models.Model):
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_groups')
    # Groups and communities share this engine (membership, chat, moderation)
    # but are separate features to a user: a group is a private circle you make
    # with people you know; a community is a public place — a church, a choir,
    # a news circle — that anyone can start and browse by category. Only
    # communities carry a category.
    KIND_GROUP = 'group'
    KIND_COMMUNITY = 'community'
    KIND_CHOICES = ((KIND_GROUP, 'Group'), (KIND_COMMUNITY, 'Community'))
    kind = models.CharField(
        max_length=12, choices=KIND_CHOICES, default=KIND_GROUP, db_index=True,
    )
    # What kind of community this is. Null means uncategorised — kept nullable
    # so deleting a category never cascades away the communities using it.
    category = models.ForeignKey(
        CommunityCategory, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='communities',
    )
    # Values for the category's `field_schema` (conference/pastor for a church,
    # genre/youtube for a choir). JSON rather than columns so a category someone
    # invents carries its own fields without a schema migration.
    details = models.JSONField(default=dict, blank=True)
    # Optional containment between communities — a choir belongs to a church.
    # Replaces the old Choir.church FK.
    parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children',
    )
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
    # Moderators can moderate content (delete any message, pin) but not manage
    # membership or group settings — a middle tier between member and admin.
    is_moderator = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(null=True, blank=True)  # for unread counts
    # No pushes from this group until then (far future = always). Mentions of
    # them still come through.
    muted_until = models.DateTimeField(null=True, blank=True)

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


class GroupAuditLog(models.Model):
    """Admin/moderator accountability trail for a group — who did what (delete a
    message, pin, change roles, remove a member, approve a join, etc.). Visible
    only to the group's admins/moderators."""
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='audit_logs')
    actor = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    action = models.CharField(max_length=40)      # machine key, e.g. 'delete_message'
    detail = models.CharField(max_length=300, blank=True, default='')  # human summary
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['group', '-created_at'])]

    def __str__(self):
        return f"{self.group_id}:{self.action} by {self.actor_id}"


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
    # The sender's own id for this message: a retried send (a flaky network)
    # is the same message, never a second one.
    client_id = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'client_id'], condition=models.Q(client_id__isnull=False),
                                    name='uniq_grouppost_client_id'),
        ]
        indexes = [models.Index(fields=['group', 'created_at', 'id'], name='grouppost_group_time')]

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


class Organization(models.Model):
    """A conference, union, church, school, publishing house or ministry — an
    account people run together, under whose name books are published.

    Members (OrganizationMember): the owner and admins run it (profile,
    members); editors also edit every book published under it; authors may
    publish their own books under its name. The verified tick is set by
    staff in the Django admin once it's confirmed who runs it."""
    KINDS = [
        ('conference', 'Conference'), ('union', 'Union'), ('church', 'Church'), ('school', 'School'),
        ('publisher', 'Publishing house'), ('ministry', 'Ministry'), ('other', 'Other'),
    ]
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, unique=True)
    kind = models.CharField(max_length=20, choices=KINDS, default='other')
    description = models.TextField(max_length=2000, blank=True, default='')
    logo = models.CharField(max_length=500, blank=True, default='')        # R2 URL
    website = models.URLField(max_length=300, blank=True, default='')
    location = models.CharField(max_length=120, blank=True, default='')
    is_verified = models.BooleanField(default=False)
    followers = models.ManyToManyField(User, related_name='followed_organizations', blank=True)
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Discover's Publishers row is kept a few minutes: a tick given (or a
        # name or logo changed) shows at once.
        from django.core.cache import cache
        cache.delete('books:publishers')


class OrganizationMember(models.Model):
    """Someone in an organisation — invited, and counting once accepted."""
    OWNER, ADMIN, EDITOR, AUTHOR = 'owner', 'admin', 'editor', 'author'
    ROLES = [(OWNER, 'Owner'), (ADMIN, 'Admin'), (EDITOR, 'Editor'), (AUTHOR, 'Author')]
    MANAGE_ROLES = (OWNER, ADMIN)
    EDIT_ROLES = (OWNER, ADMIN, EDITOR)          # edit every book under its name

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='organization_memberships')
    role = models.CharField(max_length=10, choices=ROLES, default=AUTHOR)
    invited_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('organization', 'user')


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
    # An editor's pick since this time (set by staff in the Django admin);
    # null = not a pick. The most recent picks lead Discover.
    featured_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # When the author confirmed, on publishing, that the words are theirs to
    # publish (or they have permission). Publishing needs it once.
    rights_confirmed_at = models.DateTimeField(null=True, blank=True)
    # Published under an organisation's name (its imprint); null = the author's own.
    organization = models.ForeignKey(Organization, null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name='publications')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


_MD_IMAGE = re.compile(r'!\[[^\]]*\]\([^)]*\)')
_MD_LINK = re.compile(r'\[([^\]]*)\]\([^)]*\)')
_MD_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*")


class Chapter(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='chapters')
    order = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)  # markdown
    # Words of prose (images and markdown left out), kept at save so the book
    # page can show "N min read" without loading every chapter's body.
    word_count = models.PositiveIntegerField(default=0)
    # A draft chapter is the author's alone — a published book can carry
    # chapters still being written.
    DRAFT, PUBLISHED = 'draft', 'published'
    STATUS_CHOICES = [(DRAFT, 'Draft'), (PUBLISHED, 'Published')]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PUBLISHED)
    # Goes up whenever the title or text changes: a copy kept on a phone is
    # current exactly when its version matches.
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)
    # Taken down by a moderator: hidden from readers, kept (and marked) for
    # the author, and never brought back by the author's own saves.
    is_removed = models.BooleanField(default=False)
    # Serial publishing: a draft chapter set to go out at this time (the
    # worker publishes it and tells readers). Readers see it as "coming".
    publish_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['order', 'id']

    @staticmethod
    def count_words(body):
        """Words a reader reads: inline images (often long base64 data URIs)
        and link targets don't count."""
        text = _MD_IMAGE.sub(' ', body or '')
        text = _MD_LINK.sub(r'\1', text)
        return len(_MD_WORD.findall(text))

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


class ChapterRevision(models.Model):
    """A chapter as it was before a save changed it — the author's history,
    to look back at, compare and restore. Tied to its chapter by id, not a
    foreign key: the history outlives the chapter, so a deleted chapter (its
    history grouped still) can be brought back."""
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='revisions')
    chapter_ref = models.PositiveIntegerField()
    version = models.PositiveIntegerField()
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    word_count = models.PositiveIntegerField(default=0)
    # Why this copy was kept: 'edit' (replaced by a save), 'delete' (the
    # chapter was removed from the book), 'restore' (replaced by a restore).
    reason = models.CharField(max_length=10, default='edit')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    # Kept per chapter; older copies are dropped past this.
    KEEP = 50

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['publication', 'chapter_ref', '-created_at'], name='chrev_pub_ch_idx')]


class ReadingProgress(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='progresses')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reading_progress')
    last_chapter = models.PositiveIntegerField(default=0)  # chapter index
    # How far into that chapter (0–1), so another phone opens at the same place.
    position = models.FloatField(default=0)
    # How far through the book (0–1, by words), kept as reading is recorded —
    # shelves and cards show it without adding up chapters per row.
    percent = models.FloatField(default=0)
    # When the last chapter was read to its end (the "Finished" shelf).
    finished_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('publication', 'user')


class BookHighlight(models.Model):
    """A passage a reader marked in a book — a colour, a note, or both.

    Anchored to a paragraph (its place in the chapter) and its words, so it
    can be found again after the author edits: by place when the words still
    match, else by the words. Created on the phone with its own id
    (`client_id`), so it works offline and syncs later; a deletion is kept
    (`deleted`) until every phone has heard of it."""
    COLORS = ('yellow', 'green', 'blue', 'pink', 'orange')

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='book_highlights')
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='highlights')
    chapter = models.ForeignKey(Chapter, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    client_id = models.CharField(max_length=40)
    block = models.PositiveIntegerField(default=0)         # the paragraph's place in the chapter
    quote = models.TextField(max_length=2000)
    color = models.CharField(max_length=10, blank=True, default='')
    note = models.TextField(max_length=4000, blank=True, default='')
    # The reader's own shelf for it ("Prayer", "Sermon ideas"); blank = none.
    collection = models.CharField(max_length=60, blank=True, default='')
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        unique_together = ('user', 'client_id')
        ordering = ['-updated_at', '-id']
        indexes = [models.Index(fields=['user', 'publication', '-updated_at'], name='bookhl_user_pub_idx')]


class BookReview(models.Model):
    """A reader's rating (1–5) and, if they like, a few words — one per
    reader per book, from someone who has read some of it."""
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='reviews')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='book_reviews')
    rating = models.PositiveSmallIntegerField()
    body = models.TextField(max_length=4000, blank=True, default='')
    is_removed = models.BooleanField(default=False)     # a moderator's takedown
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('publication', 'user')
        ordering = ['-updated_at', '-id']


class PublicationCollaborator(models.Model):
    """Someone the author invited to work on a book.

    co-author: writes and edits everything but publishing, deleting and who
    is invited; editor: the same (the difference is how they're credited);
    viewer: reads the drafts. The invitation counts once accepted."""
    COAUTHOR, EDITOR, VIEWER = 'coauthor', 'editor', 'viewer'
    ROLES = [(COAUTHOR, 'Co-author'), (EDITOR, 'Editor'), (VIEWER, 'Viewer')]
    EDIT_ROLES = (COAUTHOR, EDITOR)

    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='collaborators')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='book_collaborations')
    role = models.CharField(max_length=10, choices=ROLES, default=EDITOR)
    invited_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('publication', 'user')
        ordering = ['created_at']


class PublicationExport(models.Model):
    """A book made into a file (EPUB) by the worker, for its author."""
    QUEUED, RUNNING, DONE, FAILED = 'queued', 'running', 'done', 'failed'
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='exports')
    requested_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    format = models.CharField(max_length=10, default='epub')
    status = models.CharField(max_length=10, default=QUEUED)
    url = models.CharField(max_length=500, blank=True, default='')
    error = models.CharField(max_length=300, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']


class BookClub(models.Model):
    """A group reading one book together, on a schedule. Built on a Group:
    the group is the club's membership and its chat; this adds the book and
    the reading plan (BookClubMilestone). One book per club at a time — a
    club can move on to its next book."""
    group = models.OneToOneField('Group', on_delete=models.CASCADE, related_name='book_club')
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='clubs')
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    starts_on = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class BookClubMilestone(models.Model):
    """"Read up to chapter N by this date" — the club's reading plan."""
    club = models.ForeignKey(BookClub, on_delete=models.CASCADE, related_name='milestones')
    through_chapter = models.PositiveIntegerField()        # index among the book's readers' chapters
    due = models.DateField()

    class Meta:
        ordering = ['due', 'through_chapter']


class AiAnswer(models.Model):
    """An AI answer kept so the same question is asked of the model once:
    keyed by what it was about (the chapter's version, the passage, the
    language), so any reader asking it again gets it at once."""
    key = models.CharField(max_length=64, unique=True)
    kind = models.CharField(max_length=20)
    publication = models.ForeignKey(Publication, null=True, blank=True, on_delete=models.CASCADE, related_name='+')
    result = models.JSONField(default=dict)
    model = models.CharField(max_length=60, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)


class AiUsage(models.Model):
    """How many AI answers a person has had made today (answers already
    kept don't count) — the daily limit."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='+')
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('user', 'day')


class ManuscriptCheck(models.Model):
    """The whole book read for inconsistencies (names, dates, facts that
    change between chapters) by the worker, for its writers."""
    QUEUED, RUNNING, DONE, FAILED = 'queued', 'running', 'done', 'failed'
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='checks')
    requested_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name='+')
    status = models.CharField(max_length=10, default=QUEUED)
    result = models.JSONField(default=dict, blank=True)
    error = models.CharField(max_length=300, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']


class ChapterComment(models.Model):
    """A comment in a chapter's discussion (one level of replies). Tied to its
    chapter, so a reader who hasn't got there yet is warned of spoilers."""
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='chapter_comments')
    chapter = models.ForeignKey(Chapter, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chapter_comments')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies')
    body = models.TextField(max_length=2000)
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['chapter', 'created_at'], name='chcomment_chapter_idx')]


class ReadingActivity(models.Model):
    """A reader's time in a chapter, one row per chapter per day — what
    progress, streaks and (in totals only) author analytics are built from.

    The app reports reading as it happens in small batches (and later, when
    it was offline); each report adds its seconds to the day's row and moves
    the furthest point read. One row a day keeps the table small however
    often the app reports."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reading_activity')
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name='reading_activity')
    chapter = models.ForeignKey(Chapter, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    chapter_index = models.PositiveIntegerField()
    day = models.DateField()
    seconds = models.PositiveIntegerField(default=0)
    furthest = models.FloatField(default=0)        # 0–1 of the chapter
    finished = models.BooleanField(default=False)  # reached its end
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'publication', 'chapter_index', 'day')
        indexes = [
            models.Index(fields=['publication', 'day'], name='readact_pub_day_idx'),
            models.Index(fields=['user', 'day'], name='readact_user_day_idx'),
        ]


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
    # Running total of ❤️ reactions the room received — persisted so the count
    # survives rejoins and reflects the whole session, not just what one viewer
    # saw. Incremented in batches via the `react` endpoint.
    like_count = models.PositiveIntegerField(default=0)
    # Current on-screen graphic (lower third / banner / name tag / ticker), or
    # null. Persisted so it survives a host reconnect and reaches late joiners in
    # the join payload. Shape: {"style": str, "title": str, "sub": str}.
    overlay = models.JSONField(null=True, blank=True, default=None)
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

# ── Bible corpus & the daily quiz ─────────────────────────────────────────────
class BibleVerse(models.Model):
    """One verse of the KJV, stored locally.

    The Bible reader fetches chapters live from bible-api.com, which is fine for
    reading but no basis for a quiz: generating twenty questions would mean
    twenty round trips, and a 'hard' question needs to pull distractors from the
    same book, which means having the book. So the text lives here — imported
    once (`manage.py import_bible`), then everything is a local query. KJV is
    public domain, so storing it carries no licensing problem."""
    book = models.CharField(max_length=40, db_index=True)
    # Canonical order (1 = Genesis, 66 = Revelation). Sorting by name is wrong
    # and testament is derived from this, so the number is worth storing.
    book_number = models.PositiveSmallIntegerField(db_index=True)
    chapter = models.PositiveSmallIntegerField()
    verse = models.PositiveSmallIntegerField()
    text = models.TextField()

    OLD_TESTAMENT_BOOKS = 39

    class Meta:
        unique_together = ('book', 'chapter', 'verse')
        ordering = ['book_number', 'chapter', 'verse']
        indexes = [
            models.Index(fields=['book_number', 'chapter']),
        ]

    @property
    def is_old_testament(self):
        return self.book_number <= self.OLD_TESTAMENT_BOOKS

    @property
    def reference(self):
        return f"{self.book} {self.chapter}:{self.verse}"

    def __str__(self):
        return self.reference


class DailyQuiz(models.Model):
    """One quiz per calendar day, shared by everyone.

    Built on first request for that date (there is no scheduler on this deploy)
    and kept, so a late player gets the same twenty questions as an early one —
    which is what makes a leaderboard mean anything."""
    date = models.DateField(unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        verbose_name_plural = 'Daily quizzes'

    def __str__(self):
        return f"Quiz for {self.date.isoformat()}"


class QuizQuestion(models.Model):
    """A generated question. `choices` is an ordered list of strings and
    `answer_index` points into it — the answer is never sent to the client."""
    SIMPLE, MODERATE, HARD = 'simple', 'moderate', 'hard'
    DIFFICULTY_CHOICES = ((SIMPLE, 'Simple'), (MODERATE, 'Moderate'), (HARD, 'Hard'))
    # How the question was built. Kept so the mix can be tuned and so a bad
    # generator can be identified from the data rather than guessed at.
    KIND_CHOICES = (
        ('book', 'Which book'),
        ('blank', 'Missing word'),
        ('reference', 'Which reference'),
        ('order', 'Which comes first'),
    )

    # Which part of scripture this came from. Derived from the verse's book at
    # generation, so it needs no curation — a table of editable categories can
    # replace this later if questions are ever authored by hand.
    CATEGORY_CHOICES = (
        ('law', 'The Law'), ('history', 'History'), ('wisdom', 'Wisdom'),
        ('major_prophets', 'Major Prophets'), ('minor_prophets', 'Minor Prophets'),
        ('gospels', 'Gospels'), ('acts', 'Acts'), ('epistles', 'Epistles'),
        ('revelation', 'Revelation'),
    )

    # A question belongs to exactly one of the two: the shared daily quiz, or a
    # single player's practice session. Same table, because a question is the
    # same thing either way — only who can see it differs.
    quiz = models.ForeignKey(
        DailyQuiz, on_delete=models.CASCADE, related_name='questions',
        null=True, blank=True,
    )
    session = models.ForeignKey(
        'QuizSession', on_delete=models.CASCADE, related_name='questions',
        null=True, blank=True,
    )
    order = models.PositiveSmallIntegerField()
    difficulty = models.CharField(max_length=10, choices=DIFFICULTY_CHOICES, db_index=True)
    category = models.CharField(
        max_length=20, choices=CATEGORY_CHOICES, blank=True, default='', db_index=True,
    )
    # What the player is shown after answering. For a blanked verse this is the
    # verse restored — genuinely worth reading. Never invented commentary.
    explanation = models.TextField(blank=True, default='')
    # Difficulty is worth more than a flat point: hard questions pay more.
    base_points = models.PositiveSmallIntegerField(default=10)
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    prompt = models.TextField()
    passage = models.TextField(blank=True, default='')      # the verse being asked about
    choices = models.JSONField(default=list)
    answer_index = models.PositiveSmallIntegerField()
    reference = models.CharField(max_length=80, blank=True, default='')  # revealed after answering

    class Meta:
        ordering = ['order']
        unique_together = (('quiz', 'order'), ('session', 'order'))
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(quiz__isnull=False, session__isnull=True)
                    | models.Q(quiz__isnull=True, session__isnull=False)
                ),
                name='question_belongs_to_one_owner',
            ),
        ]

    def __str__(self):
        return f"[{self.difficulty}] {self.prompt[:50]}"


class QuizAttempt(models.Model):
    """One person's run at one day's quiz. One attempt per person per day, so a
    score means the same thing for everyone on the board."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='quiz_attempts')
    quiz = models.ForeignKey(DailyQuiz, on_delete=models.CASCADE, related_name='attempts')
    # `score` counts correct answers; `points` is what the scoring rules award
    # (difficulty + speed + streak). The board ranks on points, but a plain
    # "17/20" is still what a person wants to read.
    score = models.PositiveSmallIntegerField(default=0)
    total = models.PositiveSmallIntegerField(default=0)
    points = models.PositiveIntegerField(default=0, db_index=True)
    longest_streak = models.PositiveSmallIntegerField(default=0)
    # {question_id: chosen_index} — the flat map, kept for quick lookups. The
    # per-question detail lives in QuizAnswer.
    answers = models.JSONField(default=dict)
    # Seconds taken, used only to break ties on the leaderboard.
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'quiz')
        ordering = ['-points', '-score', 'duration_seconds']
        indexes = [models.Index(fields=['quiz', '-points'])]

    def __str__(self):
        return f"{self.user.username}: {self.score}/{self.total} on {self.quiz.date}"


class QuizAnswer(models.Model):
    """One question, as one person answered it.

    The attempt already carries a flat {question: choice} map, which is enough
    to score but not to *learn* anything: it cannot say how long each answer
    took, where a streak broke, or which difficulty someone struggles with. A
    row per question is what turns a score into a profile."""
    # An answer belongs to a daily attempt or to a practice session — the same
    # record either way, so the analytics that read it need no special cases.
    attempt = models.ForeignKey(
        QuizAttempt, on_delete=models.CASCADE, related_name='answer_rows',
        null=True, blank=True,
    )
    session = models.ForeignKey(
        'QuizSession', on_delete=models.CASCADE, related_name='answer_rows',
        null=True, blank=True,
    )
    question = models.ForeignKey(QuizQuestion, on_delete=models.CASCADE, related_name='+')
    # Null when the question was left unanswered — distinct from a wrong answer.
    chosen_index = models.PositiveSmallIntegerField(null=True, blank=True)
    is_correct = models.BooleanField(default=False)
    points_earned = models.PositiveSmallIntegerField(default=0)
    # Seconds spent on this question, as reported by the client. Advisory only:
    # it shapes the speed bonus but is clamped, so a forged value cannot mint
    # points.
    response_seconds = models.FloatField(null=True, blank=True)
    # The streak this answer left behind, so a run can be replayed.
    streak_after = models.PositiveSmallIntegerField(default=0)

    class Meta:
        unique_together = (('attempt', 'question'), ('session', 'question'))
        ordering = ['question__order']
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(attempt__isnull=False, session__isnull=True)
                    | models.Q(attempt__isnull=True, session__isnull=False)
                ),
                name='answer_belongs_to_one_owner',
            ),
        ]

    def __str__(self):
        owner = self.attempt or self.session
        who = owner.user.username if owner else '?'
        return f"{who} q{self.question_id}: {'ok' if self.is_correct else 'x'}"


class QuizSession(models.Model):
    """One run of a practice mode — Speed Quiz or Streak.

    The daily quiz is shared and ranked, so it is one attempt per person per
    day. These are personal: play them as often as you like. They own their own
    questions, generated when the session starts, so two people never wait on
    the same set and nobody can look up someone else's answers.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='quiz_sessions')
    mode = models.CharField(max_length=12, db_index=True)
    # Filled in as the run proceeds — a session is scored answer by answer, not
    # in one submission at the end, because Streak has to know immediately.
    score = models.PositiveSmallIntegerField(default=0)
    answered = models.PositiveSmallIntegerField(default=0)
    points = models.PositiveIntegerField(default=0)
    streak = models.PositiveSmallIntegerField(default=0)
    longest_streak = models.PositiveSmallIntegerField(default=0)
    is_finished = models.BooleanField(default=False, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']
        indexes = [models.Index(fields=['user', 'mode', '-points'])]

    def __str__(self):
        return f"{self.user.username} · {self.mode} · {self.points} pts"


class QuizReminder(models.Model):
    """One row per person per day a morning reminder went out.

    Notification.sender is required, so a system nudge does not fit there
    without inventing a sender. This is cheaper anyway: it makes the send
    idempotent (a cron that fires twice cannot double-push) and leaves an audit
    of who was reminded and when.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='quiz_reminders')
    date = models.DateField(db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'date')
        ordering = ['-date']

    def __str__(self):
        return f"reminded {self.user.username} on {self.date}"


# ── Word puzzle ───────────────────────────────────────────────────────────────
class PuzzleTheme(models.Model):
    """A subject a word puzzle is built from — a group of books, a passage, or
    a topic searched across scripture.

    The words are never authored: `source` says where to draw them from and the
    generator reads the local corpus. So a new theme is a row, and it stays
    truthful to the text because it comes from the text.

        {"kind": "books",   "first": 1, "last": 5}       the Law
        {"kind": "passage", "book": "Psalms", "chapter": 23}
        {"kind": "topic",   "term": "faith"}
    """
    BOOKS, PASSAGE, TOPIC = 'books', 'passage', 'topic'

    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True, default='')
    icon = models.CharField(max_length=40, blank=True, default='book')
    source = models.JSONField(default=dict)
    # Lowest first — the order themes are offered in.
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class WordPuzzle(models.Model):
    """One level of one theme: a letter grid with words hidden in it.

    Shared, not per-player — everyone gets the same level 3 of Psalms, which is
    what lets progress and coin rewards mean the same thing for everyone. Built
    once on first request and kept.
    """
    theme = models.ForeignKey(PuzzleTheme, on_delete=models.CASCADE, related_name='puzzles')
    level = models.PositiveSmallIntegerField()
    size = models.PositiveSmallIntegerField()
    # The wheel: the letters every answer is spelled from, shuffled once so the
    # base word is not sitting in plain order.
    letters = models.CharField(max_length=12, blank=True, default='')
    # Rows of letters: ["ABCD", "EFGH", ...] — one string per row.
    grid = models.JSONField(default=list)
    # [{word, row, col, dr, dc}] — where each word sits. Never sent to the
    # client before it is found, or the puzzle solves itself.
    placements = models.JSONField(default=list)
    # Real words the wheel can spell that are *not* on the board. Finding one
    # pays a little and costs the puzzle nothing — it rewards curiosity instead
    # of punishing a guess, which is what keeps a stuck player playing.
    bonus_words = models.JSONField(default=list)
    # The verse the level's letters were drawn from, revealed once the board is
    # finished. Held back until then: the base word is in this text, so showing
    # it early would hand over the longest answer.
    verse = models.ForeignKey(
        'BibleVerse', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='puzzles',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('theme', 'level')
        ordering = ['theme__order', 'level']

    @property
    def words(self):
        return [p['word'] for p in self.placements]

    def __str__(self):
        return f"{self.theme.name} level {self.level}"


class PuzzleProgress(models.Model):
    """How far one person has got with one puzzle."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='puzzle_progress')
    puzzle = models.ForeignKey(WordPuzzle, on_delete=models.CASCADE, related_name='progress')
    # The words found so far, uppercase.
    found = models.JSONField(default=list)
    # Words a paid hint has pointed at. Kept apart from  so a hinted
    # word still has to be located, and so the reveal survives a reload — a
    # hint someone paid for must not evaporate.
    hinted = models.JSONField(default=list)
    # Bonus words found — kept apart from `found`, which decides completion.
    # A bonus word must never bring a level closer to finished.
    bonus = models.JSONField(default=list)
    hints_used = models.PositiveSmallIntegerField(default=0)
    coins_earned = models.PositiveIntegerField(default=0)
    is_complete = models.BooleanField(default=False, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('user', 'puzzle')
        ordering = ['-started_at']

    def __str__(self):
        return f"{self.user.username} · {self.puzzle} · {len(self.found)} found"


class CoinSpend(models.Model):
    """Coins going out.

    Until now coins only ever accumulated, so a total was a sum. A hint costs
    coins, which makes the number a balance — and a balance needs both sides
    written down. Every deduction is a row here, so what someone has can always
    be reconciled against what they earned and what they spent.
    """
    HINT = 'hint'
    REASON_CHOICES = ((HINT, 'Puzzle hint'),)

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='coin_spends')
    amount = models.PositiveIntegerField()
    reason = models.CharField(max_length=20, choices=REASON_CHOICES, default=HINT)
    # What it was spent on, for the audit trail.
    puzzle = models.ForeignKey(
        WordPuzzle, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['user', '-created_at'])]

    def __str__(self):
        return f"{self.user.username} -{self.amount} ({self.reason})"


class PlayDay(models.Model):
    """One row per person per day they played anything.

    The streak used to be counted from quiz attempts alone, which made it a
    quiz streak wearing a general name: a day spent on the puzzle broke it. A
    streak is a record of showing up, so it is recorded where showing up
    happens — every game writes a row, and the streak is read from here.

    Cheap by design: one `get_or_create` per play, at most one row per day.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='play_days')
    date = models.DateField()

    class Meta:
        unique_together = ('user', 'date')
        ordering = ['-date']
        indexes = [models.Index(fields=['user', '-date'])]

    def __str__(self):
        return f"{self.user.username} · {self.date}"


class BibleWord(models.Model):
    """A distinct word of the KJV, indexed for the word-connect puzzle.

    The puzzle needs to ask "which real words can be spelled from these
    letters?" — a question the verse table cannot answer quickly. This is that
    question's index: one row per distinct word, with its letters sorted so a
    candidate set can be narrowed by length and letter before the exact subset
    check runs.

    Built by `manage.py build_word_index` from the corpus, so the dictionary is
    scripture's own vocabulary and nothing else.
    """
    word = models.CharField(max_length=24, unique=True)
    length = models.PositiveSmallIntegerField(db_index=True)
    # Letters in alphabetical order — 'BREAD' -> 'ABDER'.
    letters = models.CharField(max_length=24, db_index=True)
    # How often it appears; common words make better puzzle answers than
    # something that occurs once in Chronicles.
    frequency = models.PositiveIntegerField(default=0, db_index=True)

    class Meta:
        ordering = ['-frequency', 'word']
        indexes = [models.Index(fields=['length', '-frequency'])]

    def __str__(self):
        return self.word


class WeatherPlace(models.Model):
    """The one place a person wants their weather for.

    Kept on the server, not just on the device, because the morning briefing is
    sent from a cron job that has no access to anyone's phone storage. One row
    per person: this is "my weather", not a list of saved cities.

    The coordinates are what the forecast is actually fetched with; the name is
    only what the notification calls the place.
    """
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name='weather_place',
    )
    name = models.CharField(max_length=120)
    # What locates the name: county or state, and the country. Stored so the
    # morning push can say "Kilimani, Nairobi County" rather than leaving a
    # neighbourhood to stand on its own — there are three Westlands.
    region = models.CharField(max_length=120, blank=True, default='')
    country = models.CharField(max_length=80, blank=True, default='')
    latitude = models.FloatField()
    longitude = models.FloatField()
    # Whether the daily morning briefing is wanted. Separate from having a
    # place: plenty of people want the screen without the push.
    briefing = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user__username']

    def __str__(self):
        return f"{self.user.username} · {self.name}"


class VerseSend(models.Model):
    """One row per person per day the verse of the day went out.

    The same idempotence as QuizReminder and WeatherBriefing: a cron that fires
    twice cannot send twice, and there is a record of what went where.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='verse_sends')
    date = models.DateField(db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'date')
        ordering = ['-date']

    def __str__(self):
        return f"{self.user.username} · {self.date}"


class WeatherBriefing(models.Model):
    """One row per person per day a morning briefing went out.

    The same idempotence trick as QuizReminder: a cron that fires twice cannot
    push twice, and there is an audit of what was sent.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='weather_briefings')
    date = models.DateField(db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'date')
        ordering = ['-date']

    def __str__(self):
        return f"{self.user.username} · {self.date}"
