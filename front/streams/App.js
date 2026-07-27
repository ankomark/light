import * as Sentry from '@sentry/react-native';

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { lockPortrait } from './utils/orientation';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TrackList from './components/TrackList';
import Comments from './components/Comments';
import LikeButton from './components/LikeButton';
import UploadTrackPage from './components/UploadTrackPage';
import SignUpPage from './components/SignUpPage';
import LoginPage from './components/LoginPage';
import HomePage from './components/HomePage';
import FavoritesPage from './components/FavoritesPage';
import CreateProfile from './components/CreateProfile';
import Header from './components/Header'; // Move the import to the top
import SocialFeed from './components/SocialFeed';
import RotatingBackground from './components/RotatingBackground';
import { useFonts, Cinzel_600SemiBold, Cinzel_700Bold } from '@expo-google-fonts/cinzel';
import { Lora_400Regular, Lora_700Bold } from '@expo-google-fonts/lora';
import CreatePost from './components/CreatePost';
import CameraCapture from './components/CameraCapture';
import Music from './components/Music';
import EditTrackScreen from './components/EditTrackScreen';
import PostDetail from './components/PostDetail'
import { View, ActivityIndicator} from 'react-native';
import BibleReader from './components/BibleReader';
import HymnList from './components/HymnList';
import HymnDetail from './components/HymnDetail';
import HamburgerMenu from './components/HamburgerMenu';
import NoticeBoard from './pages/NoticeBoard';
import AdventistMedia from './pages/AdventistMedia';
import Articles from './pages/Articles';
import PublicationDetail from './pages/PublicationDetail';
import ChapterReader from './pages/ChapterReader';
import PublicationEditor from './pages/PublicationEditor';
import Churches from './pages/Churches';
import About from './pages/About';
import UserGuide from './pages/UserGuide';
import LegalPage from './pages/LegalPage';
import PrivacyCentre from './pages/PrivacyCentre';
import Settings from './pages/Settings';
import Help from './pages/Help';
import BlockedUsers from './pages/BlockedUsers';
import FollowRequests from './pages/FollowRequests';
import Choirs from './pages/Choirs';
import ChoirCommunity from './pages/ChoirCommunity';
import ChurchCommunity from './pages/ChurchCommunity';
import Studios from './pages/Studios';
import GroupList from './pages/GroupList';
import GroupDetail from './pages/GroupDetail';
import CreateGroup from './pages/CreateGroup';
import GroupMembers from './pages/GroupMembers';
import GroupJoinRequests from './pages/GroupJoinRequests';
import GroupMedia from './pages/GroupMedia';
import GroupAuditLog from './pages/GroupAuditLog';
import GroupAddMembers from './pages/GroupAddMembers';
import MarketplaceHome from './components/marketplace/MarketplaceHome';
import ProductList from './components/marketplace/ProductList';
import ProductDetail from './components/marketplace/ProductDetail';
import Cart from './components/marketplace/Cart';
import EditProduct from './components/marketplace/EditProduct';
import AddProduct from './components/marketplace/AddProduct';
import SellerDashboard from './components/marketplace/SellerDashboard';
import Checkout from './components/marketplace/Checkout';
import OrderHistory from './components/marketplace/OrderHistory';
import OrderDetail from './components/marketplace/OrderDetail';
import Wishlist from './components/marketplace/Wishlist';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminReports from './components/admin/AdminReports';
import AdminUsers from './components/admin/AdminUsers';
import AdminContent from './components/admin/AdminContent';
import AdminLogs from './components/admin/AdminLogs';
import AdminAnalytics from './components/admin/AdminAnalytics';
import AdminAppeals from './components/admin/AdminAppeals';
import AppealScreen from './components/admin/AppealScreen';
import AdminRoles from './components/admin/AdminRoles';
import AdminWallpapers from './components/admin/AdminWallpapers';
import VideoFeed from './components/VideoFeed';
import LiveHub from './components/Live/LiveHub';
import GoLive from './components/Live/GoLive';
import LiveRoom from './components/Live/LiveRoom';
import { registerGlobals as registerLiveKitGlobals } from '@livekit/react-native';
import { isAdmin } from './utils/roles';
import InboxScreen from './components/InboxScreen';
import ChatScreen from './components/ChatScreen';
import ExploreScreen from './components/ExploreScreen';
import EmailVerificationScreen from './components/EmailVerificationScreen';
import ForgotPasswordScreen from './components/ForgotPasswordScreen';
import ResetPasswordScreen from './components/ResetPasswordScreen';
import StoryViewer from './components/StoryViewer';
import CreateStoryScreen from './components/CreateStoryScreen';
import UserProfileScreen from './components/UserProfileScreen';
import FollowList from './components/FollowList';
import Profile from './components/Profile';
import NowPlaying from './components/NowPlaying';
import PlaylistsScreen from './components/PlaylistsScreen';
import PlaylistDetail from './components/PlaylistDetail';
import { navigationRef, navigate } from './services/navigationRef';
import { API_BASE, PUBLIC_BASE } from './services/api';


