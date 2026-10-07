
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from songs.views.directory import service_share_page
from songs.views import SignUpView, ThrottledTokenObtainPairView, DeviceTokenRefreshView, LogoutView, health_check, post_share_page, share_brand_image
from songs.views.social import profile_share_page

# Django's own admin signs in with a password alone, so it is off unless
# DJANGO_ADMIN_ENABLED, and then only an active superuser gets in (Django's
# default lets any is_staff account in).
admin.site.has_permission = lambda request: bool(
    request.user.is_active and request.user.is_superuser)

urlpatterns = [
    path('', health_check, name='health-root'),

    # Public share/preview page for a post (rich link card + deep link into app).
    path('post/<int:post_id>/', post_share_page, name='post-share-page'),
    # A service's shared link (rich card + deep link into the app).
    path('service/<int:service_id>/', service_share_page, name='service-share-page'),
    # A person's shared profile (rich card + deep link into the app).
    path('u/<str:username>/', profile_share_page, name='profile-share-page'),
    # Branded fallback image for share cards (posts with no still of their own).
    path('share-og.png', share_brand_image, name='share-brand-image'),

    # API endpoints
    path('api/', include([
        path('health/', health_check, name='health'),
        # Authentication
        path('auth/', include([
            path('signup/', SignUpView.as_view(), name='signup'),
            path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
            path('token/refresh/', DeviceTokenRefreshView.as_view(), name='token_refresh'),
            path('logout/', LogoutView.as_view(), name='logout'),
        ])),
        
        # App endpoints
        path('', include('songs.urls')),  # All songs app endpoints
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
if settings.DJANGO_ADMIN_ENABLED:
    urlpatterns = [path('admin/', admin.site.urls)] + urlpatterns
