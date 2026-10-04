/**
 * The steps the event wizard (TicketCreateEvent) gained when it learned
 * fundraisers: what is being opened, a fundraiser's cause, its goal and
 * suggested amounts, the supporting document for review, and who may see
 * the supporters list and the running total.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatKes } from '../../services/tickets';
import { T, F, tap } from '../../components/tickets/TicketKit';
import DateTimeField from '../../components/tickets/DateTimeField';
import { CATEGORIES, CATEGORY_ICON } from './TicketFundraiser';
import { wholeNumber } from './eventDraft';

// The phone's document picker. In every build (expo-document-picker), but
// required inside a try like the date picker, so a build without it shows
// the step's message instead of crashing.
let DocumentPicker = null;
try {
  DocumentPicker = require('expo-document-picker');
} catch {
  DocumentPicker = null;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** A PDF or photo for review: `{ uri, name, mimeType, size }`, null if none chosen, 'too_big' if over 10 MB. */
export const pickDocument = async () => {
  if (!DocumentPicker) return null;
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
  const a = !res.canceled && res.assets?.[0];
  if (!a) return null;
  if (a.size && a.size > MAX_DOCUMENT_BYTES) return 'too_big';
  return { uri: a.uri, name: a.name || 'document.pdf', mimeType: a.mimeType || 'application/pdf', size: a.size || 0 };
};

export const TypeStep = ({ t, kind, onPick, error }) => (
  <View>
    <Text style={styles.heading} accessibilityRole="header">{t('tix.host.typeTitle')}</Text>
    <Text style={styles.body}>{t('tix.host.typeBody')}</Text>
    {[
      { k: 'event', icon: 'ticket-outline' },
      { k: 'fundraiser', icon: 'heart-outline' },
    ].map(({ k, icon }) => {
      const on = kind === k;
      return (
        <TouchableOpacity key={k} onPress={() => { tap(); onPick(k); }} style={[styles.type, on && styles.typeOn]}
                          accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`host-kind-${k}`}>
          <View style={[styles.typeIcon, on && styles.typeIconOn]}>
            <Ionicons name={icon} size={24} color={on ? T.paperInk : T.champagne} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.typeTitle}>{t(`tix.host.kind.${k}`)}</Text>
            <Text style={styles.typeSub}>{t(`tix.host.kind.${k}Sub`)}</Text>
          </View>
          <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
        </TouchableOpacity>
      );
    })}
    {!!error && <Text style={styles.bad}>{error}</Text>}
  </View>
);

