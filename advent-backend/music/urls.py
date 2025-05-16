# from django.contrib import admin
# from django.urls import path, include
# from django.conf import settings
# from django.conf.urls.static import static
# from rest_framework import routers
# from rest_framework_simplejwt.views import (
#     TokenObtainPairView,
#     TokenRefreshView,
# )
# from songs.views import SignUpView
# from songs.views import ProfileViewSet  # Import your ProfileViewSet
# # Other view imports...
# from songs.views import SocialPostViewSet
# # Create a router
# router = routers.DefaultRouter()
# router.register(r'profiles', ProfileViewSet)  # Register the ProfileViewSet
# # Register other viewsets as needed
# router.register(r'social-posts', SocialPostViewSet, basename='socialpost')
# urlpatterns = [
#     path('admin/', admin.site.urls),
#     path('api/', include(router.urls)),  # Include the router URLs
#     path('api/songs/', include('songs.urls')),
   
#     path('api/auth/signup/', SignUpView.as_view(), name='signup'),
#     path('api/auth/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
#     path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
#     path('api/songs/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),  # Add this line
# ]

# if settings.DEBUG:
#     urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

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