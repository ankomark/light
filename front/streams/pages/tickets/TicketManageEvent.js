/**
 * One event, run by its organiser.
 *
 * At the top, where it stands and the one thing to do about it (pages/
 * tickets/eventState.js): send it for review, put it on sale once approved,
 * stop sales, or fix what Skylink rejected. Then how it is selling — money
 * in, tickets sold and left, checked in, failed payments, per level and per
 * day — the ticket levels (add, change, remove while unsold), who paid, the
 * link to share, the details to edit, and cancelling.
 *
 * What a level allows comes from the server's rules: its price is fixed once
 * anyone has bought it, and its quantity can't drop below what is sold.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../context/I18nContext';
import {
  fetchMyEvent, fetchEventSummary, publishEvent, unpublishEvent, cancelEvent, updateVisibility, uploadEventFiles,
  addTicketType, updateTicketType, deleteTicketType,
} from '../../services/ticketsOrganiser';
import { formatKes, formatWhen } from '../../services/tickets';
import { confirmAction } from '../../utils/adminConfirm';
import { T, F, tap, Kicker, Pill, Notice, GoldButton, GhostButton } from '../../components/tickets/TicketKit';
import { eventState, isOver, staffNote } from './eventState';
import { VisibilityControls, pickDocument } from './HostSteps';
import { Progress } from '../../components/tickets/Supporters';
import { wholeNumber, NAME_MAX, MAX_LEVELS } from './eventDraft';
import { ticketErrorText } from './ticketText';

const DAYS_SHOWN = 14;

const TicketManageEvent = ({ navigation, route }) => {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { id } = route.params;

  const [event, setEvent] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const [pulling, setPulling] = useState(false);

  const signedOut = useCallback(() => navigation.replace('TicketHost', { next: 'TicketMyEvents' }), [navigation]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [e, s] = await Promise.all([fetchMyEvent(id), fetchEventSummary(id).catch(() => null)]);
      setEvent(e);
      setSummary(s);
    } catch (err) {
      if (err?.code === 'signed_out') signedOut();
      else setError(err);
    }
  }, [id, signedOut]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pull = async () => {
    setPulling(true);
    try { await load(); } finally { setPulling(false); }
  };

  // One action at a time; the event as the server returns it replaces ours.
  const act = async (name, fn) => {
    setBusy(name);
    setActionError('');
    try {
      const next = await fn();
      if (next?.id) setEvent(next);
      fetchEventSummary(id).then(setSummary).catch(() => {});
      return true;
    } catch (err) {
      if (err?.code === 'signed_out') { signedOut(); return false; }
      setActionError(ticketErrorText(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publish = () => { tap(); act('publish', () => publishEvent(id)); };

  const stopSales = async () => {
    const ok = await confirmAction({
      title: t('tix.mine.stopTitle'), message: t('tix.mine.stopBody'),
      confirmLabel: t('tix.mine.stop'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (ok) act('unpublish', () => unpublishEvent(id));
  };

  const cancel = async () => {
    const ok = await confirmAction({
      title: t('tix.mine.cancelTitle'), message: t('tix.mine.cancelBody'),
      confirmLabel: t('tix.mine.cancelEvent'), cancelLabel: t('tix.mine.keep'), destructive: true,
    });
    if (ok) act('cancel', () => cancelEvent(id));
  };

  const replaceDocument = async () => {
    tap();
    try {
      const doc = await pickDocument();
      if (doc === 'too_big') { setActionError(t('tix.host.docTooBig')); return; }
      if (doc) act('document', () => uploadEventFiles(id, { document: doc }));
    } catch {
      setActionError(t('tix.host.docFailed'));
    }
  };

  const share = () => {
    tap();
    const link = /^https?:/.test(event.share_url || '') ? event.share_url : `streams://events/${event.slug}`;
    Share.share({ message: `${event.title}\n${formatWhen(event.starts_at, { months, weekdays })} · ${event.venue}\n${link}` })
      .catch(() => {});
  };

  // ── Ticket levels ─────────────────────────────────────────────────────
  const [editing, setEditing] = useState(null);     // a level id, or 'new'
  const [form, setForm] = useState({ name: '', price: '', quantity: '' });
  const [formError, setFormError] = useState('');
  const openLevel = (tt) => {
    tap();
    setFormError('');
    setEditing(tt ? tt.id : 'new');
    setForm(tt ? { name: tt.name, price: String(tt.price), quantity: String(tt.quantity) } : { name: '', price: '', quantity: '' });
  };
  const saveLevel = async () => {
    const tt = event.ticket_types.find((x) => x.id === editing);
    const price = wholeNumber(form.price);
    const quantity = wholeNumber(form.quantity);
    if (!form.name.trim()) { setFormError(t('tix.host.err.levelName')); return; }
    if (!(price >= 1)) { setFormError(t('tix.host.err.price')); return; }
    if (!(quantity >= 1)) { setFormError(t('tix.host.err.quantity')); return; }
    if (tt && quantity < tt.sold) { setFormError(t('tix.mine.belowSold', { n: tt.sold })); return; }
    setFormError('');
    const done = await act('level', async () => {
      if (tt) {
        const patch = { name: form.name.trim(), quantity };
        if (!tt.sold) patch.price = price;
        await updateTicketType(id, tt.id, patch);
      } else {
        await addTicketType(id, { name: form.name, price, quantity, position: event.ticket_types.length });
      }
      return fetchMyEvent(id);
    });
    if (done) setEditing(null);
  };
  const removeLevel = async (tt) => {
    const ok = await confirmAction({
      title: t('tix.mine.removeLevelTitle', { name: tt.name }), message: '',
      confirmLabel: t('tix.host.removeLevel'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    const done = await act('level', async () => { await deleteTicketType(id, tt.id); return fetchMyEvent(id); });
    if (done) setEditing(null);
  };

  if (!event) {
    return (
      <View style={[styles.root, styles.centre]}>
        {error ? <Notice title={ticketErrorText(error, t)} action={t('common.retry')} onAction={load} />
          : <ActivityIndicator color={T.gold} size="large" />}
      </View>
    );
  }

  const state = eventState(event);
  const over = isOver(event);
  const closed = event.status === 'cancelled' || over;
  const fund = event.kind === 'fundraiser';
  const levels = event.ticket_types || [];
  const days = (summary?.by_day || []).slice(-DAYS_SHOWN);
  const dayMax = Math.max(1, ...days.map((d) => d.collected || 0));
  const capacity = (summary?.tickets_sold || 0) + (summary?.tickets_available || 0);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={T.gold} colors={[T.gold]} />}
      >
        <View style={styles.head}>
          {event.poster ? <Image source={{ uri: event.poster }} style={styles.poster} contentFit="cover" cachePolicy="memory-disk" /> : null}
          <View style={styles.flex}>
            <Text style={styles.when}>{formatWhen(event.starts_at, { months, weekdays })}</Text>
            <Text style={styles.title} accessibilityRole="header">{event.title}</Text>
            <Text style={styles.venue} numberOfLines={1}>{[event.venue, event.city].filter(Boolean).join(', ')}</Text>
          </View>
        </View>

        {/* Where it stands, and the one thing to do. */}
        <View style={[styles.state, styles[`state_${state.tone}`]]} testID="mine-state">
          <Pill kind={state.tone} label={t(`tix.mine.state.${state.key}`)} />
          <Text style={styles.stateBody}>{t(`tix.mine.state.${state.key}Body`)}</Text>
          {!!staffNote(event, state.key) && (
            <View style={styles.noteBox}>
              <Text style={styles.noteLabel}>{t('tix.mine.reviewNote')}</Text>
              <Text style={styles.noteText}>{staffNote(event, state.key)}</Text>
            </View>
          )}
          {!!event.warning_note && !event.removed_at && (
            <View style={[styles.noteBox, styles.warnBox]} testID="mine-warning">
              <Text style={[styles.noteLabel, styles.warnLabel]}>{t('tix.mine.warning')}</Text>
              <Text style={styles.noteText}>{event.warning_note}</Text>
            </View>
          )}
          {!!actionError && <Text style={styles.error} accessibilityLiveRegion="polite">{actionError}</Text>}
          {state.action === 'publish' && (
            <GoldButton label={state.key === 'approved' ? t('tix.mine.putOnSale') : t('tix.mine.sendForReview')}
                        onPress={publish} busy={busy === 'publish'} style={styles.stateBtn} testID="mine-publish" />
          )}
          {state.action === 'edit' && (
            <View style={styles.row}>
              <GhostButton label={t('tix.mine.fix')} style={styles.flex}
                           onPress={() => navigation.push('TicketEditEvent', { id })} testID="mine-fix" />
              <GoldButton label={t('tix.mine.resend')} onPress={publish} busy={busy === 'publish'}
                          style={styles.flex} testID="mine-resend" />
            </View>
          )}
          {state.action === 'unpublish' && (
            <GhostButton label={t('tix.mine.stop')} onPress={stopSales} style={styles.stateBtn} testID="mine-stop" />
          )}
        </View>

        {/* How it is selling. */}
        {!!summary && (
          <>
            <Kicker style={styles.kicker}>{fund ? t('tix.mine.giving') : t('tix.mine.sales')}</Kicker>
            {fund ? (
              <>
                {/* The organiser always sees it, whatever the public is shown. */}
                <Progress raised={summary.collected} goal={event.goal_amount} supporters={summary.orders || 0} />
                <View style={[styles.tiles, styles.tilesGap]}>
                  <Tile value={String(summary.orders || 0)} label={t('tix.mine.supporters')} />
                  <Tile value={String(summary.failed_attempts)} label={t('tix.mine.failed')} muted />
                </View>
              </>
            ) : (
              <>
                <View style={styles.tiles}>
                  <Tile value={formatKes(summary.collected)} label={t('tix.mine.collected')} wide />
                  <Tile value={`${summary.tickets_sold}/${capacity}`} label={t('tix.mine.ticketsSold')} />
                </View>
                <View style={styles.tiles}>
                  <Tile value={String(summary.checked_in)} label={t('tix.mine.checkedIn')} />
                  <Tile value={String(summary.orders || 0)} label={t('tix.mine.orders')} />
                  <Tile value={String(summary.failed_attempts)} label={t('tix.mine.failed')} muted />
                </View>
              </>
            )}
            {days.length > 0 && (
              <View style={styles.chart} accessible accessibilityLabel={t('tix.mine.byDay')}>
                <Text style={styles.chartLabel}>{t('tix.mine.byDay')}</Text>
                <View style={styles.bars}>
                  {days.map((d) => (
                    <View key={d.date} style={styles.barCol}>
                      <View style={[styles.bar, { height: Math.max(3, ((d.collected || 0) / dayMax) * 64) }]} />
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* Who sees the supporters and the total: the organiser's switches. */}
        {!event.removed_at && (
          <>
            <Kicker style={styles.kicker}>{t('tix.vis.title')}</Kicker>
            <VisibilityControls t={t} showSupporters={!!event.show_supporters} showTotal={!!event.show_total}
                                onChange={(v) => act('visibility', () => updateVisibility(id, v))} />
          </>
        )}

        {/* A fundraiser's proof for review. */}
        {fund && !closed && (
          <>
            <Kicker style={styles.kicker}>{t('tix.host.step.document')}</Kicker>
            <TouchableOpacity onPress={replaceDocument} style={styles.doc} disabled={busy === 'document'}
                              accessibilityRole="button" testID="mine-document">
              <Ionicons name={event.has_document ? 'document-text' : 'cloud-upload-outline'} size={22} color={T.champagne} />
              <View style={styles.flex}>
                <Text style={styles.levelName}>{event.has_document ? t('tix.mine.docOn') : t('tix.host.docAdd')}</Text>
                <Text style={styles.levelMeta}>{event.has_document ? t('tix.mine.docReplace') : t('tix.host.docKinds')}</Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* Ticket levels: an event's, not a fundraiser's. */}
        {!fund && <Kicker style={styles.kicker}>{t('tix.host.ticketsTitle')}</Kicker>}
        {!fund && levels.map((tt) => (
          <View key={tt.id} style={styles.level}>
            <TouchableOpacity style={styles.levelHead} onPress={() => (editing === tt.id ? setEditing(null) : openLevel(tt))}
                              disabled={closed} accessibilityRole="button" testID={`mine-level-${tt.id}`}>
              <View style={styles.flex}>
                <Text style={styles.levelName}>{tt.name}</Text>
                <Text style={styles.levelMeta}>{formatKes(tt.price)}  ·  {t('tix.mine.sold', { sold: tt.sold, total: tt.quantity })}</Text>
              </View>
              {!closed && <Ionicons name={editing === tt.id ? 'chevron-up' : 'create-outline'} size={18} color={T.champagne} />}
            </TouchableOpacity>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, (tt.sold / Math.max(1, tt.quantity)) * 100)}%` }]} /></View>
            {editing === tt.id && (
              <LevelForm t={t} form={form} setForm={setForm} error={formError} priceLocked={tt.sold > 0}
                         onSave={saveLevel} busy={busy === 'level'}
                         onRemove={tt.sold === 0 && levels.length > 1 ? () => removeLevel(tt) : null} />
            )}
          </View>
        ))}
        {!fund && !closed && levels.length < MAX_LEVELS && (editing === 'new' ? (
          <View style={styles.level}>
            <LevelForm t={t} form={form} setForm={setForm} error={formError} onSave={saveLevel} busy={busy === 'level'}
                       onCancel={() => setEditing(null)} />
          </View>
        ) : (
          <TouchableOpacity onPress={() => openLevel(null)} style={styles.add} accessibilityRole="button" testID="mine-add-level">
            <Ionicons name="add-circle-outline" size={20} color={T.champagne} />
            <Text style={styles.addText}>{t('tix.host.addLevel')}</Text>
          </TouchableOpacity>
        ))}

        {/* Everything else. */}
        <View style={styles.links}>
          <LinkRow icon="people-outline" label={fund ? t('tix.mine.supporters') : t('tix.mine.buyers')}
                   sub={t('tix.mine.buyersSub', { n: summary?.orders || 0 })}
                   onPress={() => navigation.push('TicketBuyers', { id, title: event.title })} testID="mine-buyers" />
          {!fund && !event.removed_at && event.status !== 'cancelled' && (
            <LinkRow icon="scan-outline" label={t('tix.gate.open')} sub={t('tix.gate.openSub')}
                     onPress={() => navigation.push('TicketScanner', { id, title: event.title })} testID="mine-scan" />
          )}
          {event.status === 'published' && (
            <LinkRow icon="share-social-outline" label={t('tix.host.share')} sub={t('tix.mine.shareSub')} onPress={share} testID="mine-share" />
          )}
          {!closed && (
            <LinkRow icon="create-outline" label={t('tix.mine.editDetails')} sub={t('tix.mine.editDetailsSub')}
                     onPress={() => navigation.push('TicketEditEvent', { id })} testID="mine-edit" />
          )}
        </View>

        {!closed && (
          <TouchableOpacity onPress={cancel} style={styles.cancel} disabled={!!busy} accessibilityRole="button" testID="mine-cancel">
            <Text style={styles.cancelText}>{t('tix.mine.cancelEvent')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const LevelForm = ({ t, form, setForm, error, priceLocked, onSave, onRemove, onCancel, busy }) => (
  <View style={styles.form}>
    <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
               placeholder={t('tix.host.levelNamePlaceholder')} placeholderTextColor={T.faint} maxLength={NAME_MAX}
               accessibilityLabel={t('tix.host.levelName')} testID="mine-level-name" />
    <View style={styles.row}>
      <TextInput style={[styles.input, styles.flex, priceLocked && styles.locked]} value={form.price} editable={!priceLocked}
                 onChangeText={(v) => setForm((f) => ({ ...f, price: v.replace(/[^\d]/g, '') }))}
                 placeholder={t('tix.host.price')} placeholderTextColor={T.faint} keyboardType="number-pad" maxLength={9}
                 accessibilityLabel={t('tix.host.price')} testID="mine-level-price" />
      <TextInput style={[styles.input, styles.flex]} value={form.quantity}
                 onChangeText={(v) => setForm((f) => ({ ...f, quantity: v.replace(/[^\d]/g, '') }))}
                 placeholder={t('tix.host.quantity')} placeholderTextColor={T.faint} keyboardType="number-pad" maxLength={7}
                 accessibilityLabel={t('tix.host.quantity')} testID="mine-level-quantity" />
    </View>
    {priceLocked && <Text style={styles.hint}>{t('tix.mine.priceLocked')}</Text>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    <View style={styles.row}>
      {onRemove && <GhostButton label={t('tix.host.removeLevel')} onPress={onRemove} style={styles.flex} />}
      {onCancel && <GhostButton label={t('common.cancel')} onPress={onCancel} style={styles.flex} />}
      <GoldButton label={t('tix.mine.saveLevel')} onPress={onSave} busy={busy} style={styles.flex} testID="mine-level-save" />
    </View>
  </View>
);

const Tile = ({ value, label, wide, muted }) => (
  <View style={[styles.tile, wide && styles.tileWide]}>
    <Text style={[styles.tileValue, muted && styles.tileMuted]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
  </View>
);

const LinkRow = ({ icon, label, sub, onPress, testID }) => (
  <TouchableOpacity onPress={() => { tap(); onPress(); }} style={styles.link} accessibilityRole="button" testID={testID}>
    <View style={styles.linkIcon}><Ionicons name={icon} size={19} color={T.champagne} /></View>
    <View style={styles.flex}>
      <Text style={styles.linkLabel}>{label}</Text>
      <Text style={styles.linkSub}>{sub}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={T.faint} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  scroll: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },

  head: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  poster: { width: 76, height: 95, borderRadius: 14 },
  when: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: T.gold },
  title: { fontFamily: F.display, fontSize: 28, lineHeight: 31, color: T.ivory, marginTop: 4 },
  venue: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 4 },

  state: { marginTop: 18, padding: 16, borderRadius: 20, borderWidth: 1, backgroundColor: T.surface },
  state_paid: { borderColor: 'rgba(134,211,174,0.35)' },
  state_pending: { borderColor: T.lineStrong },
  state_failed: { borderColor: 'rgba(240,144,127,0.45)' },
  state_closed: { borderColor: T.line },
  stateBody: { fontFamily: F.ui, fontSize: 14, lineHeight: 21, color: T.ivory, marginTop: 10 },
  stateBtn: { marginTop: 14 },
  noteBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(240,144,127,0.10)' },
  noteLabel: { fontFamily: F.uiBold, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: T.danger },
  noteText: { fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory, marginTop: 4 },
  warnBox: { backgroundColor: 'rgba(232,212,170,0.10)' },
  warnLabel: { color: T.champagne },
  error: { fontFamily: F.uiSemi, fontSize: 13.5, lineHeight: 19, color: T.danger, marginTop: 10 },

  kicker: { marginTop: 26, marginBottom: 12, marginLeft: 4 },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  tilesGap: { marginTop: 10 },
  doc: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  tile: { flex: 1, padding: 14, borderRadius: 18, backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line },
  tileWide: { flex: 1.6 },
  tileValue: { fontFamily: F.display, fontSize: 24, color: T.ivory },
  tileMuted: { color: T.muted },
  tileLabel: { fontFamily: F.uiBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: T.faint, marginTop: 2 },
  chart: { padding: 14, borderRadius: 18, backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line },
  chartLabel: { fontFamily: F.uiBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: T.faint },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 70, marginTop: 10 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: 3, backgroundColor: T.gold },

  level: {
    marginBottom: 10, padding: 14, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelName: { fontFamily: F.uiBold, fontSize: 15.5, color: T.ivory },
  levelMeta: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.muted, marginTop: 3 },
  track: { height: 4, borderRadius: 2, backgroundColor: T.line, overflow: 'hidden', marginTop: 10 },
  fill: { height: 4, backgroundColor: T.gold },
  form: { marginTop: 12 },
  input: {
    minHeight: 50, borderRadius: 14, paddingHorizontal: 14, marginTop: 10,
    fontFamily: F.uiSemi, fontSize: 15.5, color: T.ivory, backgroundColor: T.raised, borderWidth: 1, borderColor: T.line,
  },
  locked: { opacity: 0.5 },
  hint: { fontFamily: F.ui, fontSize: 12.5, color: T.faint, marginTop: 8 },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  addText: { fontFamily: F.uiBold, fontSize: 14.5, color: T.champagne },

  links: { marginTop: 26, borderRadius: 20, overflow: 'hidden', backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.line },
  linkIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,212,170,0.08)' },
  linkLabel: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  linkSub: { fontFamily: F.ui, fontSize: 12.5, color: T.muted, marginTop: 2 },

  cancel: { alignSelf: 'center', marginTop: 28, paddingVertical: 10, paddingHorizontal: 16 },
  cancelText: { fontFamily: F.uiBold, fontSize: 14, color: T.danger },
});

export default TicketManageEvent;
