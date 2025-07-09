
from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.utils.text import slugify
from django.core.validators import FileExtensionValidator
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator
from django.utils import timezone
from urllib.parse import urlparse, parse_qs
import re


# Custom User Model
class User(AbstractUser):
    bio = models.TextField(blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    followers = models.ManyToManyField(
        'self', symmetrical=False, related_name='followed_by', blank=True
    )
    # is_artist = models.BooleanField(default=False)

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


# Track Model
class Track(models.Model):
    title = models.CharField(max_length=100)
    artist = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tracks')
    album = models.CharField(max_length=100, blank=True, null=True)
    audio_file = models.FileField(upload_to='audio/')  # Use a descriptive name
    cover_image = models.ImageField(upload_to='covers/', blank=True, null=True)
    lyrics = models.TextField(blank=True, null=True)
    slug = models.SlugField(unique=True)
    is_favorite = models.BooleanField(default=False)
    views = models.PositiveIntegerField(default=0)
    downloads = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ['-created_at']
    # favorites = models.ManyToManyField(User, related_name='favorite_tracks', blank=True)

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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
    picture = models.ImageField(upload_to='profiles/', blank=True, null=True)

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
    media_file = models.FileField(
        upload_to='social_media/',
        validators=[
            FileExtensionValidator(
                allowed_extensions=['mp4', 'mov', 'avi', 'jpg', 'jpeg', 'png']
            )
        ]
    )
    song = models.ForeignKey(
        Track, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        help_text="Optional song for image posts"
    )
    caption = models.TextField(blank=True)
    tags = models.CharField(max_length=200, blank=True)
    location = models.CharField(max_length=100, blank=True)
    duration = models.DurationField(
        null=True,
        blank=True,
        help_text="Duration for video posts (max 1 minute)"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s {self.content_type} post"

    def clean(self):
        super().clean()
        if self.content_type == 'video':
            ext = os.path.splitext(self.media_file.name)[1].lower()
            if ext not in ['.mp4', '.mov', '.avi']:
                raise ValidationError("Invalid video format")
            if self.duration and self.duration > timedelta(minutes=1):
                raise ValidationError("Video cannot exceed 1 minute")
        elif self.content_type == 'image' and self.song:
            ext = os.path.splitext(self.song.audio_file.name)[1].lower()
            if ext not in ['.mp3', '.wav', '.ogg']:
                raise ValidationError("Invalid audio format")

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
    created_at = models.DateTimeField(auto_now_add=True)

class PostSave(models.Model):
    post = models.ForeignKey(SocialPost, on_delete=models.CASCADE, related_name='saves')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_posts')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('post', 'user')

class Notification(models.Model):
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_notifications')
    message = models.TextField()
    read = models.BooleanField(default=False)
    notification_type = models.CharField(max_length=50)  # e.g., 'like', 'comment', 'follow'
    post = models.ForeignKey(SocialPost, null=True, blank=True, on_delete=models.CASCADE)
    track = models.ForeignKey(Track, null=True, blank=True, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.sender.username} -> {self.recipient.username}: {self.message}"


class Church(models.Model):
    name = models.CharField(max_length=200)
    continent = models.CharField(max_length=100)
    country = models.CharField(max_length=100)
    county = models.CharField(max_length=100, blank=True, null=True)
    conference = models.CharField(max_length=200)
    district = models.CharField(max_length=200, blank=True, null=True)
    location = models.CharField(max_length=300)
    members = models.PositiveIntegerField(default=0)
    pastor = models.CharField(max_length=200, blank=True, null=True)
    contact = models.CharField(max_length=100, blank=True, null=True)
    image = models.ImageField(upload_to='churches/', blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='churches')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['-created_at']


class Videostudio(models.Model):
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
    
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    location = models.CharField(max_length=300)
    contact_phone = models.CharField(max_length=20, blank=True, null=True)
    contact_email = models.EmailField(blank=True, null=True)
    logo = models.ImageField(upload_to='videostudios/logos/', blank=True, null=True)
    cover_image = models.ImageField(upload_to='videostudios/covers/', blank=True, null=True)
    whatsapp_number = models.CharField(max_length=20, blank=True, null=True)
    service_types = models.JSONField(
        default=list,
        blank=True,
        null=True,
        help_text="List of service types the studio offers (stored as JSON array)"
    )
    youtube_link = models.URLField(blank=True, null=True)
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
            
            # Validate each service type
            invalid = [s for s in self.service_types 
                      if s not in self.SERVICE_TYPE_CHOICES]
            if invalid:
                raise ValidationError({
                    'service_types': f'Invalid service types: {", ".join(invalid)}. '
                                  f'Valid options: {", ".join(self.SERVICE_TYPE_CHOICES)}'
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
    profile_image = models.ImageField(upload_to='choirs/profiles/', blank=True, null=True)
    cover_image = models.ImageField(upload_to='choirs/covers/', blank=True, null=True)
    founded_date = models.DateField(blank=True, null=True)
    youtube_link = models.URLField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='choirs')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        verbose_name_plural = "Choirs"
        ordering = ['-created_at']

class Group(models.Model):
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_groups')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cover_image = models.ImageField(upload_to='group_covers/', blank=True, null=True)
    is_private = models.BooleanField(default=True)
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

    class Meta:
        unique_together = ('group', 'user')

    def __str__(self):
        return f"{self.user.username} -> {self.group.name} ({self.status})"

class GroupPost(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name='posts')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Post in {self.group.name} by {self.user.username}"

class GroupPostAttachment(models.Model):
    ATTACHMENT_TYPES = (
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('document', 'Document'),
    )
    
    post = models.ForeignKey(GroupPost, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='group_posts/%Y/%m/%d/')
    file_type = models.CharField(max_length=10, choices=ATTACHMENT_TYPES)
    created_at = models.DateTimeField(auto_now_add=True)

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
    image = models.ImageField(upload_to='products/images/', validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png'])])
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
    
    buyer = models.ForeignKey('User', on_delete=models.CASCADE, related_name='purchases')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
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
    
    class Meta:
        ordering = ['-id']
    
    def __str__(self):
        return f"{self.quantity} x {self.product.title if self.product else '[Deleted Product]'}"
    
    @property
    def total_price(self):
        return self.price_at_purchase * self.quantity

# Product Review Model
class ProductReview(models.Model):
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