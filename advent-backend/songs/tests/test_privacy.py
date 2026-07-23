from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import (
    FollowRequest, Profile, SocialPost, User,
    can_view_profile, hidden_private_author_ids,
)


class PrivateAccountTests(APITestCase):
    """A private account's content is withheld from anyone it hasn't approved,
    and following one raises a request instead of an instant follow."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user(username='priv', email='priv@t.local', password='pw')
        self.stranger = User.objects.create_user(username='stranger', email='str@t.local', password='pw')
        self.follower = User.objects.create_user(username='follower', email='fol@t.local', password='pw')

        Profile.objects.update_or_create(user=self.owner, defaults={'is_public': False})
        for u in (self.stranger, self.follower):
            Profile.objects.update_or_create(user=u, defaults={'is_public': True})

        # An already-approved follower.
        self.owner.followers.add(self.follower)

        self.post = SocialPost.objects.create(user=self.owner, caption='secret', content_type='image')

    @staticmethod
    def _rows(response):
        """Response rows, whether or not the endpoint is paginated."""
        data = response.data
        return data['results'] if isinstance(data, dict) and 'results' in data else data

    # -- the gate itself ------------------------------------------------------
    def test_can_view_profile_rules(self):
        self.assertTrue(can_view_profile(self.owner, self.owner))       # self
        self.assertTrue(can_view_profile(self.follower, self.owner))    # approved
        self.assertFalse(can_view_profile(self.stranger, self.owner))   # not approved
        self.assertFalse(can_view_profile(None, self.owner))            # anonymous

    def test_public_accounts_stay_visible_to_everyone(self):
        self.assertTrue(can_view_profile(self.owner, self.stranger))
        self.assertTrue(can_view_profile(None, self.stranger))

    def test_hidden_author_ids_excludes_only_unapproved_private_accounts(self):
        self.assertIn(self.owner.id, hidden_private_author_ids(self.stranger))
        self.assertNotIn(self.owner.id, hidden_private_author_ids(self.follower))
        self.assertNotIn(self.owner.id, hidden_private_author_ids(self.owner))  # own posts

    # -- content gating -------------------------------------------------------
    def test_private_posts_are_withheld_from_a_stranger(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.get(f'/api/users/{self.owner.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['social_posts'], [])
        self.assertTrue(res.data['is_private'])
        self.assertFalse(res.data['can_view'])
        # Counts stay visible; it is the content that is withheld.
        self.assertEqual(res.data['followers_count'], 1)

    def test_approved_follower_sees_the_posts(self):
        self.client.force_authenticate(self.follower)
        res = self.client.get(f'/api/users/{self.owner.id}/')
        self.assertTrue(res.data['can_view'])
        self.assertEqual(len(res.data['social_posts']), 1)

    def test_owner_always_sees_their_own_posts(self):
        self.client.force_authenticate(self.owner)
        res = self.client.get(f'/api/users/{self.owner.id}/')
        self.assertEqual(len(res.data['social_posts']), 1)

    def test_private_posts_are_absent_from_the_post_list(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.get('/api/social-posts/')
        results = self._rows(res)
        self.assertNotIn(self.post.id, [p['id'] for p in results])

    # -- the approval flow ----------------------------------------------------
    def test_following_a_private_account_creates_a_request_not_a_follow(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.post(f'/api/users/{self.owner.id}/follow/')

        self.assertEqual(res.data['follow_status'], 'requested')
        self.assertFalse(res.data['is_following'])
        self.assertFalse(self.owner.followers.filter(pk=self.stranger.pk).exists())
        self.assertTrue(FollowRequest.objects.filter(
            requester=self.stranger, target=self.owner, status='pending').exists())

    def test_following_again_withdraws_the_pending_request(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')
        res = self.client.post(f'/api/users/{self.owner.id}/follow/')

        self.assertEqual(res.data['follow_status'], 'none')
        self.assertFalse(FollowRequest.objects.filter(
            requester=self.stranger, target=self.owner).exists())

    def test_public_accounts_still_follow_instantly(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(f'/api/users/{self.stranger.id}/follow/')
        self.assertTrue(res.data['is_following'])
        self.assertEqual(res.data['follow_status'], 'following')
        self.assertFalse(FollowRequest.objects.filter(target=self.stranger).exists())

    def test_approve_grants_access(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')
        req = FollowRequest.objects.get(requester=self.stranger, target=self.owner)

        self.client.force_authenticate(self.owner)
        res = self.client.post(f'/api/follow-requests/{req.id}/approve/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.assertTrue(self.owner.followers.filter(pk=self.stranger.pk).exists())
        self.assertFalse(FollowRequest.objects.filter(id=req.id).exists())
        self.assertTrue(can_view_profile(self.stranger, self.owner))

    def test_reject_leaves_no_access_and_allows_asking_again(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')
        req = FollowRequest.objects.get(requester=self.stranger, target=self.owner)

        self.client.force_authenticate(self.owner)
        self.client.post(f'/api/follow-requests/{req.id}/reject/')
        self.assertFalse(self.owner.followers.filter(pk=self.stranger.pk).exists())

        # The row is gone, so unique_together does not block a later attempt.
        self.client.force_authenticate(self.stranger)
        res = self.client.post(f'/api/users/{self.owner.id}/follow/')
        self.assertEqual(res.data['follow_status'], 'requested')

    def test_only_the_target_can_act_on_a_request(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')
        req = FollowRequest.objects.get(requester=self.stranger, target=self.owner)

        # A third party (and the requester) must not be able to self-approve.
        self.client.force_authenticate(self.follower)
        self.assertEqual(
            self.client.post(f'/api/follow-requests/{req.id}/approve/').status_code,
            status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.post(f'/api/follow-requests/{req.id}/approve/').status_code,
            status.HTTP_404_NOT_FOUND)
        self.assertFalse(self.owner.followers.filter(pk=self.stranger.pk).exists())

    def test_list_shows_only_my_own_pending_requests(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')

        self.client.force_authenticate(self.owner)
        res = self.client.get('/api/follow-requests/')
        results = self._rows(res)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['requester']['username'], 'stranger')

        # The requester sees nothing in their own inbox.
        self.client.force_authenticate(self.stranger)
        res = self.client.get('/api/follow-requests/')
        self.assertEqual(len(self._rows(res)), 0)

    def test_follow_status_reports_pending(self):
        self.client.force_authenticate(self.stranger)
        self.client.post(f'/api/users/{self.owner.id}/follow/')
        res = self.client.get(f'/api/users/{self.owner.id}/')
        self.assertEqual(res.data['follow_status'], 'requested')