import { useAuth, AuthProvider } from './context/useAuth';
import { PlayerProvider } from './context/PlayerContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './context/I18nContext';
import { WallpaperProvider } from './context/WallpaperContext';
import MiniPlayer from './components/MiniPlayer';
import { addNotificationResponseListener } from './services/pushNotifications';
import ErrorBoundary from './components/ErrorBoundary';

// Init Sentry before anything else — DSN is set at build time via EXPO_PUBLIC_SENTRY_DSN
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 0 : 0.2,
  enabled: !__DEV__ && !!process.env.EXPO_PUBLIC_SENTRY_DSN,
});

// WebRTC globals for LiveKit must be registered once before any live screen mounts.
// Guarded: in Expo Go (or any build without the native WebRTC module) this throws
// "WebRTC native module not found" at startup — swallow it so the rest of the app
// still boots; the Live screens show their own "needs a dev build" guard.
try {
  registerLiveKitGlobals();
} catch (e) {
  console.warn('[LiveKit] WebRTC native module unavailable — live disabled in this build.', e?.message);
}

// Deep linking: a shared post URL (streams://post/123, or the web page
// https://<public-host>/post/123) opens the app straight to that post.
const linking = {
  prefixes: ['streams://', PUBLIC_BASE, API_BASE],
  config: {
    screens: {
      PostDetail: 'post/:postId',
    },
  },
};

// React Navigation's default theme background is light grey (rgb(242,242,242)),
// which flashes through during transitions now that screens are transparent.
// Use the app's dark background so transitions/blank frames are dark, not grey.
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#0A1628' },
};

// Per-tab wallpapers are admin-managed now: each surface asks for its own
// `scope` and RotatingBackground resolves it from the server-curated set. The
// music images that used to be hardcoded here are seeded as scope='music' rows
// by migration 0078, so admins can reorder, hide or delete them.

const Stack = createNativeStackNavigator();
const AuthInitializer = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return children;
};
  const HymnDetailWrapper = ({ navigation, route }) => (
    <View style={{ flex: 1 }}>
      <Header navigation={navigation} />
      <HymnDetail route={route} />
    </View>
  );
  // Add this to your App component


