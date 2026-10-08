from django.core import mail
from django.test import TestCase
from rest_framework.test import APITestCase

from songs.emails import render_html, send_branded_mail
from songs.models import EmailVerification, User


class BrandedEmailTests(TestCase):
    def test_text_and_html_with_the_logo_inside(self):
        send_branded_mail('Adventist Life — Verify your email',
                          'Hi ann,\n\nYour verification code is: 482913\n\nThis code expires in 15 minutes.\n\n— Adventist Life Team',
                          None, ['ann@x.com'], code='482913')
        m = mail.outbox[0]
        self.assertIn('Your verification code is: 482913', m.body)           # the text is unchanged
        html = m.alternatives[0][0]
        self.assertIn('cid:adventist-life-logo', html)
        self.assertIn('>482913</div>', html)                                 # the code in its box
        logo = [a for a in m.attachments if getattr(a, 'get', None) and a.get('Content-ID') == '<adventist-life-logo>']
        self.assertEqual(len(logo), 1)
        self.assertEqual(m.mixed_subtype, 'related')                         # shown in the email, not a download

    def test_what_people_wrote_cannot_become_markup(self):
        html = render_html('Hi <b>x</b>,\n\nYour post "<script>alert(1)</script>" was removed.')
        self.assertNotIn('<script>', html)
        self.assertNotIn('<b>x</b>', html)
        self.assertIn('&lt;script&gt;', html)

    def test_the_sentence_before_the_code_stays_and_the_code_shows_once(self):
        html = render_html('Your password reset code is: 111222', code='111222')
        self.assertIn('Your password reset code is:', html)
        self.assertEqual(html.count('111222'), 2)                            # the box, and the inbox preview line


class SignUpEmailTests(APITestCase):
    def test_the_verification_email_is_branded(self):
        from songs.views.auth import _send_verification_email
        u = User.objects.create_user('newbie', 'newbie@x.com', 'pw-12345678')
        code = _send_verification_email(u, background=False)
        self.assertEqual(EmailVerification.objects.get(user=u).code, code)
        m = mail.outbox[-1]
        self.assertIn(code, m.body)
        self.assertIn(f'>{code}</div>', m.alternatives[0][0])
