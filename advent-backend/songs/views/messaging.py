from .common import *  # noqa: F401,F403
from django.db.models import Exists, OuterRef, Subquery, Count, IntegerField, F, Q, Value, Case, When, CharField
from django.db.models.functions import Coalesce
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from .. import messaging as dm
from ..models import ConversationState, SinglesMatch

# Base64 of a ~6 MB binary is ~8 MB of text; allow a little headroom. The client
# caps uploads at 6 MB, but the server enforces its own bound (clients lie).
MAX_ATTACHMENT_CHARS = 9 * 1024 * 1024
MAX_TEXT_CHARS = 5000
# Message requests (a first message to someone who hasn't accepted you) one
# account may start in a day: enough for anyone, too few for a spam run.
REQUESTS_PER_DAY = 30


def _singles_signals(conversation, me, message):
    """In a Single & Searching chat: the first message from each side is a
    "conversation started" (the engine's measure of a meaningful connection),
    and contact details shared are counted for the reviewers' risk signals."""
    from .. import singles
    from ..models import SinglesProfile
    match = SinglesMatch.objects.filter(conversation=conversation).first()
    if match is None:
        return
    mine = SinglesProfile.objects.filter(user=me).first()
    if mine is None:
        return
    other = match.profile_b if match.profile_a_id == mine.pk else match.profile_a
    if not conversation.messages.filter(sender=me).exclude(pk=message.pk).exists():
        singles.signal(mine, 'chat_started', other)
    if message.message_type == 'text' and singles.has_contact(message.content):
        singles.signal(mine, 'link_shared', other)