const App = () => {
  // Load the Cinzel display font used for the app's brand title.
  const [fontsLoaded] = useFonts({ Cinzel_600SemiBold, Cinzel_700Bold, Lora_400Regular, Lora_700Bold });

  // App is portrait by default; only the Live room opts into rotation (it
  // unlocks on mount and relocks portrait on leave). Guarded so it no-ops until
  // the native module is present in a fresh build.
  React.useEffect(() => {
    lockPortrait();
  }, []);

  // Handle notification taps when app is killed or in background
  React.useEffect(() => {
    const sub = addNotificationResponseListener(response => {
      const data = response.notification.request.content.data;
      if (data?.postId) {
        navigate('PostDetail', { postId: data.postId });
      } else if (data?.groupSlug) {
        // Group taps deep-link like the in-app bell: a join request goes to the
        // group's pending-requests page, everything else to the group itself.
        if (data.type === 'group_join_request') {
          navigate('GroupJoinRequests', { groupSlug: data.groupSlug });
        } else {
          navigate('GroupDetail', { groupSlug: data.groupSlug });
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Hold first paint until the brand font is ready so the title doesn't flash
  // in a fallback face and reflow.
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#102E50' }}>
        <ActivityIndicator size="large" color="#1DA1F2" />
      </View>
    );
  }

    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary fallbackMessage="The app encountered an unexpected error. Please restart.">
      <AuthProvider>
      <AuthInitializer>
      <PreferencesProvider>
      <ThemeProvider>
      <I18nProvider>
      <WallpaperProvider>
      <PlayerProvider>

        <NavigationContainer ref={navigationRef} linking={linking} theme={navTheme}>
            <Stack.Navigator
                initialRouteName="Home"
                screenOptions={{
                    headerShown: false, // Hide default header
                    contentStyle: { backgroundColor: '#0A1628' }, // dark scene bg, not grey
                }}
            >
                <Stack.Screen name="Home" component={HomePageWrapper} />
                <Stack.Screen name="Music" component={MusicPageWrapper} />
                <Stack.Screen name="Tracks" component={TrackListWrapper} />
                <Stack.Screen name="Comments" component={Comments} />
                <Stack.Screen name="LikeButton" component={LikeButton} />
                <Stack.Screen name="SignUp" component={SignUpPage} />
                <Stack.Screen name="Login" component={LoginPage} />
                <Stack.Screen name="CreateProfile" component={CreateProfile} />
                <Stack.Screen name="Favorites" component={FavoritesWrapper} />
                <Stack.Screen name="UploadTrack" component={UploadTrackPage} options={{ headerShown: true }} />
                <Stack.Screen name="SocialFeed" component={SocialFeedWrapper} />
                <Stack.Screen name="PostDetail" component={PostDetail} />
                <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ headerShown: true, title: 'Profile' }} />
                <Stack.Screen name="FollowList" component={FollowList} options={{ headerShown: true, title: 'Following', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD' }} />
                <Stack.Screen name="Profile" component={ProfileWrapper} />
                <Stack.Screen name="NowPlaying" component={NowPlaying} options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="Playlists" component={PlaylistsWrapper} options={{ headerShown: false }} />
                <Stack.Screen name="PlaylistDetail" component={PlaylistDetailWrapper} options={{ headerShown: false }} />
                <Stack.Screen name="CreatePost" component={CreatePost} options={{ headerShown: true }} />
                <Stack.Screen name="CameraCapture" component={CameraCapture} options={{ headerShown: false, presentation: 'fullScreenModal' }} />
                <Stack.Screen name="EditTrack" component={EditTrackScreen} />
                <Stack.Screen name="Hymns" component={HymnsWrapper} options={{ headerShown: false }}/>
                <Stack.Screen name="HymnDetail" component={HymnDetail}  options={({ route }) => ({ headerShown: false, title: route.params?.hymn?.title || 'Hymn Details' })}/>
                <Stack.Screen name="bible" component={BibleWrapper} />
                <Stack.Screen name="HamburgerMenu" component={HamburgerMenu} />
                <Stack.Screen name="NoticeBoard" component={NoticeBoard} options={{ headerShown: true, title: 'Notice Board', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD', headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false }} />
                <Stack.Screen name="AdventistMedia" component={ AdventistMedia} />
                <Stack.Screen name="Publishing" component={PublishingWrapper} />
                <Stack.Screen name="PublicationDetail" component={PublicationDetail} />
                <Stack.Screen name="ChapterReader" component={ChapterReader} />
                <Stack.Screen name="PublicationEditor" component={PublicationEditor} />
                <Stack.Screen name="Churches" component={ChurchesWrapper} />
                <Stack.Screen name="About" component={About} />
                <Stack.Screen name="UserGuide" component={UserGuide} />
                <Stack.Screen name="PrivacyCentre" component={PrivacyCentre} />
                <Stack.Screen name="LegalPage" component={LegalPage} />
                <Stack.Screen name="Settings" component={Settings} options={{ headerShown: false }} />
                <Stack.Screen name="Help" component={Help} options={{ headerShown: false }} />
                <Stack.Screen name="BlockedUsers" component={BlockedUsers} options={{ headerShown: false }} />
                <Stack.Screen name="FollowRequests" component={FollowRequests} options={{ headerShown: false }} />
                <Stack.Screen name="Studios" component={StudiosWrapper} />
                <Stack.Screen name="Choirs" component={ChoirsWrapper} />
                <Stack.Screen name="ChoirCommunity" component={ChoirCommunity} options={{ headerShown: false }} />
                <Stack.Screen name="ChurchCommunity" component={ChurchCommunity} options={{ headerShown: false }} />
                <Stack.Screen name="Groups" component={GroupListWrapper} />
                <Stack.Screen name="GroupDetail" component={GroupDetail} />
                <Stack.Screen name="CreateGroup" component={CreateGroup} />
                <Stack.Screen name="GroupMembers" component={GroupMembers} options={{ title: 'Group Members' }}/>
                <Stack.Screen name="GroupJoinRequests" component={GroupJoinRequests} options={{ title: 'Join Requests' }}/>
                <Stack.Screen name="GroupMedia" component={GroupMedia} options={{ headerShown: false }}/>
                <Stack.Screen name="GroupAuditLog" component={GroupAuditLog} options={{ headerShown: false }}/>
                <Stack.Screen name="GroupAddMembers" component={GroupAddMembers} options={{ headerShown: false }}/>
                <Stack.Screen name="MarketplaceHome" component={MarketplaceHomeWrapper} />
                <Stack.Screen name="ProductList" component={ProductListWrapper} />
                <Stack.Screen name="ProductDetail" component={ProductDetailWrapper} />
                <Stack.Screen name="Cart" component={CartWrapper} />
                <Stack.Screen name="Checkout" component={CheckoutWrapper} />
                <Stack.Screen name="OrderHistory" component={OrderHistoryWrapper} />
                <Stack.Screen name="OrderDetail" component={OrderDetailWrapper} />
                <Stack.Screen name="Wishlist" component={WishlistWrapper} />
                <Stack.Screen name="SellerDashboard" component={SellerDashboardWrapper} />
                <Stack.Screen name="AdminDashboard" component={AdminDashboardWrapper} />
                <Stack.Screen name="AdminReports" component={AdminReportsWrapper} />
                <Stack.Screen name="AdminUsers" component={AdminUsersWrapper} />
                <Stack.Screen name="AdminContent" component={AdminContentWrapper} />
                <Stack.Screen name="AdminLogs" component={AdminLogsWrapper} />
                <Stack.Screen name="AdminAnalytics" component={AdminAnalyticsWrapper} />
                <Stack.Screen name="AdminAppeals" component={AdminAppealsWrapper} />
                <Stack.Screen name="Appeal" component={AppealWrapper} />
                <Stack.Screen name="AdminRoles" component={AdminRolesWrapper} />
                <Stack.Screen name="AdminWallpapers" component={AdminWallpapersWrapper} />
                <Stack.Screen name="AddProduct" component={AddProductWrapper} />
                <Stack.Screen name="EditProduct" component={EditProductWrapper} />
                <Stack.Screen name="Inbox" component={InboxWrapper} />
                <Stack.Screen name="Chat" component={ChatScreen} />
                <Stack.Screen name="Explore" component={ExploreWrapper} />
                <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
                <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
                <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
                <Stack.Screen name="Videos" component={VideoFeed} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
                <Stack.Screen name="StoryViewer" component={StoryViewer} options={{ headerShown: false, animation: 'fade' }} />
                <Stack.Screen name="CreateStory" component={CreateStoryScreen} options={{ headerShown: false }} />
                <Stack.Screen name="LiveHub" component={LiveHubWrapper} />
                <Stack.Screen name="GoLive" component={GoLive} options={{ headerShown: false }} />
                <Stack.Screen name="LiveRoom" component={LiveRoom} options={{ headerShown: false, gestureEnabled: false }} />
                
                
              

            </Stack.Navigator>
            <MiniPlayer />
        </NavigationContainer>
      </PlayerProvider>
      </WallpaperProvider>
      </I18nProvider>
      </ThemeProvider>
      </PreferencesProvider>
      </AuthInitializer>
      </AuthProvider>
      </ErrorBoundary>
      </GestureHandlerRootView>
    );
};

const GroupListWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Groups couldn't load.">
      <GroupList navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const InboxWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Messages couldn't load.">
      <InboxScreen navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const HymnsWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <HymnList navigation={navigation} />
  </View>
);

const BibleWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <BibleReader navigation={navigation} />
  </View>
);

const ExploreWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    {/* Social-feed wallpapers behind Explore (swap for bespoke art later). */}
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Explore couldn't load.">
      <ExploreScreen navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const ChoirsWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Choir Community couldn't load.">
      <Choirs navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const ChurchesWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Church Community couldn't load.">
      <Churches navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const StudiosWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Studios couldn't load.">
      <Studios navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const PublishingWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Publishing couldn't load.">
      <Articles navigation={navigation} />
    </ErrorBoundary>
  </View>
);
// Wrapper components for each screen to include the Header
const HomePageWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        {/* One shared rotating wallpaper behind both the nav bar and the feed,
            so the background flows continuously from the header into the feed.
            Header + feed render transparent over it. */}
        <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.28)" />
        <Header navigation={navigation} transparentBg />
        <ErrorBoundary fallbackMessage="The feed couldn't load. Pull down to retry.">
          <HomePage />
        </ErrorBoundary>
    </View>
);

