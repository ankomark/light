

# from rest_framework.routers import DefaultRouter
# from django.urls import path, include
# from .views import (
#     UserViewSet,
#     TrackViewSet,
#     PlaylistViewSet,
#     ProfileViewSet,
#     CommentViewSet,
#     LikeViewSet,
#     CategoryViewSet,
#     SignUpView,
#     FavoriteTracksView,
#     SocialPostViewSet,
#     PostLikeViewSet,
#     PostCommentViewSet,
#     PostSaveViewSet, 
#     # ProfileByUserView,
# )
# from .favorites import toggle_favorite
# from .views import FavoriteTracksView
# from rest_framework_nested.routers import NestedSimpleRouter
# from django.urls import path, include
# from rest_framework.routers import DefaultRouter
# # Base router
# router = DefaultRouter()
# router.register(r'users', UserViewSet)
# router.register(r'tracks', TrackViewSet)
# router.register(r'playlists', PlaylistViewSet)
# router.register(r'profiles', ProfileViewSet, basename='profiles')

# router.register(r'comments', CommentViewSet)
# router.register(r'likes', LikeViewSet)
# router.register(r'categories', CategoryViewSet)
# router.register(r'social-posts', SocialPostViewSet)

# router.register(r'post-likes', PostLikeViewSet)
# router.register(r'post-comments', PostCommentViewSet)
# router.register(r'post-saves', PostSaveViewSet)
# # Nested router for comments under tracks
# tracks_router = NestedSimpleRouter(router, r'tracks', lookup='track')
# tracks_router.register(r'comments', CommentViewSet, basename='track-comments')
# social_posts_router = NestedSimpleRouter(router, r'social-posts', lookup='post')
# social_posts_router.register(r'comments', PostCommentViewSet, basename='post-comments')
# # Additional routes
# urlpatterns = [
#     path('api/auth/signup/', SignUpView.as_view(), name='signup'),
#     path('tracks/<int:pk>/download/', TrackViewSet.as_view({'get': 'download'}), name='track-download'),
#     path('api/songs/tracks/<int:track_id>/favorite/', toggle_favorite, name='toggle_favorite'),
#     path('favorites/', FavoriteTracksView.as_view(), name='favorite-tracks'),
#     path('profiles/by_user/<int:user_id>/', ProfileViewSet.as_view({'get': 'by_user'}), name='profile-by-user'),
#     path('tracks/upload/', TrackViewSet.as_view({'post': 'upload_track'}), name='track-upload'),

#     # path('social-posts/<int:pk>/like/', SocialPostViewSet.as_view({'post': 'like'}), name='post-like'),
#     # path('social-posts/<int:pk>/comment/', SocialPostViewSet.as_view({'post': 'comment'}), name='post-comment'),
#     # path('social-posts/<int:pk>/save/', SocialPostViewSet.as_view({'post': 'save_post'}), name='post-save'),
#     # path('social-posts/<int:pk>/share/', SocialPostViewSet.as_view({'get': 'share'}), name='post-share'),
#     # path('social-posts/<int:pk>/download/', SocialPostViewSet.as_view({'get': 'download'}), name='post-download'),
# ]
# # Add router URLs
# urlpatterns += router.urls + tracks_router.urls + social_posts_router.urls

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
)

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'tracks', TrackViewSet)
router.register(r'playlists', PlaylistViewSet)
router.register(r'profiles', ProfileViewSet, basename='profiles')
# router.register(r'comments', CommentViewSet)
router.register(r'likes', LikeViewSet)
router.register(r'categories', CategoryViewSet)
router.register(r'social-posts', SocialPostViewSet)
router.register(r'post-likes', PostLikeViewSet)
router.register(r'post-comments', PostCommentViewSet)
router.register(r'post-saves', PostSaveViewSet)
router.register(r'notifications', NotificationViewSet, basename='notifications')

# Nested routers
tracks_router = NestedSimpleRouter(router, r'tracks', lookup='track')
# tracks_router.register(r'comments', CommentViewSet, basename='track-comments')
tracks_router.register(r'comments', CommentViewSet, basename='track-comments')

social_posts_router = NestedSimpleRouter(router, r'social-posts', lookup='post')
social_posts_router.register(r'comments', PostCommentViewSet, basename='post-comments')

urlpatterns = [
    # Your existing additional routes
    path('tracks/<int:pk>/download/', TrackViewSet.as_view({'get': 'download'}), name='track-download'),
    path('tracks/upload/', TrackViewSet.as_view({'post': 'upload_track'}), name='track-upload'),
    path('notifications/unread_count/', NotificationViewSet.as_view({'get': 'unread_count'}), name='notification-unread-count'),
    # path('tracks/<int:track_pk>/comments/', CommentViewSet.as_view({'get': 'list'})),
]

urlpatterns += router.urls + tracks_router.urls + social_posts_router.urls