"""Comment replies, @mentions in comments, reactions, and the notifications
they raise — which must land on the exact comment and never double up."""
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from songs.models import (
    Block, CommentReaction, Notification, PostComment, SocialPost, User,
)

IMG = 'https://media.example.com/p.jpg'


def rows(res):
    body = res.json()
    return body['results'] if isinstance(body, dict) and 'results' in body else body


class Base(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('ct_owner', 'cto@x.com', 'x')
        self.amy = User.objects.create_user('ct_amy', 'cta@x.com', 'x')
        self.ben = User.objects.create_user('ct_ben', 'ctb@x.com', 'x')
        self.post = SocialPost.objects.create(user=self.owner, content_type='image', media_file=IMG)

    def comment(self, user, content, parent=None, route='comments'):
        self.client.force_authenticate(user)
        body = {'content': content, **({'parent': parent} if parent else {})}
        url = (f'/api/social-posts/{self.post.id}/comments/' if route == 'comments'
               else f'/api/social-posts/{self.post.id}/comment/')
        res = self.client.post(url, body, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def notes(self, user, kind=None):
        qs = Notification.objects.filter(recipient=user)
        return qs.filter(notification_type=kind) if kind else qs


class ThreadTests(Base):
    def test_reply_to_a_reply_joins_the_top_thread(self):
        top = self.comment(self.amy, 'first')
        r1 = self.comment(self.ben, 'answer', parent=top['id'])
        r2 = self.comment(self.amy, 'back to you', parent=r1['id'], route='comment')
        self.assertEqual(r1['parent'], top['id'])
        self.assertEqual(r2['parent'], top['id'])                 # flattened
        self.assertEqual(r2['reply_to']['username'], 'ct_ben')     # but addressed
        self.assertEqual(PostComment.objects.get(pk=top['id']).replies_count, 2)
        self.post.refresh_from_db()
        self.assertEqual(self.post.comments_count, 3)

    def test_list_is_top_level_and_replies_are_a_thread(self):
        top = self.comment(self.amy, 'first')
        self.comment(self.ben, 'r1', parent=top['id'])
        self.comment(self.owner, 'r2', parent=top['id'])
        listed = rows(self.client.get(f'/api/social-posts/{self.post.id}/comments/'))
        self.assertEqual([c['id'] for c in listed], [top['id']])
        self.assertEqual(listed[0]['replies_count'], 2)
        thread = rows(self.client.get(f'/api/social-posts/{self.post.id}/comments/{top["id"]}/replies/'))
        self.assertEqual([c['content'] for c in thread], ['r1', 'r2'])  # oldest first

    def test_parent_must_be_on_the_same_post(self):
        other = SocialPost.objects.create(user=self.owner, content_type='image', media_file=IMG)
        foreign = PostComment.objects.create(post=other, user=self.amy, content='elsewhere')
        self.client.force_authenticate(self.ben)
        res = self.client.post(f'/api/social-posts/{self.post.id}/comments/',
                               {'content': 'x', 'parent': foreign.id}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_deleting_a_top_comment_takes_its_replies_and_counts(self):
        top = self.comment(self.amy, 'first')
        self.comment(self.ben, 'r1', parent=top['id'])
        self.client.force_authenticate(self.amy)
        self.assertEqual(self.client.delete(f'/api/post-comments/{top["id"]}/').status_code, 204)
        self.post.refresh_from_db()
        self.assertEqual(self.post.comments_count, 0)

    def test_blocked_users_comments_are_hidden(self):
        self.comment(self.amy, 'visible?')
        Block.objects.create(blocker=self.ben, blocked=self.amy)
        self.client.force_authenticate(self.ben)
        self.assertEqual(rows(self.client.get(f'/api/social-posts/{self.post.id}/comments/')), [])


class NotificationTests(Base):
    def test_reply_notifies_the_person_answered_with_the_exact_comment(self):
        top = self.comment(self.amy, 'first')
        reply = self.comment(self.ben, 'answer', parent=top['id'])
        note = self.notes(self.amy, 'comment_reply').get()
        self.assertEqual((note.post_id, note.comment_id), (self.post.id, reply['id']))
        self.client.force_authenticate(self.amy)
        listed = rows(self.client.get('/api/notifications/'))
        row = next(n for n in listed if n['notification_type'] == 'comment_reply')
        self.assertEqual(row['related_comment_id'], reply['id'])
        self.assertEqual(row['post']['id'], self.post.id)

    def test_mention_in_a_comment_notifies_once(self):
        c = self.comment(self.amy, 'look @ct_ben @CT_BEN and @nobody')
        self.assertEqual(self.notes(self.ben, 'mention').count(), 1)
        self.assertEqual(self.notes(self.ben).get().comment_id, c['id'])
        self.assertEqual(list(PostComment.objects.get(pk=c['id']).mentions.values_list('username', flat=True)),
                         ['ct_ben'])

    def test_owner_gets_one_notification_for_a_reply_that_is_also_a_mention(self):
        top = self.comment(self.owner, 'thanks all')
        self.comment(self.amy, '@ct_owner agreed', parent=top['id'])
        # Replied to AND mentioned AND it's their post → one notification, the reply.
        self.assertEqual(self.notes(self.owner).count(), 1)
        self.assertEqual(self.notes(self.owner).get().notification_type, 'comment_reply')

    def test_mentions_respect_who_can_see_the_post(self):
        self.post.visibility = 'followers'
        self.post.save(update_fields=['visibility'])
        self.owner.followers.add(self.amy)
        self.comment(self.amy, 'hey @ct_ben')        # ben doesn't follow the owner
        self.assertEqual(self.notes(self.ben).count(), 0)

    def test_blocked_mentions_are_not_notified(self):
        Block.objects.create(blocker=self.ben, blocked=self.amy)
        self.comment(self.amy, 'hey @ct_ben')
        self.assertEqual(self.notes(self.ben).count(), 0)


class ReactionTests(Base):
    def setUp(self):
        super().setUp()
        self.c = PostComment.objects.create(post=self.post, user=self.amy, content='react to me')
        self.url = f'/api/post-comments/{self.c.id}/react/'

    def test_heart_toggles_and_notifies_once(self):
        self.client.force_authenticate(self.ben)
        on = self.client.post(self.url, {}, format='json').json()
        self.assertEqual(on['mine'], '❤️')
        self.assertEqual(on['reactions'], {'total': 1, 'top': ['❤️'], 'mine': '❤️'})
        off = self.client.post(self.url, {'emoji': '❤️'}, format='json').json()
        self.assertIsNone(off['mine'])
        self.assertEqual(off['reactions']['total'], 0)
        self.client.post(self.url, {}, format='json')
        self.assertEqual(self.notes(self.amy, 'comment_like').count(), 2)  # each fresh like

    def test_switching_emoji_replaces_without_renotifying(self):
        self.client.force_authenticate(self.ben)
        self.client.post(self.url, {'emoji': '❤️'}, format='json')
        res = self.client.post(self.url, {'emoji': '😂'}, format='json').json()
        self.assertEqual(res['reactions'], {'total': 1, 'top': ['😂'], 'mine': '😂'})
        self.assertEqual(self.notes(self.amy, 'comment_like').count(), 1)
        self.c.refresh_from_db()
        self.assertEqual(self.c.reactions_count, 1)

    def test_delete_and_validation(self):
        self.client.force_authenticate(self.ben)
        self.client.post(self.url, {'emoji': '🔥'}, format='json')
        self.assertIsNone(self.client.delete(self.url).json()['mine'])
        self.assertEqual(self.client.post(self.url, {'emoji': '💩'}, format='json').status_code, 400)

    def test_no_self_notification(self):
        self.client.force_authenticate(self.amy)
        self.client.post(self.url, {}, format='json')
        self.assertEqual(self.notes(self.amy).count(), 0)

    def test_cannot_react_on_a_hidden_post(self):
        self.post.visibility = 'private'
        self.post.save(update_fields=['visibility'])
        self.client.force_authenticate(self.ben)
        self.assertEqual(self.client.post(self.url, {}, format='json').status_code, 404)

    def test_summary_and_ordering_in_the_list(self):
        quiet = PostComment.objects.create(post=self.post, user=self.ben, content='newer, no love')
        for i, emoji in enumerate(['😂', '😂', '❤️']):
            u = User.objects.create_user(f'ct_fan{i}', f'ctf{i}@x.com', 'x')
            CommentReaction.objects.create(comment=self.c, user=u, emoji=emoji)
        self.client.force_authenticate(self.ben)
        listed = rows(self.client.get(f'/api/social-posts/{self.post.id}/comments/'))
        self.assertEqual([c['id'] for c in listed], [self.c.id, quiet.id])  # top comment first
        self.assertEqual(listed[0]['reactions'], {'total': 3, 'top': ['😂', '❤️'], 'mine': None})

    def test_list_query_count_is_flat(self):
        def measure(n):
            for i in range(n):
                c = PostComment.objects.create(post=self.post, user=self.amy, content=f'c{i}')
                CommentReaction.objects.create(comment=c, user=self.ben, emoji='🔥')
            self.client.force_authenticate(self.ben)
            with CaptureQueriesContext(connection) as ctx:
                self.client.get(f'/api/social-posts/{self.post.id}/comments/')
            return len(ctx.captured_queries)
        small = measure(2)
        large = measure(10)
        self.assertEqual(small, large)
