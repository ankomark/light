// Your own singles profile: where it stands (a draft, being reviewed, a
// change asked for, approved), your photos — the first is the one people see
// first, and each new one waits for a check — what you wrote, and the
// switches: pause, preview, leave.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useI18n } from '../../context/I18nContext';
import {
  addSinglesPhoto, removeSinglesPhoto, submitSinglesProfile, pauseSinglesProfile, leaveSingles, orderSinglesPhotos,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { GOLD, FACE, GoldButton, Label, Card, Portrait } from './SinglesKit';

const MAX_PHOTOS = 4;

const BANNER = {
  draft: ['pencil-outline', 'draft'],
  pending: ['clock-outline', 'pending'],
  rejected: ['alert-circle-outline', 'rejected'],
  approved: ['check-decagram-outline', 'approved'],
};

export default function MyProfilePane({ profile, onChange }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [busy, setBusy] = useState(null);
  const photos = profile.photos || [];
  const [icon, key] = BANNER[profile.status] || BANNER.draft;

  const run = async (what, fn) => {
    setBusy(what);
    try { await fn(); await onChange?.(); } catch (e) {
      notify(t('common.error'), e?.data?.image || e?.data?.error || t('singles.mine.failed'));
    } finally { setBusy(null); }
  };

  const addPhoto = () => run('photo', async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { notify(t('singles.mine.photoPermTitle'), t('singles.mine.photoPermBody')); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const small = await manipulateAsync(picked.assets[0].uri, [{ resize: { width: 1200 } }],
      { compress: 0.8, format: SaveFormat.JPEG });
    const form = new FormData();
    form.append('image', { uri: small.uri, name: 'photo.jpg', type: 'image/jpeg' });
    await addSinglesPhoto(form);
  });

  const removePhoto = async (photo) => {
    if (!(await confirmAction({ title: t('singles.mine.removePhotoTitle'), message: t('singles.mine.removePhotoBody'),
      confirmLabel: t('singles.mine.remove'), cancelLabel: t('common.cancel'), destructive: true }))) return;
    run(`rm-${photo.id}`, () => removeSinglesPhoto(photo.id));
  };

  // The first photo is the one people see first: any can take its place.
  const makeMain = (photo) => run(`main-${photo.id}`, () => orderSinglesPhotos(
    [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)]));

  const submit = () => run('submit', async () => {
    try {
      await submitSinglesProfile();
      notify(t('singles.mine.sentTitle'), t('singles.mine.sentBody'));
    } catch (e) {
      if (e?.data?.code === 'incomplete') {
        notify(t('singles.mine.missingTitle'),
          (e.data.missing || []).map((m) => `•  ${t(`singles.missing.${m}`)}`).join('\n'));
        return;
      }
      throw e;
    }
  });

  const leave = async () => {
    if (!(await confirmAction({ title: t('singles.mine.leaveTitle'), message: t('singles.mine.leaveBody'),
      confirmLabel: t('singles.mine.leave'), cancelLabel: t('common.cancel'), destructive: true }))) return;
    setBusy('leave');
    try { await leaveSingles(); navigation.goBack(); } catch { notify(t('common.error'), t('singles.mine.failed')); }
    finally { setBusy(null); }
  };

  const canSubmit = profile.status === 'draft' || profile.status === 'rejected';
  return (
    <View style={{ gap: 18 }} testID="singles-mine-pane">
      <View style={[styles.banner, profile.status === 'rejected' && styles.bannerWarn]} testID={`singles-status-${profile.status}`}>
        <MaterialCommunityIcons name={icon} size={22} color={profile.status === 'rejected' ? GOLD.danger : GOLD.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{t(`singles.status.${key}`)}</Text>
          <Text style={styles.bannerBody}>
            {profile.status === 'rejected' && profile.review_note
              ? t('singles.status.rejectedWhy', { why: profile.review_note })
              : t(`singles.status.${key}Body`)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Label>{t('singles.mine.photos')}</Label>
        <View style={styles.grid}>
          {photos.map((p, i) => (
            <View key={p.id} style={styles.slot}>
              <Portrait uri={p.url} size={150} radius={14} style={styles.slotImg} />
              {i === 0 && <Text style={styles.mainTag}>{t('singles.mine.main')}</Text>}
              {p.status === 'pending' && <Text style={styles.waitTag}>{t('singles.mine.photoWaiting')}</Text>}
              {i > 0 && (
                <TouchableOpacity style={styles.makeMain} onPress={() => makeMain(p)} accessibilityRole="button"
                  accessibilityLabel={t('singles.mine.makeMain')} testID={`singles-make-main-${p.id}`}>
                  {busy === `main-${p.id}` ? <ActivityIndicator size="small" color={GOLD.onGold} />
                    : <Ionicons name="star" size={15} color={GOLD.onGold} />}
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.remove} onPress={() => removePhoto(p)} accessibilityRole="button"
                accessibilityLabel={t('singles.mine.removePhotoTitle')} hitSlop={8}>
                {busy === `rm-${p.id}` ? <ActivityIndicator size="small" color={GOLD.text} />
                  : <Ionicons name="close" size={16} color={GOLD.text} />}
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < MAX_PHOTOS && (
            <TouchableOpacity style={[styles.slot, styles.add]} onPress={addPhoto} accessibilityRole="button"
              accessibilityLabel={t('singles.mine.addPhoto')} testID="singles-add-photo" disabled={busy === 'photo'}>
              {busy === 'photo' ? <ActivityIndicator color={GOLD.gold} /> : (
                <>
                  <Ionicons name="add" size={28} color={GOLD.gold} />
                  <Text style={styles.addText}>{t(photos.length ? 'singles.mine.addPhoto' : 'singles.mine.addFace')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Card>
        <Label>{t('singles.mine.about')}</Label>
        <Fact label={t('singles.field.nameAge')} value={`${profile.first_name} · ${profile.age}`} />
        <Fact label={t('singles.field.lives')} value={[profile.town, profile.country].filter(Boolean).join(', ')} />
        <Fact label={t('singles.field.church')} value={profile.church || t('singles.mine.notSaid')} />
        <Fact label={t('singles.field.lookingFor')} value={t(`singles.looking.${profile.looking_for}`)} />
        <Fact label={t('singles.field.prompts')} value={t('singles.mine.promptsN', { n: (profile.prompts || []).length })} />
        <GoldButton label={t('singles.mine.edit')} icon="create-outline" kind="outline" testID="singles-edit"
          onPress={() => navigation.navigate('SinglesEdit', { profile })} />
      </Card>

      {canSubmit && (
        <GoldButton label={t('singles.mine.submit')} icon="paper-plane" onPress={submit} busy={busy === 'submit'}
          testID="singles-submit" />
      )}

      {profile.status === 'approved' && (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>{t('singles.mine.pause')}</Text>
            <Text style={styles.switchSub}>{t('singles.mine.pauseSub')}</Text>
          </View>
          <Switch value={!!profile.is_paused} onValueChange={(v) => run('pause', () => pauseSinglesProfile(v))}
            trackColor={{ true: GOLD.gold, false: GOLD.border }} thumbColor="#FFFFFF"
            accessibilityLabel={t('singles.mine.pause')} testID="singles-pause" />
        </View>
      )}

      <GoldButton label={t('singles.mine.leave')} kind="quiet" onPress={leave} busy={busy === 'leave'}
        style={{ alignSelf: 'center' }} testID="singles-leave" />
    </View>
  );
}

const Fact = ({ label, value }) => (
  <View style={styles.fact}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, backgroundColor: GOLD.soft, alignItems: 'flex-start',
  },
  bannerWarn: { backgroundColor: 'rgba(242,139,130,0.12)' },
  bannerTitle: { color: GOLD.text, fontSize: 15.5, fontFamily: FACE.bold },
  bannerBody: { color: GOLD.sub, fontSize: 13.5, lineHeight: 20, fontFamily: FACE.body, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  slot: { width: '48.5%', aspectRatio: 1, borderRadius: 14, overflow: 'hidden' },
  slotImg: { width: '100%', height: '100%' },
  add: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: GOLD.border, alignItems: 'center', justifyContent: 'center', gap: 6 },
  addText: { color: GOLD.sub, fontSize: 13, fontFamily: FACE.semi, textAlign: 'center', paddingHorizontal: 8 },
  mainTag: {
    position: 'absolute', left: 8, top: 8, backgroundColor: GOLD.gold, color: GOLD.onGold, fontSize: 11,
    fontFamily: FACE.heavy, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
  },
  waitTag: {
    position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(10,22,40,0.85)', color: GOLD.text, fontSize: 11,
    fontFamily: FACE.bold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
  },
  makeMain: {
    position: 'absolute', right: 6, bottom: 6, width: 34, height: 34, borderRadius: 17,
    backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center',
  },
  remove: {
    position: 'absolute', right: 6, top: 6, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(10,22,40,0.8)', alignItems: 'center', justifyContent: 'center',
  },
  fact: { gap: 2, paddingVertical: 4 },
  factLabel: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.semi },
  factValue: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border,
  },
  switchTitle: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold },
  switchSub: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, marginTop: 2 },
});
