"""User.total_likes — the lifetime "likes received" stat on the profile.

Covers the four sources that feed it (social posts, tracks, publications and
live broadcasts), the bookkeeping on like/unlike and on cascade deletes,
moderator takedowns and restores, exposure through the profile endpoints, and
the recount repair command.

    python manage.py test songs.tests.test_total_likes --settings=music.settings_test
"""
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APITestCase

from songs.models import (
    Like, LiveBroadcast, PostLike, Profile, Publication, PublicationLike,
    SocialPost, Track, User,
)


def total(user):
    """Re-read the counter — signals update it with an UPDATE, not on the instance."""
    return User.objects.get(pk=user.pk).total_likes


class TotalLikesCounterTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('tl_author', 'tlauthor@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('tl_fan', 'tlfan@x.com', 'pw12345!')

    def test_starts_at_zero(self):
        self.assertEqual(total(self.author), 0)

    def test_post_track_publication_and_live_likes_all_count(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        track = Track.objects.create(title='Hymn', artist=self.author, audio_file='audio/x')
        pub = Publication.objects.create(title='Essay', author=self.author)

        PostLike.objects.create(post=post, user=self.fan)
        Like.objects.create(track=track, user=self.fan)
        PublicationLike.objects.create(publication=pub, user=self.fan)

        self.assertEqual(total(self.author), 3)

        # Live hearts arrive as a batched counter bump, not a row per like.
        self.client.force_authenticate(self.fan)
        broadcast = LiveBroadcast.objects.create(
            host=self.author, kind='meet', title='Devotion', room_name='r-mix',
        )
        self.client.post(f'/api/live/broadcasts/{broadcast.id}/react/', {'count': 5}, format='json')
        self.assertEqual(total(self.author), 8)

    def test_unlike_decrements(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        like = PostLike.objects.create(post=post, user=self.fan)
        self.assertEqual(total(self.author), 1)

        like.delete()
        self.assertEqual(total(self.author), 0)

    def test_never_goes_negative(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        like = PostLike.objects.create(post=post, user=self.fan)
        # Simulate a stale/duplicate delete firing after the counter is at zero.
        User.objects.filter(pk=self.author.pk).update(total_likes=0)
        like.delete()
        self.assertEqual(total(self.author), 0)

    def test_deleting_the_content_removes_its_likes_from_the_total(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        other = User.objects.create_user('tl_fan2', 'tlfan2@x.com', 'pw12345!')
        PostLike.objects.create(post=post, user=self.fan)
        PostLike.objects.create(post=post, user=other)
        self.assertEqual(total(self.author), 2)

        post.delete()  # cascades to both PostLike rows
        self.assertEqual(total(self.author), 0)

    def test_likes_are_credited_to_the_author_not_the_liker(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)

        self.assertEqual(total(self.author), 1)
        self.assertEqual(total(self.fan), 0)

    def test_post_likes_count_still_tracked(self):
        # The per-post counter must keep working exactly as before.
        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)
        post.refresh_from_db()
        self.assertEqual(post.likes_count, 1)


class TotalLikesApiTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('tl_api', 'tlapi@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('tl_apifan', 'tlapifan@x.com', 'pw12345!')

        post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=post, user=self.fan)

    def test_own_profile_endpoint_exposes_total_likes(self):
        # Authenticate with a freshly loaded row: signals bump the counter with
        # an UPDATE, so the setUp instance still holds the pre-like value.
        # A real request re-reads the user during authentication.
        self.client.force_authenticate(User.objects.get(pk=self.author.pk))
        data = self.client.get('/api/profiles/me/').json()
        self.assertEqual(data['total_likes'], 1)

    def test_other_users_profile_exposes_total_likes(self):
        self.client.force_authenticate(self.fan)
        data = self.client.get(f'/api/users/{self.author.id}/').json()
        self.assertEqual(data['total_likes'], 1)

    def test_total_likes_is_read_only_over_the_api(self):
        self.client.force_authenticate(self.author)
        self.client.patch('/api/profiles/update_me/', {'total_likes': 9999}, format='json')
        self.assertEqual(total(self.author), 1)

    def test_like_endpoint_updates_the_total(self):
        post = SocialPost.objects.create(user=self.author, content_type='image')
        self.client.force_authenticate(self.fan)

        self.client.post(f'/api/social-posts/{post.id}/like/')
        self.assertEqual(total(self.author), 2)

        self.client.post(f'/api/social-posts/{post.id}/like/')  # toggles off
        self.assertEqual(total(self.author), 1)


class LiveLikeTests(APITestCase):
    """Live ❤️ reactions have no per-like row, so the view credits the host
    directly instead of going through a signal."""

    def setUp(self):
        self.host = User.objects.create_user('tl_host', 'tlhost@x.com', 'pw12345!')
        self.viewer = User.objects.create_user('tl_viewer', 'tlviewer@x.com', 'pw12345!')
        self.broadcast = LiveBroadcast.objects.create(
            host=self.host, kind='meet', title='Evening Prayer', room_name='room-tl',
        )
        self.client.force_authenticate(self.viewer)

    def _react(self, count=None):
        payload = {} if count is None else {'count': count}
        return self.client.post(
            f'/api/live/broadcasts/{self.broadcast.id}/react/', payload, format='json',
        )

    def test_batched_reactions_credit_the_host(self):
        self._react(3)
        self._react(2)
        self.assertEqual(total(self.host), 5)

    def test_credits_the_host_not_the_viewer(self):
        self._react(4)
        self.assertEqual(total(self.host), 4)
        self.assertEqual(total(self.viewer), 0)

    def test_reactions_to_an_ended_broadcast_do_not_count(self):
        self._react(3)
        LiveBroadcast.objects.filter(pk=self.broadcast.pk).update(status='ended')

        self._react(50)
        # The broadcast tally is unchanged, and so is the profile stat.
        self.broadcast.refresh_from_db()
        self.assertEqual(self.broadcast.like_count, 3)
        self.assertEqual(total(self.host), 3)

    def test_deleting_a_broadcast_takes_its_hearts_with_it(self):
        self._react(6)
        self.assertEqual(total(self.host), 6)

        # Deliberately NOT refreshed: `react` moves like_count with an UPDATE,
        # so this instance still reads 0. The handler must hand back the stored
        # tally, not whatever the caller happens to be holding.
        self.assertEqual(self.broadcast.like_count, 0)
        self.broadcast.delete()
        self.assertEqual(total(self.host), 0)

    def test_per_call_clamp_still_applies(self):
        # The endpoint caps one flush at 100; the profile stat must agree.
        self._react(500)
        self.assertEqual(total(self.host), 100)


class RemovedContentLikesTests(APITestCase):
    """total_likes counts likes on *visible* content, so a moderator takedown
    subtracts the block it had gathered and a restore hands it back.

    The invariant that matters: whatever the incremental signals do, a recount
    must land on the same number. Anything else and every repair run would
    silently change the stat.
    """

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('rl_admin', 'rladmin@x.com', 'pw12345!')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.author = User.objects.create_user('rl_author', 'rlauthor@x.com', 'pw12345!')
        Profile.objects.create(user=self.author)
        self.fan = User.objects.create_user('rl_fan', 'rlfan@x.com', 'pw12345!')
        self.other = User.objects.create_user('rl_fan2', 'rlfan2@x.com', 'pw12345!')

        self.post = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=self.post, user=self.fan)
        PostLike.objects.create(post=self.post, user=self.other)
        self.client.force_authenticate(self.admin)

    def _remove(self, ctype, obj):
        return self.client.post('/api/admin/content/remove/', {'type': ctype, 'id': obj.id})

    def _restore(self, ctype, obj):
        return self.client.post('/api/admin/content/restore/', {'type': ctype, 'id': obj.id})

    def test_takedown_subtracts_the_posts_likes(self):
        self.assertEqual(total(self.author), 2)
        self._remove('post', self.post)
        self.assertEqual(total(self.author), 0)

    def test_restore_hands_them_back(self):
        self._remove('post', self.post)
        self._restore('post', self.post)
        self.assertEqual(total(self.author), 2)

    def test_takedown_leaves_other_content_alone(self):
        keeper = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=keeper, user=self.fan)
        self.assertEqual(total(self.author), 3)

        self._remove('post', self.post)
        self.assertEqual(total(self.author), 1)  # only `keeper`'s like survives

    def test_removing_twice_only_subtracts_once(self):
        self._remove('post', self.post)
        self._remove('post', self.post)
        self.assertEqual(total(self.author), 0)

        # And the restore is still whole — a second subtraction would have
        # clamped at zero and quietly lost a like.
        self._restore('post', self.post)
        self.assertEqual(total(self.author), 2)

    def test_restoring_twice_only_adds_once(self):
        self._remove('post', self.post)
        self._restore('post', self.post)
        self._restore('post', self.post)
        self.assertEqual(total(self.author), 2)

    def test_likes_on_a_removed_post_move_nothing(self):
        self._remove('post', self.post)
        third = User.objects.create_user('rl_fan3', 'rlfan3@x.com', 'pw12345!')
        like = PostLike.objects.create(post=self.post, user=third)
        self.assertEqual(total(self.author), 0)

        like.delete()  # and unliking must not decrement what it never credited
        self.assertEqual(total(self.author), 0)

    def test_a_like_gathered_while_removed_returns_with_the_restore(self):
        self._remove('post', self.post)
        third = User.objects.create_user('rl_fan4', 'rlfan4@x.com', 'pw12345!')
        PostLike.objects.create(post=self.post, user=third)

        self._restore('post', self.post)
        # The restore credits every like now on the post, including the one
        # added during the takedown — which is what a recount would say too.
        self.assertEqual(total(self.author), 3)

    def test_deleting_a_removed_post_does_not_subtract_twice(self):
        self._remove('post', self.post)
        self.assertEqual(total(self.author), 0)

        self.post.delete()  # cascades to both PostLike rows
        self.assertEqual(total(self.author), 0)

    def test_tracks_and_publications_follow_the_same_rule(self):
        track = Track.objects.create(title='Hymn', artist=self.author, audio_file='audio/x')
        pub = Publication.objects.create(title='Essay', author=self.author)
        Like.objects.create(track=track, user=self.fan)
        PublicationLike.objects.create(publication=pub, user=self.fan)
        self.assertEqual(total(self.author), 4)

        self._remove('track', track)
        self.assertEqual(total(self.author), 3)
        self._remove('publication', pub)
        self.assertEqual(total(self.author), 2)

        self._restore('track', track)
        self._restore('publication', pub)
        self.assertEqual(total(self.author), 4)

    def test_bulk_remove_and_restore_adjust_the_total(self):
        second = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=second, user=self.fan)
        self.assertEqual(total(self.author), 3)

        ids = [self.post.id, second.id]
        # .update() fires no signals, so this is the path most likely to drift.
        self.client.post(
            '/api/admin/content/bulk/',
            {'type': 'post', 'ids': ids, 'action': 'remove'}, format='json',
        )
        self.assertEqual(total(self.author), 0)

        self.client.post(
            '/api/admin/content/bulk/',
            {'type': 'post', 'ids': ids, 'action': 'restore'}, format='json',
        )
        self.assertEqual(total(self.author), 3)

    def test_bulk_remove_spanning_two_authors_credits_each_correctly(self):
        """One grouped query has to attribute each row to its own owner."""
        author2 = User.objects.create_user('rl_author2', 'rlauthor2@x.com', 'pw12345!')
        mine = SocialPost.objects.create(user=author2, content_type='image')
        PostLike.objects.create(post=mine, user=self.fan)
        PostLike.objects.create(post=mine, user=self.other)
        PostLike.objects.create(post=mine, user=self.admin)

        self.client.post(
            '/api/admin/content/bulk/',
            {'type': 'post', 'ids': [self.post.id, mine.id], 'action': 'remove'},
            format='json',
        )
        self.assertEqual(total(self.author), 0)
        self.assertEqual(total(author2), 0)

    def test_bulk_remove_over_an_already_removed_item_stays_balanced(self):
        second = SocialPost.objects.create(user=self.author, content_type='image')
        PostLike.objects.create(post=second, user=self.fan)
        self._remove('post', self.post)  # already down to 1
        self.assertEqual(total(self.author), 1)

        # A bulk remove that includes the item already taken down must only
        # subtract the one that actually changes state.
        self.client.post(
            '/api/admin/content/bulk/',
            {'type': 'post', 'ids': [self.post.id, second.id], 'action': 'remove'},
            format='json',
        )
        self.assertEqual(total(self.author), 0)

        self.client.post(
            '/api/admin/content/bulk/',
            {'type': 'post', 'ids': [self.post.id, second.id], 'action': 'restore'},
            format='json',
        )
        self.assertEqual(total(self.author), 3)

    def test_recount_agrees_with_the_signals_after_a_takedown(self):
        """The load-bearing test: recount must not move a correct counter."""
        track = Track.objects.create(title='Hymn', artist=self.author, audio_file='audio/x')
        Like.objects.create(track=track, user=self.fan)
        pub = Publication.objects.create(title='Essay', author=self.author)
        PublicationLike.objects.create(publication=pub, user=self.fan)
        self._remove('post', self.post)
        self._remove('track', track)

        after_signals = total(self.author)
        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(self.author), after_signals)
        self.assertEqual(after_signals, 1)  # only the publication like is visible

    def test_recount_ignores_likes_on_removed_content(self):
        SocialPost.objects.filter(pk=self.post.pk).update(is_removed=True)
        User.objects.filter(pk=self.author.pk).update(total_likes=99)

        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(self.author), 0)


