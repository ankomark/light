// A match's profile, opened from Matches: who they are, the way to their
// chat, and — always within reach — unmatch, report or block.
import React, { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { unmatchSingles } from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { GOLD, SinglesScreen, GoldButton, Card, Label, Body } from '../../components/singles/SinglesKit';
import ProfileCard from '../../components/singles/ProfileCard';
import SafetySheet from '../../components/singles/SafetySheet';
import { openerText } from './SinglesHome';

export default function SinglesPerson() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const match = params.match;
  const [safety, setSafety] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!match) return null;
  const p = match.profile;

  const unmatch = async () => {
    if (!(await confirmAction({ title: t('singles.unmatch.title', { name: p.first_name }), message: t('singles.unmatch.body'),
      confirmLabel: t('singles.unmatch.confirm'), cancelLabel: t('common.cancel'), destructive: true }))) return;
    setBusy(true);
    try { await unmatchSingles(match.id); navigation.goBack(); } catch { notify(t('common.error'), t('singles.mine.failed')); }
    finally { setBusy(false); }
  };

  return (
    <SinglesScreen title={p.first_name} testID="singles-person"
      right={(
        <TouchableOpacity onPress={() => setSafety(true)} accessibilityRole="button"
          accessibilityLabel={t('singles.safety.link')} hitSlop={10} testID="singles-person-safety">
          <Ionicons name="flag-outline" size={21} color={GOLD.text} />
        </TouchableOpacity>
      )}
      footer={(
        <GoldButton label={t('singles.match.hello')} icon="chatbubble-ellipses"
          onPress={() => navigation.navigate('Chat', { conversationId: match.conversation_id, otherUser: match.user, singles: true })} />
      )}>
      <ProfileCard profile={p} />
      <Card style={{ marginTop: 22 }}>
        <Label>{t('singles.match.begin')}</Label>
        <Body>{openerText(t, match.opener, p.first_name)}</Body>
      </Card>
      <View style={{ marginTop: 18 }}>
        <GoldButton label={t('singles.unmatch.button')} kind="quiet" onPress={unmatch} busy={busy} testID="singles-unmatch" />
      </View>
      <SafetySheet profile={p} visible={safety} onClose={() => setSafety(false)} onDone={() => navigation.goBack()} />
    </SinglesScreen>
  );
}
