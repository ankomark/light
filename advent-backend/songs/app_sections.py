"""The parts of the app an admin can switch off, one by one.

Each section is a key (the same in the app: front/streams/utils/appSections.js)
and the API paths it owns. Switched off (Admin → App control), the server
answers that section's requests 403 {code: 'feature_off', section, message}
and the app hides its way in and covers its screens — for members; admins
carry on, to check things before opening up again.

A section with no paths (`()`) lives on the phone alone (hymns, the
calculator) or on another server (tickets): the app is what keeps it shut.

Never switchable, so are not here: signing in and accounts, profiles,
notifications, reports and appeals, uploads, the app's own status.
"""

# key -> the first part of each API path it owns (under /api/)
SECTIONS = {
    'feed': ('social-posts', 'posts', 'post-comments', 'post-likes', 'post-saves', 'explore'),
    'videos': (),               # video posts are posts: the Videos screen is closed in the app
    'stories': ('stories',),
    'music': ('tracks', 'albums', 'playlists', 'library', 'music', 'studio', 'comments', 'likes'),
    'messages': ('conversations',),
    # One switch for both: communities are groups of another kind, served by
    # the same paths, and closing one would break the other.
    'groups': ('groups', 'group-posts', 'group-join-requests', 'join-requests', 'communities',
               'community-categories'),
    'live': ('live', 'live-events'),
    'bible': ('bible',),
    'verse': ('daily-verse',),
    'sabbath_school': (),
    'hymns': (),
    'books': ('publications', 'book-highlights', 'organizations'),
    'quiz': ('quiz', 'quiz-sessions', 'quiz-battles'),
    'puzzle': ('puzzles', 'puzzle-themes'),
    # The marketplace keeps its own rule (views/marketplace.py): switched off,
    # nothing new is listed or bought, but orders under way still move.
    'marketplace': (),
    'tickets': (),
    'services': ('video-studios', 'media-stations'),
    'notices': ('notices',),
    'weather': ('weather-place',),
    'calendar': (),
    'calculator': (),
    'singles': ('singles',),
}

KEYS = tuple(SECTIONS)

# '/api/<first part>/...' -> section, built once.
_BY_PREFIX = {prefix: key for key, prefixes in SECTIONS.items() for prefix in prefixes}


def section_for(path):
    """The section an API path belongs to, or None."""
    if not path.startswith('/api/'):
        return None
    first = path[len('/api/'):].split('/', 1)[0]
    return _BY_PREFIX.get(first)
