/**
 * Edit an event's details: its banner, title and description, and when and
 * where. (Ticket levels are changed on the event's own page.)
 *
 * The banner, title and description are what buyers see first, so on an
 * event Skylink has approved, changing any of them sends it back to review —
 * and off sale until it passes (the server's events/review.py). The screen
 * says so before saving, and asks first when it would stop sales. Venue and
 * times don't need review.
 *
 * A rejected event is fixed here, then sent again from its page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { fetchMyEvent, updateEvent } from '../../services/ticketsOrganiser';
import { formatWhen } from '../../services/tickets';
import { confirmAction } from '../../utils/adminConfirm';
import { T, F, tap, Kicker, GoldButton, Notice } from '../../components/tickets/TicketKit';
import DateTimeField from '../../components/tickets/DateTimeField';
import { pickBanner, BannerPermissionError } from '../../components/tickets/pickBanner';
import { validateStep, serverErrorsByStep, TITLE_MAX } from './eventDraft';
import { ticketErrorText } from './ticketText';

const fromEvent = (e) => ({
  title: e.title || '', description: e.description || '', venue: e.venue || '', city: e.city || '',
  startsAt: e.starts_at, endsAt: e.ends_at || null, salesEndAt: e.sales_end_at || null,
});

const TicketEditEvent = ({ navigation, route }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const when = (iso) => (iso ? formatWhen(iso, { months, weekdays }) : '');
  const { id } = route.params;

  const [event, setEvent] = useState(null);
  const [draft, setDraft] = useState(null);
  const [poster, setPoster] = useState(null);       // a newly chosen banner, not yet sent
  const [loadError, setLoadError] = useState(null);
  const signedOut = useCallback(() => navigation.replace('TicketHost', { next: 'TicketMyEvents' }), [navigation]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const e = await fetchMyEvent(id);
      setEvent(e);
      setDraft(fromEvent(e));
    } catch (err) {
      if (err?.code === 'signed_out') signedOut();
      else setLoadError(err);
    }
  }, [id, signedOut]);
  useEffect(() => { load(); }, [load]);

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [bannerError, setBannerError] = useState('');
  const err = (k) => (errors[k] ? (errors[k].startsWith('tix.') ? t(errors[k]) : errors[k]) : '');

  const chooseBanner = async () => {
    tap();
    setBannerError('');
    try {
      const chosen = await pickBanner();
      if (chosen) setPoster(chosen);
    } catch (e) {
      setBannerError(e instanceof BannerPermissionError ? t('tix.host.photoPermission') : t('tix.host.photoFailed'));
    }
  };

  if (!draft) {
    return (
      <View style={[styles.root, styles.centre]}>
        {loadError ? <Notice title={ticketErrorText(loadError, t)} action={t('common.retry')} onAction={load} />
          : <ActivityIndicator color={T.gold} size="large" />}
      </View>
    );
  }

  const before = fromEvent(event);
  const contentChanged = !!poster || draft.title.trim() !== before.title || draft.description.trim() !== before.description;
  const changed = contentChanged || ['venue', 'city', 'startsAt', 'endsAt', 'salesEndAt']
    .some((k) => (draft[k] || '') !== (before[k] || ''));
  const goesToReview = contentChanged && event.review_status === 'approved';

  const save = async () => {
    const e = { ...validateStep('details', draft), ...validateStep('when', draft) };
    setErrors(e);
    if (Object.keys(e).length || !changed || busy) return;
    if (goesToReview && event.status === 'published') {
      const ok = await confirmAction({
        title: t('tix.edit.pauseTitle'), message: t('tix.edit.pauseBody'),
        confirmLabel: t('tix.edit.saveAnyway'), cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setSaveError('');
    try {
      await updateEvent(id, { ...draft, till: event.till, poster });
      navigation.goBack();
    } catch (x) {
      if (x?.code === 'signed_out') { signedOut(); return; }
      setErrors(serverErrorsByStep(x?.fields).errors);
      setSaveError(ticketErrorText(x, t));
      setBusy(false);
    }
  };

  const shownPoster = poster?.uri || event.poster;

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Kicker>{t('tix.edit.kicker')}</Kicker>
          <Text style={styles.heading} accessibilityRole="header">{t('tix.edit.title')}</Text>

          {event.review_status === 'rejected' && !!event.review_note && (
            <View style={styles.noteBox}>
              <Text style={styles.noteLabel}>{t('tix.mine.reviewNote')}</Text>
              <Text style={styles.noteText}>{event.review_note}</Text>
            </View>
          )}

          <TouchableOpacity onPress={chooseBanner} activeOpacity={0.85} style={styles.banner} accessibilityRole="button"
                            accessibilityLabel={shownPoster ? t('tix.host.changeBanner') : t('tix.host.addBanner')}
                            testID="edit-banner">
            {shownPoster ? (
              <>
                <Image source={{ uri: shownPoster }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.bannerEdit}>
                  <Ionicons name="image-outline" size={14} color={T.paperInk} />
                  <Text style={styles.bannerEditText}>{t('tix.host.changeBanner')}</Text>
                </View>
              </>
            ) : (
              <>
                <Ionicons name="image-outline" size={28} color={T.champagne} />
                <Text style={styles.bannerAdd}>{t('tix.host.addBanner')}</Text>
              </>
            )}
          </TouchableOpacity>
          {!!bannerError && <Text style={[styles.bad, styles.centerText]}>{bannerError}</Text>}

          <Field label={t('tix.host.title')} error={err('title')}>
            <TextInput style={styles.input} value={draft.title} onChangeText={(v) => update({ title: v })}
                       maxLength={TITLE_MAX} placeholderTextColor={T.faint} accessibilityLabel={t('tix.host.title')} testID="edit-title" />
          </Field>
          <Field label={t('tix.host.description')} error={err('description')}>
            <TextInput style={[styles.input, styles.multiline]} value={draft.description} multiline textAlignVertical="top"
                       onChangeText={(v) => update({ description: v })} maxLength={5000} placeholderTextColor={T.faint}
                       accessibilityLabel={t('tix.host.description')} testID="edit-description" />
          </Field>
          <Field label={t('tix.host.venue')} error={err('venue')}>
            <TextInput style={styles.input} value={draft.venue} onChangeText={(v) => update({ venue: v })}
                       maxLength={200} placeholderTextColor={T.faint} accessibilityLabel={t('tix.host.venue')} testID="edit-venue" />
          </Field>
          <Field label={t('tix.host.city')} error={err('city')}>
            <TextInput style={styles.input} value={draft.city} onChangeText={(v) => update({ city: v })}
                       maxLength={80} placeholderTextColor={T.faint} accessibilityLabel={t('tix.host.city')} testID="edit-city" />
          </Field>
          <DateTimeField label={t('tix.host.starts')} value={draft.startsAt} display={when(draft.startsAt)}
                         onChange={(v) => update({ startsAt: v })} placeholder={t('tix.host.pickDate')}
                         minimumDate={new Date()} doneLabel={t('tix.host.doneShort')} error={err('startsAt')} testID="edit-starts" />
          <DateTimeField label={t('tix.host.ends')} value={draft.endsAt} display={when(draft.endsAt)}
                         onChange={(v) => update({ endsAt: v })} placeholder={t('tix.host.optional')} clearable
                         clearLabel={t('tix.host.clear')} minimumDate={new Date()} doneLabel={t('tix.host.doneShort')}
                         error={err('endsAt')} testID="edit-ends" />
          <DateTimeField label={t('tix.host.salesEnd')} value={draft.salesEndAt} display={when(draft.salesEndAt)}
                         onChange={(v) => update({ salesEndAt: v })} placeholder={t('tix.host.salesEndPlaceholder')} clearable
                         clearLabel={t('tix.host.clear')} minimumDate={new Date()} doneLabel={t('tix.host.doneShort')}
                         error={err('salesEndAt')} testID="edit-sales-end" />

          {goesToReview && (
            <View style={styles.notice} accessibilityLiveRegion="polite" testID="edit-review-warning">
              <Ionicons name="information-circle" size={18} color={T.champagne} />
              <Text style={styles.noticeText}>
                {event.status === 'published' ? t('tix.edit.reviewAndPause') : t('tix.edit.review')}
              </Text>
            </View>
          )}
          {!!saveError && <Text style={styles.saveError} accessibilityLiveRegion="polite">{saveError}</Text>}
        </ScrollView>
        <View style={styles.bar}>
          <GoldButton label={t('tix.edit.save')} onPress={save} busy={busy} disabled={!changed} testID="edit-save" />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const Field = ({ label, error, children }) => (
  <View>
    <Text style={styles.label}>{label}</Text>
    {children}
    {!!error && <Text style={styles.bad}>{error}</Text>}
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  centerText: { textAlign: 'center' },
  scroll: { padding: 20, paddingTop: 22, paddingBottom: 32, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 30, lineHeight: 34, color: T.ivory, marginTop: 6 },

  noteBox: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: 'rgba(240,144,127,0.10)' },
  noteLabel: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: T.danger },
  noteText: { fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory, marginTop: 4 },

  banner: {
    alignSelf: 'center', marginTop: 20, width: 190, height: 238, borderRadius: 20, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  bannerAdd: { fontFamily: F.uiBold, fontSize: 14, color: T.ivory },
  bannerEdit: {
    position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(251,247,238,0.92)',
  },
  bannerEditText: { fontFamily: F.uiBold, fontSize: 12, color: T.paperInk },

  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  input: {
    minHeight: 54, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: F.uiSemi, fontSize: 16, color: T.ivory, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  multiline: { minHeight: 140 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },

  notice: {
    flexDirection: 'row', gap: 10, marginTop: 22, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(232,212,170,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  noticeText: { flex: 1, fontFamily: F.uiSemi, fontSize: 13.5, lineHeight: 20, color: T.ivory },
  saveError: { fontFamily: F.uiSemi, fontSize: 14, color: T.danger, marginTop: 18 },
  bar: {
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
});

export default TicketEditEvent;
