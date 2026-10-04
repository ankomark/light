/**
 * The public supporters list, and the running total — each shown only when
 * the organiser made it public (the server returns nothing otherwise).
 *
 * A supporter appears by name, with the middle four digits of their phone
 * hidden (071****678), only if they agreed at checkout; everyone else is an
 * "Anonymous supporter" with their level or amount and nothing more. The
 * server applies all of that; this only draws it.
 *
 * Refreshed every 10 s while on screen (and the app in front), so a total
 * climbs during a harambee without anyone pulling to refresh.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchSupporters, formatKes } from '../../services/tickets';
import { T, F, tap, Kicker } from './TicketKit';

export const LIVE_MS = 10 * 1000;

/** Run `fn` now and every `ms` while mounted and the app is in front. */
export const useLive = (fn, ms = LIVE_MS, enabled = true) => {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const start = () => { stop(); saved.current(); timer = setInterval(() => saved.current(), ms); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { stop(); sub.remove(); };
  }, [ms, enabled]);
};

/** "just now", "5 min ago", "3 h ago", or the date. */
export const ago = (iso, t, months, now = Date.now()) => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return t('tix.ago.now');
  if (mins < 60) return t('tix.ago.min', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('tix.ago.hour', { n: hours });
  const d = new Date(then);
  return `${d.getDate()} ${months[d.getMonth()] || ''}`;
};

export const SupporterRow = ({ s, t, months }) => {
  const named = !!s.name;
  return (
    <View style={styles.row} testID="supporter-row">
      <View style={[styles.avatar, !named && styles.avatarAnon]}>
        {named ? <Text style={styles.initial}>{s.name.trim().charAt(0).toUpperCase()}</Text>
          : <Ionicons name="heart" size={15} color={T.champagne} />}
      </View>
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{named ? s.name : t('tix.sup.anonymous')}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[s.phone, ago(s.paid_at, t, months)].filter(Boolean).join('  ·  ')}
        </Text>
      </View>
      <View style={styles.right}>
        {s.ticket_type ? (
          <>
            {/* The level, and what was paid for it, side by side. */}
            <View style={styles.levelRow}>
              <Text style={styles.level} numberOfLines={1}>{s.ticket_type}</Text>
              <Text style={styles.paid}>{formatKes(s.amount)}</Text>
            </View>
            <Text style={styles.qty}>{t('tix.sup.tickets', { n: s.quantity })}</Text>
          </>
        ) : (
          <Text style={styles.amount}>{formatKes(s.amount)}</Text>
        )}
      </View>
    </View>
  );
};

/** The latest few supporters with "See all"; nothing at all when the list is private. */
const Supporters = ({ slug, count, onSeeAll, limit = 5, style }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const [rows, setRows] = useState(null);
  const [closed, setClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await fetchSupporters(slug);
      setRows(page.results || []);
    } catch (err) {
      if (err?.code === 'not_found') setClosed(true);
    }
  }, [slug]);
  useLive(load, LIVE_MS, !closed);

  if (closed || rows === null) return null;
  return (
    <View style={style} testID="supporters">
      <View style={styles.head}>
        <Kicker>{t('tix.sup.title')}</Kicker>
        {count != null && <Text style={styles.count}>{t('tix.sup.count', { n: count })}</Text>}
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty}>{t('tix.sup.first')}</Text>
      ) : (
        <View style={styles.card}>
          {rows.slice(0, limit).map((s, i) => <SupporterRow key={`${s.paid_at}-${i}`} s={s} t={t} months={months} />)}
          {rows.length > limit && !!onSeeAll && (
            <TouchableOpacity onPress={() => { tap(); onSeeAll(); }} style={styles.all} accessibilityRole="button"
                              testID="supporters-all">
              <Text style={styles.allText}>{t('tix.sup.seeAll')}</Text>
              <Ionicons name="chevron-forward" size={16} color={T.champagne} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

/**
 * Raised so far, against the goal when there is one. `raised` null means the
 * organiser keeps the total private: then only the goal is shown.
 */
export const Progress = ({ raised, goal, supporters, style }) => {
  const { t } = useI18n();
  const pct = raised != null && goal ? Math.min(100, Math.round((raised / goal) * 100)) : null;
  if (raised == null && !goal) return null;
  return (
    <View style={[styles.progress, style]} testID="progress">
      {raised != null ? (
        <>
          <Text style={styles.raised} accessibilityLiveRegion="polite">{formatKes(raised)}</Text>
          <Text style={styles.raisedOf}>
            {goal ? t('tix.sup.ofGoal', { goal: formatKes(goal) }) : t('tix.sup.raised')}
            {supporters != null ? `  ·  ${t('tix.sup.count', { n: supporters })}` : ''}
          </Text>
          {pct != null && (
            <>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
              <Text style={styles.pct}>{t('tix.sup.pct', { n: pct })}</Text>
            </>
          )}
        </>
      ) : (
        <>
          <Text style={styles.raisedOf}>{t('tix.sup.goal')}</Text>
          <Text style={styles.raised}>{formatKes(goal)}</Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginLeft: 4 },
  count: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.muted },
  empty: { fontFamily: F.ui, fontSize: 14, color: T.muted, marginLeft: 4 },
  card: { borderRadius: 20, backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: T.champagne },
  avatarAnon: { backgroundColor: 'rgba(232,212,170,0.12)' },
  initial: { fontFamily: F.uiHeavy, fontSize: 15, color: T.paperInk },
  name: { fontFamily: F.uiBold, fontSize: 14.5, color: T.ivory },
  meta: { fontFamily: F.ui, fontSize: 12, color: T.muted, marginTop: 2 },
  right: { alignItems: 'flex-end', maxWidth: '52%' },
  levelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  level: { flexShrink: 1, fontFamily: F.uiBold, fontSize: 13, color: T.champagne },
  paid: { fontFamily: F.uiHeavy, fontSize: 14, color: T.ivory },
  qty: { fontFamily: F.ui, fontSize: 12, color: T.muted, marginTop: 2 },
  amount: { fontFamily: F.uiHeavy, fontSize: 14, color: T.champagne },
  all: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12 },
  allText: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne },

  progress: { padding: 18, borderRadius: 22, backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong },
  raised: { fontFamily: F.display, fontSize: 36, lineHeight: 40, color: T.ivory },
  raisedOf: { fontFamily: F.uiSemi, fontSize: 13.5, color: T.muted, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: T.line, overflow: 'hidden', marginTop: 14 },
  fill: { height: 8, borderRadius: 4, backgroundColor: T.gold },
  pct: { fontFamily: F.uiBold, fontSize: 12, color: T.champagne, marginTop: 6 },
});

export default Supporters;
