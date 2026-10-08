"""How big a request may be, checked before anything reads it.

Django's DATA_UPLOAD_MAX_MEMORY_SIZE guards form posts, but DRF reads a JSON
body through the raw stream and skips it: the load test stored a 12 MB
caption. Here the declared size is checked first:

  JSON / form data      2 MB  (a long book chapter is well under that)
  multipart (a file)   30 MB  (pictures; songs and videos go straight to R2)

A body over the limit is refused with 413 before it is read. A request that
does not declare its size (chunked) is held to the same limits as it is read,
by Django's own reader.
"""
from django.http import JsonResponse

JSON_MAX = 2 * 1024 * 1024
MULTIPART_MAX = 30 * 1024 * 1024


class RequestSizeLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            length = int(request.META.get('CONTENT_LENGTH') or 0)
        except (TypeError, ValueError):
            length = 0
        if length:
            multipart = (request.META.get('CONTENT_TYPE') or '').startswith('multipart/')
            limit = MULTIPART_MAX if multipart else JSON_MAX
            if length > limit:
                return JsonResponse({'error': 'That is too large to send.', 'code': 'too_large',
                                     'max_bytes': limit}, status=413)
        return self.get_response(request)
