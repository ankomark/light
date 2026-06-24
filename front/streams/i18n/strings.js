// UI string catalog. `en` is the complete baseline; other languages may be
// partial — missing keys fall back to English, then to the key itself. Keys are
// dotted by area. New screens add their keys here and read them via t().

export const LANGUAGES = [
  { code: 'system', label: 'System default' },
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
];

// Languages that actually have a dictionary below (excludes 'system').
export const SUPPORTED_LANGS = ['en', 'sw'];

export const STRINGS = {
  en: {
    'common.cancel': 'Cancel',
    'common.done': 'Done',
    'common.error': 'Error',
    'common.save': 'Save',

    'settings.title': 'Settings',
    'settings.section.account': 'Account',
    'settings.section.privacy': 'Privacy',
    'settings.section.notifications': 'Notifications',
    'settings.section.appearance': 'Appearance',
    'settings.section.playback': 'Playback & Data',
    'settings.section.support': 'Support',
    'settings.section.session': 'Session',

    'settings.account.changePassword': 'Change password',
    'settings.account.emailVerified': 'Verified',
    'settings.account.emailUnverified': 'Not verified — tap to verify',

    'settings.privacy.privateAccount': 'Private account',
    'settings.privacy.privateAccountSub': 'Only approved followers can see your profile',
    'settings.privacy.blocked': 'Blocked accounts',
    'settings.privacy.blockedSub': "Manage who you've blocked",

    'settings.appearance.theme': 'Theme',
    'settings.appearance.language': 'Language',
    'settings.theme.system': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',

    'settings.playback.autoplay': 'Autoplay videos',
    'settings.playback.dataSaver': 'Data saver',
    'settings.playback.videoQuality': 'Video quality',
    'settings.playback.audioQuality': 'Audio quality',

    'settings.support.contact': 'Contact admins',
    'settings.support.about': 'About',
    'settings.session.logout': 'Log out',
    'settings.session.delete': 'Delete account',

    'blocked.title': 'Blocked accounts',
    'blocked.empty': 'No blocked accounts',
    'blocked.unblock': 'Unblock',

    'help.title': 'Help',
  },
  sw: {
    'common.cancel': 'Ghairi',
    'common.done': 'Imekamilika',
    'common.error': 'Hitilafu',
    'common.save': 'Hifadhi',

    'settings.title': 'Mipangilio',
    'settings.section.account': 'Akaunti',
    'settings.section.privacy': 'Faragha',
    'settings.section.notifications': 'Arifa',
    'settings.section.appearance': 'Muonekano',
    'settings.section.playback': 'Uchezaji na Data',
    'settings.section.support': 'Usaidizi',
    'settings.section.session': 'Kipindi',

    'settings.account.changePassword': 'Badilisha nywila',
    'settings.account.emailVerified': 'Imethibitishwa',
    'settings.account.emailUnverified': 'Haijathibitishwa — gusa kuthibitisha',

    'settings.privacy.privateAccount': 'Akaunti ya faragha',
    'settings.privacy.privateAccountSub': 'Wafuasi walioidhinishwa pekee ndio wataona wasifu wako',
    'settings.privacy.blocked': 'Akaunti zilizozuiwa',
    'settings.privacy.blockedSub': 'Dhibiti uliowazuia',

    'settings.appearance.theme': 'Mandhari',
    'settings.appearance.language': 'Lugha',
    'settings.theme.system': 'Mfumo',
    'settings.theme.light': 'Nuru',
    'settings.theme.dark': 'Giza',

    'settings.playback.autoplay': 'Cheza video kiotomatiki',
    'settings.playback.dataSaver': 'Kuokoa data',
    'settings.playback.videoQuality': 'Ubora wa video',
    'settings.playback.audioQuality': 'Ubora wa sauti',

    'settings.support.contact': 'Wasiliana na wasimamizi',
    'settings.support.about': 'Kuhusu',
    'settings.session.logout': 'Toka',
    'settings.session.delete': 'Futa akaunti',

    'blocked.title': 'Akaunti zilizozuiwa',
    'blocked.empty': 'Hakuna akaunti zilizozuiwa',
    'blocked.unblock': 'Ondoa zuio',

    'help.title': 'Usaidizi',
  },
};
