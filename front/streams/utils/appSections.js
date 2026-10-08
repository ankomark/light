// The parts of the app an admin can switch off, one by one (Admin → App
// control). The keys match the server's (advent-backend/songs/app_sections.py),
// which refuses a switched-off section's requests; here each section also
// names its screens, so components/SectionGate.js can cover any of them —
// reached from the menu, a notification or a link — and the menu can hide
// its way in (HamburgerMenu items carry `feature: <key>`).
//
// Admins are never shut out: they see a thin "switched off for members" note
// instead, to check things before opening up again.

export const SECTIONS = [
  { key: 'feed', icon: 'newspaper-variant-outline',
    routes: ['SocialFeed', 'PostDetail', 'CreatePost', 'Hashtag', 'Explore'] },
  { key: 'videos', icon: 'play-box-multiple-outline', routes: ['Videos', 'CameraCapture'] },
  { key: 'stories', icon: 'circle-slice-8', routes: ['StoryViewer', 'CreateStory'] },
  { key: 'music', icon: 'music-note-outline',
    routes: ['Music', 'Tracks', 'Comments', 'Favorites', 'UploadTrack', 'NowPlaying', 'Playlists', 'PlaylistDetail',
      'MusicChart', 'Genre', 'Album', 'MusicRecap', 'ArtistLibrary', 'ArtistStudio', 'Downloads', 'TrackDetail',
      'EditTrack'] },
  { key: 'messages', icon: 'message-text-outline', routes: ['Inbox', 'Chat'] },
  { key: 'groups', icon: 'account-group-outline',
    routes: ['Groups', 'Communities', 'GroupDetail', 'CreateGroup', 'GroupMembers', 'GroupJoinRequests', 'GroupMedia',
      'GroupAuditLog', 'GroupAddMembers'] },
  { key: 'live', icon: 'broadcast', routes: ['LiveHub', 'GoLive', 'LiveRoom', 'LiveSummary'] },
  { key: 'bible', icon: 'book-cross', routes: ['bible', 'BibleLibrary'] },
  { key: 'verse', icon: 'book-open-variant', routes: ['DailyVerse'] },
  { key: 'sabbath_school', icon: 'book-education-outline', routes: ['SabbathSchool', 'SabbathSchoolLesson'] },
  { key: 'hymns', icon: 'music-clef-treble', routes: ['Hymns', 'HymnDetail'] },
  { key: 'books', icon: 'bookshelf',
    routes: ['Publishing', 'PublicationDetail', 'ChapterReader', 'PublicationEditor', 'ChapterHistory',
      'ChapterDiscussion', 'AuthorPage', 'CoverStudio', 'BookCollaborators', 'AuthorStudio', 'BookInsights', 'BookClub',
      'WriterAssistant', 'Organizations', 'OrganizationPage', 'OrganizationEdit', 'OrganizationMembers'] },
  { key: 'quiz', icon: 'head-question-outline',
    routes: ['BibleQuiz', 'QuizHome', 'QuizProgress', 'QuizStories', 'Battle', 'QuizPlay'] },
  { key: 'puzzle', icon: 'puzzle-outline', routes: ['PuzzlePlay', 'PuzzleThemes', 'PuzzleLevels'] },
  // Switched off, nothing new is bought or listed; orders already made can
  // still be looked after from their own screens.
  { key: 'marketplace', icon: 'storefront-outline',
    routes: ['MarketplaceHome', 'ProductList', 'ProductDetail', 'Cart', 'Checkout', 'Wishlist', 'SellerShop',
      'AddProduct', 'EditProduct'] },
  { key: 'tickets', icon: 'ticket-confirmation-outline',
    routes: ['TicketsHome', 'TicketEvent', 'TicketCheckout', 'TicketHost', 'TicketCreateEvent', 'TicketFundraiser'] },
  { key: 'services', icon: 'storefront',
    routes: ['Studios', 'ServiceForm', 'ServiceDetail', 'ServiceVerification', 'ServiceBookings', 'ServiceInsights',
      'AdventistMedia'] },
  { key: 'notices', icon: 'bulletin-board', routes: ['NoticeBoard', 'Notice'] },
  { key: 'weather', icon: 'weather-partly-cloudy', routes: ['Weather'] },
  { key: 'calendar', icon: 'calendar-month-outline', routes: ['Calendar'] },
  { key: 'calculator', icon: 'calculator-variant-outline', routes: ['Calculator'] },
  { key: 'singles', icon: 'ring',
    routes: ['Singles', 'SinglesEdit', 'SinglesPerson', 'SinglesView', 'SinglesBrowse', 'SinglesSettings',
      'SinglesValues', 'SinglesVerify', 'SinglesCommunity', 'SinglesTopic', 'SinglesEvents', 'SinglesStories'] },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);

const BY_ROUTE = Object.fromEntries(SECTIONS.flatMap((s) => s.routes.map((r) => [r, s.key])));

/** The section a screen belongs to, or null (never switched off). */
export const sectionOfRoute = (routeName) => BY_ROUTE[routeName] || null;

export const sectionInfo = (key) => SECTIONS.find((s) => s.key === key) || null;
