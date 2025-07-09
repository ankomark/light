from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedSimpleRouter
from django.urls import path
from .views import (
    UserViewSet,
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
    ChurchViewSet, 
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
    LiveEventViewSet




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

]

urlpatterns += router.urls 
urlpatterns += tracks_router.urls 
urlpatterns += social_posts_router.urls
urlpatterns += groups_router.urls