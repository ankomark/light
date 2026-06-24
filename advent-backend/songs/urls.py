from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedSimpleRouter
from django.urls import path
from .views import (
    UserViewSet,
    AppealViewSet,
    TrackViewSet,
    PlaylistViewSet,
    ProfileViewSet,
    CommentViewSet,
    LikeViewSet,
    CategoryViewSet,
    SignUpView,
    FavoriteTracksView,
    SocialPostViewSet,
    PostLikeViewSet,
    PostCommentViewSet,
    PostSaveViewSet, 
    NotificationViewSet,
    DeviceTokenViewSet,
    ConversationViewSet,
    ExploreViewSet,
    PublicationViewSet,
    VerifyEmailView,
    ResendVerificationView,
    ForgotPasswordView,
    ResetPasswordView,
    ChangePasswordView,
    DeleteAccountView,
    NotificationPreferenceView,
    SessionsView,
    RevokeSessionView,
    RevokeOtherSessionsView,
    ExportDataView,
    AuthStatusView,
    CreatePaymentIntentView,
    StoryViewSet,
    ReportViewSet,
    ChurchViewSet,
    NoticeViewSet,
    AdminNoteViewSet,
    MediaStationViewSet,
    VideoStudioViewSet,
    ChoirViewSet,
    GroupViewSet,
    GroupJoinRequestViewSet, 
    GroupPostViewSet,
    WishlistViewSet,
    ProductReviewViewSet,
    OrderViewSet,
    CartViewSet,
    ProductCategoryViewSet,
    ProductViewSet,
    LiveEventViewSet,
    AvatarUploadView,
    TrackUploadView,
    SocialPostUploadView,
    CloudinarySignView,
    StripeWebhookView,
    AdminDashboardView,
    AdminAnalyticsView,
    AdminReportViewSet,
    AdminUserViewSet,
    AdminContentViewSet,
    AdminLogViewSet,
    AdminAppealViewSet,
    AdminRoleViewSet,
    LiveBroadcastViewSet,
    LiveKitWebhookView,
)

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'tracks', TrackViewSet)
router.register(r'playlists', PlaylistViewSet)
router.register(r'profiles', ProfileViewSet, basename='profiles')
router.register(r'likes', LikeViewSet)
router.register(r'categories', CategoryViewSet)
router.register(r'social-posts', SocialPostViewSet)
router.register(r'post-likes', PostLikeViewSet)
router.register(r'post-comments', PostCommentViewSet)
router.register(r'post-saves', PostSaveViewSet)
router.register(r'notifications', NotificationViewSet, basename='notifications')
router.register(r'churches', ChurchViewSet, basename='churches')
router.register(r'notices', NoticeViewSet, basename='notices')
router.register(r'admin-notes', AdminNoteViewSet, basename='admin-notes')
router.register(r'media-stations', MediaStationViewSet, basename='media-stations')
router.register(r'publications', PublicationViewSet, basename='publications')
router.register(r'video-studios', VideoStudioViewSet, basename='video-studios')
router.register(r'choirs', ChoirViewSet, basename='choirs')
router.register(r'groups', GroupViewSet, basename='groups')
router.register(r'group-join-requests', GroupJoinRequestViewSet, basename='group-join-requests')
router.register(r'group-posts', GroupPostViewSet, basename='group-posts')
router.register(r'marketplace/categories', ProductCategoryViewSet, basename='product-categories')
router.register(r'marketplace/products', ProductViewSet, basename='products')
router.register(r'marketplace/cart', CartViewSet, basename='cart')
router.register(r'marketplace/orders', OrderViewSet, basename='orders')
router.register(r'marketplace/wishlist', WishlistViewSet, basename='wishlist')
router.register(r'live-events', LiveEventViewSet, basename='live-events')
router.register(r'device-tokens', DeviceTokenViewSet, basename='device-tokens')
router.register(r'conversations', ConversationViewSet, basename='conversations')
router.register(r'explore', ExploreViewSet, basename='explore')
router.register(r'stories', StoryViewSet, basename='stories')
router.register(r'reports', ReportViewSet, basename='reports')
router.register(r'appeals', AppealViewSet, basename='appeals')
# Admin / moderation panel (gated by IsModerator / IsSuperAdmin in the views).
router.register(r'admin/reports', AdminReportViewSet, basename='admin-reports')
router.register(r'admin/users', AdminUserViewSet, basename='admin-users')
router.register(r'admin/content', AdminContentViewSet, basename='admin-content')
router.register(r'admin/logs', AdminLogViewSet, basename='admin-logs')
router.register(r'admin/appeals', AdminAppealViewSet, basename='admin-appeals')
router.register(r'admin/roles', AdminRoleViewSet, basename='admin-roles')
router.register(r'live/broadcasts', LiveBroadcastViewSet, basename='live-broadcasts')