class ConversationViewSet(viewsets.ModelViewSet):
    """Direct messages (songs/messaging.py has the rules and the live fan-out).

        GET  /conversations/?folder=primary|requests|archived&q=   the inbox
        POST /conversations/ {user_id}                start (or find) a chat
        GET  /conversations/<id>/messages/  (?after= | ?before= | ?q=)
        POST /conversations/<id>/send_message/ {content | attachment…, client_id, reply_to}
        POST /conversations/<id>/mark_read/
        PATCH /conversations/<id>/messages/<mid>/ {content}          edit (15 min)
        POST /conversations/<id>/messages/<mid>/delete/ {scope}      everyone (48 h) | me
        POST /conversations/<id>/messages/<mid>/react/ {emoji}       (again: removes)
        POST /conversations/<id>/state/ {accepted, muted, archived, clear}
        GET  /conversations/<id>/presence/
        GET  /conversations/unread_count/
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationSerializer
    pagination_class = StandardPagination
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    # Actions that only need "is this my conversation?" — not the inbox row.
    LEAN_ACTIONS = {'messages', 'send_message', 'mark_read', 'message_edit', 'message_delete', 'message_react',
                    'state', 'presence'}

    def get_throttles(self):
        if self.action == 'send_message':
            self.throttle_scope = 'dm_send'
        elif self.action == 'create':
            self.throttle_scope = 'dm_start'
        elif self.action in ('message_edit', 'message_delete', 'message_react', 'state'):
            self.throttle_scope = 'dm_action'
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        if self.action in self.LEAN_ACTIONS:
            # The chat asks for new messages often; it only needs to know the
            # chat is this person's. Someone else's chat is a 404 here.
            return Conversation.objects.filter(participants=user)
        dm.ensure_states(user)
        mine = ConversationState.objects.filter(conversation=OuterRef('pk'), user=user)
        # Latest message (as this person sees it: after what they cleared, not
        # taken down) + unread count, as subqueries in the one list query.
        base = Q(conversation=OuterRef('pk'), is_removed=False, id__gt=OuterRef('st_cleared'))
        last = Message.objects.filter(base).order_by('-created_at', '-id')
        unread = (Message.objects.filter(base, read=False).exclude(sender=user)
                  .order_by().values('conversation').annotate(c=Count('id')).values('c'))
        qs = (
            Conversation.objects
            .filter(participants=user)
            .filter(self._folder(user))
            .prefetch_related('participants__profile')
            .annotate(
                st_cleared=Coalesce(Subquery(mine.values('cleared_before_id')[:1]), Value(0)),
                st_accepted=Subquery(mine.values('accepted')[:1]),
                st_muted=Subquery(mine.values('muted')[:1]),
                st_archived=Subquery(mine.values('archived')[:1]),
            )
            .annotate(
                last_msg_id=Subquery(last.values('id')[:1]),
                last_msg_content=Subquery(last.values('content')[:1]),
                last_msg_type=Subquery(last.values('message_type')[:1]),
                last_msg_file=Subquery(last.values('file_name')[:1]),
                last_msg_sender=Subquery(last.values('sender_id')[:1]),
                last_msg_at=Subquery(last.values('created_at')[:1]),
                last_msg_deleted=Subquery(last.values('is_deleted')[:1]),
                singles_state=Case(
                    When(singles_match__ended_at__isnull=False, then=Value('ended')),
                    When(singles_match__isnull=False, then=Value('open')),
                    default=Value(None), output_field=CharField()),
                unread_n=Subquery(unread, output_field=IntegerField()),
            )
            # A chat with nothing in it (just opened, or cleared) isn't listed.
            .filter(last_msg_id__isnull=False)
        )
        # Nobody blocked either way, and no deactivated accounts.
        blocked = blocked_ids_for(user)
        if blocked:
            qs = qs.exclude(participants__id__in=blocked)
        qs = qs.exclude(participants__is_deactivated=True)
        q = (self.request.query_params.get('q') or '').strip()[:100]
        if q:
            # The other person's name, or words in the chat.
            others = User.objects.filter(username__icontains=q).exclude(pk=user.pk)
            qs = qs.filter(Q(participants__in=others)
                           | Q(messages__content__icontains=q, messages__is_removed=False, messages__is_deleted=False)).distinct()
        if self.request.query_params.get('folder') == 'requests':
            # Requests: from people who already follow you first (likely
            # someone you know), then strangers - each newest first.
            Follow = User.followers.through
            qs = qs.annotate(follows_me=Exists(
                Follow.objects.filter(from_user_id=user.id, to_user__conversations=OuterRef('pk'))
                .exclude(to_user_id=user.id)))
            return qs.order_by('-follows_me', F('last_msg_at').desc(nulls_last=True), '-id')
        # Most-recent activity first; a stable second key so pages can't drift.
        return qs.order_by(F('last_msg_at').desc(nulls_last=True), '-id')

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def _folder(self, user):
        """?singles=1: every Single & Searching chat, open or ended (the
        Chats tab there); otherwise the usual folders."""
        if self.request.query_params.get('singles') in ('1', 'true'):
            return Q(states__user=user, singles_match__isnull=False)
        return dm.folder_q(user, self.request.query_params.get('folder'))

    def _msg_qs(self, conversation):
        return (dm.visible_messages(conversation, self.request.user)
                .select_related('sender__profile', 'reply_to').prefetch_related('reactions'))

    def _ser(self, obj, many=False):
        return MessageSerializer(obj, many=many, context={'request': self.request}).data

    def create(self, request):
        """Start (or find) a chat with someone: {user_id}."""
        if request.user.is_currently_suspended:
            return Response({'error': 'Your account is suspended.'}, status=status.HTTP_403_FORBIDDEN)
        other_id = request.data.get('user_id')
        if not other_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        other_user = User.objects.filter(id=other_id, is_active=True, is_deactivated=False).first()
        if other_user is None:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if other_user == request.user:
            return Response({'error': 'Cannot message yourself'}, status=status.HTTP_400_BAD_REQUEST)
        if is_blocked_between(request.user, other_user):
            return Response({'error': 'You cannot message this user.'}, status=status.HTTP_403_FORBIDDEN)
        conversation = dm.start_between(request.user, other_user)
        return Response(self.get_serializer(conversation).data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        qs = self._msg_qs(conversation)

        # Search within the chat: ?q= (the newest matches first).
        q = (request.query_params.get('q') or '').strip()[:100]
        if q:
            hits = qs.filter(content__icontains=q, is_deleted=False).order_by('-created_at')[:50]
            return Response(self._ser(hits, many=True))

        # New since ?after=<id>, plus which of my earlier messages were read.
        after = request.query_params.get('after')
        if after is not None:
            try:
                after_id = int(after)
            except (TypeError, ValueError):
                after_id = 0
            new_msgs = qs.filter(id__gt=after_id).order_by('created_at')[:100]
            read_ids = list(
                conversation.messages.filter(sender=request.user, read=True, id__lte=after_id)
                .order_by('-id').values_list('id', flat=True)[:100]
            )
            return Response({'messages': self._ser(new_msgs, many=True), 'read_ids': read_ids})

        # Scroll-up history: the page just before ?before=<id>.
        before = request.query_params.get('before')
        if before is not None:
            try:
                before_id = int(before)
            except (TypeError, ValueError):
                before_id = 0
            older = list(qs.filter(id__lt=before_id).order_by('-created_at')[:30])
            older.sort(key=lambda m: m.created_at)
            return Response(self._ser(older, many=True))

        recent = list(qs.order_by('-created_at')[:100])
        recent.sort(key=lambda m: m.created_at)
        return Response(self._ser(recent, many=True))

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        conversation = self.get_object()
        me = request.user
        if me.is_currently_suspended:
            return Response({'error': 'Your account is suspended.'}, status=status.HTTP_403_FORBIDDEN)
        other = conversation.participants.exclude(id=me.id).first()
        if other and (is_blocked_between(me, other) or other.is_deactivated or not other.is_active):
            return Response({'error': 'You cannot message this user.'}, status=status.HTTP_403_FORBIDDEN)
        # A Single & Searching chat closes when either of them unmatches.
        if SinglesMatch.objects.filter(conversation=conversation, ended_at__isnull=False).exists():
            return Response({'error': 'This match has ended.', 'code': 'unmatched'},
                            status=status.HTTP_403_FORBIDDEN)

        # A retried send (a flaky network) is the same message, not another.
        client_id = (str(request.data.get('client_id') or '').strip() or None)
        if client_id:
            client_id = client_id[:64]
            existing = Message.objects.filter(sender=me, client_id=client_id).first()
            if existing:
                return Response(self._ser(existing), status=status.HTTP_200_OK)

        content = (request.data.get('content') or '').strip()[:MAX_TEXT_CHARS]
        message_type = request.data.get('message_type', 'text')
        if message_type not in dict(Message.MESSAGE_TYPES):
            message_type = 'text'
        attachment = request.data.get('attachment', '') or ''
        file_name = (request.data.get('file_name') or '')[:255]
        duration = request.data.get('duration')
        if not content and not attachment:
            return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
        # A Scripture card: the reference is looked up here, so the words on
        # the card are the Bible's, not whatever was typed.
        if message_type == 'verse':
            from ..bible_books import lookup
            found = lookup(content.split('|')[0])
            if found is None:
                return Response({'error': 'Verse not found.', 'code': 'verse_not_found'},
                                status=status.HTTP_400_BAD_REQUEST)
            content, attachment = f"{found['ref']}|{found['text']}", ''

        # Attachments: our own uploads (R2, or Cloudinary from older builds) —
        # never any address on the internet — or a legacy base64 data URI.
        if attachment:
            if attachment.startswith('https://'):
                if len(attachment) > 2000 or not _our_upload(attachment):
                    return Response({'error': 'Invalid attachment'}, status=status.HTTP_400_BAD_REQUEST)
            elif attachment.startswith('data:'):
                if len(attachment) > MAX_ATTACHMENT_CHARS:
                    return Response({'error': 'Attachment is too large (max ~6 MB).'},
                                    status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
                # Older app builds send the file itself as text. Kept in the
                # database it rode along in every load of the chat (megabytes
                # per message): it goes to storage, and the message keeps a link.
                attachment = _store_data_uri(attachment, message_type) or attachment
            else:
                return Response({'error': 'Invalid attachment'}, status=status.HTTP_400_BAD_REQUEST)

        reply_to = None
        if request.data.get('reply_to'):
            reply_to = dm.visible_messages(conversation, me).filter(pk=request.data.get('reply_to')).first()

        mine = dm.state_of(conversation, me)
        theirs = dm.state_of(conversation, other) if other else None
        first_request = bool(theirs and not theirs.accepted and not conversation.messages.filter(sender=me).exists())
        if first_request:
            day_key = f'dm_requests:{me.id}:{timezone.localdate().isoformat()}'
            cache.add(day_key, 0, 26 * 3600)
            if cache.incr(day_key) > REQUESTS_PER_DAY:
                return Response({'error': "You've sent a lot of message requests today. Try again tomorrow.",
                                 'code': 'request_limit'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        message = Message.objects.create(
            conversation=conversation, sender=me, content=content, message_type=message_type,
            attachment=attachment, file_name=file_name, reply_to=reply_to, client_id=client_id,
            duration=duration if isinstance(duration, (int, float)) else None,
        )
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=message.created_at)
        _singles_signals(conversation, me, message)
        # Answering is accepting; writing brings a chat back from the archive —
        # for both sides.
        ConversationState.objects.filter(pk=mine.pk).update(accepted=True, archived=False)
        if theirs:
            ConversationState.objects.filter(pk=theirs.pk).update(archived=False)

        data = self._ser(message)
        dm.forget_unread([me.id, other.id if other else None])
        dm.tell([me.id, other.id if other else None], {'type': 'message', 'conversation_id': conversation.id, 'message': data})

        if other and theirs:
            preview = f"📖 {content.split('|')[0]}" if message_type == 'verse' else content[:80] if content else {
                'image': '📷 Photo', 'file': '📎 File', 'audio': '🎤 Voice note',
            }.get(message_type, 'New message')
            if theirs.accepted and not theirs.muted:
                notify_user(other, 'message', f"{me.username}: {preview}", data={'conversationId': conversation.id})
            elif first_request:
                notify_user(other, 'message', f"{me.username} wants to send you a message",
                            data={'conversationId': conversation.id, 'request': True})
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        conversation = self.get_object()
        n = conversation.messages.filter(read=False).exclude(sender=request.user).update(read=True)
        if n:
            dm.forget_unread([request.user.id])
            # Read receipts, live: everything they sent here is now read.
            others = conversation.participants.exclude(id=request.user.id).values_list('id', flat=True)
            dm.tell(list(others), {'type': 'read', 'conversation_id': conversation.id, 'reader_id': request.user.id})
            # And the reader's own devices: their unread badges (the header,
            # the menu, Single & Searching) drop at once, not at the next poll.
            dm.tell([request.user.id], {'type': 'seen', 'conversation_id': conversation.id})
        return Response({'status': 'ok'})

    def _message(self, conversation, mid):
        m = dm.visible_messages(conversation, self.request.user).filter(pk=mid).select_related('reply_to').first()
        if m is None:
            raise Http404('No such message.')
        return m

    def _others(self, conversation):
        return list(conversation.participants.values_list('id', flat=True))

    @action(detail=True, methods=['patch'], url_path=r'messages/(?P<mid>\d+)')
    def message_edit(self, request, pk=None, mid=None):
        conversation = self.get_object()
        m = self._message(conversation, mid)
        if m.sender_id != request.user.id or m.is_deleted:
            raise PermissionDenied('Only its sender edits a message.')
        if m.message_type != 'text' or (timezone.now() - m.created_at).total_seconds() > dm.EDIT_WINDOW_S:
            return Response({'error': 'This message can no longer be edited.', 'code': 'too_late'},
                            status=status.HTTP_400_BAD_REQUEST)
        content = (request.data.get('content') or '').strip()[:MAX_TEXT_CHARS]
        if not content:
            return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
        m.content, m.edited_at = content, timezone.now()
        m.save(update_fields=['content', 'edited_at'])
        data = self._ser(m)
        dm.tell(self._others(conversation), {'type': 'edited', 'conversation_id': conversation.id, 'message': data})
        return Response(data)

    @action(detail=True, methods=['post'], url_path=r'messages/(?P<mid>\d+)/delete')
    def message_delete(self, request, pk=None, mid=None):
        """{scope: 'everyone' (its sender, within 48 hours) | 'me'}."""
        from ..models import MessageHide
        conversation = self.get_object()
        m = self._message(conversation, mid)
        if request.data.get('scope') == 'everyone':
            if m.sender_id != request.user.id:
                raise PermissionDenied('Only its sender deletes a message for everyone.')
            if (timezone.now() - m.created_at).total_seconds() > dm.DELETE_FOR_ALL_WINDOW_S:
                return Response({'error': 'This message can no longer be deleted for everyone.', 'code': 'too_late'},
                                status=status.HTTP_400_BAD_REQUEST)
            # Truly gone: the words and the file, not just hidden - the stored
            # file too, unless another message still uses it (a forward).
            stored = m.attachment if m.attachment and m.attachment.startswith('https://') else ''
            Message.objects.filter(pk=m.pk).update(is_deleted=True, content='', attachment='', file_name='')
            if stored and not Message.objects.filter(attachment=stored).exists():
                from .. import r2
                if r2.is_r2_url(stored):
                    r2.delete(stored)
            m.reactions.all().delete()
            dm.tell(self._others(conversation), {'type': 'deleted', 'conversation_id': conversation.id, 'id': m.id})
        else:
            MessageHide.objects.get_or_create(message=m, user=request.user)
        return Response({'status': 'ok'})

    @action(detail=True, methods=['post'], url_path=r'messages/(?P<mid>\d+)/react')
    def message_react(self, request, pk=None, mid=None):
        """{emoji}: one of the reactions; the same one again takes it off."""
        from ..models import MessageReaction
        conversation = self.get_object()
        m = self._message(conversation, mid)
        emoji = str(request.data.get('emoji') or '')
        if emoji not in dm.REACTIONS or m.is_deleted:
            return Response({'error': 'Not a reaction.'}, status=status.HTTP_400_BAD_REQUEST)
        existing = MessageReaction.objects.filter(message=m, user=request.user).first()
        if existing and existing.emoji == emoji:
            existing.delete()
        elif existing:
            existing.emoji = emoji
            existing.save(update_fields=['emoji'])
        else:
            MessageReaction.objects.create(message=m, user=request.user, emoji=emoji)
        rows = list(MessageReaction.objects.filter(message=m).values('emoji', 'user_id'))
        summary = {}
        for r in rows:
            summary.setdefault(r['emoji'], []).append(r['user_id'])
        payload = [{'emoji': e, 'count': len(u), 'user_ids': u} for e, u in summary.items()]
        dm.tell(self._others(conversation), {'type': 'reaction', 'conversation_id': conversation.id,
                                             'message_id': m.id, 'reactions': payload})
        return Response({'message_id': m.id, 'reactions': [
            {'emoji': x['emoji'], 'count': x['count'], 'mine': request.user.id in x['user_ids']} for x in payload]})

    @action(detail=True, methods=['post'])
    def state(self, request, pk=None):
        """This person's side of the chat: {accepted, muted, archived, clear}.
        Clearing takes its messages away for them only (a declined request)."""
        conversation = self.get_object()
        st = dm.state_of(conversation, request.user)
        for field in ('accepted', 'muted', 'archived'):
            if field in request.data:
                setattr(st, field, str(request.data.get(field)).lower() in ('1', 'true'))
        if str(request.data.get('clear', '')).lower() in ('1', 'true'):
            st.cleared_before_id = conversation.messages.order_by('-id').values_list('id', flat=True).first() or 0
        st.save()
        dm.forget_unread([request.user.id])
        return Response({'accepted': st.accepted, 'muted': st.muted, 'archived': st.archived,
                         'cleared_before_id': st.cleared_before_id})

    @action(detail=True, methods=['get'])
    def presence(self, request, pk=None):
        conversation = self.get_object()
        other = conversation.participants.exclude(id=request.user.id).first()
        if other is None or is_blocked_between(request.user, other):
            return Response({'online': False, 'last_seen': None})
        return Response({'online': dm.is_online(other.id), 'last_seen': other.last_seen_at})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Unread in accepted, unmuted chats (requests and muted chats don't
        light the badge), after what was cleared. Kept a few seconds per
        person (messaging.unread_key) and forgotten on any change."""
        cached = cache.get(dm.unread_key(request.user.id))
        if cached is not None:
            return Response(cached)
        data = self._unread_counts(request.user)
        cache.set(dm.unread_key(request.user.id), data, dm.UNREAD_TTL)
        return Response(data)

    def _unread_counts(self, user):
        states = ConversationState.objects.filter(conversation=OuterRef('conversation'), user=user)
        unread = (Message.objects.filter(conversation__participants=user, read=False, is_removed=False)
                  .exclude(sender=user)
                  .annotate(ok=Subquery(states.filter(accepted=True, muted=False).values('id')[:1]),
                            cleared=Coalesce(Subquery(states.values('cleared_before_id')[:1]), Value(0)))
                  .filter(ok__isnull=False, id__gt=F('cleared'))
                  .exclude(sender__in=blocked_ids_for(user)))
        count = unread.count()
        # Of those, in Single & Searching chats (its own badge on the menu).
        singles = unread.filter(conversation__singles_match__isnull=False,
                                conversation__singles_match__ended_at__isnull=True).count() if count else 0
        # Requests: what the Requests list would show - something from them
        # after anything cleared (a declined request is cleared, and kept
        # counting for ever), nobody blocked either way, no closed account.
        blocked = blocked_ids_for(user)
        waiting = Message.objects.filter(
            conversation=OuterRef('conversation'), is_removed=False,
            id__gt=Coalesce(OuterRef('cleared_before_id'), Value(0)),
        ).exclude(sender=user)
        req = (ConversationState.objects.filter(user=user, accepted=False)
               .filter(Exists(waiting))
               .exclude(conversation__participants__is_deactivated=True))
        if blocked:
            req = req.exclude(conversation__participants__id__in=blocked)
        requests_n = req.values('conversation').distinct().count()
        # And groups with something new (communities count too; muted ones don't).
        from ..group_live import unread_groups
        from .directory import unseen_notices
        return {'unread_count': count, 'requests': requests_n, **unread_groups(user),
                'notices': unseen_notices(user), 'singles': singles}


