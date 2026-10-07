"""Admin phase 3: the quiz bank, the puzzle themes and the verified tick,
run from the app, each by its own capability, every change logged.

    python manage.py test songs.tests.test_admin_tools --settings=music.settings_test
"""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APITestCase

from songs.models import (
    AdminActionLog, BankQuestion, Organization, PuzzleTheme, Role, SellerProfile, User,
)


def make(name, **extra):
    return User.objects.create_user(name, f'{name}@x.com', 'pw', **extra)


class QuizBankTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.editor = make('editor', role=Role.objects.create(name='Quiz', capabilities=['manage_quiz']))
        self.client.force_authenticate(self.editor)

    def body(self, **extra):
        return {'kind': 'who_said', 'language': 'en', 'difficulty': 'simple', 'prompt': 'Who said "Let there be light"?',
                'choices': ['God', 'Moses', 'David'], 'answer_index': 0, 'reference': 'Genesis 1:3', **extra}

    def test_write_edit_and_retire(self):
        res = self.client.post('/api/admin/quiz-bank/', self.body(), format='json')
        self.assertEqual(res.status_code, 201, res.data)
        qid = res.data['id']
        res = self.client.patch(f'/api/admin/quiz-bank/{qid}/', {'answer_index': 1}, format='json')
        self.assertEqual(res.data['answer_index'], 1)
        self.client.delete(f'/api/admin/quiz-bank/{qid}/')
        self.assertFalse(BankQuestion.objects.get(pk=qid).is_active)   # kept, not deleted
        self.assertTrue(AdminActionLog.objects.filter(action='create_question', target_id=qid).exists())

    def test_a_question_that_does_not_add_up_is_refused(self):
        for bad in (self.body(choices=['Only one']), self.body(answer_index=5),
                    self.body(kind='true_false', choices=['True', 'False', 'Maybe']), self.body(prompt='  ')):
            self.assertEqual(self.client.post('/api/admin/quiz-bank/', bad, format='json').status_code, 400, bad)

    def test_a_retired_question_comes_back_with_a_fair_start(self):
        q = BankQuestion.objects.create(**{**self.body(), 'is_active': False, 'retired_reason': 'too_hard',
                                          'times_asked': 40, 'times_correct': 1})
        listed = self.client.get('/api/admin/quiz-bank/', {'state': 'retired'}).data['results']
        self.assertEqual([r['id'] for r in listed], [q.id])
        res = self.client.post(f'/api/admin/quiz-bank/{q.id}/activate/')
        self.assertEqual((res.data['is_active'], res.data['times_asked'], res.data['retired_reason']), (True, 0, ''))

    def test_only_with_the_capability(self):
        self.client.force_authenticate(make('member'))
        self.assertEqual(self.client.get('/api/admin/quiz-bank/').status_code, 403)
        self.client.force_authenticate(make('other', role=Role.objects.create(name='Mods', capabilities=['manage_users'])))
        self.assertEqual(self.client.get('/api/admin/quiz-bank/').status_code, 403)


class PuzzleThemeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.force_authenticate(make('editor', role=Role.objects.create(name='P', capabilities=['manage_puzzles'])))

    def test_new_theme_order_and_off(self):
        res = self.client.post('/api/admin/puzzle-themes/', {
            'name': 'Test Faith', 'name_sw': 'Imani (test)', 'source': {'kind': 'topic', 'term': 'faith', 'term_sw': 'imani'},
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        other = PuzzleTheme.objects.create(name='Test Law', slug='test-law', source={'kind': 'books', 'first': 1, 'last': 5})
        self.client.post('/api/admin/puzzle-themes/reorder/', {'ids': [res.data['id'], other.id]}, format='json')
        self.assertEqual(PuzzleTheme.objects.get(pk=res.data['id']).order, 0)
        self.client.patch(f'/api/admin/puzzle-themes/{other.id}/', {'is_active': False}, format='json')
        self.assertFalse(PuzzleTheme.objects.get(pk=other.id).is_active)

    def test_a_source_that_says_nothing_is_refused(self):
        for source in ({'kind': 'books', 'first': 5, 'last': 1}, {'kind': 'passage', 'book': 'Psalms'},
                       {'kind': 'topic', 'term': ' '}, {'kind': 'random'}):
            res = self.client.post('/api/admin/puzzle-themes/', {'name': f'T{source}', 'source': source}, format='json')
            self.assertEqual(res.status_code, 400, source)

    def test_theme_words_stay_editable_once_levels_exist(self):
        from songs.models import WordPuzzle
        theme = PuzzleTheme.objects.create(name='Test Law', slug='test-law',
                                           source={'kind': 'books', 'first': 1, 'last': 5})
        WordPuzzle.objects.create(theme=theme, level=1, size=0, grid=[], placements=[])
        res = self.client.patch(f'/api/admin/puzzle-themes/{theme.id}/', {'source': {
            **theme.source, 'words': 'Moses, sinai  x', 'words_sw': ['Musa'], 'term_sw': 'sheria'}}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        theme.refresh_from_db()
        self.assertEqual(theme.source['words'], ['MOSES', 'SINAI'])
        self.assertEqual(theme.source['words_sw'], ['MUSA'])
        # Where the words come from is still fixed.
        res = self.client.patch(f'/api/admin/puzzle-themes/{theme.id}/', {'source': {
            **theme.source, 'last': 6}}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_a_passage_must_name_a_real_book_and_chapter(self):
        bad = self.client.post('/api/admin/puzzle-themes/', {'name': 'Bad', 'source': {
            'kind': 'passage', 'book': 'Psalmz', 'chapter': 1}}, format='json')
        self.assertEqual(bad.status_code, 400)
        long = self.client.post('/api/admin/puzzle-themes/', {'name': 'Long', 'source': {
            'kind': 'passage', 'book': 'Ruth', 'chapter': 9}}, format='json')
        self.assertEqual(long.status_code, 400)
        ok = self.client.post('/api/admin/puzzle-themes/', {'name': 'Ok', 'source': {
            'kind': 'passage', 'book': 'psalms', 'chapter': 23}}, format='json')
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data['source']['book'], 'Psalms')

    def test_no_deleting_a_theme(self):
        theme = PuzzleTheme.objects.create(name='Test Law', slug='test-law', source={'kind': 'books', 'first': 1, 'last': 5})
        self.assertEqual(self.client.delete(f'/api/admin/puzzle-themes/{theme.id}/').status_code, 405)


@mock.patch('songs.push.notify_user')
class VerifyTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client.force_authenticate(make('checker', role=Role.objects.create(name='V', capabilities=['verify_accounts'])))
        self.seller = make('ivy')
        self.profile = SellerProfile.objects.create(user=self.seller)

    def test_tick_given_and_taken_with_a_reason(self, notify):
        res = self.client.post('/api/admin/verify/set/', {'kind': 'seller', 'id': self.profile.id, 'verified': True},
                               format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_verified)
        notify.assert_called_once()
        # Taking it needs a reason.
        res = self.client.post('/api/admin/verify/set/', {'kind': 'seller', 'id': self.profile.id, 'verified': False},
                               format='json')
        self.assertEqual(res.data['code'], 'reason_required')
        self.client.post('/api/admin/verify/set/', {'kind': 'seller', 'id': self.profile.id, 'verified': False,
                                                    'reason': 'Not who they said'}, format='json')
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_verified)
        self.assertTrue(AdminActionLog.objects.filter(action='unverify_seller', reason='Not who they said').exists())

    def test_lists_by_kind_and_state(self, notify):
        Organization.objects.create(name='Central Conference', slug='cc', is_verified=True)
        Organization.objects.create(name='Hope Church', slug='hope')
        rows = self.client.get('/api/admin/verify/', {'kind': 'organization', 'state': 'unverified'}).data['results']
        self.assertEqual([r['name'] for r in rows], ['Hope Church'])
        self.assertEqual(self.client.get('/api/admin/verify/', {'kind': 'nonsense'}).status_code, 400)
