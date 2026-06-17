from django.contrib import admin
from .models import (
    User, Track, Playlist, Comment, Like, Category, Profile,
    SocialPost, PostLike, PostComment, PostSave, Notification,
    Church, Videostudio, Choir, Group, GroupMember, GroupJoinRequest,
    GroupPost, GroupPostAttachment, ProductCategory, Product, ProductImage,
    Cart, CartItem, Order, OrderItem, ProductReview, Wishlist, LiveEvent,
    Report, AdminActionLog, Appeal,
)


@admin.register(Appeal)
class AppealAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'status', 'reviewed_by', 'created_at')
    list_filter = ('status',)
    search_fields = ('user__username', 'message')
    ordering = ('-created_at',)


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'email', 'admin_role', 'is_suspended', 'suspended_until', 'strikes', 'is_active', 'is_superuser', 'date_joined')
    list_filter = ('admin_role', 'is_suspended', 'is_active', 'is_superuser', 'is_email_verified')
    search_fields = ('username', 'email')
    list_editable = ('admin_role', 'is_suspended')
    ordering = ('-date_joined',)


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'reporter', 'content_type', 'object_id', 'reason', 'status', 'assigned_to', 'created_at')
    list_filter = ('status', 'reason', 'content_type')
    search_fields = ('reporter__username', 'description')
    ordering = ('-created_at',)
    actions = ('mark_resolved', 'mark_dismissed')

    @admin.action(description='Mark selected reports as resolved')
    def mark_resolved(self, request, queryset):
        queryset.update(status='resolved')

    @admin.action(description='Mark selected reports as dismissed')
    def mark_dismissed(self, request, queryset):
        queryset.update(status='dismissed')


@admin.register(AdminActionLog)
class AdminActionLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'actor', 'action', 'target_type', 'target_id', 'created_at')
    list_filter = ('action', 'target_type')
    search_fields = ('actor__username', 'reason')
    ordering = ('-created_at',)
    readonly_fields = ('actor', 'action', 'target_type', 'target_id', 'reason', 'created_at')


# Register all models
admin.site.register(Category)
admin.site.register(Profile)
admin.site.register(Track)
admin.site.register(Playlist)
admin.site.register(Comment)
admin.site.register(Like)
admin.site.register(SocialPost)
admin.site.register(PostLike)
admin.site.register(PostComment)
admin.site.register(PostSave)
admin.site.register(Notification)
admin.site.register(Church)
admin.site.register(Videostudio)
admin.site.register(Choir)
admin.site.register(Group)
admin.site.register(GroupMember)
admin.site.register(GroupJoinRequest)
admin.site.register(GroupPost)
admin.site.register(GroupPostAttachment)
admin.site.register(ProductCategory)
admin.site.register(Product)
admin.site.register(ProductImage)
admin.site.register(Cart)
admin.site.register(CartItem)
admin.site.register(Order)
admin.site.register(OrderItem)
admin.site.register(ProductReview)
admin.site.register(Wishlist)
admin.site.register(LiveEvent)