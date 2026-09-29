// Today's Daily Puzzle leaderboard: everyone, the people you follow, or one
// of your groups. Finished boards only, least help first, then the quickest.
// Each board is kept once seen, so switching back to one is instant.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { fetchPuzzleDailyBoard, fetchGroups } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { starText } from './PuzzleShareCard';
import { DISPLAY, DISPLAY_MID, GOLD, PARCHMENT, MUTED, mmss } from '../pages/quizTheme';

export default function PuzzleBoardSheet({ visible, onClose }) {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const [scope, setScope] = useState('everyone');
  const wanted = useRef(scope);
  wanted.current = scope;
  const keyFor = useCallback((sc) => userKey(currentUser?.id, `puzzle:board:${sc}`), [currentUser?.id]);
  const [board, setBoard] = useState(() => peekCache(keyFor('everyone')));
  const [groups, setGroups] = useState(() => peekCache(userKey(currentUser?.id, 'quiz:myGroups')) || []);

  useEffect(() => {
    if (!visible) return undefined;
    let live = true;
    const sc = scope;
    setBoard(peekCache(keyFor(sc)) || null);
    fetchPuzzleDailyBoard(sc)
      .then((data) => {
        writeCache(keyFor(sc), data, { persist: false });
        if (live && wanted.current === sc) setBoard(data);
      })
      .catch(() => { if (live && wanted.current === sc) setBoard((b) => b || { results: [], me: null }); });
    return () => { live = false; };
  }, [visible, scope, keyFor]);

  useEffect(() => {
    if (!visible || groups.length) return;
    Promise.resolve().then(() => fetchGroups({ scope: 'mine' }))
      .then((res) => setGroups((res?.results || res || []).filter((g) => g?.slug).slice(0, 8)
        .map((g) => ({ slug: g.slug, name: g.name }))))
      .catch(() => {});
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scopes = [
    { key: 'everyone', label: t('quiz.board.everyone') },
    { key: 'following', label: t('quiz.board.following') },
    ...groups.map((g) => ({ key: `group:${g.slug}`, label: g.name, group: true })),
  ];
  const results = board?.results || [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.75}
      header={(
        <View style={styles.head}>
          <Text style={styles.headTitle}>{t('puzzle.board.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color="rgba(232,227,218,0.7)" />
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.scopes} style={styles.scopesRow}>
        {scopes.map((sc) => (
          <TouchableOpacity
            key={sc.key}
            style={[styles.scope, scope === sc.key && styles.scopeOn]}
            onPress={() => setScope(sc.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: scope === sc.key }}
            testID={`puzzle-board-${sc.key}`}
          >
            {sc.group && <Ionicons name="people" size={12} color={scope === sc.key ? GOLD : '#A9BCD0'} />}
            <Text style={[styles.scopeText, scope === sc.key && styles.scopeTextOn]} numberOfLines={1}>{sc.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body} testID="puzzle-board">
        {!board ? (
          <ActivityIndicator color={GOLD} style={styles.loading} />
        ) : !results.length ? (
          <Text style={styles.empty}>{t('puzzle.board.empty')}</Text>
        ) : (
          results.map((row, i) => {
            const isMe = row.user?.username === currentUser?.username;
            return (
              <View key={row.id} style={[styles.row, isMe && styles.rowMe]}>
                <Text style={[styles.rank, isMe && styles.gold]}>{i + 1}</Text>
                <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>{row.user?.username}</Text>
                <Text style={styles.stars}>{starText(row.stars)}</Text>
                <Text style={styles.time}>{mmss(row.seconds || 0)}</Text>
              </View>
            );
          })
        )}
        {!!board?.me && board.me.rank > results.length && (
          <View style={[styles.row, styles.rowMe, styles.pinned]}>
            <Text style={[styles.rank, styles.gold]}>{board.me.rank}</Text>
            <Text style={[styles.name, styles.nameMe]} numberOfLines={1}>{currentUser?.username}</Text>
            <Text style={styles.stars}>{starText(board.me.stars)}</Text>
            <Text style={styles.time}>{mmss(board.me.seconds || 0)}</Text>
          </View>
        )}
        {!!board?.me && (
          <Text style={styles.mine}>{t('puzzle.board.me', { rank: board.me.rank, of: board.me.of })}</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10,
  },
  headTitle: { fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.8, color: PARCHMENT },
  scopesRow: { flexGrow: 0 },
  scopes: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  scope: {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  scopeOn: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.12)' },
  scopeText: { fontSize: 12, color: '#A9BCD0' },
  scopeTextOn: { color: GOLD },
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { marginTop: 24 },
  empty: { fontSize: 13, color: 'rgba(232,227,218,0.6)', textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10,
  },
  rowMe: { backgroundColor: 'rgba(244,162,97,0.10)' },
  pinned: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)' },
  rank: { width: 26, fontFamily: DISPLAY, fontSize: 14, color: PARCHMENT, textAlign: 'center' },
  gold: { color: GOLD },
  name: { flex: 1, fontSize: 14, color: PARCHMENT },
  nameMe: { fontWeight: '700' },
  stars: { fontSize: 12, color: GOLD },
  time: { width: 52, textAlign: 'right', fontFamily: DISPLAY_MID, fontSize: 13, color: PARCHMENT },
  mine: { marginTop: 14, fontSize: 12, color: MUTED, textAlign: 'center' },
});
