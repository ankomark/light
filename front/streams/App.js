
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
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
import CreatePost from './components/CreatePost';
import Music from './components/Music';
import EditTrackScreen from './components/EditTrackScreen';
import PostDetail from './components/PostDetail'
import { View, Text, TextInput, Button, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import BibleReader from './components/BibleReader';
import HymnList from './components/HymnList';
import HymnDetail from './components/HymnDetail';
import HamburgerMenu from './components/HamburgerMenu';
import Conferences from './pages/Conferences';
import MediaScreen from './pages/MediaScreen';
import AdventistMedia from './pages/AdventistMedia';
import Churches from './pages/Churches';
import Choirs from './pages/Choirs';
import Studios from './pages/Studios';
import GroupList from './pages/GroupList';
import GroupDetail from './pages/GroupDetail';
import CreateGroup from './pages/CreateGroup';
import GroupMembers from './pages/GroupMembers';
import GroupJoinRequests from './pages/GroupJoinRequests'



const Stack = createNativeStackNavigator();
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

    return (
       
        <NavigationContainer>
            <Stack.Navigator
                initialRouteName="Home"
                screenOptions={{
                    headerShown: false, // Hide default header
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
                <Stack.Screen name="Favorites" component={FavoritesPage} />
                <Stack.Screen name="UploadTrack" component={UploadTrackPage} options={{ headerShown: true }} />
                <Stack.Screen name="SocialFeed" component={SocialFeedWrapper} />
                <Stack.Screen name="PostDetail" component={PostDetail} />
                <Stack.Screen name="CreatePost" component={CreatePost} options={{ headerShown: true }} />
                <Stack.Screen name="EditTrack" component={EditTrackScreen} />
                <Stack.Screen name="Hymns" component={HymnList} options={{ title: 'Hymnal' }}/>
                <Stack.Screen name="HymnDetail" component={HymnDetail}  options={({ route }) => ({ headerShown: false, title: route.params?.hymn?.title || 'Hymn Details' })}/>
                <Stack.Screen name="bible" component={BibleReader} />
                <Stack.Screen name="HamburgerMenu" component={HamburgerMenu} />
                <Stack.Screen name="Unions&Conferences" component={Conferences} />
                <Stack.Screen name="MediaScreen" component={MediaScreen} />
                <Stack.Screen name="AdventistMedia" component={ AdventistMedia} />
                <Stack.Screen name="Churches" component={Churches} />
                <Stack.Screen name="Studios" component={Studios} />
                <Stack.Screen name="Choirs" component={Choirs} />
                <Stack.Screen name="Groups" component={GroupListWrapper} />
                <Stack.Screen name="GroupDetail" component={GroupDetail} />
                <Stack.Screen name="CreateGroup" component={CreateGroup} />
                <Stack.Screen name="GroupMembers" component={GroupMembers} options={{ title: 'Group Members' }}/>
                <Stack.Screen name="GroupJoinRequests" component={GroupJoinRequests} options={{ title: 'Join Requests' }}/>

            </Stack.Navigator>
        </NavigationContainer>
       
    );
};

const GroupListWrapper = ({ navigation }) => (
  <View style={{ flex: 1 }}>
    <Header navigation={navigation} />
    <GroupList navigation={navigation} />
  </View>
);
// Wrapper components for each screen to include the Header
const HomePageWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <HomePage />
    </View>
);

const MusicPageWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <Music />
    </View>
);


const TrackListWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <TrackList />
    </View>
);

const BooksListsPageWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <BooksLists />
    </View>
);

// Repeat for other screens as needed...
const SocialFeedWrapper = ({ navigation }) => (
    <View style={{ flex: 1 }}>
        <Header navigation={navigation} />
        <SocialFeed navigation={navigation} />
    </View>
);
export default App;
