// A service's own page: the cover and logo, the tick, what and where, open
// now or not, Directions, what it's about, the services, prices, the week's
// hours, a gallery of their work, and their links — with a bar to reach
// them pinned at the bottom (call, WhatsApp, a message in the app, share).
// Its owner sees it as everyone does, with Edit.
//
// Draws at once from the list's row (or the last copy), then fresh.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Share, Modal, FlatList, useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  fetchVideoStudioById, getOrCreateConversation, serviceShareUrl, saveService, recordServiceEvent,
} from '../services/api';
import BookingSheet from '../components/services/BookingSheet';
import { noteServicesChanged } from '../services/servicesCatalog';
import {
  CATEGORY_ICON, DAYS, SOCIAL_LINKS, serviceLabel, rateText, withScheme, directionsUrl,
} from '../services/servicesCatalog';
import { OpenChip } from '../components/services/ServiceCard';
import ServiceReviews from '../components/services/ServiceReviews';
import { StarRow } from '../components/BookReviews';
import ReportModal from '../components/ReportModal';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const todayKey = () => DAYS[(new Date().getDay() + 6) % 7];
// "Usually answers within an hour / 3 hours / a day".
export const respondsLabel = (h, t) => (h <= 1 ? t('services.respondsHour') : h < 24
  ? t('services.respondsHours', { n: Math.ceil(h) }) : h < 48 ? t('services.respondsDay') : t('services.respondsDays', { n: Math.ceil(h / 24) }));

