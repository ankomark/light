"""New books, products and services as cards in the feed (songs/feed_cards.py):
posted when they go up unless the owner says no, one card per thing, gone
with their thing, and spaced out in the For You feed."""
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from songs.feed import space_cards
from songs.models import Product, Publication, SocialPost, User, Videostudio

R2 = 'https://media.example.test'


def follow(fan, author):
    author.followers.add(fan)


@override_settings(R2_PUBLIC_BASE=R2)
class ProductCardTests(APITestCase):
    def setUp(self):
        self.seller = User.objects.create_user('seller', 's@x.com', 'x')
        self.client.force_authenticate(self.seller)

    def sell(self, **extra):
        body = {'title': 'Study Bible', 'description': 'Leather, new', 'price': '1500.00', 'quantity': 1,
                'category': 'Books', 'currency': 'KES', **extra}
        res = self.client.post('/api/marketplace/products/', body, format='json')
        self.assertEqual(res.status_code, 201, res.content[:300])
        return Product.objects.get(slug=res.json()['slug'])

    def test_a_new_product_is_posted_as_its_card(self):
        product = self.sell()
        post = SocialPost.objects.get(content_type='product', product=product)
        self.assertEqual(post.user, self.seller)
        self.assertEqual(post.visibility, SocialPost.VISIBILITY_PUBLIC)

    def test_the_seller_may_say_no(self):
        for off in (False, 'false', '0', 'off'):
            product = self.sell(title=f'Hymnal {off}', share_to_feed=off)
            self.assertFalse(SocialPost.objects.filter(product=product).exists(), off)

    def test_the_card_carries_the_product(self):
        product = self.sell()
        fan = User.objects.create_user('fan', 'f@x.com', 'x')
        follow(fan, self.seller)
        self.client.force_authenticate(fan)
        rows = self.client.get('/api/social-posts/?feed=following').json()
        rows = rows.get('results', rows)
        card = next(r for r in rows if r['content_type'] == 'product')
        self.assertEqual(card['product']['slug'], product.slug)
        self.assertEqual(card['product']['title'], 'Study Bible')
        self.assertEqual(card['product']['price'], '1500.00')

    def test_a_card_goes_quiet_with_its_product(self):
        product = self.sell()
        post = SocialPost.objects.get(product=product)
        fan = User.objects.create_user('fan2', 'f2@x.com', 'x')
        follow(fan, self.seller)
        self.client.force_authenticate(fan)

        def shown():
            rows = self.client.get('/api/social-posts/?feed=following').json()
            return post.id in [r['id'] for r in rows.get('results', rows)]

        self.assertTrue(shown())
        Product.objects.filter(pk=product.pk).update(is_available=False)
        self.assertFalse(shown())
        Product.objects.filter(pk=product.pk).update(is_available=True, is_removed=True)
        self.assertFalse(shown())
        product.delete()
        self.assertFalse(SocialPost.objects.filter(pk=post.pk).exists())


@override_settings(R2_PUBLIC_BASE=R2)
class ServiceCardTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner', 'o@x.com', 'x')
        self.client.force_authenticate(self.owner)

    def list_service(self, **extra):
        res = self.client.post('/api/video-studios/', {
            'name': 'Hope Clinic', 'location': 'Kisumu', 'category': 'health', 'service_types': ['clinic'],
            'cover_image': f'{R2}/cover/1.jpg', **extra,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return Videostudio.objects.get(pk=res.data['id'])

    def test_a_new_service_is_posted_with_its_cover(self):
        service = self.list_service()
        post = SocialPost.objects.get(content_type='service', service=service)
        res = self.client.get(f'/api/social-posts/{post.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['service']['name'], 'Hope Clinic')
        self.assertEqual(res.data['service']['cover'], f'{R2}/cover/1.jpg')
        self.assertEqual(res.data['thumbnail_url'], f'{R2}/cover/1.jpg')   # the grid still

    def test_the_owner_may_say_no(self):
        service = self.list_service(share_to_feed=False)
        self.assertFalse(SocialPost.objects.filter(service=service).exists())


class BookCardTests(APITestCase):
    def setUp(self):
        self.author = User.objects.create_user('author', 'a@x.com', 'x')
        self.client.force_authenticate(self.author)

    def test_published_once_means_one_card(self):
        res = self.client.post('/api/publications/', {
            'title': 'Grace Notes', 'category': 'devotional', 'status': 'draft',
            'chapters': [{'order': 1, 'title': 'One', 'body': 'In the beginning.'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content[:300])
        pub_id = res.json()['id']
        self.assertFalse(SocialPost.objects.filter(publication_id=pub_id).exists())   # a draft: nothing

        res = self.client.patch(f'/api/publications/{pub_id}/',
                                {'status': 'published', 'rights_confirmed': True}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertEqual(SocialPost.objects.filter(publication_id=pub_id, content_type='book').count(), 1)

        # Out of print and back again: still the one card.
        self.client.patch(f'/api/publications/{pub_id}/', {'status': 'draft'}, format='json')
        self.client.patch(f'/api/publications/{pub_id}/', {'status': 'published'}, format='json')
        self.assertEqual(SocialPost.objects.filter(publication_id=pub_id, content_type='book').count(), 1)

    def test_published_straight_away_unless_the_author_says_no(self):
        body = {'category': 'devotional', 'status': 'published', 'rights_confirmed': True,
                'chapters': [{'order': 1, 'title': 'One', 'body': 'Words.'}]}
        yes = self.client.post('/api/publications/', {**body, 'title': 'Yes'}, format='json')
        no = self.client.post('/api/publications/', {**body, 'title': 'No', 'share_to_feed': False}, format='json')
        self.assertEqual((yes.status_code, no.status_code), (201, 201), (yes.content[:200], no.content[:200]))
        self.assertTrue(SocialPost.objects.filter(publication_id=yes.json()['id']).exists())
        self.assertFalse(SocialPost.objects.filter(publication_id=no.json()['id']).exists())
        self.assertEqual(Publication.objects.get(pk=no.json()['id']).status, 'published')


class SpacingTests(TestCase):
    def test_at_most_one_card_in_five_never_two_in_a_row(self):
        ordered = list(range(1, 31))
        cards = {2, 3, 4, 5, 12, 13, 20}
        out = space_cards(ordered, cards)
        for i in range(len(out) - 4):
            self.assertLessEqual(sum(1 for p in out[i:i + 5] if p in cards), 1, out)
        # Ordinary posts keep their order and all stay.
        self.assertEqual([p for p in out if p not in cards], [p for p in ordered if p not in cards])

    def test_no_cards_no_change(self):
        self.assertEqual(space_cards([5, 4, 3], set()), [5, 4, 3])

    def test_cards_that_cannot_fit_wait(self):
        self.assertEqual(space_cards([1, 2, 3], {1, 2, 3}), [1])
