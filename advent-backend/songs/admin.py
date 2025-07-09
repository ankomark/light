from django.contrib import admin
from .models import (
    User, Track, Playlist, Comment, Like, Category, Profile,
    SocialPost, PostLike, PostComment, PostSave, Notification,
    Church, Videostudio, Choir, Group, GroupMember, GroupJoinRequest,
    GroupPost, GroupPostAttachment, ProductCategory, Product, ProductImage,
    Cart, CartItem, Order, OrderItem, ProductReview, Wishlist, LiveEvent
)

# Register all models
admin.site.register(User)
admin.site.register(Category)
admin.site.register(Profile)
admin.site.register(Track)
admin.site.register(Playlist)
admin.site.register(Comment)
admin.site.register(Like)
admin.site.register(SocialPost)
admin.site.register(PostLike)
admin.site.register(PostComment)
admin.site.register(PostSave)
admin.site.register(Notification)
admin.site.register(Church)
admin.site.register(Videostudio)
admin.site.register(Choir)
admin.site.register(Group)
admin.site.register(GroupMember)
admin.site.register(GroupJoinRequest)
admin.site.register(GroupPost)
admin.site.register(GroupPostAttachment)
admin.site.register(ProductCategory)
admin.site.register(Product)
admin.site.register(ProductImage)
admin.site.register(Cart)
admin.site.register(CartItem)
admin.site.register(Order)
admin.site.register(OrderItem)
admin.site.register(ProductReview)
admin.site.register(Wishlist)
admin.site.register(LiveEvent)