from django.urls import re_path

from songs import consumers

websocket_urlpatterns = [
    re_path(r'ws/groups/(?P<slug>[-\w]+)/$', consumers.GroupChatConsumer.as_asgi()),
    re_path(r'ws/community/(?P<kind>choir|church)/(?P<cid>\d+)/$',
            consumers.CommunityChatConsumer.as_asgi()),
]
