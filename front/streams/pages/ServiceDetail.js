// A service's own page, made to feel like the provider's own website - a
// small, high-end one: "Maison".
//
//   Masthead     the cover, full bleed and tall, the logo in a gold ring, the
//                name in a display serif, what and where, the verified seal.
//   Section nav  About · Offerings · Work · Hours · Reviews · Contact: a tap
//                scrolls there (and a slim bar with the name follows the
//                reader down once the masthead has gone).
//   Highlights   the stars, how quickly they answer, since when, from what price.
//   Numbered sections (01 About, 02 Offerings, 03 Work …), each with a small
//                gold kicker and a serif title, as an editorial site lays out.
//   Work         the portfolio: up to 20 photos in a mosaic - a feature, then
//                pairs at alternating heights - each with its caption; a tap
//                opens them full screen with a counter and the caption.
//   Contact      the ways to reach them, and where they are.
// Reaching them stays pinned at the bottom (call, WhatsApp, message, share).
// Its owner sees it as everyone does, with their own bar of tools.
//
// Draws at once from the list's row (or the last copy), then fresh.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Linking, Share, Modal, FlatList, useWindowDimensions,
  ActivityIndicator, Animated, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  fetchVideoStudioById, getOrCreateConversation, serviceShareUrl, saveService, recordServiceEvent,
} from '../services/api';
import BookingSheet from '../components/services/BookingSheet';
import {
  noteServicesChanged, CATEGORY_ICON, DAYS, SOCIAL_LINKS, serviceLabel, rateText, withScheme, directionsUrl,
  openState, openLabel,
} from '../services/servicesCatalog';
import ServiceReviews from '../components/services/ServiceReviews';
import { StarRow } from '../components/BookReviews';
import ReportModal from '../components/ReportModal';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { notify } from '../utils/adminConfirm';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const todayKey = () => DAYS[(new Date().getDay() + 6) % 7];
// "Usually answers within an hour / 3 hours / a day".
export const respondsLabel = (h, t) => (h <= 1 ? t('services.respondsHour') : h < 24
  ? t('services.respondsHours', { n: Math.ceil(h) }) : h < 48 ? t('services.respondsDay') : t('services.respondsDays', { n: Math.ceil(h / 24) }));

// ── Maison: the page's own palette and type ──────────────────────────────────
// Espresso black, champagne gold and ivory - a boutique's site, not the app's
// navy. The same in light and dark (as Tickets and Single & Searching keep
// their own looks).
export const M = {
  bg: '#0D0C0A',
  panel: '#15130F',
  raised: '#1D1A14',
  line: 'rgba(201,169,110,0.20)',
  lineStrong: 'rgba(201,169,110,0.42)',
  gold: '#C9A96E',
  goldSoft: 'rgba(201,169,110,0.13)',
  ivory: '#F4EFE6',
  text: '#E7E1D6',
  muted: '#A69F91',
  faint: '#6E685D',
  ink: '#0D0C0A',
  open: '#7FC29B',
};
const FONT = {
  display: 'CormorantGaramond_700Bold',
  displaySemi: 'CormorantGaramond_600SemiBold',
  read: 'Lora_400Regular',
  ui: 'Manrope_500Medium',
  uiSemi: 'Manrope_600SemiBold',
  uiBold: 'Manrope_700Bold',
  uiHeavy: 'Manrope_800ExtraBold',
};
const MAX_W = 820;

// A gallery entry as {url, caption}: older listings (and older servers) send
// addresses only.
export const portfolioOf = (s) => (Array.isArray(s?.gallery_items) && s.gallery_items.length
  ? s.gallery_items.filter((g) => g?.url)
  : (s?.gallery || []).filter(Boolean).map((url) => ({ url, caption: '' })));

/** The portfolio's mosaic: a feature, then pairs whose widths alternate. */
export const mosaicRows = (items) => {
  const rows = [];
  if (!items.length) return rows;
  rows.push({ kind: 'feature', items: [{ ...items[0], index: 0 }] });
  for (let i = 1; i < items.length; i += 2) {
    const pair = [{ ...items[i], index: i }];
    if (items[i + 1]) pair.push({ ...items[i + 1], index: i + 1 });
    rows.push({ kind: (rows.length % 2) ? 'wideLeft' : 'wideRight', items: pair });
  }
  return rows;
};

const Kicker = ({ n, children }) => (
  <View style={styles.kickerRow}>
    {n ? <Text style={styles.kickerNum}>{n}</Text> : null}
    <View style={styles.kickerRule} />
    <Text style={styles.kicker}>{children}</Text>
  </View>
);

