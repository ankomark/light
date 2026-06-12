from .common import *  # noqa: F401,F403


class ConversationViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationSerializer
    pagination_class = StandardPagination
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return Conversation.objects.filter(
            participants=self.request.user
        ).prefetch_related(
            'participants__profile',
            'messages__sender__profile',
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def create(self, request):
        """Get or create a 1-to-1 conversation with another user."""
        other_id = request.data.get('user_id')
        if not other_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            other_user = User.objects.get(id=other_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if other_user == request.user:
            return Response({'error': 'Cannot message yourself'}, status=status.HTTP_400_BAD_REQUEST)

        # Find existing conversation between exactly these two users
        conversation = (
            Conversation.objects
            .filter(participants=request.user)
            .filter(participants=other_user)
            .first()
        )
        if not conversation:
            conversation = Conversation.objects.create()
            conversation.participants.add(request.user, other_user)

        serializer = self.get_serializer(conversation)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        if not conversation.participants.filter(id=request.user.id).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        # Bound the response: return the most recent 100 messages in
        # chronological order (older history can be loaded later if needed).
        recent = conversation.messages.select_related('sender__profile').order_by('-created_at')[:100]
        msgs = sorted(recent, key=lambda m: m.created_at)
        return Response(MessageSerializer(msgs, many=True).data)

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        conversation = self.get_object()
        if not conversation.participants.filter(id=request.user.id).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)

        content = (request.data.get('content') or '').strip()
        message_type = request.data.get('message_type', 'text')
        if message_type not in dict(Message.MESSAGE_TYPES):
            message_type = 'text'
        attachment = request.data.get('attachment', '') or ''
        file_name = (request.data.get('file_name') or '')[:255]
        duration = request.data.get('duration')

        # A message must have either text or an attachment.
        if not content and not attachment:
            return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=content,
            message_type=message_type,
            attachment=attachment,
            file_name=file_name,
            duration=duration if isinstance(duration, (int, float)) else None,
        )
        # Touch conversation so ordering by updated_at works
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=message.created_at)

        # Push notification to the other participant
        other = conversation.participants.exclude(id=request.user.id).first()
        if other:
            preview = content[:80] if content else {
                'image': '📷 Photo', 'file': '📎 File', 'audio': '🎤 Voice note',
            }.get(message_type, 'New message')
            notify_user(
                other,
                'message',
                f"{request.user.username}: {preview}",
                data={'conversationId': conversation.id},
            )

        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        conversation = self.get_object()
        conversation.messages.filter(read=False).exclude(sender=request.user).update(read=True)
        return Response({'status': 'ok'})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Message.objects.filter(
            conversation__participants=request.user,
            read=False,
        ).exclude(sender=request.user).count()
        return Response({'unread_count': count})



class DeviceTokenViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['post'])
    def register(self, request):
        token = request.data.get('token', '').strip()
        platform = request.data.get('platform', 'android')
        if not token:
            return Response({'error': 'Token is required'}, status=status.HTTP_400_BAD_REQUEST)
        DeviceToken.objects.update_or_create(
            user=request.user,
            token=token,
            defaults={'platform': platform, 'is_active': True},
        )
        return Response({'status': 'registered'})

    @action(detail=False, methods=['post'])
    def unregister(self, request):
        token = request.data.get('token', '').strip()
        if token:
            DeviceToken.objects.filter(user=request.user, token=token).update(is_active=False)
        return Response({'status': 'unregistered'})



class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)\
            .select_related(
                'sender__profile',
                'post',
                'track',
                'post__user__profile',
                'track__artist__profile'
            )\
            .order_by('-created_at')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=True, methods=['post'])
    def mark_as_read(self, request, pk=None):
        notification = self.get_object()
        if notification.recipient != request.user:
            return Response(
                {'error': 'You can only mark your own notifications as read'},
                status=status.HTTP_403_FORBIDDEN
            )
        notification.read = True
        notification.save()
        return Response({'status': 'notification marked as read'})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Notification.objects.filter(
            recipient=request.user, 
            read=False
        ).count()
        return Response({'unread_count': count})

