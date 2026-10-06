// One event, for review: everything buyers will see, who is behind it, where
// the money goes, and Approve or Reject (with the reason the organiser will
// read). An event already on sale can be taken down the same way.
//
// Approving puts it on sale at once only if its organiser has published it
// and its till is active; otherwise it goes on sale by itself when the last
// of those happens (the ticketing server's events/review.py).
//
// Once approved, staff still hold it: Warn (the organiser reads it; it keeps
// selling), Pause sales (off sale until resumed; the organiser can't undo
// it), and Burn — remove for good, which asks for a fresh authenticator
// code and can't be undone here. Every one asks why, and is logged.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchAdminTicketEvent, adminTicketEventAction } from '../../services/api';
import { formatKes, formatWhen } from '../../services/tickets';
import { bannerRatio } from '../tickets/TicketKit';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState, useReasonSheet } from './AdminKit';
import { Badge, TILL_COLOR, STATE_COLOR, adminState, stateLabel } from './AdminTickets';

export default function AdminTicketEvent({ navigation, route }) {
  const { t } = useI18n();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const { id } = route.params;
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reasonSheet, askReason] = useReasonSheet();

  const load = useCallback(async () => {
    setError(null);
    try { setEvent(await fetchAdminTicketEvent(id)); } catch (e) { setError(e); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const when = (iso) => (iso ? formatWhen(iso, { months, weekdays }) : '');

  const approve = async () => {
    const ok = await confirmAction({
      title: t('adminTix.approveTitle'),
      message: event.till?.status === 'active' ? t('adminTix.approveLive') : t('adminTix.approveWaits'),
      confirmLabel: t('adminTix.approve'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    act('approve');
  };

  const reject = async () => {
    const selling = event.status === 'published';
    const note = await askReason({
      title: selling ? t('adminTix.takeDownTitle') : t('adminTix.rejectTitle'),
      message: t('adminTix.rejectMessage'),
      confirmLabel: selling ? t('adminTix.takeDown') : t('adminTix.reject'),
      destructive: true,
    });
    if (!note) return;
    act('reject', { note });
  };

  // Warn, pause, burn: each asks why, in words the organiser will read.
  const withNote = async (action, { title, message, confirmLabel, destructive }) => {
    const note = await askReason({ title, message, confirmLabel, destructive });
    if (note) act(action, { note });
  };
  const warn = () => withNote('warn', {
    title: t('adminTix.warnTitle'), message: t('adminTix.warnMessage'), confirmLabel: t('adminTix.warn'),
  });
  const pause = () => withNote('pause', {
    title: t('adminTix.pauseTitle'), message: t('adminTix.pauseMessage'), confirmLabel: t('adminTix.pause'), destructive: true,
  });
  const burn = () => withNote('remove', {
    title: t('adminTix.removeTitle'), message: t('adminTix.removeMessage'), confirmLabel: t('adminTix.remove'), destructive: true,
  });
  const resume = async () => {
    const ok = await confirmAction({
      title: t('adminTix.resumeTitle'), message: t('adminTix.resumeMessage'),
      confirmLabel: t('adminTix.resume'), cancelLabel: t('common.cancel'),
    });
    if (ok) act('resume');
  };

  const act = async (action, body) => {
    setBusy(true);
    try {
      setEvent(await adminTicketEventAction(id, action, body));
    } catch (e) {
      notify(t('adminTix.actionFailed'), e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!event) {
    return (
      <View style={styles.centre}>
        {error ? <ErrorState message={error.message} onRetry={load} /> : <ActivityIndicator color={ADMIN.gold} />}
      </View>
    );
  }

  const selling = event.status === 'published';
  const decided = event.review_status === 'approved' || event.review_status === 'rejected';
  const removed = !!event.removed_at;
  const paused = !!event.paused_by_staff;
  // Pausing means something once it is (or could go) on sale.
  const pausable = !paused && (selling || event.review_status === 'approved');

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {!!event.poster && (
          // At its own shape: a landscape flyer whole, as staff must judge it.
          <Image source={{ uri: event.poster }} style={[styles.poster, { aspectRatio: bannerRatio(event) }]} contentFit="cover" />
        )}
        {event.kind === 'fundraiser' && (
          <Text style={styles.kind}>
            {[t('tix.kind.fundraiser'), event.category ? t(`tix.cat.${event.category}`) : ''].filter(Boolean).join(' · ')}
          </Text>
        )}
        <Text style={styles.title}>{event.title}</Text>
        <View style={styles.badges}>
          <Badge color={STATE_COLOR[adminState(event)] || ADMIN.muted} label={stateLabel(t, event)} />
          {!removed && <Badge color={selling ? ADMIN.ok : ADMIN.muted} label={t(`adminTix.status.${event.status}`)} />}
          {event.publish_requested && !selling && !removed && <Badge color={ADMIN.gold} label={t('adminTix.wantsToSell')} />}
        </View>

        {event.review_status === 'unsubmitted' && !removed && (
          <Text style={styles.info}>{t('adminTix.notSent')}</Text>
        )}
        {removed && <Note label={t('adminTix.removedNote')} text={event.removed_note} danger />}
        {paused && <Note label={t('adminTix.pausedNote')} text={event.pause_note} />}
        {!!event.warning_note && !removed && <Note label={t('adminTix.warningNote')} text={event.warning_note} />}

        {!!event.review_note && (
          <View style={styles.note}>
            <Text style={styles.noteLabel}>{t('adminTix.lastNote', { who: event.reviewed_by || '' })}</Text>
            <Text style={styles.noteText}>{event.review_note}</Text>
          </View>
        )}

        <Section label={t('adminTix.organiser')}>
          <Line>{event.organiser?.display_name || '—'}</Line>
          <Line muted>{event.organiser?.email}{event.organiser?.phone ? ` · ${event.organiser.phone}` : ''}</Line>
        </Section>
        <Section label={t('adminTix.whenWhere')}>
          <Line>{when(event.starts_at)}{event.ends_at ? `  →  ${when(event.ends_at)}` : ''}</Line>
          <Line muted>{[event.venue, event.city].filter(Boolean).join(', ')}</Line>
          {!!event.sales_end_at && <Line muted>{t('tix.salesEnd', { when: when(event.sales_end_at) })}</Line>}
        </Section>
        <Section label={t('adminTix.description')}>
          <Line>{event.description || t('adminTix.noDescription')}</Line>
        </Section>
        {event.kind === 'fundraiser' && (
          <Section label={t('adminTix.fundraiser')}>
            <Line>{event.goal_amount ? t('tix.host.goalOf', { goal: formatKes(event.goal_amount) }) : t('tix.host.noGoal')}</Line>
            <Line muted>{t('adminTix.collected', { amount: formatKes(event.collected || 0) })}</Line>
            {/* Proof for review: opened from the ticketing server by a link that lasts ten minutes. */}
            {event.document_url ? (
              <TouchableOpacity style={styles.docBtn} onPress={() => Linking.openURL(event.document_url).catch(() => {})}
                                testID="admin-tix-document">
                <Text style={styles.docText}>{t('adminTix.openDocument')}</Text>
              </TouchableOpacity>
            ) : <Line muted>{t('adminTix.noDocument')}</Line>}
          </Section>
        )}
        {event.kind !== 'fundraiser' && (
        <Section label={t('adminTix.tickets')}>
          {(event.ticket_types || []).map((tt) => (
            <View key={tt.id} style={styles.level}>
              <Text style={styles.levelName}>{tt.name}</Text>
              <Text style={styles.levelMeta}>{formatKes(tt.price)} · {tt.sold}/{tt.quantity}</Text>
            </View>
          ))}
          {!event.ticket_types?.length && <Line muted>{t('adminTix.noTickets')}</Line>}
          {event.collected > 0 && <Line muted>{t('adminTix.collected', { amount: formatKes(event.collected) })}</Line>}
        </Section>
        )}
        <Section label={t('tix.vis.title')}>
          <Line>{event.show_supporters ? t('tix.vis.listOn') : t('tix.vis.listOff')}</Line>
          <Line>{event.show_total ? t('tix.vis.totalOn') : t('tix.vis.totalOff')}</Line>
        </Section>
        <Section label={t('adminTix.payout')}>
          <View style={styles.tillRow}>
            <View style={{ flex: 1 }}>
              <Line>{event.till?.business_name}</Line>
              <Line muted>{t('adminTix.tillNo', { n: event.till?.till_number })}</Line>
            </View>
            <Badge color={TILL_COLOR[event.till?.status] || ADMIN.muted} label={t(`adminTix.till.${event.till?.status}`)} />
          </View>
          {event.till?.status !== 'active' && (
            <TouchableOpacity onPress={() => navigation.navigate('AdminTicketTill', { id: event.till.id })}
                              testID="admin-tix-open-till">
              <Text style={styles.link}>{t('adminTix.openTill')}</Text>
            </TouchableOpacity>
          )}
        </Section>

        {/* What staff can still do with it, once it is past review. */}
        {!removed && (
          <Section label={t('adminTix.manage')}>
            <ManageRow icon="!" label={t('adminTix.warn')} sub={t('adminTix.warnSub')} onPress={warn} disabled={busy}
                       testID="admin-tix-warn" />
            {paused ? (
              <ManageRow icon="▶" label={t('adminTix.resume')} sub={t('adminTix.resumeSub')} onPress={resume} disabled={busy}
                         testID="admin-tix-resume" />
            ) : pausable ? (
              <ManageRow icon="Ⅱ" label={t('adminTix.pause')} sub={t('adminTix.pauseSub')} onPress={pause} disabled={busy}
                         testID="admin-tix-pause" />
            ) : null}
            <ManageRow icon="✕" label={t('adminTix.remove')} sub={t('adminTix.removeSub')} onPress={burn} disabled={busy}
                       danger testID="admin-tix-remove" />
          </Section>
        )}
      </ScrollView>

      {!removed && (
      <View style={styles.bar}>
        {(!decided || event.review_status === 'rejected') && (
          <TouchableOpacity style={[styles.btn, styles.approve, busy && styles.off]} onPress={approve} disabled={busy}
                            testID="admin-tix-approve">
            <Text style={styles.approveText}>{t('adminTix.approve')}</Text>
          </TouchableOpacity>
        )}
        {event.review_status !== 'rejected' && (
          <TouchableOpacity style={[styles.btn, styles.reject, busy && styles.off]} onPress={reject} disabled={busy}
                            testID="admin-tix-reject">
            <Text style={styles.rejectText}>{selling ? t('adminTix.takeDown') : t('adminTix.reject')}</Text>
          </TouchableOpacity>
        )}
      </View>
      )}
      {reasonSheet}
    </>
  );
}

const Note = ({ label, text, danger }) => (
  <View style={[styles.note, !danger && styles.noteQuiet]}>
    <Text style={[styles.noteLabel, !danger && styles.noteLabelQuiet]}>{label}</Text>
    <Text style={styles.noteText}>{text}</Text>
  </View>
);

const ManageRow = ({ icon, label, sub, onPress, disabled, danger, testID }) => (
  <TouchableOpacity style={[styles.manageRow, disabled && styles.off]} onPress={onPress} disabled={disabled} testID={testID}>
    <View style={[styles.manageIcon, danger && styles.manageIconDanger]}>
      <Text style={[styles.manageIconText, danger && styles.manageTextDanger]}>{icon}</Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={[styles.manageLabel, danger && styles.manageTextDanger]}>{label}</Text>
      <Text style={styles.manageSub}>{sub}</Text>
    </View>
  </TouchableOpacity>
);

const Section = ({ label, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionLabel}>{label}</Text>
    {children}
  </View>
);

const Line = ({ children, muted }) => <Text style={[styles.line, muted && styles.lineMuted]}>{children}</Text>;

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 32, width: '100%', maxWidth: 760, alignSelf: 'center' },
  poster: { width: '100%', maxHeight: 420, borderRadius: 16, marginBottom: 14 },
  title: { color: ADMIN.text, fontSize: 22, fontWeight: '800' },
  kind: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  docBtn: {
    marginTop: 12, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ADMIN.gold,
  },
  docText: { color: ADMIN.gold, fontWeight: '800', fontSize: 14 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  note: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,122,107,0.10)', borderWidth: 1, borderColor: 'rgba(255,122,107,0.35)' },
  noteLabel: { color: ADMIN.muted, fontSize: 11.5, fontWeight: '700' },
  noteText: { color: ADMIN.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
  noteQuiet: { backgroundColor: 'rgba(255,196,107,0.10)', borderColor: 'rgba(255,196,107,0.35)' },
  noteLabelQuiet: { color: ADMIN.gold },
  info: { color: ADMIN.muted, fontSize: 13.5, lineHeight: 20, marginTop: 12 },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  manageIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ADMIN.gold,
  },
  manageIconDanger: { borderColor: ADMIN.danger },
  manageIconText: { color: ADMIN.gold, fontWeight: '800', fontSize: 14 },
  manageTextDanger: { color: ADMIN.danger },
  manageLabel: { color: ADMIN.text, fontSize: 15, fontWeight: '700' },
  manageSub: { color: ADMIN.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  section: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: ADMIN.card, borderWidth: 1, borderColor: ADMIN.border },
  sectionLabel: { color: ADMIN.gold, fontSize: 11.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  line: { color: ADMIN.text, fontSize: 14.5, lineHeight: 21 },
  lineMuted: { color: ADMIN.muted, fontSize: 13 },
  level: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  levelName: { color: ADMIN.text, fontSize: 14.5, fontWeight: '600' },
  levelMeta: { color: ADMIN.muted, fontSize: 13.5 },
  tillRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: ADMIN.gold, fontWeight: '700', fontSize: 13.5, marginTop: 10 },
  bar: {
    flexDirection: 'row', gap: 10, padding: 14, paddingBottom: 18, borderTopWidth: 1, borderTopColor: ADMIN.border,
    backgroundColor: 'rgba(10,22,40,0.96)',
  },
  btn: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  approve: { backgroundColor: ADMIN.ok },
  approveText: { color: '#06281A', fontWeight: '800', fontSize: 15 },
  reject: { borderWidth: 1, borderColor: ADMIN.danger, backgroundColor: 'rgba(255,122,107,0.08)' },
  rejectText: { color: ADMIN.danger, fontWeight: '800', fontSize: 15 },
  off: { opacity: 0.5 },
});