const Section = ({ n, kicker, title, children, testID, onLayout }) => (
  <View style={styles.section} testID={testID} onLayout={onLayout}>
    <Kicker n={n}>{kicker}</Kicker>
    {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
    {children}
  </View>
);

const ServiceDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const id = Number(route.params?.id);
  const { data, failed, reload } = useCachedData(userKey(currentUser?.id, `service:${id}`), () => fetchVideoStudioById(id));
  const s = data || route.params?.preview || null;
  const [viewer, setViewer] = useState(null);           // portfolio index being viewed
  const [viewerAt, setViewerAt] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [booking, setBooking] = useState(null);         // 'booking' | 'quote' — the sheet open
  const [saved, setSaved] = useState(null);             // null: as the listing says
  const [aboutOpen, setAboutOpen] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scroller = useRef(null);
  const anchors = useRef({});
  const pageY = useRef(0);

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
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom', 'left', 'right']}>
        {failed ? (
          <>
            <Ionicons name="cloud-offline-outline" size={44} color={M.faint} />
            <Text style={styles.muted}>{t('services.loadOneFailed')}</Text>
            <TouchableOpacity style={styles.retry} onPress={reload} testID="service-retry">
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 8 }}>
              <Text style={styles.muted}>{t('common.goBack')}</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator color={M.gold} />}
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
  const portfolio = portfolioOf(s);
  const links = SOCIAL_LINKS.filter((l) => s[l.key]);
  const price = rateText(s);
  const openNow = openState(hours);
  const openText = openLabel(openNow, t);
  const pageW = Math.min(width, MAX_W);
  const gutter = 20 + Math.max(insets.left || 0, insets.right || 0);
  const innerW = pageW - gutter * 2;
  // The masthead: tall and cinematic on a phone, never more than most of the screen.
  // On its side (a short screen) it keeps room for the logo, the name and the place.
  const heroH = Math.round(Math.min(Math.max(width * 1.02, 380), Math.max(height * 0.68, 330), 620));
  const directions = () => {
    track('directions');
    open(s.latitude != null ? directionsUrl(`${s.latitude},${s.longitude}`) : directionsUrl(s.location));
  };
  const actions = [
    s.contact_phone && { key: 'call', icon: 'call', label: t('studios.call'), onPress: () => { track('call'); open(`tel:${s.contact_phone}`); } },
    s.whatsapp_number && {
      key: 'whatsapp', icon: 'logo-whatsapp', label: t('studios.whatsapp'),
      onPress: () => { track('whatsapp'); open(`https://wa.me/${s.whatsapp_number.replace(/[^\d]/g, '')}`); },
    },
    !owner && s.created_by?.id && { key: 'message', icon: 'chatbubble-ellipses', label: t('services.message'), onPress: message, busy: messaging },
    { key: 'share', icon: 'share-social', label: t('services.share'), onPress: share, quiet: true },
  ].filter(Boolean);

  // The numbered sections present on this page, in order (the nav lists only those).
  const sections = [
    s.description && { key: 'about', label: t('services.site.navAbout') },
    (s.service_types?.length || price) && { key: 'offerings', label: t('services.site.navOfferings') },
    portfolio.length && { key: 'work', label: t('services.site.navWork') },
    hasHours && { key: 'hours', label: t('services.site.navHours') },
    { key: 'reviews', label: t('services.site.navReviews') },
    { key: 'contact', label: t('services.site.navContact') },
  ].filter(Boolean);
  const numberOf = (key) => String(sections.findIndex((x) => x.key === key) + 1).padStart(2, '0');
  const anchor = (key) => (e) => { anchors.current[key] = e.nativeEvent.layout.y; };
  const goTo = (key) => {
    const y = anchors.current[key];
    if (y != null) scroller.current?.scrollTo({ y: Math.max(0, pageY.current + y - insets.top - 64), animated: true });
  };

  // The slim bar: in once the masthead has scrolled away.
  const barIn = scrollY.interpolate({ inputRange: [heroH * 0.55, heroH * 0.8], outputRange: [0, 1], extrapolate: 'clamp' });
  // The cover drifts slower than the page (a little parallax), and stretches on a pull down.
  const coverShift = scrollY.interpolate({
    inputRange: [-200, 0, heroH], outputRange: [-100, 0, heroH * 0.35], extrapolateRight: 'clamp',
  });
  const coverScale = scrollY.interpolate({ inputRange: [-200, 0], outputRange: [1.5, 1], extrapolateRight: 'clamp' });

  const longAbout = (s.description || '').length > 420;
  const highlights = [
    s.rating_count ? { key: 'rating', value: String(s.rating_avg), label: t('reviews.count', { n: s.rating_count }), stars: true } : null,
    s.responds_in_hours != null ? { key: 'responds', icon: 'flash-outline', label: respondsLabel(s.responds_in_hours, t) } : null,
    s.member_since ? { key: 'since', value: String(s.member_since), label: t('services.site.since') } : null,
    price ? { key: 'price', value: price, label: t('services.site.rates'), small: true } : null,
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* ── Masthead ── */}
        <View style={[styles.hero, { height: heroH }]} testID="service-masthead">
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: coverShift }, { scale: coverScale }] }]}>
            {s.cover_image ? (
              <Image source={{ uri: s.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <LinearGradient colors={['#2B241A', '#15120D', M.bg]} style={[StyleSheet.absoluteFill, styles.coverFallback]}>
                <MaterialIcons name={CATEGORY_ICON[cat] || 'storefront'} size={64} color="rgba(201,169,110,0.35)" />
              </LinearGradient>
            )}
          </Animated.View>
          <LinearGradient
            colors={['rgba(13,12,10,0.55)', 'rgba(13,12,10,0)', 'rgba(13,12,10,0.25)', M.bg]}
            locations={[0, 0.3, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroText, { paddingHorizontal: gutter, maxWidth: MAX_W }]}>
            <View style={styles.logoRing}>
              <Image source={s.logo ? { uri: s.logo } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} style={styles.logo} contentFit="cover" />
            </View>
            <Text style={styles.heroKicker}>{t(`services.cat.${cat}`).toUpperCase()}</Text>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { fontSize: pageW < 380 ? 38 : 46, lineHeight: pageW < 380 ? 42 : 50 }]}
                accessibilityRole="header">{s.name}</Text>
              {s.is_verified ? (
                <View style={styles.seal} testID="service-verified">
                  <MaterialIcons name="verified" size={16} color={M.ink} />
                </View>
              ) : null}
            </View>
            <View style={styles.heroMetaRow}>
              <Ionicons name="location-outline" size={14} color={M.gold} />
              <Text style={styles.heroMeta} numberOfLines={1}>{s.location}</Text>
              {openText ? (
                <View style={styles.openPill} testID="service-open-state">
                  <View style={[styles.openDot, { backgroundColor: openNow.state === 'open' ? M.open : M.faint }]} />
                  <Text style={[styles.openText, openNow.state === 'open' && { color: M.open }]} numberOfLines={1}>{openText}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.page, { width: pageW, paddingHorizontal: gutter }]}
          onLayout={(e) => { pageY.current = e.nativeEvent.layout.y; }}>
          {s.organization ? (
            <TouchableOpacity style={styles.orgRow} testID="service-org"
              onPress={() => navigation.navigate('OrganizationPage', { slug: s.organization.slug, name: s.organization.name })}>
              <Ionicons name="business-outline" size={14} color={M.gold} />
              <Text style={styles.orgText} numberOfLines={1}>{t('services.runBy', { name: s.organization.name })}</Text>
              {s.organization.is_verified ? <MaterialIcons name="verified" size={14} color={M.gold} /> : null}
            </TouchableOpacity>
          ) : null}

          {/* ── The site's navigation ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navRow}
            style={styles.nav} testID="service-nav">
            {sections.map((x) => (
              <TouchableOpacity key={x.key} onPress={() => goTo(x.key)} style={styles.navItem}
                accessibilityRole="link" testID={`service-nav-${x.key}`}>
                <Text style={styles.navText}>{x.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Highlights ── */}
          {highlights.length ? (
            <View style={styles.highlights} testID="service-highlights">
              {highlights.map((h, i) => (
                <View key={h.key} style={[styles.highlight, i > 0 && styles.highlightRule]}
                  testID={h.key === 'rating' ? 'service-stars' : h.key === 'responds' ? 'service-responds' : undefined}>
                  {h.icon ? <Ionicons name={h.icon} size={24} color={M.gold} style={styles.highlightIcon} /> : (
                    <Text style={[styles.highlightValue, h.small && styles.highlightValueSmall]} numberOfLines={1}
                      adjustsFontSizeToFit minimumFontScale={0.6}>{h.value}</Text>
                  )}
                  {h.stars ? <StarRow value={s.rating_avg} size={11} color={M.gold} /> : null}
                  <Text style={styles.highlightLabel} numberOfLines={2}>{h.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── The two calls to action ── */}
          {!owner ? (
            <View style={styles.ctaRow}>
              <TouchableOpacity style={styles.ctaPrimary} onPress={() => (isAuthenticated ? setBooking('booking') : navigation.navigate('Login'))}
                testID="service-book" accessibilityRole="button">
                <Text style={styles.ctaPrimaryText}>{t('bookings.book')}</Text>
                <Ionicons name="arrow-forward" size={16} color={M.ink} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaGhost} testID="service-quote" accessibilityRole="button"
                onPress={() => (isAuthenticated ? setBooking('quote') : navigation.navigate('Login'))}>
                <Text style={styles.ctaGhostText}>{t('bookings.askQuote')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity style={styles.directions} testID="service-directions" onPress={directions}>
            <Ionicons name="navigate-outline" size={15} color={M.gold} />
            <Text style={styles.directionsText}>{t('services.directions')}</Text>
          </TouchableOpacity>

          {owner ? (
            <View style={styles.ownerBar} testID="service-owner-bar">
              <View style={styles.ownerHead}>
                <Ionicons name="eye-outline" size={16} color={M.gold} />
                <Text style={styles.ownerText}>{t('services.ownerView')}</Text>
              </View>
              <View style={styles.ownerActions}>
                <TouchableOpacity style={styles.ownerBtn} testID="service-insights"
                  onPress={() => navigation.navigate('ServiceInsights', { id: s.id, name: s.name })}>
                  <Ionicons name="stats-chart" size={13} color={M.gold} />
                  <Text style={styles.ownerBtnText}>{t('services.insights')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ownerBtn} testID="service-requests"
                  onPress={() => navigation.navigate('ServiceBookings', { role: 'incoming' })}>
                  <Ionicons name="calendar-outline" size={13} color={M.gold} />
                  <Text style={styles.ownerBtnText}>{t('bookings.requests')}</Text>
                </TouchableOpacity>
                {!s.is_verified ? (
                  <TouchableOpacity style={styles.ownerBtn} testID="service-get-verified"
                    onPress={() => navigation.navigate('ServiceVerification', { id: s.id, name: s.name })}>
                    <MaterialIcons name="verified" size={14} color={M.gold} />
                    <Text style={styles.ownerBtnText}>{t('verify.cta')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.ownerBtn, styles.ownerBtnSolid]} testID="service-page-edit"
                  onPress={() => navigation.navigate('ServiceForm', { service: s })}>
                  <MaterialIcons name="edit" size={14} color={M.ink} />
                  <Text style={[styles.ownerBtnText, { color: M.ink }]}>{t('common.edit')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* ── 01 About ── */}
          {s.description ? (
            <Section n={numberOf('about')} kicker={t('services.site.navAbout')} title={t('services.site.aboutTitle', { name: s.name })}
              onLayout={anchor('about')} testID="service-about">
              <Text style={styles.lede} numberOfLines={longAbout && !aboutOpen ? 7 : undefined}>{s.description}</Text>
              {longAbout ? (
                <TouchableOpacity onPress={() => setAboutOpen((v) => !v)} hitSlop={8}>
                  <Text style={styles.textLink}>{aboutOpen ? t('services.site.readLess') : t('services.site.readMore')}</Text>
                </TouchableOpacity>
              ) : null}
            </Section>
          ) : null}

          {/* ── Offerings ── */}
          {s.service_types?.length || price ? (
            <Section n={numberOf('offerings')} kicker={t('services.site.navOfferings')} title={t('services.offers')}
              onLayout={anchor('offerings')}>
              {s.service_types?.length ? (
                <View style={styles.offerGrid}>
                  {s.service_types.map((k) => (
                    <View key={k} style={[styles.offer, { width: innerW >= 520 ? (innerW - 12) / 2 : innerW }]}>
                      <View style={styles.diamond} />
                      <Text style={styles.offerText}>{serviceLabel(k, t)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {price ? (
                <View style={styles.rateCard}>
                  <Text style={styles.rateLabel}>{t('services.site.rates').toUpperCase()}</Text>
                  <Text style={styles.rateValue}>{price}</Text>
                  {s.rate_description ? <Text style={styles.rateNote}>{s.rate_description}</Text> : null}
                </View>
              ) : null}
            </Section>
          ) : null}

          {/* ── The work: the portfolio ── */}
          {portfolio.length ? (
            <Section n={numberOf('work')} kicker={t('services.site.navWork')} title={t('services.site.workTitle')}
              onLayout={anchor('work')} testID="service-gallery">
              <Text style={styles.sectionLead}>{t('services.site.workLead', { n: portfolio.length })}</Text>
              <View style={styles.mosaic}>
                {mosaicRows(portfolio).map((row, r) => {
                  if (row.kind === 'feature') {
                    const p = row.items[0];
                    return (
                      <TouchableOpacity key={`r${r}`} activeOpacity={0.92} onPress={() => { setViewer(p.index); setViewerAt(p.index); }}
                        testID={`service-photo-${p.index}`} style={[styles.tile, { width: innerW, height: Math.round(innerW * 0.66) }]}>
                        <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
                        {p.caption ? <TileCaption text={p.caption} /> : null}
                      </TouchableOpacity>
                    );
                  }
                  const wide = Math.round((innerW - 10) * 0.58);
                  const narrow = innerW - 10 - wide;
                  const rowH = Math.round((innerW - 10) * 0.5 * 1.18);
                  const single = row.items.length === 1;
                  return (
                    <View key={`r${r}`} style={styles.mosaicRow}>
                      {row.items.map((p, j) => {
                        const isWide = row.kind === 'wideLeft' ? j === 0 : j === 1;
                        return (
                          <TouchableOpacity key={p.index} activeOpacity={0.92} onPress={() => { setViewer(p.index); setViewerAt(p.index); }}
                            testID={`service-photo-${p.index}`}
                            style={[styles.tile, { width: single ? innerW : (isWide ? wide : narrow), height: single ? Math.round(innerW * 0.6) : rowH }]}>
                            <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
                            {p.caption ? <TileCaption text={p.caption} /> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </Section>
          ) : null}

          {/* ── Hours ── */}
          {hasHours ? (
            <Section n={numberOf('hours')} kicker={t('services.site.navHours')} title={t('services.hours')}
              onLayout={anchor('hours')} testID="service-hours">
              <View style={styles.hoursCard}>
                {DAYS.map((d, i) => {
                  const span = hours[d];
                  const today = d === todayKey();
                  return (
                    <View key={d} style={[styles.hourRow, i > 0 && styles.hourRule, today && styles.hourToday]}>
                      <Text style={[styles.hourDay, today && styles.hourTodayText]}>{t(`services.day.${d}`)}</Text>
                      <View style={styles.hourDots} />
                      <Text style={[styles.hourTime, !span && styles.hourClosed, today && styles.hourTodayText]}>
                        {span ? `${span[0]} – ${span[1] === '24:00' ? '00:00' : span[1]}` : t('services.closed')}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Section>
          ) : null}

          {/* ── Reviews (their own component, in this page's look) ── */}
          <View onLayout={anchor('reviews')}>
            <View style={styles.reviewsHead}>
              <Kicker n={numberOf('reviews')}>{t('services.site.navReviews')}</Kicker>
            </View>
            <ServiceReviews service={s} uid={currentUser?.id} t={t} isAuthenticated={isAuthenticated} navigation={navigation}
              skin={REVIEWS_SKIN} />
          </View>

          {/* ── Contact ── */}
          <Section n={numberOf('contact')} kicker={t('services.site.navContact')} title={t('services.site.contactTitle')}
            onLayout={anchor('contact')}>
            <View style={styles.contactCard}>
              <TouchableOpacity style={styles.contactRow} onPress={directions}>
                <View style={styles.contactIcon}><Ionicons name="location-outline" size={17} color={M.gold} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactLabel}>{t('services.site.visit')}</Text>
                  <Text style={styles.contactText}>{s.location}</Text>
                </View>
                <Ionicons name="arrow-forward" size={15} color={M.faint} />
              </TouchableOpacity>
              {s.contact_phone ? (
                <TouchableOpacity style={[styles.contactRow, styles.contactRule]} onPress={() => { track('call'); open(`tel:${s.contact_phone}`); }}>
                  <View style={styles.contactIcon}><Ionicons name="call-outline" size={17} color={M.gold} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactLabel}>{t('studios.call')}</Text>
                    <Text style={styles.contactText}>{s.contact_phone}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={15} color={M.faint} />
                </TouchableOpacity>
              ) : null}
              {s.contact_email ? (
                <TouchableOpacity style={[styles.contactRow, styles.contactRule]} onPress={() => open(`mailto:${s.contact_email}`)}>
                  <View style={styles.contactIcon}><Ionicons name="mail-outline" size={17} color={M.gold} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactLabel}>{t('services.site.email')}</Text>
                    <Text style={styles.contactText} numberOfLines={1}>{s.contact_email}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={15} color={M.faint} />
                </TouchableOpacity>
              ) : null}
            </View>
            {links.length ? (
              <View style={styles.links}>
                {links.map((l) => (
                  <TouchableOpacity key={l.key} style={styles.linkBtn} onPress={() => open(withScheme(s[l.key]))}
                    accessibilityLabel={t(l.labelKey)} testID={`service-link-${l.key}`}>
                    <Ionicons name={l.icon} size={19} color={M.gold} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </Section>

          {/* ── The page's foot ── */}
          <View style={styles.footer}>
            <View style={styles.footerRule} />
            <Text style={styles.footerName}>{s.name}</Text>
            {s.created_by?.username ? (
              <Text style={styles.listedBy}>
                {[t('services.listedBy', { name: s.created_by.username }), s.member_since ? t('services.memberSince', { year: s.member_since }) : null]
                  .filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {!owner && isAuthenticated ? (
              <TouchableOpacity style={styles.reportLink} onPress={() => setReporting(true)} testID="service-page-report">
                <Ionicons name="flag-outline" size={13} color={M.faint} />
                <Text style={styles.reportText}>{t('services.report')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Animated.ScrollView>

      {/* The slim bar that follows the reader once the masthead is gone. */}
      <Animated.View pointerEvents="none" style={[styles.slimBar, { paddingTop: insets.top, height: insets.top + 54, opacity: barIn }]}>
        <Text style={styles.slimName} numberOfLines={1}>{s.name}</Text>
      </Animated.View>

      {/* Over the masthead: back, and save. */}
      <View style={[styles.topBar, { top: insets.top + 6, left: 12 + (insets.left || 0), right: 12 + (insets.right || 0) }]}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => navigation.goBack()} accessibilityRole="button"
          accessibilityLabel={t('common.back')} testID="service-back">
          <Ionicons name="arrow-back" size={21} color={M.ivory} />
        </TouchableOpacity>
        {!owner ? (
          <TouchableOpacity style={styles.roundBtn} onPress={toggleSave} accessibilityRole="button"
            accessibilityState={{ selected: isSaved }} accessibilityLabel={t(isSaved ? 'services.unsave' : 'services.save')} testID="service-page-save">
            <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={20} color={isSaved ? '#E8706F' : M.ivory} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Reaching them: always at hand. */}
      <View style={[styles.actionBar, { paddingBottom: 10 + insets.bottom, paddingLeft: 16 + (insets.left || 0), paddingRight: 16 + (insets.right || 0) }]}>
        <View style={styles.actionInner}>
          {actions.map((a) => (
            <TouchableOpacity key={a.key} style={[styles.action, a.quiet && styles.actionQuiet]}
              onPress={a.onPress} disabled={a.busy} testID={`service-action-${a.key}`} accessibilityRole="button"
              accessibilityLabel={a.label}>
              {a.busy ? <ActivityIndicator color={M.ink} size="small" /> : (
                <Ionicons name={a.icon} size={17} color={a.quiet ? M.gold : M.ink} />
              )}
              {!a.quiet ? <Text style={styles.actionText} numberOfLines={1}>{a.label}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* The portfolio, full screen: swipe through, with its count and caption. */}
      <Modal visible={viewer != null} transparent animationType="fade" onRequestClose={() => setViewer(null)} statusBarTranslucent>
        <View style={styles.viewer}>
          <FlatList horizontal pagingEnabled data={portfolio} keyExtractor={(p, i) => `v${i}`} initialScrollIndex={viewer || 0}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setViewerAt(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image source={{ uri: item.url }} style={styles.viewerImg} contentFit="contain" />
              </View>
            )} />
          <View style={[styles.viewerTop, { top: insets.top + 10, left: 16 + (insets.left || 0), right: 16 + (insets.right || 0) }]}>
            <Text style={styles.viewerCount} testID="service-photo-count">
              {t('services.site.photoOf', { i: (viewerAt || 0) + 1, n: portfolio.length })}
            </Text>
            <TouchableOpacity style={styles.roundBtn} onPress={() => setViewer(null)}
              accessibilityLabel={t('common.close')} testID="service-photo-close">
              <Ionicons name="close" size={22} color={M.ivory} />
            </TouchableOpacity>
          </View>
          {portfolio[viewerAt]?.caption ? (
            <View style={[styles.viewerCaption, { paddingBottom: 24 + insets.bottom }]}>
              <Text style={styles.viewerCaptionText}>{portfolio[viewerAt].caption}</Text>
            </View>
          ) : null}
        </View>
      </Modal>

      {reporting ? <ReportModal visible onClose={() => setReporting(false)} contentType="videostudio" objectId={s.id} /> : null}
      <BookingSheet visible={!!booking} initialKind={booking || 'booking'} onClose={() => setBooking(null)} service={s} t={t} />
    </View>
  );
};

/** A tile's caption: a line over a soft fade at its foot. */
const TileCaption = ({ text }) => (
  <LinearGradient colors={['rgba(13,12,10,0)', 'rgba(13,12,10,0.82)']} style={styles.tileCaption}>
    <Text style={styles.tileCaptionText} numberOfLines={2}>{text}</Text>
  </LinearGradient>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: M.bg },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { fontFamily: FONT.ui, fontSize: 14, color: M.muted, textAlign: 'center' },
  retry: { backgroundColor: M.gold, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  retryText: { fontFamily: FONT.uiBold, fontSize: 14, color: M.ink },

  // Masthead
  hero: { width: '100%', overflow: 'hidden', backgroundColor: M.panel, justifyContent: 'flex-end' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  heroText: { width: '100%', alignSelf: 'center', paddingBottom: 26, gap: 6 },
  logoRing: {
    width: 78, height: 78, borderRadius: 39, padding: 3, borderWidth: 1.5, borderColor: M.gold,
    backgroundColor: 'rgba(13,12,10,0.5)', marginBottom: 10,
  },
  logo: { width: '100%', height: '100%', borderRadius: 36, backgroundColor: M.raised },
  heroKicker: { fontFamily: FONT.uiBold, fontSize: 11, letterSpacing: 3, color: M.gold },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name: { fontFamily: FONT.display, color: M.ivory, flexShrink: 1 },
  seal: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: M.gold, alignItems: 'center', justifyContent: 'center',
  },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  heroMeta: { fontFamily: FONT.uiSemi, fontSize: 14, color: M.text, flexShrink: 1 },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 6, paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: M.lineStrong, backgroundColor: 'rgba(13,12,10,0.45)',
  },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  openText: { fontFamily: FONT.uiBold, fontSize: 11.5, color: M.muted },

  page: { alignSelf: 'center' },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4, maxWidth: '100%' },
  orgText: { fontFamily: FONT.uiSemi, fontSize: 13, color: M.text, flexShrink: 1 },

  // The site's navigation
  nav: { marginTop: 14, marginHorizontal: -4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: M.line },
  navRow: { paddingHorizontal: 4, gap: 22 },
  navItem: { paddingVertical: 12 },
  navText: { fontFamily: FONT.uiBold, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: M.muted },

  // Highlights
  highlights: {
    flexDirection: 'row', marginTop: 20, paddingVertical: 16, borderRadius: 18,
    backgroundColor: M.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: M.line,
  },
  highlight: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  highlightRule: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: M.line },
  highlightValue: { fontFamily: FONT.display, fontSize: 26, color: M.ivory },
  highlightValueSmall: { fontSize: 18, marginTop: 5 },
  highlightIcon: { marginVertical: 3 },
  highlightLabel: { fontFamily: FONT.ui, fontSize: 11, color: M.muted, textAlign: 'center' },

  // Calls to action
  ctaRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  ctaPrimary: {
    flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52,
    borderRadius: 999, backgroundColor: M.gold,
  },
  ctaPrimaryText: { fontFamily: FONT.uiHeavy, fontSize: 14.5, color: M.ink, letterSpacing: 0.3 },
  ctaGhost: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 999,
    borderWidth: 1, borderColor: M.lineStrong,
  },
  ctaGhostText: { fontFamily: FONT.uiBold, fontSize: 14, color: M.ivory },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 14, padding: 4 },
  directionsText: { fontFamily: FONT.uiBold, fontSize: 13, color: M.gold, letterSpacing: 0.4 },

  ownerBar: {
    gap: 10, marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: M.panel,
    borderWidth: 1, borderColor: M.lineStrong,
  },
  ownerHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownerText: { fontFamily: FONT.ui, fontSize: 12.5, color: M.text, flex: 1 },
  ownerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ownerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7,
    borderWidth: 1, borderColor: M.lineStrong,
  },
  ownerBtnSolid: { backgroundColor: M.gold, borderColor: M.gold },
  ownerBtnText: { fontFamily: FONT.uiBold, fontSize: 12, color: M.gold },

  // Sections
  section: { marginTop: 44, gap: 12 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kickerNum: { fontFamily: FONT.display, fontSize: 18, color: M.gold },
  kickerRule: { width: 28, height: StyleSheet.hairlineWidth * 2, backgroundColor: M.lineStrong },
  kicker: { fontFamily: FONT.uiBold, fontSize: 11, letterSpacing: 2.6, textTransform: 'uppercase', color: M.gold },
  sectionTitle: { fontFamily: FONT.display, fontSize: 32, lineHeight: 36, color: M.ivory },
  sectionLead: { fontFamily: FONT.ui, fontSize: 13.5, color: M.muted, marginTop: -4 },
  lede: { fontFamily: FONT.read, fontSize: 16.5, lineHeight: 28, color: M.text },
  textLink: { fontFamily: FONT.uiBold, fontSize: 13, color: M.gold, letterSpacing: 0.4 },

  offerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  offer: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14,
    backgroundColor: M.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: M.line,
  },
  diamond: { width: 7, height: 7, backgroundColor: M.gold, transform: [{ rotate: '45deg' }] },
  offerText: { fontFamily: FONT.uiSemi, fontSize: 14.5, color: M.ivory, flexShrink: 1 },
  rateCard: {
    marginTop: 4, padding: 18, borderRadius: 16, backgroundColor: M.goldSoft,
    borderWidth: StyleSheet.hairlineWidth, borderColor: M.lineStrong, gap: 4,
  },
  rateLabel: { fontFamily: FONT.uiBold, fontSize: 10.5, letterSpacing: 2.4, color: M.gold },
  rateValue: { fontFamily: FONT.display, fontSize: 28, color: M.ivory },
  rateNote: { fontFamily: FONT.ui, fontSize: 13.5, color: M.muted },

  // The portfolio
  mosaic: { gap: 10 },
  mosaicRow: { flexDirection: 'row', gap: 10 },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: M.raised },
  tileCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 26, paddingBottom: 10 },
  tileCaptionText: { fontFamily: FONT.uiSemi, fontSize: 12.5, color: M.ivory },

  // Hours
  hoursCard: { borderRadius: 16, backgroundColor: M.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: M.line, overflow: 'hidden' },
  hourRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 10 },
  hourRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: M.line },
  hourToday: { backgroundColor: M.goldSoft },
  hourDay: { fontFamily: FONT.uiSemi, fontSize: 14, color: M.text },
  hourDots: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: M.line },
  hourTime: { fontFamily: FONT.uiBold, fontSize: 14, color: M.ivory },
  hourClosed: { color: M.faint, fontFamily: FONT.ui },
  hourTodayText: { color: M.gold },

  reviewsHead: { marginTop: 44 },

  // Contact
  contactCard: { borderRadius: 16, backgroundColor: M.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: M.line },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  contactRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: M.line },
  contactIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: M.goldSoft,
  },
  contactLabel: { fontFamily: FONT.uiBold, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: M.gold },
  contactText: { fontFamily: FONT.uiSemi, fontSize: 14.5, color: M.ivory, marginTop: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  linkBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: M.lineStrong, backgroundColor: M.panel,
  },

  footer: { marginTop: 52, alignItems: 'center', gap: 6 },
  footerRule: { width: 44, height: 1, backgroundColor: M.lineStrong, marginBottom: 10 },
  footerName: { fontFamily: FONT.display, fontSize: 22, color: M.ivory, textAlign: 'center' },
  listedBy: { fontFamily: FONT.ui, fontSize: 12, color: M.faint, textAlign: 'center' },
  reportLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, padding: 4 },
  reportText: { fontFamily: FONT.ui, fontSize: 12, color: M.faint },

  // Chrome
  slimBar: {
    position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(13,12,10,0.94)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: M.line,
  },
  slimName: { fontFamily: FONT.display, fontSize: 19, color: M.ivory, maxWidth: '62%' },
  topBar: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(13,12,10,0.55)', alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,239,230,0.18)',
  },
  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, backgroundColor: 'rgba(13,12,10,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: M.line,
  },
  actionInner: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46,
    borderRadius: 999, backgroundColor: M.gold, paddingHorizontal: 6,
  },
  actionQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: M.lineStrong, flex: 0, width: 46 },
  actionText: { fontFamily: FONT.uiBold, fontSize: 13, color: M.ink, flexShrink: 1 },

  viewer: { flex: 1, backgroundColor: 'rgba(8,7,6,0.97)' },
  viewerImg: { width: '100%', height: '78%' },
  viewerTop: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewerCount: { fontFamily: FONT.uiBold, fontSize: 12, letterSpacing: 2, color: M.gold },
  viewerCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 18 },
  viewerCaptionText: { fontFamily: FONT.displaySemi, fontSize: 20, color: M.ivory, textAlign: 'center' },
});

// The reviews, in Maison's look (components/services/ServiceReviews: skin).
const REVIEWS_SKIN = {
  section: { marginHorizontal: 0, marginTop: 12, paddingTop: 0, borderTopWidth: 0 },
  title: { fontFamily: FONT.display, fontSize: 32, lineHeight: 36, color: M.ivory, fontWeight: undefined },
  avg: { fontFamily: FONT.display, fontSize: 44, color: M.ivory, fontWeight: undefined },
  count: { color: M.muted },
  spreadLabel: { color: M.muted },
  track: { backgroundColor: M.raised },
  fill: { backgroundColor: M.gold },
  star: M.gold,
  none: { color: M.muted },
  mine: { borderColor: M.lineStrong, backgroundColor: M.panel },
  mineLabel: { color: M.gold },
  write: { backgroundColor: M.gold, borderRadius: 999 },
  writeText: { color: M.ink },
  writeIcon: M.ink,
  review: { borderBottomColor: M.line, paddingVertical: 14 },
  who: { color: M.ivory },
  when: { color: M.faint },
  body: { color: M.text, fontFamily: FONT.read, fontSize: 15, lineHeight: 24 },
  reply: { borderLeftColor: M.gold },
  replyWho: { color: M.gold },
  replyText: { color: M.text },
  link: { color: M.gold },
  bookedText: { color: M.gold },
};

export default ServiceDetail;
