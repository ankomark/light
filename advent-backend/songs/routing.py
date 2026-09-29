from django.urls import re_path

from songs import consumers

websocket_urlpatterns = [
    re_path(r'ws/groups/(?P<slug>[-\w]+)/$', consumers.GroupChatConsumer.as_asgi()),
    # Direct messages: one socket per device, for all of a person's chats.
    re_path(r'ws/dm/$', consumers.DMConsumer.as_asgi()),
    # Live Bible Battle: the room's news (songs/battle.py decides; this tells).
    re_path(r'ws/battle/(?P<code>[A-Za-z0-9]{6})/$', consumers.BattleConsumer.as_asgi()),
]
