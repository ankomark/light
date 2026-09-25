"""Publishing phase 4, the Writer Studio: who may work on a book, making a
book into an EPUB, and drawing covers from templates.

Roles: the author (owner) does everything; a co-author or an editor
(accepted) writes and edits, but publishing, deleting and inviting stay the
author's; a viewer reads the drafts.

EPUB: EPUB 3 made here (zip + XHTML), run by the worker; pictures in the
text are fetched (our R2 only) or decoded (old base64) and packed in, so the
file works offline in any reader.

Covers: five templates drawn with Pillow in the app's book faces (Lora,
Cinzel, Atkinson Hyperlegible — OFL, in songs/assets/fonts), uploaded to R2.
"""
import base64
import binascii
import html
import io
import re
import uuid
import zipfile
from pathlib import Path

from django.utils import timezone

from .jobs import enqueue, handler
from .models import Chapter, Publication, PublicationCollaborator, PublicationExport

FONTS = Path(__file__).resolve().parent / 'assets' / 'fonts'
OWNER = 'owner'


# ── Roles ────────────────────────────────────────────────────────────────────

def role_of(user, publication):
    """'owner', 'coauthor', 'editor', 'viewer' — or None."""
    if not getattr(user, 'is_authenticated', False):
        return None
    if publication.author_id == user.id:
        return OWNER
    c = (PublicationCollaborator.objects.filter(publication=publication, user=user, accepted_at__isnull=False)
         .values_list('role', flat=True).first())
    if c is None and publication.organization_id:
        # An organisation's editors (and those who run it) edit its books.
        from .models import OrganizationMember
        if OrganizationMember.objects.filter(organization_id=publication.organization_id, user=user,
                                             accepted_at__isnull=False,
                                             role__in=OrganizationMember.EDIT_ROLES).exists():
            return PublicationCollaborator.EDITOR
    return c


def can_edit(user, publication):
    return role_of(user, publication) in (OWNER, *PublicationCollaborator.EDIT_ROLES)


# ── EPUB ─────────────────────────────────────────────────────────────────────

_IMG = re.compile(r'<img\b[^>]*?\bsrc="([^"]+)"[^>]*?/?>', re.I)
_DATA = re.compile(r'^data:(image/[a-z0-9.+-]+);base64,(.+)$', re.I | re.S)
_EXT = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'}
_FOOTREF = re.compile(r'\[\^([\w-]{1,20})\](?!:)')
_FOOTDEF = re.compile(r'^\[\^([\w-]{1,20})\]:\s*(.*)$', re.M)


def split_footnotes(md):
    """Markdown with [^1] references and "[^1]: text" notes → (text with
    superscript numbers, [(number, note)]). The app's reader draws the
    same way, so a book reads alike everywhere."""
    notes = {m.group(1): m.group(2).strip() for m in _FOOTDEF.finditer(md or '')}
    body = _FOOTDEF.sub('', md or '')
    order = []

    def ref(m):
        key = m.group(1)
        if key not in notes:
            return m.group(0)
        if key not in order:
            order.append(key)
        return f'<sup>{order.index(key) + 1}</sup>'
    body = _FOOTREF.sub(ref, body)
    return body, [(i + 1, notes[k]) for i, k in enumerate(order)]


def _fetch_image(src):
    """A picture's bytes and type: an old base64 one decoded, one on our R2
    fetched. Anything else (another site) isn't fetched — None."""
    m = _DATA.match(src)
    if m:
        try:
            return base64.b64decode(re.sub(r'\s+', '', m.group(2)), validate=True), m.group(1).lower()
        except (binascii.Error, ValueError):
            return None
    from . import r2
    if not r2.is_r2_url(src):
        return None
    import requests
    try:
        res = requests.get(src, timeout=20)
        if res.ok and res.headers.get('content-type', '').startswith('image/'):
            return res.content, res.headers['content-type'].split(';')[0].lower()
    except requests.RequestException:
        return None
    return None


def _xhtml(title, body_html, lang='en'):
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
        f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{lang}" xml:lang="{lang}">\n'
        f'<head><meta charset="utf-8"/><title>{html.escape(title)}</title>'
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        f'<body>{body_html}</body></html>'
    )


STYLE = """
body { font-family: Georgia, serif; line-height: 1.6; margin: 1em; }
h1.chapter { font-size: 1.6em; margin: 1.5em 0 1em; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #c99a2e; margin-left: 0; padding-left: 1em; font-style: italic; }
.notes { font-size: 0.85em; border-top: 1px solid #ccc; margin-top: 2em; padding-top: 0.5em; }
.title-page { text-align: center; margin-top: 30%; }
"""


