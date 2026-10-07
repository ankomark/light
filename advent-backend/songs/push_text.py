"""Pushes in the reader's language.

Pushes are written in English where they are sent — some two hundred places
across the app — and this turns them into the language the recipient's app
is in (NotificationPreference.language, sent by the app). One table here,
rather than a translation at every call site: a new English message is still
delivered, just in English, until a line for it is added.

Titles go by notification type. Messages go by pattern: each English sentence
shape, with the parts that change (a name, a group, an order number) carried
across. Names and titles people wrote are never translated.

The Swahili wants a first-language review, like the app's other Swahili.
"""
import re

TITLES = {
    'sw': {
        'singles_match': '\U0001f49b Single & Searching',
        'quiz_duel': '⚔️ Changamoto yako imechezwa',
        'puzzle_challenge': '\U0001f9e9 Fumbo ulilotuma limechezwa',
        'like': '❤️ Amependa',
        'comment': '\U0001f4ac Maoni mapya',
        'follow': '\U0001f464 Mfuasi mpya',
        'group_join_request': '\U0001f465 Ombi la kujiunga',
        'group_mention': '\U0001f4ac Umetajwa',
        'notice': '\U0001f4e2 Ubao wa matangazo',
        'admin_reply': '\U0001f4ec Wasimamizi wamejibu',
        'group_join_approved': '✅ Ombi limekubaliwa',
        'group_join_rejected': '\U0001f6ab Ombi limekataliwa',
        'message': '\U0001f4ac Ujumbe mpya',
        'mention': '@ Umetajwa',
        'security': '\U0001f512 Tahadhari ya usalama',
        'milestone': '\U0001f389 Hatua mpya',
        'new_book': '\U0001f4d6 Kitabu kipya',
        'new_chapter': '\U0001f4d6 Sura mpya',
        'book_discussion': '\U0001f4ac Mjadala wa kitabu',
        'book_review': '⭐ Tathmini mpya',
        'book_invite': '✍️ Mwaliko wa kuandika',
        'org_invite': '\U0001f3db Mwaliko wa shirika',
        'service_review': '⭐ Tathmini ya huduma',
        'service_verified': '✅ Uthibitisho',
        'service_booking': '\U0001f4c5 Ombi la huduma',
        'market_order': '\U0001f6cd Oda mpya',
        'market_paid': '✅ Malipo yamethibitishwa',
        'market_shipped': '\U0001f69a Iko njiani',
        'market_delivered': '\U0001f4e6 Imefika',
        'market_cancelled': '✖️ Oda imeghairiwa',
        'market_wish': '❤️ Kutoka orodha yako ya matamanio',
        'test': '\U0001f514 Arifa ya majaribio',
    },
}

# Whole sentences that never change.
EXACT = {
    'sw': {
        'New sign-in to your Adventist Life account.': 'Kuna aliyeingia kwenye akaunti yako ya Adventist Life.',
        'Notifications are working on this device.': 'Arifa zinafanya kazi kwenye kifaa hiki.',
        'You have a new match.': 'Una mtu mpya mliyeendana naye.',
        'The admins answered your note': 'Wasimamizi wamejibu ujumbe wako',
        'You still lead.': 'Bado unaongoza.',
        'They beat you.': 'Amekushinda.',
        'A tie.': 'Mmetoka sare.',
    },
}

U = r'(?P<u>\S+)'   # a username: never translated

