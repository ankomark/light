/**
 * A calculator, styled as an instrument rather than a form.
 *
 * The arithmetic lives in utils/arithmetic.js, which parses rather than evals —
 * see the note there. This file is the keypad and its dressing.
 *
 * The look is deliberately the app's existing luxury vocabulary — Cinzel, gold
 * on ink — rather than a third style invented for this screen. What it borrows
 * from the calculator artwork is the slate-blue key face and the brass accent,
 * so icon and screen read as one thing. It is fixed dark for the same reason
 * the quiz screens are: a brass-on-slate instrument does not have a light mode,
 * and a half-translated one would look broken rather than themed.
 *
 * Two behaviours worth keeping: it shows the running answer while you type, and
 * it refuses to build a malformed expression at all, so "=" is never the moment
 * you discover a typo.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useI18n } from '../context/I18nContext';
import { evaluate, format } from '../utils/arithmetic';

// Lifted from the artwork on the menu row: slate keys, brass accents, ink
// ground. DISPLAY/SERIF are the faces the quiz and puzzle already use.
const INK = '#0A1424';
const INK_DEEP = '#060D18';
const SLATE = '#1B2A40';
const SLATE_LIGHT = '#22364F';
const BRASS = '#C9A227';
const BRASS_SOFT = '#E3C46A';
const PARCHMENT = '#ECE7DE';
const MUTED = '#7C8CA5';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';

const OPERATORS = '+-*/';
const GLYPH = { '*': '×', '/': '÷', '-': '−' };
const show = (expr) => expr.replace(/[*/-]/g, (c) => GLYPH[c] || c);

const KEYS = [
  [{ k: 'C', kind: 'clear' }, { k: '(', kind: 'fn' }, { k: ')', kind: 'fn' }, { k: '/', kind: 'op' }],
  [{ k: '7' }, { k: '8' }, { k: '9' }, { k: '*', kind: 'op' }],
  [{ k: '4' }, { k: '5' }, { k: '6' }, { k: '-', kind: 'op' }],
  [{ k: '1' }, { k: '2' }, { k: '3' }, { k: '+', kind: 'op' }],
  [{ k: '%', kind: 'fn' }, { k: '0' }, { k: '.' }, { k: '=', kind: 'equals' }],
];

