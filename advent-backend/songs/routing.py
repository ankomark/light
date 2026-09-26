from django.urls import re_path

from songs import consumers

websocket_urlpatterns = [
    re_path(r'ws/groups/(?P<slug>[-\w]+)/$', consumers.GroupChatConsumer.as_asgi()),
    # Direct messages: one socket per device, for all of a person's chats.
    re_path(r'ws/dm/$', consumers.DMConsumer.as_asgi()),
]
