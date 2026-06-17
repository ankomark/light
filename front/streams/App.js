import * as Sentry from '@sentry/react-native';

// Init Sentry before anything else — DSN is set at build time via EXPO_PUBLIC_SENTRY_DSN
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 0 : 0.2,
  enabled: !__DEV__ && !!process.env.EXPO_PUBLIC_SENTRY_DSN,
});

import React from 'react';
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
import CreatePost from './components/CreatePost';
import Music from './components/Music';
import EditTrackScreen from './components/EditTrackScreen';
import PostDetail from './components/PostDetail'
import { View, ActivityIndicator} from 'react-native';
import BibleReader from './components/BibleReader';
import HymnList from './components/HymnList';
import HymnDetail from './components/HymnDetail';
import HamburgerMenu from './components/HamburgerMenu';
import NoticeBoard from './pages/NoticeBoard';
import MediaScreen from './pages/MediaScreen';
import AdventistMedia from './pages/AdventistMedia';
import Articles from './pages/Articles';
import PublicationDetail from './pages/PublicationDetail';
import ChapterReader from './pages/ChapterReader';
import PublicationEditor from './pages/PublicationEditor';
import Churches from './pages/Churches';
import About from './pages/About';
import Choirs from './pages/Choirs';
import Studios from './pages/Studios';
import GroupList from './pages/GroupList';
import GroupDetail from './pages/GroupDetail';
import CreateGroup from './pages/CreateGroup';
import GroupMembers from './pages/GroupMembers';
import GroupJoinRequests from './pages/GroupJoinRequests';
import MarketplaceHome from './components/marketplace/MarketplaceHome';
import ProductList from './components/marketplace/ProductList';
import ProductDetail from './components/marketplace/ProductDetail';
import Cart from './components/marketplace/Cart';
import EditProduct from './components/marketplace/EditProduct';
import AddProduct from './components/marketplace/AddProduct';
import SellerDashboard from './components/marketplace/SellerDashboard';
import Checkout from './components/marketplace/Checkout';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminReports from './components/admin/AdminReports';
import AdminUsers from './components/admin/AdminUsers';
import AdminContent from './components/admin/AdminContent';
import AdminLogs from './components/admin/AdminLogs';
import { isAdmin } from './utils/roles';
import LiveEventForm from './components/Live/LiveEventForm';
import LiveEventPlayer from './components/Live/LiveEventPlayer';
import LiveEventsList from './components/Live/LiveEventsList';
import LiveHomeScreen from './components/Live/LiveHomeScreen';
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

// Per-tab wallpapers. Home/SocialFeed keeps the rotating set (in RotatingBackground's
// defaults); other tabs pass their own here (re-hosted on Cloudinary, optimized).
const CLD_W = 'https://res.cloudinary.com/dxdmo9j4v/image/upload/f_auto,q_auto,c_limit,w_1080/wallpapers';
const MUSIC_WALLPAPERS = [
  `${CLD_W}/wg19rbjnqphztrcsan0b.jpg`,
  `${CLD_W}/fjcbdllwljh0dvglousp.jpg`,
  `${CLD_W}/jxggwl3ltobv4l0o8sqq.jpg`,
  `${CLD_W}/ikinna96rzqdle0ztcoy.jpg`,
  `${CLD_W}/gvwuacmn04nq1b25axs1.jpg`,
];


import { useAuth, AuthProvider } from './context/useAuth';
import { PlayerProvider } from './context/PlayerContext';
import MiniPlayer from './components/MiniPlayer';
import { addNotificationResponseListener } from './services/pushNotifications';
import ErrorBoundary from './components/ErrorBoundary';

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
const HymnalAppWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
      <Header navigation={navigation} />
      <HymnalApp navigation={navigation} />
    </View>
  );
  
  const HymnDetailWrapper = ({ navigation, route }) => (
    <View style={{ flex: 1 }}>
      <Header navigation={navigation} />
      <HymnDetail route={route} />
    </View>
  );
  // Add this to your App component


