"""Communities: one model, many categories.

Choir and Church used to be separate models with their own endpoints, so a new
kind of community needed a code change. These tests pin the behaviour that
replaced them: categories are data, anyone can add one, and the per-category
fields still drive the directory filters that Churches.js/Choirs.js relied on.

    python manage.py test songs.tests.test_communities
"""
import json

from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import CommunityCategory, Group, GroupJoinRequest, GroupMember, User


class CommunityCategoryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.church, _ = CommunityCategory.objects.update_or_create(
            slug='church',
            defaults={
                'name': 'Church', 'is_builtin': True,
                'field_schema': [
                    {'key': 'conference', 'label': 'Conference', 'type': 'text',
                     'filterable': True, 'searchable': True},
                    {'key': 'pastor', 'label': 'Pastor', 'type': 'text',
                     'filterable': False, 'searchable': True},
                ],
            },
        )

    def test_anyone_can_create_a_category_and_a_community_in_it(self):
        """The point of the merge: starting a new kind of community is a POST,
        not a migration."""
        res = self.client.post('/api/community-categories/', {
            'name': 'Trending News',
            'description': 'Breaking news and discussion',
            'field_schema': [
                {'key': 'topic', 'label': 'Topic', 'type': 'text', 'filterable': True},
            ],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        self.assertEqual(res.data['slug'], 'trending-news')
        self.assertFalse(res.data['is_builtin'])

        res = self.client.post('/api/communities/', {
            'name': 'Kenya Headlines',
            'description': 'Daily roundup',
            'category': res.data['id'],
            'details': {'topic': 'politics'},
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        community = Group.objects.get(name='Kenya Headlines')
        self.assertEqual(community.category.slug, 'trending-news')
        self.assertEqual(community.details['topic'], 'politics')

    def test_builtin_category_is_protected(self):
        res = self.client.delete('/api/community-categories/church/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(CommunityCategory.objects.filter(slug='church').exists())

    def test_category_in_use_cannot_be_deleted(self):
        mine = CommunityCategory.objects.create(
            name='Cycling', slug='cycling', created_by=self.user
        )
        Group.objects.create(creator=self.user, name='Riders', slug='riders',
                             category=mine, kind=Group.KIND_COMMUNITY)
        res = self.client.delete('/api/community-categories/cycling/')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(CommunityCategory.objects.filter(slug='cycling').exists())

    def test_field_schema_rejects_malformed_descriptors(self):
        """field_schema builds ORM lookups, so a bad key must not get in."""
        res = self.client.post('/api/community-categories/', {
            'name': 'Bad', 'field_schema': [{'key': 'drop; table', 'label': 'x'}],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class CommunityDirectoryTests(APITestCase):
    """The church/choir directory browse, now served by the community list."""

    def setUp(self):
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.church, _ = CommunityCategory.objects.update_or_create(
            slug='church',
            defaults={
                'name': 'Church', 'is_builtin': True,
                'field_schema': [
                    {'key': 'conference', 'label': 'Conference', 'type': 'text',
                     'filterable': True, 'searchable': True},
                    {'key': 'pastor', 'label': 'Pastor', 'type': 'text',
                     'filterable': False, 'searchable': True},
                ],
            },
        )
        self.choir, _ = CommunityCategory.objects.update_or_create(
            slug='choir',
            defaults={
                'name': 'Choir', 'is_builtin': True,
                'field_schema': [{'key': 'genre', 'label': 'Genre', 'type': 'text',
                                  'filterable': True, 'searchable': False}],
            },
        )
        self.central = Group.objects.create(
            creator=self.user, name='Central SDA', slug='central-sda',
            category=self.church, is_private=False, kind=Group.KIND_COMMUNITY,
            details={'conference': 'Central Kenya', 'pastor': 'J. Mwangi'},
        )
        self.coast = Group.objects.create(
            creator=self.user, name='Coast SDA', slug='coast-sda',
            category=self.church, is_private=False, kind=Group.KIND_COMMUNITY,
            details={'conference': 'Coast', 'pastor': 'A. Otieno'},
        )
        self.singers = Group.objects.create(
            creator=self.user, name='Joyful Singers', slug='joyful-singers',
            category=self.choir, is_private=False, kind=Group.KIND_COMMUNITY,
            details={'genre': 'gospel'},
        )

    def _names(self, res):
        return {row['name'] for row in res.data['results']}

    def test_filters_by_category(self):
        res = self.client.get('/api/communities/?category=church')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(self._names(res), {'Central SDA', 'Coast SDA'})

    def test_filters_by_a_category_specific_field(self):
        res = self.client.get('/api/communities/?category=church&conference=Coast')
        self.assertEqual(self._names(res), {'Coast SDA'})

    def test_search_spans_searchable_detail_fields(self):
        """Searching a church by its pastor worked in the old directory."""
        res = self.client.get('/api/communities/?category=church&search=Mwangi')
        self.assertEqual(self._names(res), {'Central SDA'})

    def test_search_ignores_fields_not_marked_searchable(self):
        res = self.client.get('/api/communities/?category=choir&search=gospel')
        self.assertEqual(self._names(res), set())

    def test_unknown_query_param_is_not_treated_as_a_filter(self):
        """Only keys a category declares become lookups — a stray param must not
        silently filter (or blow up) the list."""
        res = self.client.get('/api/communities/?category=church&nonsense=zzz')
        self.assertEqual(self._names(res), {'Central SDA', 'Coast SDA'})

    def test_category_detail_carries_the_field_schema(self):
        """The client renders a community's extra fields from this."""
        res = self.client.get('/api/communities/central-sda/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['category_detail']['slug'], 'church')
        keys = [f['key'] for f in res.data['category_detail']['field_schema']]
        self.assertEqual(keys, ['conference', 'pastor'])
        self.assertEqual(res.data['details']['pastor'], 'J. Mwangi')

    def test_a_choir_can_belong_to_a_church(self):
        """Replaces the old Choir.church foreign key."""
        self.singers.parent = self.central
        self.singers.save()
        res = self.client.get('/api/communities/?parent=central-sda')
        self.assertEqual(self._names(res), {'Joyful Singers'})


class CommunityMembershipTests(APITestCase):
    """Membership/roles survive the merge — a church admin is a group admin."""

    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'pw12345!')
        self.cat, _ = CommunityCategory.objects.get_or_create(
            slug='church', defaults={'name': 'Church'}
        )
        self.community = Group.objects.create(
            creator=self.owner, name='Central SDA', slug='central-sda',
            category=self.cat, is_private=False, kind=Group.KIND_COMMUNITY,
        )
        GroupMember.objects.create(group=self.community, user=self.owner, is_admin=True)

    def test_creator_is_an_admin_member(self):
        self.client.force_authenticate(self.owner)
        res = self.client.get('/api/communities/central-sda/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['is_admin'])
        self.assertTrue(res.data['is_member'])


class GroupsAndCommunitiesAreSeparateTests(APITestCase):
    """Merging choir+church onto the group engine must not merge the two
    features: a group is a private circle you make, a community is a public
    place anyone can start. They share machinery, not listings."""

    def setUp(self):
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.cat, _ = CommunityCategory.objects.get_or_create(
            slug='church', defaults={'name': 'Church'}
        )
        self.community = Group.objects.create(
            creator=self.user, name='Central SDA', slug='central-sda',
            category=self.cat, is_private=False, kind=Group.KIND_COMMUNITY,
        )
        self.group = Group.objects.create(
            creator=self.user, name='Tech Circle', slug='tech-circle',
            is_private=False, kind=Group.KIND_GROUP,
        )

    def _names(self, res):
        return {row['name'] for row in res.data['results']}

    def test_community_list_excludes_groups(self):
        res = self.client.get('/api/communities/')
        self.assertEqual(self._names(res), {'Central SDA'})

    def test_group_list_excludes_communities(self):
        res = self.client.get('/api/groups/')
        self.assertEqual(self._names(res), {'Tech Circle'})

    def test_creating_via_communities_marks_it_a_community(self):
        res = self.client.post('/api/communities/', {
            'name': 'Kenya Headlines', 'category': self.cat.id,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        self.assertEqual(Group.objects.get(name='Kenya Headlines').kind, Group.KIND_COMMUNITY)

    def test_creating_via_groups_marks_it_a_group_and_drops_any_category(self):
        """A group has no category — passing one must not smuggle it into the
        community listing."""
        res = self.client.post('/api/groups/', {
            'name': 'Study Circle', 'category': self.cat.id,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        created = Group.objects.get(name='Study Circle')
        self.assertEqual(created.kind, Group.KIND_GROUP)
        self.assertIsNone(created.category)

    def test_shared_engine_still_serves_both_on_detail(self):
        """Chat, members and moderation are common to both, so detail routes
        must resolve either kind."""
        for slug in ('central-sda', 'tech-circle'):
            res = self.client.get(f'/api/groups/{slug}/')
            self.assertEqual(res.status_code, status.HTTP_200_OK, slug)


class CommunityJoinRulesTests(APITestCase):
    """Public means open, private means invited — the difference a user is
    actually choosing when they create a community."""

    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'pw12345!')
        self.joiner = User.objects.create_user('joiner', 'j@x.com', 'pw12345!')
        self.cat, _ = CommunityCategory.objects.get_or_create(
            slug='news', defaults={'name': 'News'}
        )
        self.open_c = Group.objects.create(
            creator=self.owner, name='Kenya Headlines', slug='kenya-headlines',
            category=self.cat, is_private=False, kind=Group.KIND_COMMUNITY,
        )
        self.closed_c = Group.objects.create(
            creator=self.owner, name='Elders Only', slug='elders-only',
            category=self.cat, is_private=True, kind=Group.KIND_COMMUNITY,
        )
        self.group = Group.objects.create(
            creator=self.owner, name='Tech Circle', slug='tech-circle',
            is_private=False, kind=Group.KIND_GROUP,
        )
        for g in (self.open_c, self.closed_c, self.group):
            GroupMember.objects.create(group=g, user=self.owner, is_admin=True)
        self.client.force_authenticate(self.joiner)

    def test_anyone_joins_a_public_community_instantly(self):
        res = self.client.post('/api/communities/kenya-headlines/request-join/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.content[:300])
        self.assertTrue(res.data.get('joined'))
        self.assertTrue(GroupMember.objects.filter(group=self.open_c, user=self.joiner).exists())

    def test_private_community_is_not_joinable_by_a_stranger(self):
        """A private community isn't even visible to someone outside it, so the
        open-join path can't be reached by guessing its slug."""
        res = self.client.post('/api/communities/elders-only/request-join/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(GroupMember.objects.filter(group=self.closed_c, user=self.joiner).exists())

    def test_private_community_admits_people_the_admin_adds(self):
        """Private communities fill by invitation, the way groups do."""
        GroupMember.objects.create(group=self.closed_c, user=self.joiner)
        res = self.client.get('/api/communities/?scope=mine')
        self.assertIn('Elders Only', {r['name'] for r in res.data['results']})

    def test_public_group_is_unchanged_and_still_asks(self):
        """Groups keep the behaviour they had — only communities opened up."""
        res = self.client.post('/api/groups/tech-circle/request-join/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        self.assertFalse(GroupMember.objects.filter(group=self.group, user=self.joiner).exists())
        self.assertTrue(GroupJoinRequest.objects.filter(
            group=self.group, user=self.joiner, status='pending').exists())

    def test_joining_twice_is_refused(self):
        self.client.post('/api/communities/kenya-headlines/request-join/', {}, format='json')
        res = self.client.post('/api/communities/kenya-headlines/request-join/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(GroupMember.objects.filter(
            group=self.open_c, user=self.joiner).count(), 1)


class CommunityScopeTests(APITestCase):
    """The three tabs, resolved server-side so they page instead of filtering
    whichever rows happened to load."""

    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'pw12345!')
        self.me = User.objects.create_user('me', 'm@x.com', 'pw12345!')
        self.cat, _ = CommunityCategory.objects.get_or_create(
            slug='news', defaults={'name': 'News'}
        )
        mk = lambda name, slug, priv: Group.objects.create(
            creator=self.owner, name=name, slug=slug, category=self.cat,
            is_private=priv, kind=Group.KIND_COMMUNITY,
        )
        self.pub = mk('Open One', 'open-one', False)
        self.pub2 = mk('Open Two', 'open-two', False)
        self.priv = mk('Closed One', 'closed-one', True)
        # I'm a member of one public and the private one.
        GroupMember.objects.create(group=self.pub, user=self.me)
        GroupMember.objects.create(group=self.priv, user=self.me)
        self.client.force_authenticate(self.me)

    def _names(self, res):
        return {r['name'] for r in res.data['results']}

    def test_public_scope(self):
        res = self.client.get('/api/communities/?scope=public')
        self.assertEqual(self._names(res), {'Open One', 'Open Two'})

    def test_private_scope_shows_only_ones_im_in(self):
        res = self.client.get('/api/communities/?scope=private')
        self.assertEqual(self._names(res), {'Closed One'})

    def test_mine_scope_is_what_ive_joined(self):
        res = self.client.get('/api/communities/?scope=mine')
        self.assertEqual(self._names(res), {'Open One', 'Closed One'})

    def test_mine_has_no_duplicate_rows(self):
        """The membership join must not multiply a row per member."""
        GroupMember.objects.create(group=self.pub, user=self.owner)
        res = self.client.get('/api/communities/?scope=mine')
        names = [r['name'] for r in res.data['results']]
        self.assertEqual(len(names), len(set(names)), names)

    def test_scope_combines_with_category(self):
        res = self.client.get('/api/communities/?scope=mine&category=news')
        self.assertEqual(self._names(res), {'Open One', 'Closed One'})


class CommunityCreatedTheWayTheAppDoesTests(APITestCase):
    """The app submits the create form as multipart FormData, not JSON — and it
    posts to whichever route matches the screen it came from. Both mattered: a
    community posted to /groups/ came back a group with its category stripped.
    """

    def setUp(self):
        self.user = User.objects.create_user('mark', 'm@x.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.cat, _ = CommunityCategory.objects.update_or_create(
            slug='news',
            defaults={'name': 'News', 'field_schema': [
                {'key': 'region', 'label': 'Region', 'type': 'text',
                 'filterable': True, 'searchable': True}]},
        )

    def _post(self, path, **extra):
        payload = {
            'name': 'Media And Events',
            'description': 'media desk',
            'is_private': 'false',
            'category': str(self.cat.id),
            'details': json.dumps({'region': 'Nyanza'}),
        }
        payload.update(extra)
        return self.client.post(path, payload, format='multipart')

    def test_multipart_create_lands_in_communities(self):
        res = self._post('/api/communities/')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        made = Group.objects.get(name='Media And Events')
        self.assertEqual(made.kind, Group.KIND_COMMUNITY)
        self.assertEqual(made.category, self.cat)

    def test_multipart_details_json_is_parsed_not_stored_as_a_string(self):
        """FormData carries JSON as text; if it were kept as a string the
        directory filters would never match."""
        self._post('/api/communities/')
        made = Group.objects.get(name='Media And Events')
        self.assertIsInstance(made.details, dict, made.details)
        self.assertEqual(made.details.get('region'), 'Nyanza')

    def test_the_detail_is_actually_filterable_after_a_multipart_create(self):
        self._post('/api/communities/')
        res = self.client.get('/api/communities/?category=news&region=Nyanza')
        self.assertEqual({r['name'] for r in res.data['results']}, {'Media And Events'})

    def test_it_shows_in_the_community_list_and_not_the_group_list(self):
        self._post('/api/communities/')
        res = self.client.get('/api/communities/')
        self.assertIn('Media And Events', {r['name'] for r in res.data['results']})
        res = self.client.get('/api/groups/')
        self.assertNotIn('Media And Events', {r['name'] for r in res.data['results']})

    def test_the_same_form_posted_to_groups_still_makes_a_plain_group(self):
        res = self._post('/api/groups/')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.content[:300])
        made = Group.objects.get(name='Media And Events')
        self.assertEqual(made.kind, Group.KIND_GROUP)
        self.assertIsNone(made.category)
