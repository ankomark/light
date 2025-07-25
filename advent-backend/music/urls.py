
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from songs.views import SignUpView

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # API endpoints
    path('api/', include([
        # Authentication
        path('auth/', include([
            path('signup/', SignUpView.as_view(), name='signup'),
            path('token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
            path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
        ])),
        
        # App endpoints
        path('', include('songs.urls')),  # All songs app endpoints
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)