# Nested routers
tracks_router = NestedSimpleRouter(router, r'tracks', lookup='track')
tracks_router.register(r'comments', CommentViewSet, basename='track-comments')

social_posts_router = NestedSimpleRouter(router, r'social-posts', lookup='post')
social_posts_router.register(r'comments', PostCommentViewSet, basename='post-comments')

# Group nested router
groups_router = NestedSimpleRouter(router, r'groups', lookup='group')
groups_router.register(r'join-requests', GroupJoinRequestViewSet, basename='group-join-requests')
groups_router.register(r'posts', GroupPostViewSet, basename='group-posts')
products_router = NestedSimpleRouter(router, r'marketplace/products', lookup='product')
products_router.register(r'reviews', ProductReviewViewSet, basename='product-reviews')

urlpatterns = [
    path('upload/sign/', CloudinarySignView.as_view(), name='cloudinary-sign'),
    path('auth/verify-email/', VerifyEmailView.as_view(), name='verify-email'),
    path('auth/resend-verification/', ResendVerificationView.as_view(), name='resend-verification'),
    path('auth/forgot-password/', ForgotPasswordView.as_view(), name='forgot-password'),
    path('auth/reset-password/', ResetPasswordView.as_view(), name='reset-password'),
    path('auth/status/', AuthStatusView.as_view(), name='auth-status'),
    path('auth/change-password/', ChangePasswordView.as_view(), name='change-password'),
    path('auth/delete-account/', DeleteAccountView.as_view(), name='delete-account'),
    path('auth/sessions/', SessionsView.as_view(), name='sessions'),
    path('auth/sessions/revoke/', RevokeSessionView.as_view(), name='session-revoke'),
    path('auth/sessions/revoke-others/', RevokeOtherSessionsView.as_view(), name='session-revoke-others'),
    path('auth/export-data/', ExportDataView.as_view(), name='export-data'),
    path('notification-preferences/', NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('profiles/update_me/', ProfileViewSet.as_view({'patch': 'update_me'}), name='profile-update-me'),
    path('admin/dashboard/', AdminDashboardView.as_view(), name='admin-dashboard'),
    path('live/webhook/', LiveKitWebhookView.as_view(), name='livekit-webhook'),
    path('admin/analytics/', AdminAnalyticsView.as_view(), name='admin-analytics'),
    path('marketplace/create-payment-intent/', CreatePaymentIntentView.as_view(), name='create-payment-intent'),
    path('marketplace/stripe-webhook/', StripeWebhookView.as_view(), name='stripe-webhook'),
    # Existing routes
    path('signup/', SignUpView.as_view(), name='signup'),
    path('tracks/<int:pk>/download/', TrackViewSet.as_view({'get': 'download'}), name='track-download'),
    path('tracks/upload/', TrackViewSet.as_view({'post': 'upload_track'}), name='track-upload'),
    path('tracks/favorites/', TrackViewSet.as_view({'get': 'get_favorites'}), name='track-favorites'),
    path('notifications/unread_count/', NotificationViewSet.as_view({'get': 'unread_count'}), name='notification-unread-count'),
    path('churches/my_churches/', ChurchViewSet.as_view({'get': 'my_churches'}), name='church-my-churches'),
    path('video-studios/my-studios/', VideoStudioViewSet.as_view({'get': 'my_videostudios'}), name='video-my-studios'),
    path('choirs/my-choirs/', ChoirViewSet.as_view({'get': 'my_choirs'}), name='choir-my-choirs'),
    path('choirs/<int:pk>/add-member/', ChoirViewSet.as_view({'post': 'add_member'}), name='choir-add-member'),
    path('choirs/<int:pk>/toggle-active/', ChoirViewSet.as_view({'post': 'toggle_active'}), name='choir-toggle-active'),
    path('choirs/<int:pk>/update-members/', ChoirViewSet.as_view({'post': 'update_members'}), name='choir-update-members'),
    
    
    # New group-related routes
    path('groups/<slug:slug>/request-join/', 
         GroupViewSet.as_view({'post': 'request_join'}), 
         name='group-request-join'),
    path('groups/<slug:slug>/members/', 
         GroupViewSet.as_view({'get': 'group_members'}), 
         name='group-members'),
    path('group-join-requests/<int:pk>/approve/', 
         GroupJoinRequestViewSet.as_view({'post': 'approve_request'}), 
         name='group-join-approve'),
    path('group-join-requests/<int:pk>/reject/', 
         GroupJoinRequestViewSet.as_view({'post': 'reject_request'}), 
         name='group-join-reject'),
     path('groups/<slug:slug>/check-membership/', GroupViewSet.as_view({'get': 'check_membership'}), name='group-check-membership'),
     #     path('groups/<slug:slug>/posts/', 
     #     GroupViewSet.as_view({'get': 'group_posts', 'post': 'group_posts'}), 
     #     name='group-posts'),

     path('marketplace/products/<slug:slug>/upload-images/', 
         ProductViewSet.as_view({'post': 'upload_images'}), 
         name='product-upload-images'),
    path('marketplace/cart/add-item/', 
         CartViewSet.as_view({'post': 'add_item'}), 
         name='cart-add-item'),
    path('marketplace/cart/checkout/', 
         CartViewSet.as_view({'post': 'checkout'}), 
         name='cart-checkout'),
    path('marketplace/orders/<int:pk>/update-status/', 
         OrderViewSet.as_view({'post': 'update_status'}), 
         name='order-update-status'),
    path('marketplace/wishlist/add-product/', 
         WishlistViewSet.as_view({'post': 'add_product'}), 
         name='wishlist-add-product'),
    path('marketplace/wishlist/remove-product/', 
         WishlistViewSet.as_view({'post': 'remove_product'}), 
         name='wishlist-remove-product'),
     # Add this to your urlpatterns
     path('marketplace/cart/items/<int:pk>/', 
          CartViewSet.as_view({'delete': 'destroy'}), 
          name='cart-item-delete'),
          
     path('live-events/featured/', 
         LiveEventViewSet.as_view({'get': 'featured'}), 
         name='live-event-featured'),
    path('api/upload/avatar/', AvatarUploadView.as_view(), name='avatar-upload'),
    path('api/upload/track/', TrackUploadView.as_view(), name='track-upload'),
    path('api/upload/post/', SocialPostUploadView.as_view(), name='post-upload'),
    path('users/<int:pk>/followers_count/', 
         UserViewSet.as_view({'get': 'followers_count'}), 
         name='user-followers-count'),
    path('users/<int:pk>/following_count/', 
         UserViewSet.as_view({'get': 'following_count'}), 
         name='user-following-count'),
    path('users/<int:pk>/followers/', 
         UserViewSet.as_view({'get': 'followers'}), 
         name='user-followers-list'),
    path('users/<int:pk>/following/', 
         UserViewSet.as_view({'get': 'following'}), 
         name='user-following-list'),

]

urlpatterns += router.urls 
urlpatterns += tracks_router.urls 
urlpatterns += social_posts_router.urls
urlpatterns += groups_router.urls