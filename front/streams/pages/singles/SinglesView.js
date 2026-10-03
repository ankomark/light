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
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState(false);
  const [match, setMatch] = useState(null);

  useEffect(() => {
    let live = true;
    fetchSinglesProfile(params.id).then((p) => live && setProfile(p)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [params.id]);

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
      {failed ? (
        <Centered><Body style={{ textAlign: 'center' }}>{t('singles.view.gone')}</Body></Centered>
      ) : !profile ? <ActivityIndicator color={GOLD.gold} style={{ marginTop: 60 }} /> : (
        <View><ProfileCard profile={profile} testID="singles-view-card" /></View>
      )}
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
