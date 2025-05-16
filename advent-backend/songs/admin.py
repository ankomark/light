from django.contrib import admin

# Register your models here.
from .models import Track,Comment,Category,User,Like,Profile,Playlist

admin.site.register(User)
admin.site.register(Category)
admin.site.register(Profile)
admin.site.register(Track)
admin.site.register(Playlist)
admin.site.register(Comment)
admin.site.register(Like)
