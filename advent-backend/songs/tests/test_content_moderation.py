from decimal import Decimal

from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import (
    User, Profile, Publication, Product, ProductReview, Group, GroupPost,
    Choir, ChoirMessage, Church, ChurchMessage, Videostudio, MediaStation,
    SocialPost,
)


def _rows(res):
    data = res.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


class ContentModerationTests(APITestCase):
    """Every user-generated content type is now takedown/restore-able by an
    admin, and a takedown must actually disappear from public reads."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('cmadmin', 'cmadmin@t.local', 'pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.author = User.objects.create_user('cmauthor', 'cmauthor@t.local', 'pw')

        self.pub = Publication.objects.create(title='Article', author=self.author, status='published')
        self.product = Product.objects.create(
            seller=self.author, title='Widget', description='d',
            price=Decimal('9.99'), quantity=3, slug='cm-widget', currency='USD',
        )
        self.review = ProductReview.objects.create(
            product=self.product, reviewer=self.admin, rating=1, comment='bad',
        )
        self.group = Group.objects.create(name='G', creator=self.author, is_private=False, slug='cm-g')
        self.gpost = GroupPost.objects.create(group=self.group, user=self.author, content='hi group')
        self.choir = Choir.objects.create(name='Voices', location='Nairobi', created_by=self.author)
        self.cmsg = ChoirMessage.objects.create(choir=self.choir, sender=self.author, content='hi choir')
        self.church = Church.objects.create(
            name='Central', country='Kenya', conference='CKC', location='Nairobi', created_by=self.author,
        )
        self.chmsg = ChurchMessage.objects.create(church=self.church, sender=self.author, content='hi church')
        self.studio = Videostudio.objects.create(
            name='HopeWorks', location='Nairobi', service_types=['editing'], created_by=self.author,
        )
        self.station = MediaStation.objects.create(name='Hope TV', created_by=self.author)

        # (type, instance) for the uniform admin remove/restore loop.
        self.targets = [
            ('publication', self.pub), ('product', self.product), ('productreview', self.review),
            ('grouppost', self.gpost), ('choirmessage', self.cmsg), ('churchmessage', self.chmsg),
            ('church', self.church), ('choir', self.choir),
            ('videostudio', self.studio), ('mediastation', self.station),
        ]

    def _remove(self, ctype, obj):
        return self.client.post('/api/admin/content/remove/', {'type': ctype, 'id': obj.id})

    def _restore(self, ctype, obj):
        return self.client.post('/api/admin/content/restore/', {'type': ctype, 'id': obj.id})

    # ── uniform admin control over every type ────────────────────────────────
    def test_admin_can_list_remove_and_restore_every_content_type(self):
        self.client.force_authenticate(self.admin)
        for ctype, obj in self.targets:
            listing = self.client.get('/api/admin/content/', {'type': ctype})
            self.assertEqual(listing.status_code, status.HTTP_200_OK, ctype)
            self.assertIn(obj.id, {r['id'] for r in _rows(listing)}, f'{ctype} not listed')

            self.assertEqual(self._remove(ctype, obj).status_code, status.HTTP_200_OK, ctype)
            obj.refresh_from_db()
            self.assertTrue(obj.is_removed, f'{ctype} not removed')

            self.assertEqual(self._restore(ctype, obj).status_code, status.HTTP_200_OK, ctype)
            obj.refresh_from_db()
            self.assertFalse(obj.is_removed, f'{ctype} not restored')

    def test_non_admin_cannot_remove_content(self):
        self.client.force_authenticate(self.author)
        res = self._remove('product', self.product)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_removed)

    # ── takedown actually hides content from public reads ────────────────────
    def _visible(self, url, obj_id, **params):
        res = self.client.get(url, params)
        return obj_id in {r['id'] for r in _rows(res)}

    def test_removed_content_disappears_from_public_lists(self):
        # (public list url, ctype, instance). ctype travels with each row: these
        # objects live in different tables and all get id=1 in a fresh DB, so a
        # dict keyed by .id would collide and remove the wrong type.
        checks = [
            ('/api/publications/', 'publication', self.pub, {}),
            ('/api/marketplace/products/', 'product', self.product, {}),
            (f'/api/marketplace/products/{self.product.slug}/reviews/', 'productreview', self.review, {}),
            ('/api/churches/', 'church', self.church, {}),
            ('/api/choirs/', 'choir', self.choir, {}),
            ('/api/video-studios/', 'videostudio', self.studio, {}),
            ('/api/media-stations/', 'mediastation', self.station, {}),
        ]

        self.client.force_authenticate(self.author)  # a normal signed-in user
        for url, _ctype, obj, params in checks:
            self.assertTrue(self._visible(url, obj.id, **params), f'{url} should show {obj.id} before removal')

        self.client.force_authenticate(self.admin)
        for _url, ctype, obj, _params in checks:
            self.assertEqual(self._remove(ctype, obj).status_code, status.HTTP_200_OK, ctype)

        self.client.force_authenticate(self.author)
        for url, _ctype, obj, params in checks:
            self.assertFalse(self._visible(url, obj.id, **params), f'{url} still shows removed {obj.id}')

    def test_removing_a_review_drops_the_products_rating(self):
        # A five-star review lifts the average; removing it must pull it back.
        ProductReview.objects.create(product=self.product, reviewer=self.author, rating=5, comment='great')
        res = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertEqual(res.data['review_count'], 2)  # rating 1 + rating 5

        self.client.force_authenticate(self.admin)
        self._remove('productreview', self.review)  # drop the 1-star

        res = self.client.get(f'/api/marketplace/products/{self.product.slug}/')
        self.assertEqual(res.data['review_count'], 1)
        self.assertEqual(res.data['average_rating'], 5.0)


class ProfileGridTakedownTests(APITestCase):
    """The profile post grid used to be the one public surface a takedown stayed
    visible on — the feed hid it, the grid did not. It hides it now, for the
    author too, and the header count agrees with what the grid renders."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('pgadmin', 'pgadmin@t.local', 'pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.author = User.objects.create_user('pgauthor', 'pgauthor@t.local', 'pw')
        Profile.objects.create(user=self.author)
        self.viewer = User.objects.create_user('pgviewer', 'pgviewer@t.local', 'pw')

        self.kept = SocialPost.objects.create(user=self.author, content_type='image')
        self.taken = SocialPost.objects.create(user=self.author, content_type='image')

    def _grid_ids(self):
        res = self.client.get(f'/api/users/{self.author.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        return {p['id'] for p in res.data['social_posts']}

    def _endpoint_ids(self):
        res = self.client.get(f'/api/users/{self.author.id}/social_posts/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        return {p['id'] for p in _rows(res)}

    def _take_down(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/admin/content/remove/', {'type': 'post', 'id': self.taken.id})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_serializer_grid_hides_a_takedown(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._grid_ids(), {self.kept.id, self.taken.id})

        self._take_down()
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._grid_ids(), {self.kept.id})

    def test_social_posts_endpoint_hides_a_takedown(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._endpoint_ids(), {self.kept.id, self.taken.id})

        self._take_down()
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._endpoint_ids(), {self.kept.id})

    def test_the_author_does_not_see_their_own_takedown_either(self):
        self._take_down()
        self.client.force_authenticate(self.author)
        self.assertEqual(self._grid_ids(), {self.kept.id})
        self.assertEqual(self._endpoint_ids(), {self.kept.id})

    def test_posts_count_matches_the_grid(self):
        self._take_down()
        self.client.force_authenticate(self.author)
        res = self.client.get('/api/profiles/me/')
        # A count of 2 over a one-item grid is the mismatch this guards.
        self.assertEqual(res.data['posts_count'], 1)
        self.assertEqual(len(self._grid_ids()), 1)

    def test_a_restore_brings_the_post_back_to_the_grid(self):
        self._take_down()
        self.client.post('/api/admin/content/restore/', {'type': 'post', 'id': self.taken.id})

        self.client.force_authenticate(self.viewer)
        self.assertEqual(self._grid_ids(), {self.kept.id, self.taken.id})
        self.assertEqual(self._endpoint_ids(), {self.kept.id, self.taken.id})


class ReportModerationTests(APITestCase):
    """A reported product resolves to a preview and can be removed from the
    report, closing the earlier gap where only post/comment/track could be."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user('rmadmin', 'rmadmin@t.local', 'pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.seller = User.objects.create_user('rmseller', 'rmseller@t.local', 'pw')
        self.reporter = User.objects.create_user('rmreporter', 'rmrep@t.local', 'pw')
        self.product = Product.objects.create(
            seller=self.seller, title='Scam', description='d',
            price=Decimal('1'), quantity=1, slug='rm-scam', currency='USD',
        )

    def test_report_a_product_then_remove_it_from_the_report(self):
        self.client.force_authenticate(self.reporter)
        r = self.client.post('/api/reports/', {
            'content_type': 'product', 'object_id': self.product.id, 'reason': 'spam',
        })
        self.assertIn(r.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED))
        from songs.models import Report
        report_id = Report.objects.get(content_type='product', object_id=self.product.id).id

        self.client.force_authenticate(self.admin)
        # The admin report list resolves a preview for the product target.
        lst = self.client.get('/api/admin/reports/')
        row = next(x for x in _rows(lst) if x['id'] == report_id)
        self.assertIsNotNone(row.get('target'), 'product report has no preview')

        res = self.client.post(f'/api/admin/reports/{report_id}/remove_target/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertTrue(self.product.is_removed)