const Section = ({ title, children, testID }) => (
  <View style={styles.section} testID={testID}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const ServiceDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const id = Number(route.params?.id);
  const { data, failed, reload } = useCachedData(userKey(currentUser?.id, `service:${id}`), () => fetchVideoStudioById(id));
  const s = data || route.params?.preview || null;
  const [viewer, setViewer] = useState(null);           // gallery index being viewed
  const [reporting, setReporting] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [booking, setBooking] = useState(null);         // 'booking' | 'quote' — the sheet open
  const [saved, setSaved] = useState(null);             // null: as the listing says

  // How it's found and reached, for its owner's numbers (never who). A
  // failure is silent — it's only counting.
  const track = useCallback((kind) => { Promise.resolve().then(() => recordServiceEvent(id, kind)).catch(() => {}); }, [id]);
  useEffect(() => { if (id) track('view'); }, [id, track]);

  const open = useCallback((url) => Linking.openURL(url).catch(() => notify(t('common.error'), t('dir.openLinkFailed'))), [t]);
  const share = () => track('share') || Share.share({
    message: `${s.name} — ${t(`services.cat.${s.category || 'media'}`)} · ${s.location}\n${serviceShareUrl(s.id)}`,
  }).catch(() => {});
  const message = async () => {
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    setMessaging(true);
    track('message');
    try {
      const c = await getOrCreateConversation(s.created_by.id);
      // Started for them — theirs to change or send.
      navigation.navigate('Chat', {
        conversationId: c.id, otherUser: c.other_participant ?? s.created_by, draft: t('services.messageDraft', { name: s.name }),
      });
    } catch {
      notify(t('common.error'), t('services.messageFailed'));
    } finally {
      setMessaging(false);
    }
  };

  if (!s) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        {failed ? (
          <>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
            <Text style={styles.muted}>{t('services.loadOneFailed')}</Text>
            <TouchableOpacity style={styles.retry} onPress={reload} testID="service-retry">
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: spacing.sm }}>
              <Text style={styles.muted}>{t('common.goBack')}</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator color={colors.primary} />}
      </SafeAreaView>
    );
  }

  const owner = !!s.is_owner;
  const isSaved = saved ?? !!s.is_saved;
  const toggleSave = async () => {
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    const next = !isSaved;
    setSaved(next);
    try {
      await saveService(s.id, next);
      noteServicesChanged({ item: { ...s, is_saved: next } });   // the list shows it on the way back
    } catch { setSaved(!next); notify(t('common.error'), t('services.saveFailed')); }
  };
  const cat = s.category || 'media';
  const hours = s.opening_hours || {};
  const hasHours = Object.keys(hours).length > 0;
  const gallery = s.gallery || [];
  const links = SOCIAL_LINKS.filter((l) => s[l.key]);
  const price = rateText(s);
  const coverH = Math.min(260, Math.round(Math.min(width, 760) * 0.5));
  const actions = [
    s.contact_phone && { key: 'call', icon: 'call', label: t('studios.call'), onPress: () => { track('call'); open(`tel:${s.contact_phone}`); } },
    s.whatsapp_number && {
      key: 'whatsapp', icon: 'logo-whatsapp', label: t('studios.whatsapp'), tint: '#25D366',
      onPress: () => { track('whatsapp'); open(`https://wa.me/${s.whatsapp_number.replace(/[^\d]/g, '')}`); },
    },
    !owner && s.created_by?.id && { key: 'message', icon: 'chatbubble-ellipses', label: t('services.message'), onPress: message, busy: messaging },
    { key: 'share', icon: 'share-social', label: t('services.share'), onPress: share, quiet: true },
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={styles.page}>
          <View style={[styles.cover, { height: coverH + insets.top }]}>
            {s.cover_image ? (
              <Image source={{ uri: s.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
                <MaterialIcons name={CATEGORY_ICON[cat] || 'storefront'} size={48} color={colors.textMuted} />
              </View>
            )}
            <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.35)']} style={StyleSheet.absoluteFill} />
          </View>

          <View style={styles.idBlock}>
            <Image source={s.logo ? { uri: s.logo } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} style={styles.logo} contentFit="cover" />
            <View style={styles.nameRow}>
              <Text style={styles.name}>{s.name}</Text>
              {s.is_verified ? <MaterialIcons name="verified" size={20} color={colors.primary} testID="service-verified" /> : null}
            </View>
            <Text style={styles.sub}>{`${t(`services.cat.${cat}`)} · ${s.location}`}</Text>
            {s.rating_count ? (
              <View style={styles.starsRow} testID="service-stars">
                <StarRow value={s.rating_avg} size={14} />
                <Text style={styles.starsText}>{`${s.rating_avg} · ${t('reviews.count', { n: s.rating_count })}`}</Text>
              </View>
            ) : null}
            {s.organization ? (
              <TouchableOpacity style={styles.orgRow} testID="service-org"
                onPress={() => navigation.navigate('OrganizationPage', { slug: s.organization.slug, name: s.organization.name })}>
                <Ionicons name="business-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.orgText} numberOfLines={1}>{t('services.runBy', { name: s.organization.name })}</Text>
                {s.organization.is_verified ? <MaterialIcons name="verified" size={14} color={colors.primary} /> : null}
              </TouchableOpacity>
            ) : null}
            <OpenChip hours={hours} t={t} style={styles.openChip} />
            <View style={styles.quickRow}>
              <TouchableOpacity style={styles.pill} testID="service-directions"
                onPress={() => { track('directions'); open(s.latitude != null ? directionsUrl(`${s.latitude},${s.longitude}`) : directionsUrl(s.location)); }}>
                <Ionicons name="navigate" size={15} color={colors.primary} />
                <Text style={styles.pillText}>{t('services.directions')}</Text>
              </TouchableOpacity>
              {price ? (
                <View style={[styles.pill, styles.pricePill]}>
                  <MaterialIcons name="payments" size={15} color={colors.primary} />
                  <Text style={styles.pillText} numberOfLines={1}>{price}</Text>
                </View>
              ) : null}
            </View>
            {s.responds_in_hours != null ? (
              <View style={styles.responds} testID="service-responds">
                <Ionicons name="flash-outline" size={14} color={colors.success} />
                <Text style={styles.respondsText}>{respondsLabel(s.responds_in_hours, t)}</Text>
              </View>
            ) : null}
            {!owner ? (
              <View style={styles.bookRow}>
                <TouchableOpacity style={styles.bookBtn} onPress={() => (isAuthenticated ? setBooking('booking') : navigation.navigate('Login'))}
                  testID="service-book">
                  <Ionicons name="calendar" size={17} color={colors.white} />
                  <Text style={styles.bookText}>{t('bookings.book')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.bookBtn, styles.quoteBtn]} testID="service-quote"
                  onPress={() => (isAuthenticated ? setBooking('quote') : navigation.navigate('Login'))}>
                  <Ionicons name="pricetag-outline" size={17} color={colors.primary} />
                  <Text style={[styles.bookText, styles.quoteText]}>{t('bookings.askQuote')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {owner ? (
            <View style={styles.ownerBar} testID="service-owner-bar">
              <View style={styles.ownerHead}>
                <Ionicons name="eye-outline" size={18} color={colors.accent} />
                <Text style={styles.ownerText}>{t('services.ownerView')}</Text>
              </View>
              <View style={styles.ownerActions}>
              <TouchableOpacity style={[styles.editBtn, styles.verifyBtn]} testID="service-insights"
                onPress={() => navigation.navigate('ServiceInsights', { id: s.id, name: s.name })}>
                <Ionicons name="stats-chart" size={14} color={colors.primary} />
                <Text style={[styles.editText, styles.verifyText]}>{t('services.insights')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editBtn, styles.verifyBtn]} testID="service-requests"
                onPress={() => navigation.navigate('ServiceBookings', { role: 'incoming' })}>
                <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                <Text style={[styles.editText, styles.verifyText]}>{t('bookings.requests')}</Text>
              </TouchableOpacity>
              {!s.is_verified ? (
                <TouchableOpacity style={[styles.editBtn, styles.verifyBtn]} testID="service-get-verified"
                  onPress={() => navigation.navigate('ServiceVerification', { id: s.id, name: s.name })}>
                  <MaterialIcons name="verified" size={15} color={colors.primary} />
                  <Text style={[styles.editText, styles.verifyText]}>{t('verify.cta')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('ServiceForm', { service: s })} testID="service-page-edit">
                <MaterialIcons name="edit" size={16} color={colors.white} />
                <Text style={styles.editText}>{t('common.edit')}</Text>
              </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {s.description ? (
            <Section title={t('services.about')}><Text style={styles.body}>{s.description}</Text></Section>
          ) : null}

          {s.service_types?.length ? (
            <Section title={t('services.offers')}>
              <View style={styles.tags}>
                {s.service_types.map((k) => (
                  <View key={k} style={styles.tag}><Text style={styles.tagText}>{serviceLabel(k, t)}</Text></View>
                ))}
              </View>
            </Section>
          ) : null}

          {gallery.length ? (
            <Section title={t('services.gallery')} testID="service-gallery">
              <FlatList horizontal data={gallery} keyExtractor={(u, i) => `${i}_${u}`} showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.galleryRow}
                renderItem={({ item, index }) => (
                  <TouchableOpacity onPress={() => setViewer(index)} testID={`service-photo-${index}`} activeOpacity={0.9}>
                    <Image source={{ uri: item }} style={styles.photo} contentFit="cover" transition={150} />
                  </TouchableOpacity>
                )} />
            </Section>
          ) : null}

          {hasHours ? (
            <Section title={t('services.hours')} testID="service-hours">
              {DAYS.map((d) => {
                const span = hours[d];
                const today = d === todayKey();
                return (
                  <View key={d} style={[styles.hourRow, today && styles.hourToday]}>
                    <Text style={[styles.hourDay, today && styles.hourTodayText]}>{t(`services.day.${d}`)}</Text>
                    <Text style={[styles.hourTime, today && styles.hourTodayText]}>
                      {span ? `${span[0]} – ${span[1] === '24:00' ? '00:00' : span[1]}` : t('services.closed')}
                    </Text>
                  </View>
                );
              })}
            </Section>
          ) : null}

          {s.contact_phone || s.contact_email || links.length ? (
            <Section title={t('services.contactSection')}>
              {s.contact_phone ? (
                <TouchableOpacity style={styles.contactRow} onPress={() => open(`tel:${s.contact_phone}`)}>
                  <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.contactText}>{s.contact_phone}</Text>
                </TouchableOpacity>
              ) : null}
              {s.contact_email ? (
                <TouchableOpacity style={styles.contactRow} onPress={() => open(`mailto:${s.contact_email}`)}>
                  <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.contactText}>{s.contact_email}</Text>
                </TouchableOpacity>
              ) : null}
              {links.length ? (
                <View style={styles.links}>
                  {links.map((l) => (
                    <TouchableOpacity key={l.key} style={styles.linkBtn} onPress={() => open(withScheme(s[l.key]))}
                      accessibilityLabel={t(l.labelKey)} testID={`service-link-${l.key}`}>
                      <Ionicons name={l.icon} size={20} color={l.color} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </Section>
          ) : null}

          <ServiceReviews service={s} uid={currentUser?.id} t={t} isAuthenticated={isAuthenticated} navigation={navigation} />

          {s.created_by?.username ? (
            <Text style={styles.listedBy}>
              {[t('services.listedBy', { name: s.created_by.username }), s.member_since ? t('services.memberSince', { year: s.member_since }) : null]
                .filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {!owner && isAuthenticated ? (
            <TouchableOpacity style={styles.reportLink} onPress={() => setReporting(true)} testID="service-page-report">
              <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
              <Text style={styles.reportText}>{t('services.report')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      {/* Over the cover: back. */}
      <View style={[styles.topBar, { top: insets.top + spacing.xs, left: spacing.sm + (insets.left || 0), right: spacing.sm + (insets.right || 0) }]}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => navigation.goBack()} accessibilityRole="button"
          accessibilityLabel={t('common.back')} testID="service-back">
          <Ionicons name="arrow-back" size={22} color={colors.white} />
        </TouchableOpacity>
        {!owner ? (
          <TouchableOpacity style={styles.roundBtn} onPress={toggleSave} accessibilityRole="button"
            accessibilityState={{ selected: isSaved }} accessibilityLabel={t(isSaved ? 'services.unsave' : 'services.save')} testID="service-page-save">
            <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={21} color={isSaved ? '#FF5A6E' : colors.white} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Reaching them: always at hand. */}
      <View style={[styles.actionBar, { paddingBottom: spacing.sm + insets.bottom, paddingLeft: spacing.md + (insets.left || 0), paddingRight: spacing.md + (insets.right || 0) }]}>
        <View style={styles.actionInner}>
          {actions.map((a) => (
            <TouchableOpacity key={a.key} style={[styles.action, a.quiet && styles.actionQuiet, a.tint && { backgroundColor: a.tint }]}
              onPress={a.onPress} disabled={a.busy} testID={`service-action-${a.key}`} accessibilityRole="button">
              {a.busy ? <ActivityIndicator color={colors.white} size="small" /> : (
                <Ionicons name={a.icon} size={18} color={a.quiet ? colors.textPrimary : colors.white} />
              )}
              <Text style={[styles.actionText, a.quiet && styles.actionTextQuiet]} numberOfLines={1}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Modal visible={viewer != null} transparent animationType="fade" onRequestClose={() => setViewer(null)} statusBarTranslucent>
        <View style={styles.viewer}>
          <FlatList horizontal pagingEnabled data={gallery} keyExtractor={(u, i) => `v${i}`} initialScrollIndex={viewer || 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width, justifyContent: 'center' }}>
                <Image source={{ uri: item }} style={styles.viewerImg} contentFit="contain" />
              </View>
            )} />
          <TouchableOpacity style={[styles.roundBtn, styles.viewerClose, { top: insets.top + spacing.sm }]} onPress={() => setViewer(null)}
            accessibilityLabel={t('common.close')} testID="service-photo-close">
            <Ionicons name="close" size={24} color={colors.white} />
          </TouchableOpacity>
        </View>
      </Modal>

      {reporting ? <ReportModal visible onClose={() => setReporting(false)} contentType="videostudio" objectId={s.id} /> : null}
      <BookingSheet visible={!!booking} initialKind={booking || 'booking'} onClose={() => setBooking(null)} service={s} t={t} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.label, color: colors.white, fontWeight: '700' },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  cover: { width: '100%', backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  idBlock: { paddingHorizontal: spacing.md, marginTop: -44, gap: 4 },
  logo: {
    width: 88, height: 88, borderRadius: radius.lg, borderWidth: 4, borderColor: colors.bg, backgroundColor: colors.surface,
    marginBottom: spacing.xs, ...shadows.md,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...typography.h2, color: colors.textPrimary, flexShrink: 1 },
  sub: { ...typography.body, color: colors.textSecondary },
  openChip: { marginTop: 2 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary,
  },
  pricePill: { borderColor: 'transparent', backgroundColor: `${colors.primary}14`, flexShrink: 1 },
  pillText: { ...typography.label, color: colors.primary, fontWeight: '700', flexShrink: 1 },
  ownerBar: {
    gap: spacing.sm, margin: spacing.md, marginBottom: 0, padding: spacing.sm + 2,
    borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent,
  },
  ownerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  responds: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  respondsText: { ...typography.caption, color: colors.success, fontWeight: '700' },
  bookRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  bookBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  quoteBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  bookText: { ...typography.label, color: colors.white, fontWeight: '800' },
  quoteText: { color: colors.primary },
  ownerText: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  editText: { ...typography.caption, color: colors.white, fontWeight: '800' },
  verifyBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  verifyText: { color: colors.primary },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  starsText: { ...typography.caption, color: colors.textSecondary },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%' },
  orgText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', flexShrink: 1 },
  section: {
    marginHorizontal: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.sm,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: 5 },
  tagText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  galleryRow: { gap: spacing.sm },
  photo: { width: 150, height: 150, borderRadius: radius.md, backgroundColor: colors.surface },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  hourToday: { backgroundColor: `${colors.primary}14` },
  hourDay: { ...typography.body, color: colors.textSecondary },
  hourTime: { ...typography.body, color: colors.textPrimary },
  hourTodayText: { color: colors.primary, fontWeight: '800' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  contactText: { ...typography.body, color: colors.textPrimary },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  linkBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  listedBy: { ...typography.caption, color: colors.textMuted, marginHorizontal: spacing.md, marginTop: spacing.lg },
  reportLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: spacing.md, marginTop: spacing.sm, alignSelf: 'flex-start' },
  reportText: { ...typography.caption, color: colors.textMuted },
  topBar: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: spacing.sm, backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  actionInner: { flexDirection: 'row', gap: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.xs,
  },
  actionQuiet: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flex: 0, paddingHorizontal: spacing.md },
  actionText: { ...typography.label, color: colors.white, fontWeight: '800', flexShrink: 1 },
  actionTextQuiet: { color: colors.textPrimary },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerImg: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', right: spacing.md },
});

export default ServiceDetail;
