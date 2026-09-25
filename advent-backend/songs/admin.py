from django.contrib import admin
from .models import (
    User, Track, Playlist, Comment, Like, Category, Profile,
    SocialPost, PostLike, PostComment, PostSave, Notification,
    Videostudio, CommunityCategory, Group, GroupMember, GroupJoinRequest,
    GroupPost, GroupPostAttachment, ProductCategory, Product, ProductImage,
    Cart, CartItem, Order, OrderItem, ProductReview, Wishlist, LiveEvent,
    Report, AdminActionLog, Appeal, Role, LiveBroadcast, CoHostRequest, Publication,
    Organization, ServiceVerification, ServiceReview,
)

admin.site.register(LiveBroadcast)
admin.site.register(CoHostRequest)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    """Organisation accounts. The verified tick is set here once it's
    confirmed who runs the organisation."""
    list_display = ('id', 'name', 'kind', 'location', 'is_verified', 'created_by', 'created_at')
    list_filter = ('kind', 'is_verified')
    list_editable = ('is_verified',)
    search_fields = ('name', 'slug', 'location')
    raw_id_fields = ('created_by', 'followers')


@admin.register(Publication)
class PublicationAdmin(admin.ModelAdmin):
    """Books. Editor's picks are chosen here: select books and run "Make
    editor's pick" — the most recent picks lead Discover."""
    list_display = ('id', 'title', 'author', 'status', 'category', 'featured_at', 'is_removed', 'published_at')
    list_filter = ('status', 'category', 'is_removed')
    search_fields = ('title', 'author__username')
    raw_id_fields = ('author',)
    actions = ['make_pick', 'drop_pick']

    @admin.action(description="Make editor's pick")
    def make_pick(self, request, queryset):
        from django.utils import timezone
        queryset.filter(status='published', is_removed=False).update(featured_at=timezone.now())

    @admin.action(description="No longer an editor's pick")
    def drop_pick(self, request, queryset):
        queryset.update(featured_at=None)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'created_at')
    search_fields = ('name',)


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
def _decide_verification(v, status, by, note=''):
    """Approve or refuse a service's request for the tick, and tell its owner."""
    from django.utils import timezone
    from .push import notify_user
    v.status, v.decided_by, v.decided_at = status, by, timezone.now()
    if note:
        v.decision_note = note[:500]
    v.save(update_fields=['status', 'decided_by', 'decided_at', 'decision_note'])
    s = v.service
    if status == ServiceVerification.APPROVED:
        Videostudio.objects.filter(pk=s.pk).update(is_verified=True)
        msg = f'{s.name} is now verified ✓'
    else:
        msg = f'{s.name} wasn’t verified' + (f': {v.decision_note}' if v.decision_note else '')
    notify_user(s.created_by, 'service_verified', msg, data={'type': 'service', 'service_id': s.id})


@admin.register(ServiceVerification)
class ServiceVerificationAdmin(admin.ModelAdmin):
    """Requests for the verified tick on a service. Look at the documents,
    then approve (select → "Approve"), or refuse: open it, write why in
    "Decision note", set the status to Rejected and save. The owner is told."""
    list_display = ('id', 'service', 'legal_name', 'registration_number', 'status', 'created_at', 'decided_at')
    list_filter = ('status',)
    search_fields = ('legal_name', 'registration_number', 'service__name')
    readonly_fields = ('service', 'requested_by', 'legal_name', 'registration_number', 'note', 'document_links',
                       'decided_by', 'decided_at', 'created_at')
    fields = readonly_fields + ('status', 'decision_note')
    actions = ['approve']

    @admin.display(description='Documents')
    def document_links(self, obj):
        from django.utils.html import format_html_join
        return format_html_join(' ', '<a href="{}" target="_blank">Document {}</a>',
                                ((u, i + 1) for i, u in enumerate(obj.documents or [])))

    @admin.action(description='Approve (gives the verified tick)')
    def approve(self, request, queryset):
        for v in queryset.select_related('service', 'service__created_by'):
            _decide_verification(v, ServiceVerification.APPROVED, request.user)

    def save_model(self, request, obj, form, change):
        before = ServiceVerification.objects.filter(pk=obj.pk).values_list('status', flat=True).first()
        if change and 'status' in form.changed_data and obj.status != before and obj.status != ServiceVerification.PENDING:
            _decide_verification(obj, obj.status, request.user, obj.decision_note)
        else:
            super().save_model(request, obj, form, change)


@admin.register(ServiceReview)
class ServiceReviewAdmin(admin.ModelAdmin):
    list_display = ('id', 'service', 'user', 'rating', 'is_removed', 'created_at')
    list_filter = ('rating', 'is_removed')
    raw_id_fields = ('service', 'user')


@admin.register(Videostudio)
class ServiceAdmin(admin.ModelAdmin):
    """Services. The verified tick and the Services home's featured row are
    set here: select listings and run "Feature on Services home"."""
    list_display = ('id', 'name', 'category', 'location', 'is_verified', 'featured_at', 'is_removed', 'created_at')
    list_filter = ('category', 'is_verified', 'is_removed')
    list_editable = ('is_verified',)
    search_fields = ('name', 'location', 'created_by__username')
    raw_id_fields = ('created_by',)
    actions = ['feature', 'unfeature']

    @admin.action(description='Feature on Services home')
    def feature(self, request, queryset):
        from django.utils import timezone
        queryset.update(featured_at=timezone.now())

    @admin.action(description='Stop featuring')
    def unfeature(self, request, queryset):
        queryset.update(featured_at=None)
admin.site.register(CommunityCategory)
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