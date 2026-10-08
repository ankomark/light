"""Speed of each screen's requests on the seeded load-test stack.

    .venv/Scripts/python loadtest/measure.py [--base http://127.0.0.1:8800] [--users 25]

For every endpoint a screen opens: the first (cold) answer, then the median of
five more (warm: caches filled), and the size sent. Then many people at once
on the busiest screens, with p50 / p95. Anything slower than the budget is
marked.
"""
import argparse
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

import requests

BUDGET_MS = 400          # a screen's request, warm, on the server itself


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8800')
    ap.add_argument('--users', type=int, default=25)
    ap.add_argument('--json', default='')
    ap.add_argument('--tokens', default='loadtest/results/tokens.txt')
    a = ap.parse_args()
    api = a.base + '/api'
    s = requests.Session()
    r = s.post(f'{api}/auth/token/', json={'username': 'loadtester', 'password': 'Load-test-1234'}, timeout=30)
    r.raise_for_status()
    s.headers['Authorization'] = 'Bearer ' + r.json()['access']

    # Ids to open detail screens with.
    feed = s.get(f'{api}/social-posts/', timeout=60).json()
    rows = feed.get('results', feed) if isinstance(feed, dict) else feed
    post_id = rows[0]['id'] if rows else 1
    groups = s.get(f'{api}/groups/', timeout=60).json()
    grows = groups.get('results', groups) if isinstance(groups, dict) else groups
    slug = grows[0]['slug'] if grows else 'group-0'
    me = s.get(f'{api}/auth/status/', timeout=30).json()
    other = me['id'] - 1

    screens = {
        'Feed': [f'/social-posts/', '/social-posts/latest/', '/stories/feed/'],
        'Post + comments': [f'/social-posts/{post_id}/', f'/social-posts/{post_id}/comments/'],
        'Videos': ['/social-posts/?content_type=video'],
        'Explore': ['/explore/trending_posts/', '/explore/search/?q=grace', '/explore/search/?q=gracce%20choir'],
        'Notifications': ['/notifications/', '/notifications/unread_count/'],
        'Messages': ['/conversations/'],
        'Music home': ['/music/home/', '/tracks/', '/tracks/favorites/', '/playlists/'],
        'Groups': ['/groups/', f'/groups/{slug}/', f'/groups/{slug}/posts/'],
        'Profile (mine)': ['/profiles/me/', f'/users/{me["id"]}/social_posts/'],
        'Profile (other)': [f'/users/{other}/', f'/users/{other}/social_posts/', f'/users/{other}/tracks/'],
        'Marketplace': ['/marketplace/products/'],
        'Books': ['/publications/home/'],
    }

    report = {'endpoints': [], 'load': []}
    print(f'{"screen":18} {"endpoint":45} {"cold":>7} {"warm":>7} {"size":>8}  status')
    for screen, eps in screens.items():
        for ep in eps:
            t0 = time.perf_counter()
            r = s.get(api + ep, timeout=120)
            cold = (time.perf_counter() - t0) * 1000
            warm = []
            for _ in range(5):
                t0 = time.perf_counter()
                s.get(api + ep, timeout=120)
                warm.append((time.perf_counter() - t0) * 1000)
            w = statistics.median(warm)
            flag = '  SLOW' if w > BUDGET_MS else ''
            size = len(r.content)
            print(f'{screen:18} {ep[:45]:45} {cold:7.0f} {w:7.0f} {size / 1024:7.1f}k  {r.status_code}{flag}')
            report['endpoints'].append({'screen': screen, 'endpoint': ep, 'cold_ms': round(cold),
                                        'warm_ms': round(w), 'kb': round(size / 1024, 1), 'status': r.status_code})

    # Many people at once on the busiest screens.
    print(f'\n{a.users} people at once, 8 requests each:')
    # Different people (one account's 25 phones would hit its own rate limit;
    # 25 sign-ins in a row from one address hit the sign-in limit): sessions
    # made in the container, one per line (see loadtest/README.md).
    with open(a.tokens, encoding='utf-8') as f:
        tokens = ['Bearer ' + line.strip() for line in f if line.strip()][:a.users]

    def one_user(i, path):
        sess = requests.Session()
        sess.headers['Authorization'] = tokens[i]
        out = []
        for _ in range(8):
            t0 = time.perf_counter()
            resp = sess.get(api + path, timeout=120)
            out.append(((time.perf_counter() - t0) * 1000, resp.status_code))
        return out

    for path in ('/social-posts/', '/notifications/', f'/groups/{slug}/posts/', '/music/home/'):
        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=a.users) as pool:
            results = [x for lst in pool.map(lambda i: one_user(i, path), range(a.users)) for x in lst]
        wall = time.perf_counter() - t0
        times = sorted(t for t, _ in results)
        errors = sum(1 for _, c in results if c >= 400)
        codes = sorted({c for _, c in results if c >= 400})
        p50, p95 = times[len(times) // 2], times[int(len(times) * 0.95) - 1]
        rps = len(results) / wall
        print(f'  {path:35} p50 {p50:6.0f} ms  p95 {p95:6.0f} ms  {rps:5.1f} req/s  errors {errors} {codes or ""}')
        report['load'].append({'endpoint': path, 'p50_ms': round(p50), 'p95_ms': round(p95),
                               'rps': round(rps, 1), 'errors': errors})
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=1)


if __name__ == '__main__':
    main()
