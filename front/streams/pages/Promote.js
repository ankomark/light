/**
 * Promote something: a post, your profile, a product, a book or a service.
 * Pick a package (a price for a number of views over some days), who sees it
 * (everyone, or chosen counties), and pay by M-Pesa. Then it waits for the
 * phone: once paid it goes to the admins to approve, and runs from then.
 *
 * route.params: { kind, targetId?, title? } for a new one, or
 *               { promotionId } to finish paying for one already made.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchPromotionPackages, createPromotion, payPromotion, fetchPromotion,
} from '../services/api';
import { useI18n } from '../context/I18nContext';
import { colors, spacing, radius } from '../constants/theme';

const POLL_MS = 3000;
const POLL_FOR_MS = 150000;   // the ticketing server gives up at 10 min; the phone prompt at ~1
const KIND_ICON = { post: 'images-outline', profile: 'person-outline', product: 'pricetag-outline',
  book: 'book-outline', service: 'briefcase-outline' };

export const formatViews = (n) => Number(n || 0).toLocaleString();

const errorText = (e, t) => e?.response?.data?.error || e?.data?.error || t('promote.failed');

const Promote = ({ navigation, route }) => {
  const { t } = useI18n();
  const params = route?.params || {};
  const [catalog, setCatalog] = useState(null);       // { packages, counties }
  const [pkg, setPkg] = useState('standard');
  const [everyone, setEveryone] = useState(true);
  const [counties, setCounties] = useState([]);
  const [search, setSearch] = useState('');
  const [phone, setPhone] = useState('');
  const [promotion, setPromotion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // No answer from M-Pesa in the waiting time: say so, and offer another prompt.
  const [timedOut, setTimedOut] = useState(false);
  const pollStarted = useRef(0);

  useEffect(() => {
    fetchPromotionPackages().then(setCatalog).catch(() => setError(t('promote.loadFailed')));
    if (params.promotionId) {
      fetchPromotion(params.promotionId).then((p) => {
        setPromotion(p);
        setPkg(p.package?.key || 'standard');
        setEveryone(!p.counties?.length);
        setCounties(p.counties || []);
      }).catch(() => {});
    }
  }, [params.promotionId, t]);

  const kind = promotion?.kind || params.kind || 'post';
  const chosen = catalog?.packages?.find((p) => p.key === pkg);
  const status = promotion?.status;
  const waiting = status === 'paying';

  // Waiting on the phone: read the promotion until M-Pesa has answered.
  useEffect(() => {
    if (!waiting || !promotion?.id) return undefined;
    pollStarted.current = pollStarted.current || Date.now();
    const id = setInterval(async () => {
      if (Date.now() - pollStarted.current > POLL_FOR_MS) { clearInterval(id); setTimedOut(true); return; }
      try { setPromotion(await fetchPromotion(promotion.id)); } catch { /* next tick */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, promotion?.id]);

  const shownCounties = useMemo(() => {
    const all = catalog?.counties || [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((c) => c.toLowerCase().includes(q)) : all;
  }, [catalog, search]);

  const toggleCounty = (c) => setCounties((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const pay = useCallback(async () => {
    setError('');
    if (!phone.trim()) { setError(t('promote.phoneNeeded')); return; }
    if (!everyone && counties.length === 0) { setError(t('promote.countiesNeeded')); return; }
    setBusy(true);
    try {
      let p = promotion;
      if (!p || p.status === 'cancelled') {
        p = await createPromotion({
          kind, target_id: params.targetId ?? null, package: pkg, counties: everyone ? [] : counties,
        });
        setPromotion(p);
      }
      pollStarted.current = Date.now();
      setTimedOut(false);
      setPromotion(await payPromotion(p.id, phone.trim()));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [phone, everyone, counties, promotion, kind, params.targetId, pkg, t]);

  // Once made, its package and audience are what the server holds (and what
  // the price is for): shown, not changeable. To change them, cancel it.
  const locked = !!promotion;

  let body;
  if (status === 'review' || status === 'active' || status === 'done') {
    body = (
      <View style={styles.result} testID="promote-paid">
        <Ionicons name="checkmark-circle" size={56} color={colors.success || '#34C759'} />
        <Text style={styles.resultTitle}>{t('promote.paidTitle')}</Text>
        <Text style={styles.resultText}>{t('promote.paidBody')}</Text>
        <TouchableOpacity style={styles.primary} onPress={() => (navigation.replace ? navigation.replace('MyPromotions') : navigation.navigate('MyPromotions'))}
                          accessibilityRole="button" testID="promote-mine">
          <Text style={styles.primaryText}>{t('promote.seeMine')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (waiting && timedOut) {
    body = (
      <View style={styles.result} testID="promote-timed-out">
        <Ionicons name="time-outline" size={52} color={colors.textSecondary} />
        <Text style={styles.resultTitle}>{t('promote.noAnswer')}</Text>
        <Text style={styles.resultText}>{t('promote.noAnswerBody')}</Text>
        <TouchableOpacity style={styles.primary} onPress={pay} disabled={busy} accessibilityRole="button"
                          testID="promote-retry">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{t('promote.sendAgain')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('MyPromotions')} accessibilityRole="button">
          <Text style={styles.link}>{t('promote.seeMine')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (waiting) {
    body = (
      <View style={styles.result} testID="promote-waiting">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.resultTitle}>{t('promote.checkPhone')}</Text>
        <Text style={styles.resultText}>{t('promote.checkPhoneBody', { amount: formatViews(promotion.price) })}</Text>
      </View>
    );
  } else {
    body = (
      <>
        <View style={styles.what}>
          <Ionicons name={KIND_ICON[kind] || 'megaphone-outline'} size={20} color={colors.primary} />
          <Text style={styles.whatText} numberOfLines={2}>
            {t(`promote.kind.${kind}`)}{params.title ? ` · ${params.title}` : ''}
          </Text>
        </View>

        <Text style={styles.label}>{t('promote.package')}</Text>
        {!catalog ? <ActivityIndicator color={colors.primary} /> : catalog.packages.map((p) => {
          const on = p.key === pkg;
          return (
            <TouchableOpacity key={p.key} style={[styles.pack, on && styles.packOn]} disabled={locked}
                              onPress={() => setPkg(p.key)} accessibilityRole="radio"
                              accessibilityState={{ checked: on }} testID={`promote-package-${p.key}`}>
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20}
                        color={on ? colors.primary : colors.textSecondary} />
              <View style={styles.packText}>
                <Text style={styles.packName}>{p.name}</Text>
                <Text style={styles.packSub}>{t('promote.packSub', { views: formatViews(p.views), days: p.days })}</Text>
              </View>
              <Text style={styles.packPrice}>KES {formatViews(p.price)}</Text>
            </TouchableOpacity>
          );
        })}

        <Text style={styles.label}>{t('promote.audience')}</Text>
        <View style={styles.segment}>
          {[true, false].map((all) => (
            <TouchableOpacity key={String(all)} style={[styles.segBtn, everyone === all && styles.segOn]}
                              disabled={locked} onPress={() => setEveryone(all)}
                              accessibilityRole="radio" accessibilityState={{ checked: everyone === all }}
                              testID={all ? 'promote-everyone' : 'promote-counties'}>
              <Text style={[styles.segText, everyone === all && styles.segTextOn]}>
                {all ? t('promote.everyone') : t('promote.someCounties')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {!everyone && (
          <View style={styles.counties}>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} editable={!locked}
                       placeholder={t('promote.searchCounty')} placeholderTextColor={colors.placeholder}
                       testID="promote-county-search" />
            <View style={styles.chips}>
              {shownCounties.map((c) => {
                const on = counties.includes(c);
                return (
                  <TouchableOpacity key={c} style={[styles.chip, on && styles.chipOn]} disabled={locked}
                                    onPress={() => toggleCounty(c)} testID={`promote-county-${c}`}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <Text style={styles.label}>{t('promote.payWith')}</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                   placeholder="0712 345 678" placeholderTextColor={colors.placeholder} maxLength={15}
                   testID="promote-phone" />
        {!!promotion?.payment_note && status === 'unpaid' && (
          <Text style={styles.error}>{t('promote.notPaid', { why: promotion.payment_note })}</Text>
        )}
        <Text style={styles.note}>{t('promote.reviewNote')}</Text>
        <TouchableOpacity style={[styles.primary, (busy || !chosen) && styles.off]} onPress={pay}
                          disabled={busy || !chosen} accessibilityRole="button" testID="promote-pay">
          {busy ? <ActivityIndicator color={colors.white} /> : (
            <Text style={styles.primaryText}>
              {t('promote.pay', { amount: formatViews(promotion?.price ?? chosen?.price ?? 0) })}
            </Text>
          )}
        </TouchableOpacity>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button"
                          accessibilityLabel={t('common.back')}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('promote.title')}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {body}
        {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  scroll: { padding: spacing.md, paddingBottom: 48, gap: spacing.sm, width: '100%', maxWidth: 620, alignSelf: 'center' },
  what: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: 'rgba(10,22,40,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  whatText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: spacing.md, textTransform: 'uppercase' },
  pack: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: 'rgba(10,22,40,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  packOn: { borderColor: colors.primary },
  packText: { flex: 1 },
  packName: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  packSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  packPrice: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  segOn: { borderColor: colors.primary, backgroundColor: 'rgba(29,161,242,0.16)' },
  segText: { color: colors.textSecondary, fontWeight: '700' },
  segTextOn: { color: colors.textPrimary },
  counties: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  input: {
    minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16,
    backgroundColor: 'rgba(5,10,20,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  note: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: spacing.sm },
  primary: {
    minHeight: 52, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center',
    justifyContent: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg,
  },
  off: { opacity: 0.5 },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: '800' },
  result: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  resultTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  resultText: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700', padding: spacing.sm },
  error: { color: '#FF8A80', fontSize: 13.5, marginTop: spacing.sm, textAlign: 'center' },
});

export default Promote;