class RecountCommandTests(APITestCase):
    def test_recount_repairs_a_drifted_counter(self):
        author = User.objects.create_user('tl_drift', 'tldrift@x.com', 'pw12345!')
        fan = User.objects.create_user('tl_driftfan', 'tldriftfan@x.com', 'pw12345!')
        post = SocialPost.objects.create(user=author, content_type='image')
        track = Track.objects.create(title='T', artist=author, audio_file='audio/x')
        PostLike.objects.create(post=post, user=fan)
        Like.objects.create(track=track, user=fan)
        LiveBroadcast.objects.create(
            host=author, kind='meet', title='Vespers', room_name='room-drift', like_count=10,
        )

        # Drift, as a raw-SQL import or a signal-bypassing bulk write would cause.
        User.objects.filter(pk=author.pk).update(total_likes=99)

        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(author), 12)

    def test_recount_does_not_multiply_across_sources(self):
        """Several broadcasts alongside post/track likes: the SUM must not be
        inflated by the like joins (the classic mixed-aggregate trap)."""
        author = User.objects.create_user('tl_multi', 'tlmulti@x.com', 'pw12345!')
        fan = User.objects.create_user('tl_multifan', 'tlmultifan@x.com', 'pw12345!')
        other = User.objects.create_user('tl_multi2', 'tlmulti2@x.com', 'pw12345!')

        post = SocialPost.objects.create(user=author, content_type='image')
        PostLike.objects.create(post=post, user=fan)
        PostLike.objects.create(post=post, user=other)
        track = Track.objects.create(title='T', artist=author, audio_file='audio/x')
        Like.objects.create(track=track, user=fan)
        for i in range(3):
            LiveBroadcast.objects.create(
                host=author, kind='meet', title=f'B{i}', room_name=f'room-m{i}', like_count=4,
            )

        User.objects.filter(pk=author.pk).update(total_likes=0)
        call_command('recount_total_likes', verbosity=0)
        self.assertEqual(total(author), 2 + 1 + 12)
