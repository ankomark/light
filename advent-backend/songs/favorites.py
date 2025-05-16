from django.shortcuts import get_object_or_404
from .models import Track, Like

def toggle_favorite(request, track_id):
    if request.method == "POST":
        track = get_object_or_404(Track, id=track_id)
        user = request.user

        # Toggle the favorite status
        existing_like = Like.objects.filter(user=user, track=track).first()
        if existing_like:
            existing_like.delete()
            likes_count = Like.objects.filter(track=track).count()
            return JsonResponse({"status": "Track unliked", "likes_count": likes_count}, status=200)

        Like.objects.create(user=user, track=track)
        likes_count = Like.objects.filter(track=track).count()
        return JsonResponse({"status": "Track liked", "likes_count": likes_count}, status=200)

    return JsonResponse({"error": "Invalid request"}, status=400)
