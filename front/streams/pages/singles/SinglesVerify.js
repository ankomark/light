// Photo verification: take a selfie making the gesture shown; a moderator
// compares it with your photos. The selfie is never shown on your profile —
// only the tick, once it passes.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesVerify, sendSinglesSelfie } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, SinglesScreen, GoldButton, Title, Body, Centered, Ring, Card, Label } from '../../components/singles/SinglesKit';

const GESTURE_ICON = { thumbs_up: 'thumb-up-outline', peace: 'hand-peace', wave: 'hand-wave-outline', hand_on_chin: 'account-question-outline' };

export default function SinglesVerify() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    fetchSinglesVerify().then(setState).catch(() => setState({ failed: true }));
  }, []));

  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { notify(t('singles.verify.cameraTitle'), t('singles.verify.cameraBody')); return; }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, cameraType: ImagePicker.CameraType?.front });
    if (shot.canceled || !shot.assets?.[0]) return;
    setBusy(true);
    try {
      const small = await manipulateAsync(shot.assets[0].uri, [{ resize: { width: 1000 } }], { compress: 0.8, format: SaveFormat.JPEG });
      const form = new FormData();
      form.append('image', { uri: small.uri, name: 'selfie.jpg', type: 'image/jpeg' });
      form.append('gesture', state.gesture);
      await sendSinglesSelfie(form);
      notify(t('singles.verify.sentTitle'), t('singles.verify.sentBody'));
      navigation.goBack();
    } catch {
      notify(t('common.error'), t('singles.mine.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SinglesScreen title={t('singles.verify.title')} testID="singles-verify"
      footer={state && !state.failed && !state.verified && state.last !== 'pending' ? (
        <GoldButton label={t('singles.verify.take')} icon="camera" onPress={take} busy={busy} testID="singles-verify-take" />
      ) : null}>
      {!state ? <ActivityIndicator color={GOLD.gold} style={{ marginTop: 60 }} /> : state.failed ? (
        <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
      ) : state.verified ? (
        <Centered>
          <MaterialCommunityIcons name="check-decagram" size={64} color={GOLD.gold} />
          <Title>{t('singles.verify.doneTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.verify.doneBody')}</Body>
        </Centered>
      ) : state.last === 'pending' ? (
        <Centered>
          <Title>{t('singles.verify.waitingTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.verify.waitingBody')}</Body>
        </Centered>
      ) : (
        <Centered>
          <Ring><MaterialCommunityIcons name={GESTURE_ICON[state.gesture] || 'hand-wave-outline'} size={72} color={GOLD.gold} /></Ring>
          <Title>{t(`singles.gesture.${state.gesture}`)}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.verify.lead')}</Body>
          {state.last === 'rejected' && <Body style={{ textAlign: 'center', color: GOLD.danger }}>{t('singles.verify.again')}</Body>}
          <Card style={{ alignSelf: 'stretch' }}>
            <Label>{t('singles.verify.privateTitle')}</Label>
            <Body style={{ fontSize: 14 }}>{t('singles.verify.privateBody')}</Body>
          </Card>
        </Centered>
      )}
    </SinglesScreen>
  );
}
