"""Weather, for the morning briefing.

The app fetches its own forecast when someone opens the screen; this is the
server's copy, used only by the cron job that sends the daily push. It has to
live here because a cron job cannot ask a sleeping phone what the weather is.

Open-Meteo, the same source the app uses — free, and with no API key to ship,
leak or rotate. https://open-meteo.com
"""
import json
import urllib.parse
import urllib.request

FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
TIMEOUT = 12

# WMO codes, grouped. The distinction between "moderate" and "dense" drizzle is
# not something a morning notification needs to draw.
_CODES = (
    (0,  'clear'), (2,  'partly cloudy'), (3,  'cloudy'), (49, 'foggy'),
    (59, 'drizzly'), (69, 'rainy'), (79, 'snowy'), (84, 'showery'),
    (94, 'snowy'), (99, 'stormy'),
)


def describe(code):
    """A short phrase for a WMO weather code."""
    try:
        n = int(code)
    except (TypeError, ValueError):
        return 'unsettled'
    for ceiling, word in _CODES:
        if n <= ceiling:
            return word
    return 'unsettled'


def day_ahead(latitude, longitude):
    """Today's high, low and outlook for one place, or None if unavailable.

    Returns None rather than raising: a forecast that cannot be fetched should
    cost one person their briefing, not stop the whole morning run.
    """
    query = urllib.parse.urlencode({
        'latitude': latitude,
        'longitude': longitude,
        'daily': 'weather_code,temperature_2m_max,temperature_2m_min,'
                 'precipitation_probability_max',
        'timezone': 'auto',
        'forecast_days': 1,
    })
    try:
        with urllib.request.urlopen(f'{FORECAST_URL}?{query}', timeout=TIMEOUT) as response:
            data = json.loads(response.read().decode('utf-8'))
    except Exception:                                   # noqa: BLE001
        return None

    daily = data.get('daily') or {}
    if not daily.get('time'):
        return None
    return {
        'code': (daily.get('weather_code') or [None])[0],
        'max': (daily.get('temperature_2m_max') or [None])[0],
        'min': (daily.get('temperature_2m_min') or [None])[0],
        'rain_chance': (daily.get('precipitation_probability_max') or [None])[0],
    }


def greeting_for(user):
    """"Good morning, Mark" — the heading on the morning briefing.

    A first name if there is one, otherwise the username tidied up: a push that
    opens with "Good morning, mark254" is worse than one that just says good
    morning, so a username that looks like a handle is left off entirely.
    """
    first = (getattr(user, 'first_name', '') or '').strip()
    if first:
        return f'Good morning, {first.split()[0]}'

    username = (getattr(user, 'username', '') or '').strip()
    # Digits or separators mean a handle, not a name someone would be called.
    if username and username.isalpha() and 2 <= len(username) <= 20:
        return f'Good morning, {username.capitalize()}'
    return 'Good morning'


def place_label(name, region=''):
    """How the place is named in the push.

    A neighbourhood on its own is ambiguous — there is a Westlands in Nairobi,
    one in Jamaica and one in Massachusetts — so the region comes along unless
    it merely repeats the name.
    """
    name = (name or '').strip()
    region = (region or '').strip()
    if not region:
        return name
    if region.lower() in name.lower() or name.lower() in region.lower():
        return name
    return f'{name}, {region}'


def briefing_text(place_name, forecast, region=''):
    """The one line that lands on someone's lock screen.

    Written to be useful at a glance and to survive truncation: the place and
    the temperature come first, the caveat last.
    """
    if not forecast:
        return None
    place_name = place_label(place_name, region)
    high = forecast.get('max')
    low = forecast.get('min')
    if high is None:
        return None

    sky = describe(forecast.get('code'))
    line = f"{place_name} today: {sky}, {round(high)}°"
    if low is not None:
        line += f" / {round(low)}°"

    rain = forecast.get('rain_chance')
    if rain is not None and rain >= 40:
        line += f". {int(rain)}% chance of rain — take a coat."
    else:
        line += '.'
    return line
