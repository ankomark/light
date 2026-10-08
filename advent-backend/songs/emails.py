"""Branded emails: the app's logo and colours around the plain text it sends.

Every email keeps its plain-text body exactly as before (tests, and mail apps
that show only text, read it) and gains an HTML version built from that same
text, so the two can never say different things:

    Hi name,                          -> greeting
    Your code is: 123456              -> the sentence, then the code in a box
    — Adventist Life Team             -> signed off, muted

The logo travels inside the email (an inline image, ~9 KB) rather than as a
link: it shows in mail apps that block outside images, and needs no server.
"""
import os
from email.mime.image import MIMEImage
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

_LOGO_PATH = os.path.join(os.path.dirname(__file__), 'assets', 'email-logo.png')
_LOGO_CID = 'adventist-life-logo'
_logo_bytes = None

BLUE = '#2F80C0'
NAVY = '#14285A'
INK = '#1F2933'
MUTED = '#6B7785'
PAGE = '#F2F5F9'


def _logo():
    global _logo_bytes
    if _logo_bytes is None:
        try:
            with open(_LOGO_PATH, 'rb') as f:
                _logo_bytes = f.read()
        except OSError:
            _logo_bytes = b''
    return _logo_bytes


def _site():
    return getattr(settings, 'SITE_NAME', 'Adventist Life')


def _paragraph(text, style):
    return f'<p style="margin:0 0 16px;{style}">{escape(text).replace(chr(10), "<br>")}</p>'


def render_html(message, code=None):
    """The HTML version of a plain-text email."""
    parts = [p.strip() for p in message.split('\n\n') if p.strip()]
    body, preheader = [], ''
    for p in parts:
        if p.startswith('— '):
            body.append(_paragraph(p, f'color:{MUTED};font-size:14px;margin-top:8px'))
        elif p.startswith('Hi ') and p.endswith(','):
            body.append(_paragraph(p, f'color:{INK};font-size:16px;font-weight:600'))
        elif code and code in p:
            before = p.split(code, 1)[0].rstrip().rstrip(':').rstrip()
            if before:
                body.append(_paragraph(before + ':', f'color:{INK};font-size:16px'))
            body.append(
                f'<div style="margin:4px 0 20px;padding:18px 12px;background:#EAF3FB;border-radius:12px;'
                f'text-align:center;font-family:Menlo,Consolas,\'Courier New\',monospace;font-size:34px;'
                f'font-weight:700;letter-spacing:10px;color:{NAVY}">{escape(code)}</div>')
            preheader = preheader or p
        else:
            body.append(_paragraph(p, f'color:{INK};font-size:16px;line-height:1.5'))
            if not preheader:
                preheader = p
    site = escape(_site())
    logo = (f'<img src="cid:{_LOGO_CID}" width="56" height="56" alt="" '
            f'style="display:block;border:0;width:56px;height:56px">') if _logo() else ''
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>{site}</title></head>
<body style="margin:0;padding:0;background:{PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{escape(preheader[:140])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE}">
<tr><td align="center" style="padding:28px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:480px;background:#FFFFFF;border-radius:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <tr><td style="padding:28px 28px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px">{logo}</td>
        <td style="font-size:20px;font-weight:800;color:{NAVY};letter-spacing:0.3px">{site}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 28px"><div style="height:3px;background:{BLUE};border-radius:2px;margin:12px 0 24px"></div></td></tr>
    <tr><td style="padding:0 28px 12px">{''.join(body)}</td></tr>
  </table>
  <p style="max-width:480px;margin:18px auto 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
            font-size:12px;line-height:1.5;color:{MUTED};text-align:center">
    {site} &middot; Faith. Growth. Service.<br>This is an automatic message &mdash; replies to it are not read.
  </p>
</td></tr></table>
</body></html>"""


def send_branded_mail(subject, message, from_email, recipient_list, fail_silently=False, code=None):
    """send_mail's arguments, sent as the plain text plus the branded HTML.
    `code`, when given, is shown large in its own box."""
    msg = EmailMultiAlternatives(subject, message, from_email or settings.DEFAULT_FROM_EMAIL, recipient_list)
    msg.attach_alternative(render_html(message, code), 'text/html')
    logo = _logo()
    if logo:
        msg.mixed_subtype = 'related'      # the logo belongs to the HTML, not a download
        img = MIMEImage(logo, 'png')
        img.add_header('Content-ID', f'<{_LOGO_CID}>')
        img.add_header('Content-Disposition', 'inline', filename='logo.png')
        msg.attach(img)
    return msg.send(fail_silently=fail_silently)