# (English shape, the language's sentence). Tried in order: the more
# particular shape before the general one it would also match.
PATTERNS = {
    'sw': [
        (rf'^{U} liked your post$', '{u} amependa chapisho lako'),
        (rf'^{U} liked your track (?P<t>.+)$', '{u} amependa wimbo wako {t}'),
        (rf'^{U} started following you$', '{u} ameanza kukufuata'),
        (rf'^{U} requested to follow you$', '{u} ameomba kukufuata'),
        (rf'^{U} accepted your follow request$', '{u} amekubali ombi lako la kumfuata'),
        (rf'^{U} mentioned you in a post$', '{u} amekutaja kwenye chapisho'),
        (rf'^{U} mentioned you in a comment$', '{u} amekutaja kwenye maoni'),
        (rf'^{U} replied to your comment$', '{u} amejibu maoni yako'),
        (rf'^{U} mentioned you in (?P<g>.+?): (?P<p>.*)$', '{u} amekutaja kwenye {g}: {p}'),
        (rf'^{U} mentioned you in (?P<g>.+)$', '{u} amekutaja kwenye {g}'),
        (rf'^{U} is live on air: (?P<t>.+)$', '{u} yuko hewani sasa: {t}'),
        (rf'^{U} reacted (?P<e>\S+) to your story$', '{u} ameitikia hadithi yako kwa {e}'),
        (rf'^{U} wants to send you a message$', '{u} anataka kukutumia ujumbe'),
        (rf'^{U} requested to join (?P<g>.+)$', '{u} ameomba kujiunga na {g}'),
        (rf'^{U} wants to co-host$', '{u} anataka kuendesha matangazo pamoja nawe'),
        (rf'^{U} invited you to join (?P<o>.+)$', '{u} amekualika ujiunge na {o}'),
        (rf'^{U} invited you to work on “(?P<t>.+)”$', '{u} amekualika mfanye kazi pamoja kwenye “{t}”'),
        (rf'^{U} replied in “(?P<t>.+)”$', '{u} amejibu kwenye “{t}”'),
        (rf'^{U} commented on chapter (?P<n>\d+) of “(?P<t>.+)”$', '{u} ametoa maoni kwenye sura ya {n} ya “{t}”'),
        (rf'^{U} rated “(?P<t>.+)” (?P<r>\d)★$', '{u} amekipa “{t}” nyota {r}★'),
        (rf'^{U} rated (?P<s>.+) (?P<r>\d)★$', '{u} ameipa {s} nyota {r}★'),
        (rf'^{U} ordered (?P<i>.+)\. Order #(?P<n>\d+)\.$', '{u} ameagiza {i}. Oda #{n}.'),
        (rf'^{U} added delivery details to order #(?P<n>\d+)\.$', '{u} ameweka maelezo ya kufikisha oda #{n}.'),
        (rf'^{U} confirmed your payment for order #(?P<n>\d+)\.$', '{u} amethibitisha malipo yako ya oda #{n}.'),
        (rf'^{U} has sent your order #(?P<n>\d+)\.$', '{u} ametuma oda yako #{n}.'),
        (rf'^{U} marked your order #(?P<n>\d+) delivered\.$', '{u} ameandika kuwa oda yako #{n} imefika.'),
        (rf'^{U} received their order #(?P<n>\d+)\.$', '{u} amepokea oda yake #{n}.'),
        (rf'^{U} cancelled order #(?P<n>\d+) with you\.$', '{u} ameghairi oda #{n} kwako.'),
        (rf'^{U} cancelled their part of order #(?P<n>\d+)\.$', '{u} ameghairi sehemu yake ya oda #{n}.'),
        (rf'^{U} cancelled their booking$', '{u} ameghairi ombi lake la huduma'),
        (rf'^{U} solved your puzzle in (?P<m>\d+:\d\d) with (?P<s>\d) stars\.\s*(?P<rest>.*)$',
         '{u} ametatua fumbo lako kwa {m}, nyota {s}. {rest}'),
        (r'^The admins answered your note: (?P<x>.*)$', 'Wasimamizi wamejibu ujumbe wako: {x}'),
    ],
}
_COMPILED = {lang: [(re.compile(p, re.S), out) for p, out in rows] for lang, rows in PATTERNS.items()}

LANGUAGES = ('en',) + tuple(TITLES)


def title_for(notification_type, english_title, language):
    """The heading in `language`: the type's own, or the English as given."""
    if language in TITLES and notification_type in TITLES[language]:
        return TITLES[language][notification_type]
    return english_title


def message_for(message, language):
    """`message` in `language`, or as it came when there is no line for it."""
    if not message or language not in PATTERNS:
        return message
    exact = EXACT.get(language, {})
    if message in exact:
        return exact[message]
    for rx, out in _COMPILED[language]:
        m = rx.match(message)
        if m:
            parts = m.groupdict()
            if 'rest' in parts:
                parts['rest'] = exact.get(parts['rest'].strip(), parts['rest'].strip())
            return out.format(**parts).strip()
    return message


def localize(notification_type, title, message, language, title_given=False):
    """(title, message) for a reader of `language`. A title the caller wrote
    (`title_given`) is theirs and kept; the type's standard one is translated."""
    if language not in LANGUAGES or language == 'en':
        return title, message
    if not title_given:
        title = title_for(notification_type, title, language)
    return title, message_for(message, language)