def build_epub(publication, chapters=None):
    """The book as EPUB 3 bytes: a title page (and cover, if it has one), a
    table of contents, each chapter (footnotes at its end), pictures packed
    in. `chapters` defaults to every chapter not taken down, in order."""
    import markdown as md_lib
    if chapters is None:
        chapters = list(publication.chapters.filter(is_removed=False).order_by('order', 'id'))
    title = publication.title or 'Untitled'
    author = publication.author.username if publication.author_id else ''
    book_id = f'urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f"adventistlife/publication/{publication.pk}")}'
    images = []                                  # (href, media_type, bytes)
    seen = {}

    def pack(src):
        if src in seen:
            return seen[src]
        got = _fetch_image(src)
        if not got:
            seen[src] = None
            return None
        data, mime = got
        href = f'images/img{len(images) + 1}.{_EXT.get(mime, "img")}'
        images.append((href, mime, data))
        seen[src] = href
        return href

    def swap_images(body_html):
        def repl(m):
            href = pack(html.unescape(m.group(1)))
            return f'<img src="{href}" alt=""/>' if href else ''
        return _IMG.sub(repl, body_html)

    cover_href = pack(publication.cover) if publication.cover else None

    pages = []                                   # (file, title, xhtml)
    title_html = (f'<div class="title-page"><h1>{html.escape(title)}</h1>'
                  f'<p>{html.escape(author)}</p>'
                  + (f'<p><em>{html.escape(publication.summary)}</em></p>' if publication.summary else '')
                  + '</div>')
    if cover_href:
        title_html = f'<div style="text-align:center"><img src="{cover_href}" alt="Cover"/></div>' + title_html
    pages.append(('title.xhtml', title, _xhtml(title, title_html)))

    for i, ch in enumerate(chapters, start=1):
        text, notes = split_footnotes(ch.body)
        body = md_lib.markdown(text, extensions=['tables', 'sane_lists'], output_format='xhtml')
        body = swap_images(body)
        heading = ch.title or f'Chapter {i}'
        note_html = ''
        if notes:
            items = ''.join(f'<li id="n{n}">{html.escape(t)}</li>' for n, t in notes)
            note_html = f'<section class="notes" epub:type="footnotes"><ol>{items}</ol></section>'
        pages.append((f'chapter{i}.xhtml', heading,
                      _xhtml(heading, f'<h1 class="chapter">{html.escape(heading)}</h1>{body}{note_html}')))

    nav_items = ''.join(f'<li><a href="{f}">{html.escape(t)}</a></li>' for f, t, _ in pages[1:])
    nav = _xhtml('Contents', f'<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{nav_items}</ol></nav>')
    now = timezone.now().strftime('%Y-%m-%dT%H:%M:%SZ')
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    ]
    manifest += [f'<item id="p{n}" href="{f}" media-type="application/xhtml+xml"/>' for n, (f, _, _) in enumerate(pages)]
    for n, (href, mime, _) in enumerate(images):
        props = ' properties="cover-image"' if href == cover_href else ''
        manifest.append(f'<item id="i{n}" href="{href}" media-type="{mime}"{props}/>')
    spine = ''.join(f'<itemref idref="p{n}"/>' for n in range(len(pages)))
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="bookid">{book_id}</dc:identifier>'
        f'<dc:title>{html.escape(title)}</dc:title>'
        f'<dc:creator>{html.escape(author)}</dc:creator>'
        '<dc:language>en</dc:language>'
        f'<dc:publisher>Adventist Life</dc:publisher>'
        f'<meta property="dcterms:modified">{now}</meta>'
        '</metadata>'
        f'<manifest>{"".join(manifest)}</manifest>'
        f'<spine>{spine}</spine>'
        '</package>'
    )
    container = ('<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                 '</rootfiles></container>')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        # The mimetype must be first and stored uncompressed (the EPUB rule).
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/nav.xhtml', nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/style.css', STYLE, compress_type=zipfile.ZIP_DEFLATED)
        for f, _, x in pages:
            z.writestr(f'OEBPS/{f}', x, compress_type=zipfile.ZIP_DEFLATED)
        for href, _, data in images:
            z.writestr(f'OEBPS/{href}', data, compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def request_export(publication, user, fmt='epub'):
    """Queue making the book into a file; the worker does it."""
    exp = PublicationExport.objects.create(publication=publication, requested_by=user, format=fmt)
    enqueue('pub_export', key=f'export:{exp.pk}', export_id=exp.pk)
    return exp


def _export_failed(payload, error):
    PublicationExport.objects.filter(pk=payload.get('export_id')).update(
        status=PublicationExport.FAILED, error=str(error)[:300], finished_at=timezone.now())


@handler('pub_export', on_failure=_export_failed)
def run_export(export_id):
    from . import r2
    exp = PublicationExport.objects.select_related('publication', 'publication__author').filter(pk=export_id).first()
    if exp is None or exp.status == PublicationExport.DONE:
        return
    PublicationExport.objects.filter(pk=exp.pk).update(status=PublicationExport.RUNNING)
    data = build_epub(exp.publication)
    safe = re.sub(r'[^a-z0-9]+', '-', (exp.publication.title or 'book').lower()).strip('-')[:60] or 'book'
    url = r2.put_bytes(f'exports/{exp.publication_id}/{uuid.uuid4().hex}/{safe}.epub', data, 'application/epub+zip')
    PublicationExport.objects.filter(pk=exp.pk).update(status=PublicationExport.DONE, url=url,
                                                       finished_at=timezone.now(), error='')


# ── Covers ───────────────────────────────────────────────────────────────────

COVER_W, COVER_H = 1200, 1800
TEMPLATES = ('minimal', 'classic', 'luxury', 'modern', 'photo')
PALETTES = {
    'navy': ('#0F2744', '#F4DE9B', '#E8ECF3'),
    'ivory': ('#F7F3EA', '#2B2A26', '#8C6A1A'),
    'forest': ('#10261D', '#E3F0E8', '#C8A96A'),
    'wine': ('#3A1420', '#F6E1EA', '#E7C871'),
    'sky': ('#1D5A8A', '#FFFFFF', '#FFD7A8'),
    'charcoal': ('#1B1D22', '#F2F2F2', '#F4A261'),
}


def _font(name, size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default()


def _wrap(draw, text, font, width):
    words, lines, line = (text or '').split(), [], ''
    for w in words:
        test = f'{line} {w}'.strip()
        if draw.textlength(test, font=font) <= width or not line:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def _fit(draw, text, face, width, start, smallest, max_lines):
    """The biggest size (from `start`) at which `text` wraps into
    `max_lines` lines of `width` — titles long or short both fill well."""
    size = start
    while size > smallest:
        font = _font(face, size)
        lines = _wrap(draw, text, font, width)
        if len(lines) <= max_lines:
            return font, lines
        size -= 6
    font = _font(face, smallest)
    return font, _wrap(draw, text, font, width)[:max_lines]


def render_cover(template, title, author='', subtitle='', palette='navy', image=None):
    """A cover (JPEG bytes, 1200×1800) in one of the templates.
    `image` (bytes) is the photo for 'photo' (and a faint backdrop for
    'modern')."""
    from PIL import Image, ImageDraw, ImageFilter, ImageOps
    template = template if template in TEMPLATES else 'minimal'
    bg, fg, accent = PALETTES.get(palette, PALETTES['navy'])
    canvas = Image.new('RGB', (COVER_W, COVER_H), bg)

    photo = None
    if image:
        try:
            photo = ImageOps.fit(Image.open(io.BytesIO(image)).convert('RGB'), (COVER_W, COVER_H))
        except Exception:
            photo = None
    if template == 'photo' and photo is not None:
        canvas.paste(photo)
        shade = Image.new('RGBA', (COVER_W, COVER_H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        for y in range(COVER_H // 2, COVER_H):                   # darker toward the bottom, for the words
            a = int(200 * (y - COVER_H // 2) / (COVER_H // 2))
            sd.line([(0, y), (COVER_W, y)], fill=(0, 0, 0, a))
        canvas = Image.alpha_composite(canvas.convert('RGBA'), shade).convert('RGB')
        fg, accent = '#FFFFFF', accent
    elif template == 'modern' and photo is not None:
        faded = Image.blend(photo.filter(ImageFilter.GaussianBlur(18)), Image.new('RGB', photo.size, bg), 0.72)
        canvas.paste(faded)

    d = ImageDraw.Draw(canvas)
    margin = 110
    width = COVER_W - margin * 2

    if template == 'classic':
        d.rectangle([60, 60, COVER_W - 60, COVER_H - 60], outline=accent, width=6)
        d.rectangle([84, 84, COVER_W - 84, COVER_H - 84], outline=accent, width=2)
        tfont, tlines = _fit(d, (title or '').upper(), 'Cinzel_700Bold.ttf', width - 60, 120, 60, 4)
        y = 520
        for line in tlines:
            d.text((COVER_W / 2, y), line, font=tfont, fill=fg, anchor='ma')
            y += int(tfont.size * 1.2)
        d.line([(COVER_W / 2 - 120, y + 30), (COVER_W / 2 + 120, y + 30)], fill=accent, width=4)
        if subtitle:
            sfont = _font('Lora_400Regular_Italic.ttf', 52)
            for line in _wrap(d, subtitle, sfont, width - 60)[:3]:
                y += 72
                d.text((COVER_W / 2, y + 60), line, font=sfont, fill=fg, anchor='ma')
        d.text((COVER_W / 2, COVER_H - 230), (author or '').upper(), font=_font('Cinzel_400Regular.ttf', 54), fill=accent, anchor='ma')
    elif template == 'luxury':
        d.rectangle([0, 0, COVER_W, COVER_H], fill=bg)
        d.line([(margin, 260), (COVER_W - margin, 260)], fill=accent, width=3)
        d.line([(margin, COVER_H - 300), (COVER_W - margin, COVER_H - 300)], fill=accent, width=3)
        tfont, tlines = _fit(d, title, 'Lora_700Bold.ttf', width, 140, 64, 4)
        total = len(tlines) * int(tfont.size * 1.15)
        y = (COVER_H - total) / 2 - 60
        for line in tlines:
            d.text((COVER_W / 2, y), line, font=tfont, fill=accent, anchor='ma')
            y += int(tfont.size * 1.15)
        if subtitle:
            d.text((COVER_W / 2, y + 40), subtitle[:60], font=_font('Lora_400Regular_Italic.ttf', 50), fill=fg, anchor='ma')
        d.text((COVER_W / 2, COVER_H - 240), author or '', font=_font('Cinzel_700Bold.ttf', 56), fill=fg, anchor='ma')
    elif template == 'modern':
        d.rectangle([0, COVER_H - 620, COVER_W, COVER_H], fill=accent)
        tfont, tlines = _fit(d, title, 'AtkinsonHyperlegible_700Bold.ttf', width, 150, 70, 4)
        y = 240
        for line in tlines:
            d.text((margin, y), line, font=tfont, fill=fg)
            y += int(tfont.size * 1.08)
        if subtitle:
            sfont = _font('AtkinsonHyperlegible_400Regular.ttf', 54)
            for line in _wrap(d, subtitle, sfont, width)[:3]:
                y += 20
                d.text((margin, y + 30), line, font=sfont, fill=fg)
                y += 64
        d.text((margin, COVER_H - 250), author or '', font=_font('AtkinsonHyperlegible_700Bold.ttf', 64), fill=bg)
    else:   # minimal (and photo)
        tfont, tlines = _fit(d, title, 'Lora_700Bold.ttf', width, 130, 64, 5)
        block = len(tlines) * int(tfont.size * 1.18)
        y = COVER_H - 420 - block if template == 'photo' else (COVER_H - block) / 2 - 80
        for line in tlines:
            d.text((COVER_W / 2, y), line, font=tfont, fill=fg, anchor='ma')
            y += int(tfont.size * 1.18)
        if subtitle:
            d.text((COVER_W / 2, y + 30), subtitle[:70], font=_font('Lora_400Regular_Italic.ttf', 48), fill=fg, anchor='ma')
        d.text((COVER_W / 2, COVER_H - 200), author or '', font=_font('Lora_400Regular.ttf', 56), fill=accent, anchor='ma')

    out = io.BytesIO()
    canvas.save(out, 'JPEG', quality=88, optimize=True)
    return out.getvalue()


def make_cover(user, template, title, subtitle='', author='', palette='navy', image_url=''):
    """Draw a cover and put it on R2; returns its address. A photo must be
    one already on our R2 (an upload), never another site's address."""
    from . import r2
    image = None
    if image_url:
        got = _fetch_image(image_url)
        image = got[0] if got else None
    data = render_cover(template, title, author=author, subtitle=subtitle, palette=palette, image=image)
    return r2.put_bytes(f'cover_images/{uuid.uuid4().hex}.jpg', data, 'image/jpeg')
