"""Attack the load-test stack from outside, and report what gets through.

    .venv/Scripts/python loadtest/security_probe.py [--base http://127.0.0.1:8800]

Each probe prints OK (refused / safe) or FLAG (needs fixing), with what came
back. Only for the throwaway stack: it writes to the database.
"""
import argparse
import base64
import json
import time

import requests

flags = []


def report(name, ok, detail=''):
    tag = 'OK  ' if ok else 'FLAG'
    if not ok:
        flags.append(name)
    print(f'{tag} {name}{" - " + detail if detail else ""}')


def b64(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8800')
    a = ap.parse_args()
    api = a.base + '/api'
    tok = requests.post(f'{api}/auth/token/', json={'username': 'loadtester', 'password': 'Load-test-1234'},
                        timeout=30).json()
    H = {'Authorization': f'Bearer {tok["access"]}'}
    me = requests.get(f'{api}/auth/status/', headers=H, timeout=30).json()

    # ── tokens ───────────────────────────────────────────────────────────────
    head, body, sig = tok['access'].split('.')
    payload = json.loads(base64.urlsafe_b64decode(body + '=='))
    payload['user_id'] = 1
    forged = f'{head}.{b64(payload)}.{sig}'
    r = requests.get(f'{api}/auth/status/', headers={'Authorization': f'Bearer {forged}'}, timeout=30)
    report('tampered token (user_id changed) refused', r.status_code == 401, str(r.status_code))
    none_tok = f'{b64({"alg": "none", "typ": "JWT"})}.{b64(payload)}.'
    r = requests.get(f'{api}/auth/status/', headers={'Authorization': f'Bearer {none_tok}'}, timeout=30)
    report('alg=none token refused', r.status_code == 401, str(r.status_code))
    r = requests.get(f'{api}/auth/status/', headers={'Authorization': f'Bearer {tok["refresh"]}'}, timeout=30)
    report('refresh token not accepted as an access token', r.status_code == 401, str(r.status_code))

    # ── making yourself an admin ─────────────────────────────────────────────
    for url in ('/profiles/me/', f'/users/{me["id"]}/'):
        for method in ('patch', 'put'):
            getattr(requests, method)(api + url, headers=H, timeout=30, json={
                'admin_role': 'super_admin', 'is_superuser': True, 'is_staff': True, 'is_super_admin': True,
                'capabilities': ['manage_users'], 'is_verified_artist': True, 'is_email_verified': True,
                'total_likes': 999999, 'role': 1, 'user': 1, 'user_id': 1,
            })
    st = requests.get(f'{api}/profiles/me/', headers=H, timeout=30).json()
    r = requests.get(f'{api}/admin/dashboard/', headers=H, timeout=30)
    report('profile edit cannot grant admin powers', r.status_code in (401, 403)
           and not st.get('is_super_admin') and st.get('admin_role') in (None, '', 'none', 'user'),
           f'dashboard {r.status_code}, admin_role={st.get("admin_role")!r}')
    report('profile edit cannot mark itself verified artist', not st.get('is_verified_artist'),
           f'is_verified_artist={st.get("is_verified_artist")!r}')

    # ── outside URLs planted in media fields ─────────────────────────────────
    evil = 'https://attacker.example/pixel.png'
    r = requests.post(f'{api}/social-posts/', headers=H, timeout=30, json={
        'caption': 'hello', 'content_type': 'image', 'media_file': evil, 'media_url': evil})
    planted = r.status_code < 300 and evil in r.text
    report('post cannot point its media at an outside server', not planted, f'{r.status_code}')
    r = requests.patch(f'{api}/profiles/me/', headers=H, timeout=30, json={'picture': evil, 'picture_url': evil})
    after = requests.get(f'{api}/profiles/me/', headers=H, timeout=30).text
    report('profile picture cannot be an outside URL', evil not in after, f'{r.status_code}')
    r = requests.post(f'{api}/tracks/', headers=H, timeout=30, json={
        'title': 'x', 'audio_file': evil.replace('png', 'mp3'), 'rights_confirmed': True})
    report('song cannot point its audio at an outside server',
           not (r.status_code < 300 and 'attacker.example' in r.text), f'{r.status_code}')

    # ── size and paging abuse ────────────────────────────────────────────────
    t0 = time.perf_counter()
    r = requests.get(f'{api}/notifications/?page_size=100000', headers=H, timeout=120)
    n = len(r.json().get('results', [])) if r.ok and isinstance(r.json(), dict) else -1
    report('page_size is capped', 0 <= n <= 100, f'{n} rows in {time.perf_counter() - t0:.1f}s')
    r = requests.get(f'{api}/social-posts/?page=999999999', headers=H, timeout=60)
    report('a page far past the end is a clean answer', r.status_code in (200, 404), str(r.status_code))
    big = {'caption': 'x' * (12 * 1024 * 1024), 'content_type': 'image'}
    try:
        r = requests.post(f'{api}/social-posts/', headers=H, json=big, timeout=60)
        report('a 12 MB JSON body is refused', r.status_code in (400, 413), str(r.status_code))
    except requests.RequestException as e:
        report('a 12 MB JSON body is refused', True, f'connection closed ({type(e).__name__})')
    r = requests.post(f'{api}/post-comments/', headers=H, timeout=30,
                      json={'post': 1, 'content': 'y' * 100000})
    report('a 100,000-character comment is refused or cut', r.status_code >= 400 or len(r.text) < 60000,
           str(r.status_code))

    # ── what errors reveal ───────────────────────────────────────────────────
    r = requests.get(a.base + '/no-such-page-xyz/', timeout=30)
    report('404 reveals no settings or routes', 'Traceback' not in r.text and 'urlpatterns' not in r.text
           and 'DEBUG' not in r.text, str(r.status_code))
    r = requests.get(f'{api}/social-posts/abc/', headers=H, timeout=30)
    report('bad id reveals no stack trace', 'Traceback' not in r.text and 'File "' not in r.text, str(r.status_code))

    # ── headers and CORS ─────────────────────────────────────────────────────
    r = requests.get(f'{api}/health/', timeout=30)
    report('X-Content-Type-Options: nosniff', r.headers.get('X-Content-Type-Options') == 'nosniff')
    report('X-Frame-Options set', bool(r.headers.get('X-Frame-Options')), r.headers.get('X-Frame-Options', ''))
    report('Referrer-Policy set', bool(r.headers.get('Referrer-Policy')), r.headers.get('Referrer-Policy', ''))
    report('server version not advertised', 'gunicorn' not in r.headers.get('Server', '').lower()
           and 'daphne' not in r.headers.get('Server', '').lower(), r.headers.get('Server', ''))
    r = requests.get(f'{api}/profiles/me/', headers={**H, 'Origin': 'https://evil.example'}, timeout=30)
    acao = r.headers.get('Access-Control-Allow-Origin', '')
    report('CORS does not allow any website', acao not in ('*', 'https://evil.example'), acao or '(none)')

    # ── account takeover helpers ─────────────────────────────────────────────
    r = requests.post(f'{api}/auth/forgot-password/', json={'email': 'nobody-here@load.test'}, timeout=30)
    r2 = requests.post(f'{api}/auth/forgot-password/', json={'email': 'loadtester@load.test'}, timeout=30)
    report('forgot-password does not reveal who has an account',
           r.status_code == r2.status_code and r.text == r2.text, f'{r.status_code}/{r2.status_code}')
    codes = [requests.post(f'{api}/auth/reset-password/', timeout=30,
                           json={'email': 'loadtester@load.test', 'code': f'{i:06d}', 'new_password': 'Zx9kLmq2-new!'}
                           ).status_code for i in range(8)]
    report('reset codes cannot be guessed endlessly', any(c in (403, 429) for c in codes), str(codes))

    print(f'\n{len(flags)} flagged: {", ".join(flags) or "none"}')


if __name__ == '__main__':
    main()