const MusicPageWrapper = ({ navigation }) => (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
        <RotatingBackground scope="music" intervalMs={60000} scrimColor="rgba(10,22,40,0.45)" />
        <Header navigation={navigation} transparentBg />
        <Music />
    </View>
);


const TrackListWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <TrackList />
    </View>
);

const FavoritesWrapper = ({ navigation }) => (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
        <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
        <Header navigation={navigation} transparentBg />
        <ErrorBoundary fallbackMessage="Favorites couldn't load.">
          <FavoritesPage />
        </ErrorBoundary>
    </View>
);

// Shared luxury backdrop (rotating wallpaper + transparent nav bar) for every
// marketplace screen, matching Studios/Churches. The screen itself renders on a
// transparent surface so the wallpaper shows through behind cards & the header.
const marketWrap = (Screen, fallbackMessage = "Marketplace couldn't load.") =>
  ({ navigation, route }) => (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
      <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
      <Header navigation={navigation} transparentBg />
      <ErrorBoundary fallbackMessage={fallbackMessage}>
        <Screen navigation={navigation} route={route} />
      </ErrorBoundary>
    </View>
  );

const MarketplaceHomeWrapper = marketWrap(MarketplaceHome);
const ProductListWrapper = marketWrap(ProductList);
const ProductDetailWrapper = marketWrap(ProductDetail, 'This product couldn’t load.');
const CartWrapper = marketWrap(Cart);
const CheckoutWrapper = marketWrap(Checkout);
const OrderHistoryWrapper = marketWrap(OrderHistory);
const OrderDetailWrapper = marketWrap(OrderDetail, 'This order couldn’t load.');
const WishlistWrapper = marketWrap(Wishlist, 'Your wishlist couldn’t load.');
const SellerDashboardWrapper = marketWrap(SellerDashboard);

