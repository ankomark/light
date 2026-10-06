/**
 * Everyone who has paid in, newest first, as the organiser made it public —
 * named only with the supporter's consent, phones with the middle digits
 * hidden. The first page is re-read every 10 s, so new supporters appear at
 * the top while it is open; older pages load as the list is scrolled.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import { fetchSupporters } from '../../services/tickets';
import { T, F, Kicker, Notice } from '../../components/tickets/TicketKit';
import { SupporterRow, useLive } from '../../components/tickets/Supporters';
import { nextPage } from './TicketsHome';
import { ticketErrorText } from './ticketText';

const TicketSupporters = ({ route }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const { slug, title } = route.params;

  const [first, setFirst] = useState(null);       // page 1, kept fresh
  const [older, setOlder] = useState([]);         // pages 2… as scrolled to
  const [count, setCount] = useState(0);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const loadingMore = useRef(false);

  useLive(useCallback(async () => {
    try {
      const page = await fetchSupporters(slug);
      setFirst(page.results || []);
      setCount(page.count || 0);
      setNext((n) => n ?? page.next);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [slug]));

  const more = async () => {
    const page = nextPage(next);
    if (!page || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const res = await fetchSupporters(slug, page);
      setOlder((o) => [...o, ...(res.results || [])]);
      setNext(res.next);
    } catch { /* stays as it is */ } finally {
      loadingMore.current = false;
    }
  };

  const rows = [...(first || []), ...older];
  return (
    <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      <FlatList
        data={rows}
        keyExtractor={(s, i) => `${s.paid_at}-${i}`}
        renderItem={({ item }) => <SupporterRow s={item} t={t} months={months} />}
        ListHeaderComponent={(
          <View style={styles.head}>
            <Kicker>{title}</Kicker>
            <Text style={styles.heading} accessibilityRole="header">{t('tix.sup.title')}</Text>
            {first !== null && <Text style={styles.count}>{t('tix.sup.count', { n: count })}</Text>}
            <Text style={styles.privacy}>{t('tix.sup.privacy')}</Text>
          </View>
        )}
        ListEmptyComponent={first === null
          ? (error ? <Notice title={ticketErrorText(error, t)} /> : <ActivityIndicator style={styles.loading} color={T.gold} />)
          : <Notice title={t('tix.sup.first')} />}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  list: { paddingBottom: 36, width: '100%', maxWidth: 720, alignSelf: 'center' },
  head: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },
  heading: { fontFamily: F.display, fontSize: 32, lineHeight: 36, color: T.ivory, marginTop: 6 },
  count: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 6 },
  privacy: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.faint, marginTop: 10 },
  loading: { marginTop: 40 },
});

export default TicketSupporters;
