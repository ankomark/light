// One screen for each legal document: the route passes { docKey } — 'privacy',
// 'terms' or 'guidelines' (content/legal.js). The prose is English (it is the
// text that applies); the page around it is translated. A reading bar, the
// document "at a glance", a contents list that jumps to each part, and the
// other documents at the end.
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../context/I18nContext';
import { LEGAL, LEGAL_DOCS, isPlaceholder } from '../content/legal';
import { FONT_SCALE } from '../utils/layout';
import {
  INFO, FONT, RADIUS, InfoScreen, Section, Card, Tiles, Para, InfoButton,
} from '../components/info/InfoKit';

const OTHER = { privacy: ['terms', 'guidelines'], terms: ['privacy', 'guidelines'], guidelines: ['privacy', 'terms'] };

const LegalPage = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useI18n();
  const key = LEGAL_DOCS[route.params?.docKey] ? route.params.docKey : 'privacy';
  const { titleKey, doc, summary, icon } = LEGAL_DOCS[key];
  const title = t(titleKey);
  const insets = useSafeAreaInsets();

  const scrollRef = useRef(null);
  const offsets = useRef({});            // section index -> y in the scroll content
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);

  const onScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const room = Math.max(1, contentSize.height - layoutMeasurement.height);
    const p = Math.min(1, Math.max(0, contentOffset.y / room));
    if (Math.abs(p - progress) > 0.01) setProgress(p);
    if ((contentOffset.y > 700) !== showTop) setShowTop(contentOffset.y > 700);
  };
  const jump = (i) => scrollRef.current?.scrollTo({ y: Math.max(0, (offsets.current[i] ?? 0) - 12), animated: true });

  const updated = isPlaceholder(LEGAL.effectiveDate) ? null : t('legal.updated', { date: LEGAL.effectiveDate });
  const paras = (p) => (Array.isArray(p) ? p : [p]);
  const sections = useMemo(() => doc.sections, [doc]);

  return (
    <View style={{ flex: 1, backgroundColor: INFO.bg }}>
      <InfoScreen
        title={title}
        eyebrow={t('legal.eyebrow')}
        subtitle={updated}
        icon={icon}
        scrollRef={scrollRef}
        onScroll={onScroll}
        testID={`legal-${key}`}
        below={(
          <View style={styles.track} accessibilityLabel={t('legal.readProgress', { n: Math.round(progress * 100) })}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
        )}
      >
        <Para style={{ marginTop: 10 }}>{doc.intro}</Para>

        <Section label={t('legal.atAGlance')} plain>
          <View style={styles.glance} testID="legal-glance">
            {summary.map((line) => (
              <View key={line} style={styles.point}>
                <Ionicons name="checkmark-circle-outline" size={19} color={INFO.accent} style={{ marginTop: 1 }} />
                <Text style={styles.pointText}>{line}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section label={t('legal.contents')}>
          {sections.map((sec, i) => (
            <React.Fragment key={sec.h}>
              {i > 0 && <View style={styles.tocDivider} />}
              <TouchableOpacity style={styles.tocRow} onPress={() => jump(i)} accessibilityRole="button"
                testID={`legal-toc-${i}`}>
                <Text style={styles.tocNum} maxFontSizeMultiplier={FONT_SCALE.chrome}>{i + 1}</Text>
                <Text style={styles.tocText}>{sec.h}</Text>
                <Ionicons name="arrow-down" size={16} color={INFO.muted} />
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </Section>

        {sections.map((sec, i) => (
          <View key={sec.h} style={styles.part} onLayout={(e) => { offsets.current[i] = e.nativeEvent.layout.y; }}>
            <View style={styles.partHead}>
              <Text style={styles.partNum}>{i + 1}</Text>
              <Text style={styles.partTitle} accessibilityRole="header">{sec.h}</Text>
            </View>
            {paras(sec.p).map((para) => (
              <View key={para} style={styles.paraRow}>
                {paras(sec.p).length > 1 && <View style={styles.bullet} />}
                <Text style={styles.partText} selectable>{para}</Text>
              </View>
            ))}
          </View>
        ))}

        <Section label={t('legal.questions')} plain>
          <Card>
            <Para>{t('legal.questionsBody')}</Para>
            <InfoButton icon="mail-outline" label={LEGAL.contactEmail}
              onPress={() => Linking.openURL(`mailto:${LEGAL.contactEmail}`).catch(() => {})} />
          </Card>
        </Section>

        <Section label={t('legal.alsoRead')} plain>
          <Tiles items={OTHER[key].map((k) => ({
            icon: LEGAL_DOCS[k].icon,
            title: t(LEGAL_DOCS[k].titleKey),
            onPress: () => navigation.replace('LegalPage', { docKey: k }),
            testID: `legal-open-${k}`,
          }))} />
        </Section>

        <Text style={styles.footer}>{t('legal.disclaimer')}</Text>
      </InfoScreen>

      {showTop && (
        <TouchableOpacity style={[styles.topBtn, { bottom: 24 + insets.bottom, right: 18 + insets.right }]} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          accessibilityRole="button" accessibilityLabel={t('legal.backToTop')}>
          <Ionicons name="arrow-up" size={22} color={INFO.onAccent} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  track: { height: 3, backgroundColor: INFO.border },
  fill: { height: 3, backgroundColor: INFO.accent },
  glance: {
    padding: 16, gap: 12, borderRadius: RADIUS,
    backgroundColor: INFO.accentSoft, borderWidth: 1, borderColor: INFO.accentLine,
  },
  point: { flexDirection: 'row', gap: 10 },
  pointText: { flex: 1, color: INFO.text, fontSize: 14.5, fontFamily: FONT.body, lineHeight: 22 },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
  tocDivider: { height: StyleSheet.hairlineWidth, backgroundColor: INFO.border, marginLeft: 48 },
  tocNum: { minWidth: 20, color: INFO.accent, fontSize: 13, fontFamily: FONT.heavy, fontVariant: ['tabular-nums'] },
  tocText: { flex: 1, color: INFO.sub, fontSize: 14, fontFamily: FONT.semi },
  part: { marginTop: 30, gap: 12 },
  partHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  partNum: { color: INFO.accent, fontSize: 15, fontFamily: FONT.titleBold, fontVariant: ['tabular-nums'] },
  partTitle: { flex: 1, color: INFO.text, fontSize: 19, fontFamily: FONT.title, lineHeight: 25 },
  paraRow: { flexDirection: 'row', gap: 10 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: INFO.accent, marginTop: 10 },
  partText: { flex: 1, color: INFO.sub, fontSize: 15, fontFamily: FONT.body, lineHeight: 24 },
  footer: {
    color: INFO.muted, fontSize: 12, fontFamily: FONT.body, lineHeight: 18, textAlign: 'center',
    marginTop: 28, fontStyle: 'italic',
  },
  topBtn: {
    position: 'absolute', width: 50, height: 50, borderRadius: 25,
    backgroundColor: INFO.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});

export default LegalPage;