// Playlists share the same luxury backdrop + custom nav header as the rest of
// the app (replacing the plain native stack header these screens used before).
const PlaylistsWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="Playlists couldn't load.">
      <PlaylistsScreen navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const PlaylistDetailWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.55)" />
    <Header navigation={navigation} transparentBg />
    <ErrorBoundary fallbackMessage="This playlist couldn’t load.">
      <PlaylistDetail navigation={navigation} route={route} />
    </ErrorBoundary>
  </View>
);

// Role gate: non-admins are bounced Home. The API is also gated server-side, so
// this is purely UX (hides screens that would 403 anyway).
const RequireAdmin = ({ navigation, children }) => {
  const { currentUser } = useAuth();
  const allowed = isAdmin(currentUser);
  React.useEffect(() => {
    if (!allowed) navigation.replace('Home');
  }, [allowed, navigation]);
  return allowed ? children : null;
};

// Shared luxury backdrop (rotating wallpaper + transparent nav bar) for all
// admin screens, matching Explore/Bible/Hymns.
const adminWrap = (Screen) => ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.6)" />
    <Header navigation={navigation} transparentBg />
    <RequireAdmin navigation={navigation}>
      <Screen navigation={navigation} />
    </RequireAdmin>
  </View>
);

const AdminDashboardWrapper = adminWrap(AdminDashboard);
const AdminReportsWrapper = adminWrap(AdminReports);
const AdminUsersWrapper = adminWrap(AdminUsers);
const AdminContentWrapper = adminWrap(AdminContent);
const AdminLogsWrapper = adminWrap(AdminLogs);
const LiveHubWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#060D1A' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(6,13,26,0.72)" />
    <Header navigation={navigation} transparentBg />
    <LiveHub navigation={navigation} />
  </View>
);

const AdminAnalyticsWrapper = adminWrap(AdminAnalytics);
const AdminAppealsWrapper = adminWrap(AdminAppeals);
const AdminRolesWrapper = adminWrap(AdminRoles);
const AdminWallpapersWrapper = adminWrap(AdminWallpapers);

// Appeal is available to any signed-in user (a suspended user can't reach admin
// screens), so it gets the luxury backdrop without the RequireAdmin gate.
const AppealWrapper = ({ navigation }) => (
  <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.6)" />
    <Header navigation={navigation} transparentBg />
    <AppealScreen navigation={navigation} />
  </View>
);
const AddProductWrapper = marketWrap(AddProduct, 'The product form couldn’t load.');
const EditProductWrapper = marketWrap(EditProduct, 'The product form couldn’t load.');

// Repeat for other screens as needed...
const SocialFeedWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <SocialFeed navigation={navigation} />
    </View>
);

const ProfileWrapper = ({ navigation }) => (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
        <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.5)" />
        <Header navigation={navigation} transparentBg />
        <ErrorBoundary fallbackMessage="Your profile couldn't load.">
            <Profile />
        </ErrorBoundary>
    </View>
);
export default Sentry.wrap(App);