const App = () => {
  // Load the Cinzel display font used for the app's brand title.
  const [fontsLoaded] = useFonts({ Cinzel_600SemiBold, Cinzel_700Bold });

  // Handle notification taps when app is killed or in background
  React.useEffect(() => {
    const sub = addNotificationResponseListener(response => {
      const data = response.notification.request.content.data;
      if (data?.postId) {
        navigate('PostDetail', { postId: data.postId });
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
      <ErrorBoundary fallbackMessage="The app encountered an unexpected error. Please restart.">
      <AuthProvider>
      <AuthInitializer>
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
                <Stack.Screen name="Playlists" component={PlaylistsScreen} options={{ headerShown: true, title: 'Playlists', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD' }} />
                <Stack.Screen name="PlaylistDetail" component={PlaylistDetail} options={{ headerShown: true, title: 'Playlist', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD' }} />
                <Stack.Screen name="CreatePost" component={CreatePost} options={{ headerShown: true }} />
                <Stack.Screen name="EditTrack" component={EditTrackScreen} />
                <Stack.Screen name="Hymns" component={HymnsWrapper} options={{ headerShown: false }}/>
                <Stack.Screen name="HymnDetail" component={HymnDetail}  options={({ route }) => ({ headerShown: false, title: route.params?.hymn?.title || 'Hymn Details' })}/>
                <Stack.Screen name="bible" component={BibleWrapper} />
                <Stack.Screen name="HamburgerMenu" component={HamburgerMenu} />
                <Stack.Screen name="NoticeBoard" component={NoticeBoard} options={{ headerShown: true, title: 'Notice Board', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD', headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false }} />
                <Stack.Screen name="MediaScreen" component={MediaScreen} />
                <Stack.Screen name="AdventistMedia" component={ AdventistMedia} />
                <Stack.Screen name="Articles" component={Articles} />
                <Stack.Screen name="PublicationDetail" component={PublicationDetail} />
                <Stack.Screen name="ChapterReader" component={ChapterReader} />
                <Stack.Screen name="PublicationEditor" component={PublicationEditor} />
                <Stack.Screen name="Churches" component={Churches} options={{ headerShown: true, title: 'Churches', headerStyle: { backgroundColor: '#102E50' }, headerTintColor: '#E0E1DD', headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false }} />
                <Stack.Screen name="About" component={About} />
                <Stack.Screen name="Studios" component={Studios} />
                <Stack.Screen name="Choirs" component={Choirs} />
                <Stack.Screen name="Groups" component={GroupListWrapper} />
                <Stack.Screen name="GroupDetail" component={GroupDetail} />
                <Stack.Screen name="CreateGroup" component={CreateGroup} />
                <Stack.Screen name="GroupMembers" component={GroupMembers} options={{ title: 'Group Members' }}/>
                <Stack.Screen name="GroupJoinRequests" component={GroupJoinRequests} options={{ title: 'Join Requests' }}/>
                <Stack.Screen name="MarketplaceHome" component={MarketplaceHomeWrapper} />
                <Stack.Screen name="ProductList" component={ProductListWrapper} />
                <Stack.Screen name="ProductDetail" component={ProductDetailWrapper} />
                <Stack.Screen name="Cart" component={CartWrapper} />
                <Stack.Screen name="Checkout" component={CheckoutWrapper} />
                <Stack.Screen name="OrderHistory" component={OrderHistoryWrapper} />
                <Stack.Screen name="SellerDashboard" component={SellerDashboardWrapper} />
                <Stack.Screen name="AdminDashboard" component={AdminDashboardWrapper} />
                <Stack.Screen name="AdminReports" component={AdminReportsWrapper} />
                <Stack.Screen name="AdminUsers" component={AdminUsersWrapper} />
                <Stack.Screen name="AdminContent" component={AdminContentWrapper} />
                <Stack.Screen name="AdminLogs" component={AdminLogsWrapper} />
                <Stack.Screen name="AddProduct" component={AddProductWrapper} />
                <Stack.Screen name="EditProduct" component={EditProductWrapper} />
                <Stack.Screen name="Inbox" component={InboxScreen} />
                <Stack.Screen name="Chat" component={ChatScreen} />
                <Stack.Screen name="Explore" component={ExploreWrapper} />
                <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
                <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
                <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
                <Stack.Screen name="StoryViewer" component={StoryViewer} options={{ headerShown: false, animation: 'fade' }} />
                <Stack.Screen name="CreateStory" component={CreateStoryScreen} options={{ headerShown: false }} />
                <Stack.Screen name="LiveHomeScreen" component={LiveHomeScreenWrapper} />
                <Stack.Screen name="LiveEvents" component={LiveEventsListWrapper} />
                <Stack.Screen name="LiveEventForm" component={LiveEventFormWrapper} />
                <Stack.Screen name="LiveEventPlayer" component={LiveEventPlayerWrapper} options={{ headerShown: false, presentation: 'modal' }}/>
                
                
              

            </Stack.Navigator>
            <MiniPlayer />
        </NavigationContainer>
      </PlayerProvider>
      </AuthInitializer>
      </AuthProvider>
      </ErrorBoundary>
    );
};
const LiveHomeScreenWrapper = ({ navigation,route }) => (
 
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <LiveHomeScreen navigation={navigation} route={route} />
  </View>
);

const LiveEventsListWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <LiveEventsList navigation={navigation} route={route} />
  </View>
);

const LiveEventFormWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <LiveEventForm navigation={navigation} route={route} />
  </View>
);

const LiveEventPlayerWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <LiveEventPlayer navigation={navigation} route={route} />
  </View>
);

const GroupListWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <ErrorBoundary fallbackMessage="Groups couldn't load.">
      <GroupList navigation={navigation} />
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
        <RotatingBackground images={MUSIC_WALLPAPERS} intervalMs={60000} scrimColor="rgba(10,22,40,0.45)" />
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
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <ErrorBoundary fallbackMessage="Favorites couldn't load.">
          <FavoritesPage />
        </ErrorBoundary>
    </View>
);

const BooksListsPageWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <BooksLists />
    </View>
);
// Add these wrapper components
const MarketplaceHomeWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <ErrorBoundary fallbackMessage="Marketplace couldn't load.">
      <MarketplaceHome navigation={navigation} />
    </ErrorBoundary>
  </View>
);

const ProductListWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <ProductList route={route} navigation={navigation} />
  </View>
);

const ProductDetailWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <ProductDetail route={route} navigation={navigation} />
  </View>
);

const CartWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <Cart navigation={navigation} />
  </View>
);

const CheckoutWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <Checkout navigation={navigation} />
  </View>
);

const OrderHistoryWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <OrderHistory navigation={navigation} />
  </View>
);

const SellerDashboardWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <SellerDashboard navigation={navigation} />
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
const OrderDetailWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <OrderDetail route={route} navigation={navigation} />
  </View>
);

const AddProductWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <AddProduct navigation={navigation} />
  </View>
);

const EditProductWrapper = ({ navigation, route }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <EditProduct route={route} navigation={navigation} />
  </View>
);

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
