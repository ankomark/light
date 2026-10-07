"""The app's choices that follow an account from phone to phone.

The phone keeps every choice locally (front/streams/utils/preferences.js) and
these are copied to the account, so a new phone or a reinstall opens the way
its owner left it. Each key has the values it may take; anything else is
refused, so the store cannot become a dumping ground. Choices that belong to
one phone — whether this phone gets pushes — are not here and stay on it.
"""

BOOL = 'bool'

# key -> allowed values: BOOL, a tuple of choices, or (min, max) for numbers.
# The weather town is not here: it is already kept with the account (the
# morning briefing needs it), through its own endpoint.
SYNCED = {
    'autoplayVideo': BOOL,
    'musicAutoplay': BOOL,
    'autoDownloadLiked': BOOL,
    'dataSaver': BOOL,
    'audioQuality': ('auto', 'high', 'standard', 'data_saver'),
    'downloadQuality': ('standard', 'high'),
    'downloadWifiOnly': BOOL,
    'videoQuality': ('auto', 'hd', 'data_saver'),
    'themeMode': ('system', 'light', 'dark'),
    'language': ('system', 'en', 'sw'),
    'quizSound': BOOL,
    'quizMusic': BOOL,
    'calendarReminders': BOOL,
    'videoMode': BOOL,
    'hymnFavSort': ('recent', 'number', 'title', 'hymnal'),
    'hymnLang': ('en', 'sw', 'dho', 'guz'),
    'hymnTextSize': (10, 40),
    'bibleVersion': 'version',
    'bibleTextSize': (10, 40),
    'wallpaperOn': BOOL,
}


def _ok(rule, value):
    if rule == BOOL:
        return isinstance(value, bool)
    if rule == 'version':
        return isinstance(value, str) and 0 < len(value) <= 40 and value.replace('_', '').replace('-', '').isalnum()
    if isinstance(rule, tuple) and len(rule) == 2 and all(isinstance(x, int) for x in rule):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and rule[0] <= value <= rule[1]
    return value in rule


def clean(prefs):
    """The accepted part of `prefs`, and the keys refused."""
    if not isinstance(prefs, dict):
        return {}, ['app_prefs']
    kept, refused = {}, []
    for key, value in prefs.items():
        rule = SYNCED.get(key)
        if rule is not None and _ok(rule, value):
            kept[key] = value
        else:
            refused.append(key)
    return kept, refused
