from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from songs.models import Role, User, Wallpaper

R2 = 'https://pub-test.r2.dev/wallpapers'


class WallpaperTests(APITestCase):
    """Admins holding `manage_wallpapers` curate the app background set;
    everyone else may only read the active list."""

    def setUp(self):
        cache.clear()
        # Migration 0078 seeds the legacy wallpapers, so start from a clean
        # table — these tests assert on exact list contents.
        Wallpaper.objects.all().delete()
        self.admin = User.objects.create_user(username='wpadmin', email='wpa@t.local', password='pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])

        self.plain = User.objects.create_user(username='wpplain', email='wpp@t.local', password='pw')

        self.active = Wallpaper.objects.create(image=f'{R2}/a.jpg', title='A', sort_order=1)
        self.inactive = Wallpaper.objects.create(image=f'{R2}/b.jpg', title='B', is_active=False, sort_order=2)

    # -- reading --------------------------------------------------------------
    def test_list_is_public_and_only_returns_active(self):
        # Unauthenticated: a cold start must not race the token refresh.
        res = self.client.get('/api/wallpapers/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        titles = [w['title'] for w in res.data]
        self.assertEqual(titles, ['A'])

    def test_list_exposes_the_resolved_url(self):
        res = self.client.get('/api/wallpapers/')
        self.assertEqual(res.data[0]['image_url'], f'{R2}/a.jpg')

    def test_admin_can_see_deactivated_ones_with_all(self):
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api/wallpapers/', {'all': '1'})
        self.assertEqual(len(res.data), 2)

    def test_rotation_order_follows_sort_order(self):
        Wallpaper.objects.create(image=f'{R2}/c.jpg', title='C', sort_order=0)
        res = self.client.get('/api/wallpapers/')
        self.assertEqual([w['title'] for w in res.data], ['C', 'A'])

    # -- writing is capability-gated ------------------------------------------
    def test_plain_user_cannot_upload(self):
        self.client.force_authenticate(self.plain)
        res = self.client.post('/api/wallpapers/', {'image': f'{R2}/x.jpg', 'title': 'X'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Wallpaper.objects.filter(title='X').exists())

    def test_anonymous_cannot_upload(self):
        res = self.client.post('/api/wallpapers/', {'image': f'{R2}/x.jpg'})
        self.assertIn(res.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
        self.assertFalse(Wallpaper.objects.filter(image=f'{R2}/x.jpg').exists())

    def test_admin_can_upload_and_is_recorded_as_uploader(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/wallpapers/', {'image': f'{R2}/new.jpg', 'title': 'New'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Wallpaper.objects.get(title='New').uploaded_by, self.admin)

    def test_delegated_capability_grants_access(self):
        role = Role.objects.create(name='Wallpaper editor', capabilities=['manage_wallpapers'])
        self.plain.role = role
        self.plain.save(update_fields=['role'])

        self.client.force_authenticate(self.plain)
        res = self.client.post('/api/wallpapers/', {'image': f'{R2}/d.jpg', 'title': 'D'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_a_different_capability_does_not_grant_access(self):
        role = Role.objects.create(name='Reports only', capabilities=['handle_reports'])
        self.plain.role = role
        self.plain.save(update_fields=['role'])

        self.client.force_authenticate(self.plain)
        res = self.client.post('/api/wallpapers/', {'image': f'{R2}/e.jpg'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_image_must_be_an_absolute_url(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/wallpapers/', {'image': 'not-a-url'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # -- curation -------------------------------------------------------------
    def test_deactivating_removes_it_from_the_public_list(self):
        self.client.force_authenticate(self.admin)
        self.client.patch(f'/api/wallpapers/{self.active.id}/', {'is_active': False})

        self.client.force_authenticate(None)
        res = self.client.get('/api/wallpapers/')
        self.assertEqual(res.data, [])

    def test_reorder_persists_a_new_rotation_order(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/wallpapers/reorder/', {
            'items': [
                {'id': self.active.id, 'sort_order': 9},
                {'id': self.inactive.id, 'sort_order': 3},
            ],
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.active.refresh_from_db()
        self.assertEqual(self.active.sort_order, 9)

    def test_reorder_rejects_a_malformed_payload(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/wallpapers/reorder/', {'items': 'nope'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reorder_is_capability_gated(self):
        self.client.force_authenticate(self.plain)
        res = self.client.post('/api/wallpapers/reorder/', {'items': []}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_removes_the_row(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'/api/wallpapers/{self.active.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Wallpaper.objects.filter(id=self.active.id).exists())


class WallpaperScopeTests(APITestCase):
    """Each surface curates its own set, and the legacy hardcoded images are
    ordinary rows now — so an admin can delete them like any other."""

    def setUp(self):
        cache.clear()
        # Migration 0078 seeds the legacy wallpapers, so start from a clean
        # table — these tests assert on exact list contents.
        Wallpaper.objects.all().delete()
        self.admin = User.objects.create_user(username='wpsadmin', email='wps@t.local', password='pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])

        self.general = Wallpaper.objects.create(image=f'{R2}/g.jpg', title='G', scope='general')
        self.music = Wallpaper.objects.create(image=f'{R2}/m.jpg', title='M', scope='music')

    def test_scope_defaults_to_general(self):
        w = Wallpaper.objects.create(image=f'{R2}/d.jpg')
        self.assertEqual(w.scope, 'general')

    def test_list_returns_every_scope_by_default(self):
        # One round trip; the client groups them itself.
        res = self.client.get('/api/wallpapers/')
        self.assertEqual({w['scope'] for w in res.data}, {'general', 'music'})

    def test_scope_filter_narrows_the_set(self):
        res = self.client.get('/api/wallpapers/', {'scope': 'music'})
        self.assertEqual([w['title'] for w in res.data], ['M'])

    def test_admin_can_delete_a_legacy_wallpaper(self):
        """The point of seeding the old hardcoded images: they are deletable."""
        legacy = Wallpaper.objects.create(image=f'{R2}/s366jodfjqsiikqn39ps.jpg', scope='general')
        self.client.force_authenticate(self.admin)

        res = self.client.delete(f'/api/wallpapers/{legacy.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Wallpaper.objects.filter(id=legacy.id).exists())

    def test_deleting_every_wallpaper_leaves_an_empty_list(self):
        """Deletion has to stick: the API must not re-serve the bundled set,
        or the client would resurrect what the admin just removed."""
        self.client.force_authenticate(self.admin)
        for w in list(Wallpaper.objects.all()):
            self.client.delete(f'/api/wallpapers/{w.id}/')

        res = self.client.get('/api/wallpapers/')
        self.assertEqual(res.data, [])

    def test_uploading_to_one_scope_does_not_touch_the_other(self):
        self.client.force_authenticate(self.admin)
        self.client.post('/api/wallpapers/', {'image': f'{R2}/new.jpg', 'scope': 'music'})

        res = self.client.get('/api/wallpapers/', {'scope': 'general'})
        self.assertEqual([w['title'] for w in res.data], ['G'])


class LegacyWallpaperSeedTests(APITestCase):
    """Migration 0078 puts the previously-hardcoded images into the table. This
    guards the whole point of it: nothing about the app's backgrounds is beyond
    an admin's reach any more."""

    def test_the_legacy_images_exist_as_editable_rows(self):
        # No table wipe here — we are asserting on what the migration created.
        seeded = Wallpaper.objects.filter(image__contains='r2.dev/wallpapers')
        self.assertGreaterEqual(seeded.count(), 10)

        scopes = set(seeded.values_list('scope', flat=True))
        self.assertEqual(scopes, {'general', 'music'})

    def test_a_seeded_wallpaper_can_be_deleted_by_an_admin(self):
        admin = User.objects.create_user(username='seedadmin', email='sa@t.local', password='pw')
        admin.admin_role = 'super_admin'
        admin.save(update_fields=['admin_role'])

        target = Wallpaper.objects.filter(scope='music').first()
        self.assertIsNotNone(target, 'expected the migration to seed music wallpapers')

        self.client.force_authenticate(admin)
        res = self.client.delete(f'/api/wallpapers/{target.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Wallpaper.objects.filter(id=target.id).exists())


class WallpaperReactivateTests(APITestCase):
    """Regression: a deactivated wallpaper must stay reachable for detail
    actions. It used to fall out of get_queryset() once is_active went False,
    so switching it back ON 404d — you could hide a wallpaper but never unhide
    it."""

    def setUp(self):
        cache.clear()
        Wallpaper.objects.all().delete()
        self.admin = User.objects.create_user(username='wpreact', email='wpr@t.local', password='pw')
        self.admin.admin_role = 'super_admin'
        self.admin.save(update_fields=['admin_role'])
        self.hidden = Wallpaper.objects.create(image=f'{R2}/h.jpg', title='H', is_active=False)

    def test_a_hidden_wallpaper_can_be_switched_back_on(self):
        self.client.force_authenticate(self.admin)
        res = self.client.patch(f'/api/wallpapers/{self.hidden.id}/', {'is_active': True})

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.hidden.refresh_from_db()
        self.assertTrue(self.hidden.is_active)

    def test_hide_then_unhide_round_trips(self):
        self.client.force_authenticate(self.admin)
        active = Wallpaper.objects.create(image=f'{R2}/r.jpg', title='R', is_active=True)

        off = self.client.patch(f'/api/wallpapers/{active.id}/', {'is_active': False})
        self.assertEqual(off.status_code, status.HTTP_200_OK)
        on = self.client.patch(f'/api/wallpapers/{active.id}/', {'is_active': True})
        self.assertEqual(on.status_code, status.HTTP_200_OK)

        active.refresh_from_db()
        self.assertTrue(active.is_active)

    def test_a_hidden_wallpaper_can_still_be_deleted(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'/api/wallpapers/{self.hidden.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_hidden_rows_stay_out_of_the_public_list(self):
        res = self.client.get('/api/wallpapers/')
        self.assertEqual(res.data, [])

    def test_all_flag_is_ignored_for_a_caller_without_the_capability(self):
        # Otherwise anyone could enumerate wallpapers taken out of rotation.
        res = self.client.get('/api/wallpapers/', {'all': '1'})
        self.assertEqual(res.data, [])

        plain = User.objects.create_user(username='wpnosee', email='wpn@t.local', password='pw')
        self.client.force_authenticate(plain)
        res = self.client.get('/api/wallpapers/', {'all': '1'})
        self.assertEqual(res.data, [])

    def test_all_flag_works_for_an_admin(self):
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api/wallpapers/', {'all': '1'})
        self.assertEqual([w['title'] for w in res.data], ['H'])