DATA_TYPES = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'audio/m4a': '.m4a', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
}


def _store_data_uri(data_uri, message_type):
    """A legacy data: attachment, uploaded to our storage. Its URL, or None
    (no storage set up, or not something we take) - then it's kept as before."""
    import base64
    import re as _re
    import uuid
    from .. import r2
    if not r2.is_configured():
        return None
    m = _re.match(r'^data:([\w.+/-]+)?(;[^,]*)?;base64,(.*)$', data_uri, _re.S)
    if not m:
        return None
    ctype = (m.group(1) or '').lower()
    ext = DATA_TYPES.get(ctype)
    if ext is None:
        ctype, ext = 'application/octet-stream', '.bin'
    try:
        raw = base64.b64decode(m.group(3), validate=False)
    except (ValueError, TypeError):
        return None
    try:
        return r2.put_bytes(f'messages/{message_type}/{uuid.uuid4().hex}{ext}', raw, ctype)
    except Exception:  # noqa: BLE001 - storage trouble: keep the old way
        return None


def _our_upload(url):
    """Is this one of our uploads (R2, or Cloudinary from older builds)?"""
    from .. import r2
    return r2.is_r2_url(url) or url.startswith('https://res.cloudinary.com/')


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
        # A phone gets one account's notifications: whoever signed in on it
        # before (and never signed out cleanly) stops getting them here.
        DeviceToken.objects.filter(token=token, is_active=True).exclude(user=request.user).update(is_active=False)
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
        user = self.request.user
        # A notification about a post you can no longer open (taken down, made
        # private, or on a private account you don't follow) would only lead
        # to "Failed to load post details" — so it isn't listed.
        hidden_authors = blocked_ids_for(user) | hidden_private_author_ids(user)
        post_ok = (Q(post__is_removed=False, post__user__is_deactivated=False)
                   & visible_posts_q(user, prefix='post__')
                   & ~Q(post__user_id__in=hidden_authors))
        return Notification.objects.filter(recipient=user)\
            .filter(Q(post__isnull=True) | post_ok)\
            .select_related(
                'sender__profile',
                'post',
                'track',
                'post__user__profile',
                'track__artist__profile',
                'group',
                'comment',
                'track_comment',
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

