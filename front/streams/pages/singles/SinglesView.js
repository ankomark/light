// Someone's profile, opened from the grid or from "interested in you":
// who they are, why they're suggested, and Interested / Not now. Messages
// open only once you are both interested.
import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesProfile, answerSingles } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, SinglesScreen, GoldButton, Body, Centered } from '../../components/singles/SinglesKit';
import ProfileCard from '../../components/singles/ProfileCard';
import SafetySheet from '../../components/singles/SafetySheet';
import { MatchMoment } from './SinglesHome';

export default function SinglesView() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const [profile, setProfile] = useState(null);
  // 'gone' (404: not there for me) or 'offline' (no answer): only the first
  // says the profile isn't available - offline used to say it too.
  const [failed, setFailed] = useState(null);
  // The grid already had the photo, name, age and why: drawn at once while
  // the rest comes (it was a spinner).
  const card = params.card;
  const preview = card ? { ...card, photos: card.photo ? [{ id: 'card', url: card.photo }] : [] } : null;
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState(false);
  const [match, setMatch] = useState(null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(null);
    fetchSinglesProfile(params.id).then((p) => live && setProfile(p))
      .catch((e) => live && setFailed(e?.status === 404 ? 'gone' : 'offline'));
    return () => { live = false; };
  }, [params.id, attempt]);

  const answer = async (kind) => {
    setBusy(true);
    try {
      const res = await answerSingles(profile.id, kind);
      if (res.matched) setMatch(res.match); else navigation.goBack();
    } catch (e) {
      notify(t('common.error'), e?.data?.code === 'daily_limit' ? t('singles.discover.doneBody') : t('singles.discover.failed'));
    } finally {
      setBusy(false);
    }
  };

  const name = profile?.first_name || params.card?.first_name || '';
  return (
    <SinglesScreen title={name} testID="singles-view"
      right={profile ? (
        <TouchableOpacity onPress={() => setSafety(true)} accessibilityRole="button" accessibilityLabel={t('singles.safety.link')}
          hitSlop={10}>
          <Ionicons name="flag-outline" size={21} color={GOLD.text} />
        </TouchableOpacity>
      ) : null}
      footer={profile ? (
        <>
          <GoldButton label={t('singles.notNow')} icon="close" kind="outline" onPress={() => answer('pass')} disabled={busy}
            testID="singles-view-pass" />
          <GoldButton label={t('singles.interested')} icon="heart" onPress={() => answer('interested')} busy={busy}
            testID="singles-view-interested" />
        </>
      ) : null}>
      {failed === 'gone' ? (
        <Centered><Body style={{ textAlign: 'center' }}>{t('singles.view.gone')}</Body></Centered>
      ) : profile || preview ? (
        <View>
          <ProfileCard profile={profile || preview} testID={profile ? 'singles-view-card' : 'singles-view-preview'} />
          {!profile && (failed === 'offline' ? (
            <View style={{ alignItems: 'center', gap: 12, marginTop: 8 }} testID="singles-view-offline">
              <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
              <GoldButton label={t('common.retry')} icon="refresh" kind="outline" onPress={() => setAttempt((n) => n + 1)} />
            </View>
          ) : <ActivityIndicator color={GOLD.gold} style={{ marginTop: 8 }} />)}
        </View>
      ) : failed === 'offline' ? (
        <Centered>
          <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
          <GoldButton label={t('common.retry')} icon="refresh" kind="outline" onPress={() => setAttempt((n) => n + 1)}
            testID="singles-view-retry" />
        </Centered>
      ) : <ActivityIndicator color={GOLD.gold} style={{ marginTop: 60 }} />}
      {profile && (
        <SafetySheet profile={profile} visible={safety} onClose={() => setSafety(false)} onDone={() => navigation.goBack()} />
      )}
      <MatchMoment match={match} onClose={() => { setMatch(null); navigation.goBack(); }}
        onHello={() => {
          const m = match;
          setMatch(null);
          navigation.replace('Chat', { conversationId: m.conversation_id, otherUser: m.user, singles: true });
        }} />
    </SinglesScreen>
  );
}