const Calculator = ({ navigation }) => {
  const { t } = useI18n();
  const { height, width } = useWindowDimensions();

  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState([]);

  // The running answer: null while half-typed, which is most of the time. The
  // readout simply stays quiet until there is something true to say.
  const preview = useMemo(() => evaluate(expr), [expr]);

  const tap = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
    Haptics.impactAsync(style).catch(() => {});
  }, []);

  const press = useCallback((key) => {
    tap();
    setExpr((current) => {
      if (key === 'C') return '';
      const last = current.slice(-1);

      if (OPERATORS.includes(key)) {
        if (!current) return key === '-' ? '-' : current;
        if (OPERATORS.includes(last)) return current.slice(0, -1) + key;   // swap, don't stack
        if (last === '(') return key === '-' ? current + key : current;
        return current + key;
      }
      if (key === '.') {
        const tail = current.split(/[+\-*/()%]/).pop();
        if (tail.includes('.')) return current;                            // one point per number
        return tail ? current + '.' : current + '0.';
      }
      if (key === ')') {
        const opens = (current.match(/\(/g) || []).length;
        const closes = (current.match(/\)/g) || []).length;
        if (opens <= closes || OPERATORS.includes(last) || last === '(') return current;
        return current + key;
      }
      if (key === '(') {
        if (current && /[\d).%]$/.test(last)) return `${current}*(`;       // 2(3+4) means 2×(3+4)
        return current + key;
      }
      if (key === '%') {
        if (!current || !/[\d).]$/.test(last)) return current;
        return current + key;
      }
      return current + key;
    });
  }, [tap]);

  const backspace = useCallback(() => { tap(); setExpr((c) => c.slice(0, -1)); }, [tap]);

  const equals = useCallback(() => {
    const value = evaluate(expr);
    if (value === null) { tap(Haptics.ImpactFeedbackStyle.Heavy); return; }
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setHistory((h) => [{ expr, value }, ...h].slice(0, 30));
    setExpr(format(value).replace(/,/g, ''));      // carry on from the answer
  }, [expr, tap]);

  // A short screen gives the keypad priority; a tall one can afford the ledger.
  const roomy = height >= 720;
  const keyHeight = Math.min(72, Math.max(52, Math.round((width - 40) / 4 / 1.35)));

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[SLATE, INK, INK_DEEP]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={PARCHMENT} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('tools.calculator')}</Text>
          <TouchableOpacity
            onPress={() => { tap(); setHistory([]); }}
            hitSlop={10}
            disabled={!history.length}
            accessibilityLabel={t('tools.clearHistory')}
          >
            <Ionicons
              name="time-outline"
              size={21}
              color={history.length ? BRASS_SOFT : 'transparent'}
            />
          </TouchableOpacity>
        </View>

        {/* The ledger: past sums, quiet, tap one to work from its answer. */}
        {roomy && (
          <ScrollView
            style={styles.ledger}
            contentContainerStyle={styles.ledgerInner}
            showsVerticalScrollIndicator={false}
          >
            {history.map((row, i) => (
              <TouchableOpacity
                key={`${row.expr}-${i}`}
                onPress={() => { tap(); setExpr(format(row.value).replace(/,/g, '')); }}
                activeOpacity={0.7}
              >
                <Text style={styles.ledgerExpr} numberOfLines={1}>{show(row.expr)}</Text>
                <Text style={styles.ledgerValue} numberOfLines={1}>{format(row.value)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* The readout, set on its own plate with a brass rule beneath. */}
        <View style={styles.readout}>
          <Text
            style={styles.expr}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.45}
          >
            {show(expr) || '0'}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {preview !== null && expr ? format(preview) : ' '}
          </Text>
          <LinearGradient
            colors={['transparent', BRASS, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.rule}
          />
        </View>

        <View style={styles.pad}>
          {KEYS.map((row, r) => (
            <View style={styles.padRow} key={`r${r}`}>
              {row.map((key) => {
                const isEquals = key.kind === 'equals';
                const isClear = key.kind === 'clear';
                return (
                  <TouchableOpacity
                    key={key.k}
                    style={[
                      styles.key,
                      { height: keyHeight },
                      (key.kind === 'op' || key.kind === 'fn') && styles.keyAccent,
                      isEquals && styles.keyEquals,
                    ]}
                    onPress={() => (isEquals ? equals() : press(key.k))}
                    onLongPress={isClear ? backspace : undefined}
                    activeOpacity={0.7}
                    accessibilityLabel={key.k === 'C' ? t('tools.clear') : key.k}
                  >
                    <Text style={[
                      styles.keyText,
                      key.kind === 'op' && styles.keyTextOp,
                      key.kind === 'fn' && styles.keyTextFn,
                      isClear && styles.keyTextClear,
                      isEquals && styles.keyTextEquals,
                    ]}>
                      {GLYPH[key.k] || key.k}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity
            style={styles.backspace}
            onPress={backspace}
            activeOpacity={0.7}
            accessibilityLabel={t('tools.backspace')}
          >
            <Ionicons name="backspace-outline" size={20} color={MUTED} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  back: { paddingVertical: 4 },
  title: {
    flex: 1, fontFamily: DISPLAY, fontSize: 15, letterSpacing: 1.2,
    color: PARCHMENT, textTransform: 'uppercase',
  },

  ledger: { maxHeight: 132 },
  ledgerInner: { paddingHorizontal: 22, paddingBottom: 8, gap: 12 },
  ledgerExpr: { fontSize: 12.5, color: MUTED, textAlign: 'right', letterSpacing: 0.4 },
  ledgerValue: {
    fontFamily: DISPLAY_MID, fontSize: 15, color: BRASS_SOFT, textAlign: 'right',
    letterSpacing: 0.6, marginTop: 1,
  },

  readout: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 14 },
  expr: {
    fontFamily: DISPLAY, fontSize: 42, color: PARCHMENT, textAlign: 'right',
    letterSpacing: 0.5,
  },
  preview: {
    fontFamily: DISPLAY_MID, fontSize: 17, color: BRASS_SOFT, textAlign: 'right',
    letterSpacing: 1, marginTop: 8, minHeight: 22, opacity: 0.9,
  },
  // A thin brass rule that fades at both ends — the one flourish on the screen.
  rule: { height: 1, marginTop: 14, opacity: 0.7 },

  pad: { paddingHorizontal: 14, paddingBottom: 6, gap: 10 },
  padRow: { flexDirection: 'row', gap: 10 },
  key: {
    flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 16,
    backgroundColor: SLATE,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(201,162,39,0.16)',
  },
  keyAccent: { backgroundColor: SLATE_LIGHT },
  keyEquals: {
    backgroundColor: BRASS,
    borderColor: BRASS_SOFT,
    shadowColor: BRASS, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  keyText: { fontFamily: DISPLAY_MID, fontSize: 22, color: PARCHMENT },
  keyTextOp: { color: BRASS_SOFT, fontSize: 24 },
  keyTextFn: { color: '#A9BCD0', fontSize: 20 },
  keyTextClear: { color: '#E0715F' },
  keyTextEquals: { color: INK, fontSize: 24 },

  backspace: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 28 },
});

export default Calculator;
