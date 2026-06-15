
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import (
    TokenRefreshView,
)
from songs.views import SignUpView, ThrottledTokenObtainPairView, LogoutView, health_check, post_share_page

urlpatterns = [
    path('', health_check, name='health-root'),
    path('admin/', admin.site.urls),

    # Public share/preview page for a post (rich link card + deep link into app).
    path('post/<int:post_id>/', post_share_page, name='post-share-page'),

    # API endpoints
    path('api/', include([
        path('health/', health_check, name='health'),
        # Authentication
        path('auth/', include([
            path('signup/', SignUpView.as_view(), name='signup'),
            path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
            path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
            path('logout/', LogoutView.as_view(), name='logout'),
        ])),
        
        # App endpoints
        path('', include('songs.urls')),  # All songs app endpoints
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)