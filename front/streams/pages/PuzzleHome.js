/**
 * Pick a puzzle theme.
 *
 * The wallet sits at the top because this is the first screen where coins are
 * spent as well as earned — you should be able to see what a hint will cost you
 * before you start.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fetchPuzzleThemes, fetchCoinWallet } from '../services/api';
import { useI18n } from '../context/I18nContext';
import {
  Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF,
  GOLD, PARCHMENT, MUTED,
} from './quizTheme';

const PuzzleHome = ({ navigation }) => {
  const { t } = useI18n();
  const [themes, setThemes] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [th, w] = await Promise.allSettled([fetchPuzzleThemes(), fetchCoinWallet()]);
        if (!alive) return;
        if (th.status === 'fulfilled') setThemes(Array.isArray(th.value) ? th.value : []);
        if (w.status === 'fulfilled') setWallet(w.value);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []));

  if (loading && !themes.length) {
    return (
      <View style={q.rootClear}>
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  return (
    <View style={q.rootClear}>
      <View style={q.flex}>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <Text style={q.pageTitle}>{t('puzzle.title')}</Text>

          {!!wallet && (
            <View style={styles.wallet}>
              <View>
                <Text style={q.eyebrow}>{t('puzzle.balance')}</Text>
                <Coins value={wallet.balance} size={40} textSize={26} style={styles.walletCoins} />
              </View>
              <View style={styles.walletSide}>
                <View style={styles.walletHint}>
                  <Ionicons name="bulb" size={15} color={GOLD} />
                  <Text style={styles.walletHintText}>
                    {t('puzzle.hintCosts', { cost: wallet.hint_cost })}
                  </Text>
                </View>
                {/* The same streak the quiz shows — one record of showing up,
                    whichever game the day was spent on. */}
                {wallet.day_streak > 0 && (
                  <View style={styles.streak}>
                    <Ionicons
                      name="flame"
                      size={15}
                      color={wallet.played_today ? GOLD : MUTED}
                    />
                    <Text style={styles.streakText}>
                      {t('puzzle.dayStreak', { count: wallet.day_streak })}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <Text style={styles.lead}>{t('puzzle.lead')}</Text>

          {themes.map((theme) => (
            <TouchableOpacity
              style={styles.themeCard}
              key={theme.slug}
              onPress={() => navigation.navigate('PuzzlePlay', {
                theme: theme.slug,
                level: (theme.levels_completed || 0) + 1,
              })}
              activeOpacity={0.88}
            >
              <View style={styles.themeIcon}>
                <Ionicons name={theme.icon || 'book'} size={20} color={GOLD} />
              </View>
              <View style={styles.themeBody}>
                <Text style={styles.themeName}>{theme.name}</Text>
                {!!theme.description && (
                  <Text style={styles.themeText}>{theme.description}</Text>
                )}
                <Text style={styles.themeProgress}>
                  {theme.levels_completed > 0
                    ? t('puzzle.levelsDone', { count: theme.levels_completed })
                    : t('puzzle.notStarted')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </TouchableOpacity>
          ))}

          <Text style={styles.note}>{t('puzzle.note')}</Text>
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },

  wallet: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 18, borderRadius: 16, backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  walletCoins: { marginTop: 4 },
  walletSide: { alignItems: 'flex-end', gap: 6 },
  walletHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  walletHintText: { fontSize: 11.5, color: MUTED },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  streakText: { fontFamily: DISPLAY_MID, fontSize: 11.5, color: PARCHMENT },

  lead: { fontFamily: SERIF, fontSize: 14, lineHeight: 22, color: '#A9BCD0', marginTop: 4 },

  themeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14,
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  themeIcon: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.12)',
  },
  themeBody: { flex: 1, gap: 3 },
  themeName: { fontFamily: DISPLAY, fontSize: 14, letterSpacing: 0.5, color: PARCHMENT },
  themeText: { fontSize: 13, lineHeight: 19, color: '#A9BCD0' },
  themeProgress: { fontFamily: DISPLAY_MID, fontSize: 11, color: MUTED, marginTop: 3 },

  note: { marginTop: 10, fontSize: 11.5, lineHeight: 18, color: MUTED, textAlign: 'center' },
});

export default PuzzleHome;