export const CategoryPicker = ({ t, value, onPick, error }) => (
  <View>
    <Text style={styles.label}>{t('tix.host.category')}</Text>
    <View style={styles.cats}>
      {CATEGORIES.map((c) => {
        const on = value === c;
        return (
          <TouchableOpacity key={c} onPress={() => { tap(); onPick(c); }} style={[styles.cat, on && styles.catOn]}
                            accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`host-cat-${c}`}>
            <Ionicons name={CATEGORY_ICON[c]} size={15} color={on ? T.paperInk : T.champagne} />
            <Text style={[styles.catText, on && styles.catTextOn]}>{t(`tix.cat.${c}`)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
    {!!error && <Text style={styles.bad}>{error}</Text>}
  </View>
);

export const GoalStep = ({ t, draft, update, err, when }) => (
  <View>
    <Text style={styles.heading} accessibilityRole="header">{t('tix.host.goalTitle')}</Text>
    <Text style={styles.body}>{t('tix.host.goalBody')}</Text>

    <Text style={styles.label}>{t('tix.host.goal')}</Text>
    <View style={[styles.field, !!err('goal') && styles.fieldBad]}>
      <Text style={styles.prefix}>KES</Text>
      <TextInput value={draft.goal} onChangeText={(v) => update({ goal: v.replace(/[^\d]/g, '') })} keyboardType="number-pad"
                 maxLength={9} placeholder={t('tix.host.goalPlaceholder')} placeholderTextColor={T.faint}
                 style={styles.input} accessibilityLabel={t('tix.host.goal')} testID="host-goal" />
    </View>
    {err('goal') ? <Text style={styles.bad}>{err('goal')}</Text>
      : wholeNumber(draft.goal) >= 1 ? <Text style={styles.hint}>{formatKes(wholeNumber(draft.goal))}</Text> : null}

    <DateTimeField label={t('tix.host.fundEnds')} value={draft.endsAt} display={when(draft.endsAt)}
                   onChange={(v) => update({ endsAt: v })} placeholder={t('tix.host.fundEndsPlaceholder')} clearable
                   clearLabel={t('tix.host.clear')} minimumDate={new Date()} doneLabel={t('tix.host.doneShort')}
                   error={err('endsAt')} testID="host-fund-ends" />

    <Text style={styles.label}>{t('tix.host.suggested')}</Text>
    <Text style={styles.hintTop}>{t('tix.host.suggestedHint')}</Text>
    <View style={styles.suggested}>
      {draft.suggested.map((v, i) => (
        <View key={i} style={styles.suggestedCell}>
          <TextInput value={v} keyboardType="number-pad" maxLength={6}
                     onChangeText={(x) => update({ suggested: draft.suggested.map((s, j) => (j === i ? x.replace(/[^\d]/g, '') : s)) })}
                     style={[styles.input, styles.suggestedInput, !!err(`suggested.${i}`) && styles.fieldBad]}
                     accessibilityLabel={`${t('tix.host.suggested')} ${i + 1}`} testID={`host-suggested-${i}`} />
        </View>
      ))}
    </View>
    {draft.suggested.some((_, i) => err(`suggested.${i}`)) && <Text style={styles.bad}>{t('tix.host.err.suggested')}</Text>}
  </View>
);

export const DocumentStep = ({ t, document, onPick, onRemove, err, busy, notice }) => (
  <View>
    <Text style={styles.heading} accessibilityRole="header">{t('tix.host.docTitle')}</Text>
    <Text style={styles.body}>{t('tix.host.docBody')}</Text>
    <TouchableOpacity onPress={onPick} disabled={busy} style={[styles.doc, !!err('document') && styles.fieldBad]}
                      accessibilityRole="button" testID="host-document">
      <Ionicons name={document ? 'document-text' : 'cloud-upload-outline'} size={26} color={T.champagne} />
      <View style={styles.flex}>
        <Text style={styles.docTitle} numberOfLines={1}>{document ? document.name : t('tix.host.docAdd')}</Text>
        <Text style={styles.docSub}>{document ? t('tix.host.docChange') : t('tix.host.docKinds')}</Text>
      </View>
    </TouchableOpacity>
    {!!document && (
      <TouchableOpacity onPress={onRemove} style={styles.remove} accessibilityRole="button">
        <Text style={styles.link}>{t('tix.host.docRemove')}</Text>
      </TouchableOpacity>
    )}
    {(err('document') || notice) ? <Text style={styles.bad}>{err('document') || notice}</Text> : null}
    <View style={styles.private}>
      <Ionicons name="lock-closed" size={15} color={T.faint} />
      <Text style={styles.privateText}>{t('tix.host.docPrivate')}</Text>
    </View>
  </View>
);

const Toggle = ({ title, sub, value, onChange, testID }) => (
  <View style={styles.toggle}>
    <View style={styles.flex}>
      <Text style={styles.toggleTitle}>{title}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: T.gold, false: T.raised }} thumbColor={T.ivory}
            accessibilityLabel={title} testID={testID} />
  </View>
);

/** Who sees what: the wizard's step, and the switches on an event's own page. */
export const VisibilityControls = ({ t, showSupporters, showTotal, onChange }) => (
  <View>
    <Toggle title={t('tix.vis.list')} sub={t('tix.vis.listSub')} value={showSupporters}
            onChange={(v) => { tap(); onChange({ showSupporters: v, showTotal }); }} testID="vis-supporters" />
    <Toggle title={t('tix.vis.total')} sub={t('tix.vis.totalSub')} value={showTotal}
            onChange={(v) => { tap(); onChange({ showSupporters, showTotal: v }); }} testID="vis-total" />
    <View style={styles.private}>
      <Ionicons name="shield-checkmark-outline" size={15} color={T.faint} />
      <Text style={styles.privateText}>{t('tix.vis.consent')}</Text>
    </View>
  </View>
);

export const VisibilityStep = ({ t, draft, update }) => (
  <View>
    <Text style={styles.heading} accessibilityRole="header">{t('tix.vis.title')}</Text>
    <Text style={styles.body}>{t('tix.vis.body')}</Text>
    <VisibilityControls t={t} showSupporters={draft.showSupporters} showTotal={draft.showTotal}
                        onChange={(v) => update(v)} />
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { fontFamily: F.display, fontSize: 30, lineHeight: 34, color: T.ivory, marginTop: 8 },
  body: { fontFamily: F.ui, fontSize: 14.5, lineHeight: 22, color: T.muted, marginTop: 8 },
  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  hint: { fontFamily: F.uiBold, fontSize: 13, color: T.champagne, marginTop: 8, marginLeft: 4 },
  hintTop: { fontFamily: F.ui, fontSize: 13, color: T.faint, marginTop: -2, marginBottom: 10, marginLeft: 4 },
  link: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne },

  type: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 14, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  typeOn: { borderColor: T.gold, backgroundColor: 'rgba(201,164,92,0.08)' },
  typeIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,212,170,0.10)' },
  typeIconOn: { backgroundColor: T.champagne },
  typeTitle: { fontFamily: F.display, fontSize: 22, color: T.ivory },
  typeSub: { fontFamily: F.ui, fontSize: 13, lineHeight: 19, color: T.muted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: T.lineStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: T.gold },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: T.gold },

  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18,
    borderWidth: 1, borderColor: T.lineStrong,
  },
  catOn: { backgroundColor: T.champagne, borderColor: T.champagne },
  catText: { fontFamily: F.uiBold, fontSize: 13, color: T.champagne },
  catTextOn: { color: T.paperInk },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: 16, paddingHorizontal: 16,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  fieldBad: { borderColor: T.danger },
  prefix: { fontFamily: F.uiBold, fontSize: 14, color: T.faint },
  input: { flex: 1, fontFamily: F.uiSemi, fontSize: 16, color: T.ivory, paddingVertical: 0 },
  suggested: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  suggestedCell: { width: '47%' },
  suggestedInput: {
    flex: 0, height: 50, borderRadius: 14, paddingHorizontal: 14,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },

  doc: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20, padding: 18, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  docTitle: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  docSub: { fontFamily: F.ui, fontSize: 12.5, color: T.muted, marginTop: 2 },
  remove: { alignSelf: 'flex-start', marginTop: 10, marginLeft: 4 },
  private: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, paddingHorizontal: 4 },
  privateText: { flex: 1, fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.faint },

  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14, padding: 16, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  toggleTitle: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  toggleSub: { fontFamily: F.ui, fontSize: 12.5, lineHeight: 18, color: T.muted, marginTop: 3 },
});
