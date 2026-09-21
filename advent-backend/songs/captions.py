"""Hashtags and @mentions in post captions.

The app renders `#tag` and `@user` as tappable, and the server links each post
to its Hashtag rows and mentioned users, so tag pages, trending tags and
"you were mentioned" notifications all read proper relations instead of
substring-matching captions.

The patterns are deliberately the same shape as the client's
(utils/richText.js), so what the author sees highlighted is what gets linked.
"""
import re

# A tag starts after start-of-text or a non-word character (so "a#b" and
# "##x" don't count) and runs over letters/digits/underscore in any script —
# Kiswahili and accented names included.
HASHTAG_RE = re.compile(r'(?<![\w#])#(\w{1,100})', re.UNICODE)

# Usernames are Django's: letters, digits and @/./+/-/_. The '@' is excluded
# inside the match so "@a@b" doesn't read as one name.
MENTION_RE = re.compile(r'(?<![\w@])@([\w.+-]{1,150})', re.UNICODE)

MAX_TAGS_PER_POST = 30
MAX_MENTIONS_PER_POST = 20


def extract_hashtags(text):
    """Distinct lowercase tags in order of first appearance."""
    seen, out = set(), []
    for raw in HASHTAG_RE.findall(text or ''):
        tag = raw.lower()
        if tag.isdigit():  # "#1" is a ranking, not a topic
            continue
        if tag not in seen:
            seen.add(tag)
            out.append(tag)
        if len(out) >= MAX_TAGS_PER_POST:
            break
    return out


def extract_mentions(text):
    """Distinct usernames (original case, trailing punctuation stripped)."""
    seen, out = set(), []
    for raw in MENTION_RE.findall(text or ''):
        name = raw.rstrip('.-+')  # "thanks @john." → john
        key = name.lower()
        if name and key not in seen:
            seen.add(key)
            out.append(name)
        if len(out) >= MAX_MENTIONS_PER_POST:
            break
    return out
