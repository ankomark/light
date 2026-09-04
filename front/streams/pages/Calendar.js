/**
 * A calendar that knows what Sabbath it is, and remembers what you asked it to.
 *
 * Six ways to look at the same entries — year, month, week, day, schedule and
 * reminders — because "what is this month like" and "what is next" are
 * different questions and a month grid only answers the first.
 *
 * Sabbath: Fridays and Saturdays are marked, and selecting one shows its
 * sunset times. Those are computed, not fetched (utils/sabbath.js), so they
 * work for any month and with no signal. They use the place already chosen for
 * the weather; without one the days are still marked but no time is claimed.
 *
 * Entries and reminders live on the device (utils/calendarStore.js). A
 * reminder is a note to yourself, so it fires from the phone rather than from
 * the server — on time, with or without signal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Modal, Switch, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek,
  format as fmt, isSameDay, isSameMonth, isToday, setMonth as setMonthOf,
  setYear, startOfMonth, startOfWeek,
} from 'date-fns';
import { useI18n } from '../context/I18nContext';
import { getPreference, PREF_KEYS } from '../utils/preferences';
import { sabbathTimes, formatMinutes, isFriday, isSabbath } from '../utils/sabbath';
import {
  loadEntries, saveEntries, makeEntry, flatten,
  scheduleReminder, cancelReminder,
} from '../utils/calendarStore';

// The same black ground as the weather screen, so the two tools read as one
// set rather than two apps. Gold stays the accent here: a calendar's job is
// legibility, and gold on black is the strongest pairing the app owns.
const INK = '#000000';
const INK_DEEP = '#000000';
const SLATE = '#0A0F18';
const GOLD = '#C9A227';
const GOLD_SOFT = '#E3C46A';
const PARCHMENT = '#ECE7DE';
const MUTED = '#7C8CA5';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';

const KEY = (d) => fmt(d, 'yyyy-MM-dd');
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const VIEWS = ['year', 'month', 'week', 'day', 'schedule', 'reminders'];

const Calendar = ({ navigation }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();

  const [view, setView] = useState('month');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());
  const [entries, setEntries] = useState({});
  const [place, setPlace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The composer for a new entry.
  const [draft, setDraft] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [draftRemind, setDraftRemind] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, saved] = await Promise.all([
        loadEntries(),
        getPreference(PREF_KEYS.weatherPlace),
      ]);
      if (!alive) return;
      setEntries(rows);
      if (saved && saved.latitude != null) setPlace(saved);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const persist = useCallback(async (next) => {
    setEntries(next);
    if (!(await saveEntries(next))) {
      Alert.alert(t('calendar.saveFailedTitle'), t('calendar.saveFailedBody'));
    }
  }, [t]);

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  }), [month]);

  const weekDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(selected), end: endOfWeek(selected),
  }), [selected]);

  const sabbath = useMemo(() => sabbathTimes(selected, place), [selected, place]);
  const dayEntries = entries[KEY(selected)] || [];

  const upcoming = useMemo(
    () => flatten(entries, { from: KEY(new Date()), onlyReminders: view === 'reminders' }),
    [entries, view],
  );

  // ── entries ──────────────────────────────────────────────────────────────
  const addEntry = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const time = /^\d{1,2}:\d{2}$/.test(draftTime.trim()) ? pad(draftTime.trim()) : null;
    const entry = makeEntry(text, time, draftRemind);
    const key = KEY(selected);

    if (entry.remind) {
      entry.notificationId = await scheduleReminder(key, entry);
      // The switch stays honest: if the reminder could not be booked — no
      // permission, or a time already gone — it is not shown as set.
      if (!entry.notificationId) entry.remind = false;
    }

    await persist({ ...entries, [key]: [...(entries[key] || []), entry] });
    setDraft(''); setDraftTime(''); setDraftRemind(false);
  }, [draft, draftTime, draftRemind, entries, persist, selected]);

  const removeEntry = useCallback(async (dateKey, id) => {
    const list = entries[dateKey] || [];
    const gone = list.find((e) => e.id === id);
    await cancelReminder(gone?.notificationId);
    const rest = list.filter((e) => e.id !== id);
    const next = { ...entries };
    if (rest.length) next[dateKey] = rest; else delete next[dateKey];
    await persist(next);
  }, [entries, persist]);

  const toggleReminder = useCallback(async (dateKey, id) => {
    const list = entries[dateKey] || [];
    const next = await Promise.all(list.map(async (e) => {
      if (e.id !== id) return e;
      if (e.remind) {
        await cancelReminder(e.notificationId);
        return { ...e, remind: false, notificationId: null };
      }
      const notificationId = await scheduleReminder(dateKey, e);
      return { ...e, remind: !!notificationId, notificationId };
    }));
    await persist({ ...entries, [dateKey]: next });
  }, [entries, persist]);

  const goto = useCallback((date) => {
    setSelected(date);
    setMonth(startOfMonth(date));
  }, []);

  if (loading) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={[SLATE, INK, INK_DEEP]} style={StyleSheet.absoluteFill} />
        <View style={styles.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  const cell = Math.floor((width - 32) / 7);
  const disc = Math.min(38, cell - 6);
  // The year cells were sized by percentage and an aspect ratio, and came out
  // as long bars. Measuring them in points instead — three to a row, height
  // derived from width — cannot go wrong whatever the cause was.
  const yearGap = 10;
  const yearCell = Math.floor((width - 32 - yearGap * 2) / 3);

  return (
    <View style={styles.root}>
      {/* Barely a gradient — just enough lift at the top that the header does
          not sit on a flat void, then black the rest of the way down. */}
      <LinearGradient
        colors={[SLATE, INK, INK_DEEP]} locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={PARCHMENT} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('tools.calendar')}</Text>
          <TouchableOpacity
            onPress={() => { const n = new Date(); goto(n); }}
            hitSlop={10}
          >
            <Text style={styles.todayBtn}>{t('calendar.today')}</Text>
          </TouchableOpacity>
        </View>

        {/* Which question you are asking. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {VIEWS.map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.tab, view === v && styles.tabOn]}
              onPress={() => setView(v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, view === v && styles.tabTextOn]}>
                {t(`calendar.view.${v}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* The month name is the control that changes it. */}
          {view !== 'schedule' && view !== 'reminders' && (
            <View style={styles.monthBar}>
              <TouchableOpacity
                onPress={() => step(-1)}
                hitSlop={14}
              >
                <Ionicons name="chevron-back" size={20} color={MUTED} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.monthLabelWrap}
                onPress={() => setPickerOpen(true)}
                activeOpacity={0.75}
              >
                <Text style={styles.monthLabel}>
                  {view === 'year' ? fmt(month, 'yyyy')
                    : view === 'day' ? fmt(selected, 'd MMMM yyyy')
                    : fmt(month, 'MMMM yyyy')}
                </Text>
                <Ionicons name="chevron-down" size={15} color={GOLD_SOFT} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => step(1)} hitSlop={14}>
                <Ionicons name="chevron-forward" size={20} color={MUTED} />
              </TouchableOpacity>
            </View>
          )}

          <LinearGradient
            colors={['transparent', GOLD, 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.rule}
          />

          {view === 'year' && (
            <View style={styles.yearGrid}>
              {Array.from({ length: 12 }, (_, i) => setMonthOf(month, i)).map((m) => {
                const count = countIn(entries, m);
                return (
                  <TouchableOpacity
                    key={i(m)}
                    style={[
                      styles.yearCell,
                      { width: yearCell, height: Math.round(yearCell * 0.62) },
                      isSameMonth(m, new Date()) && styles.yearCellNow,
                    ]}
                    onPress={() => { setMonth(startOfMonth(m)); setView('month'); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.yearMonth}>{fmt(m, 'MMM')}</Text>
                    {count > 0 && <Text style={styles.yearCount}>{count}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {(view === 'month' || view === 'week') && (
            <>
              <View style={styles.weekRow}>
                {WEEKDAYS.map((d, idx) => (
                  <Text key={d} style={[styles.weekday, idx === 6 && styles.weekdaySabbath, { width: cell }]}>
                    {t(`calendar.short.${d}`)}
                  </Text>
                ))}
              </View>
              <View style={styles.grid}>
                {(view === 'month' ? days : weekDays).map((day) => {
                  const outside = view === 'month' && !isSameMonth(day, month);
                  const chosen = isSameDay(day, selected);
                  const list = entries[KEY(day)] || [];
                  const holy = isSabbath(day);
                  return (
                    <TouchableOpacity
                      key={day.toISOString()}
                      style={[styles.cell, { width: cell, height: cell }]}
                      onPress={() => setSelected(day)}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.disc,
                        { width: disc, height: disc, borderRadius: disc / 2 },
                        holy && !chosen && styles.discSabbath,
                        isToday(day) && !chosen && styles.discToday,
                        chosen && styles.discSelected,
                      ]}>
                        <Text style={[
                          styles.cellText,
                          holy && styles.cellTextSabbath,
                          outside && styles.cellTextOutside,
                          chosen && styles.cellTextSelected,
                        ]}>
                          {fmt(day, 'd')}
                        </Text>
                      </View>
                      {!!list.length && (
                        <View style={styles.marks}>
                          {list.slice(0, 3).map((e) => (
                            <View
                              key={e.id}
                              style={[
                                styles.dot,
                                e.remind && styles.dotRemind,
                                chosen && styles.dotSelected,
                              ]}
                            />
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Sabbath: the question this calendar is actually asked. */}
          {view !== 'schedule' && view !== 'reminders' && view !== 'year'
            && (isFriday(selected) || isSabbath(selected)) && (
            <View style={styles.sabbathCard}>
              <View style={styles.sabbathHead}>
                <Ionicons name="moon" size={15} color={GOLD_SOFT} />
                <Text style={styles.sabbathTitle}>{t('calendar.sabbath')}</Text>
              </View>
              {sabbath && sabbath.begins !== null && sabbath.ends !== null ? (
                <View style={styles.sabbathTimes}>
                  <View style={styles.sabbathSlot}>
                    <Text style={styles.sabbathLabel}>{t('calendar.begins')}</Text>
                    <Text style={styles.sabbathValue}>{formatMinutes(sabbath.begins)}</Text>
                    <Text style={styles.sabbathDay}>{fmt(sabbath.beginsOn, 'EEE d MMM')}</Text>
                  </View>
                  <View style={styles.sabbathDivider} />
                  <View style={styles.sabbathSlot}>
                    <Text style={styles.sabbathLabel}>{t('calendar.ends')}</Text>
                    <Text style={styles.sabbathValue}>{formatMinutes(sabbath.ends)}</Text>
                    <Text style={styles.sabbathDay}>{fmt(sabbath.endsOn, 'EEE d MMM')}</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.sabbathEmpty}
                  onPress={() => navigation.navigate('Weather')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sabbathEmptyText}>{t('calendar.needPlace')}</Text>
                  <Ionicons name="chevron-forward" size={16} color={GOLD_SOFT} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* A list, when the question is "what is next" rather than "what is this month". */}
          {(view === 'schedule' || view === 'reminders') && (
            <View style={styles.agenda}>
              {upcoming.length === 0 && (
                <Text style={styles.dayEmpty}>
                  {t(view === 'reminders' ? 'calendar.noReminders' : 'calendar.noUpcoming')}
                </Text>
              )}
              {upcoming.map((e) => (
                <TouchableOpacity
                  key={`${e.date}-${e.id}`}
                  style={styles.agendaRow}
                  onPress={() => { goto(new Date(`${e.date}T00:00:00`)); setView('day'); }}
                  activeOpacity={0.8}
                >
                  <View style={styles.agendaWhen}>
                    <Text style={styles.agendaDate}>{fmt(new Date(`${e.date}T00:00:00`), 'd MMM')}</Text>
                    <Text style={styles.agendaTime}>{e.time || t('calendar.allDay')}</Text>
                  </View>
                  <Text style={styles.agendaText} numberOfLines={2}>{e.text}</Text>
                  {e.remind && <Ionicons name="notifications" size={15} color={GOLD} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* The day panel: what is on this date, and how to add to it. */}
          {view !== 'schedule' && view !== 'reminders' && view !== 'year' && (
            <View style={styles.dayPanel}>
              <Text style={styles.dayTitle}>{fmt(selected, 'EEEE d MMMM')}</Text>

              {dayEntries.length === 0 && (
                <Text style={styles.dayEmpty}>{t('calendar.noNotes')}</Text>
              )}

              {dayEntries.map((e) => (
                <View style={styles.note} key={e.id}>
                  <Text style={styles.noteTime}>{e.time || '—'}</Text>
                  <Text style={styles.noteText}>{e.text}</Text>
                  <TouchableOpacity
                    onPress={() => toggleReminder(KEY(selected), e.id)}
                    hitSlop={8}
                    disabled={!e.time}
                    accessibilityLabel={t('calendar.toggleReminder')}
                  >
                    <Ionicons
                      name={e.remind ? 'notifications' : 'notifications-outline'}
                      size={17}
                      color={e.remind ? GOLD : (e.time ? MUTED : 'rgba(124,140,165,0.35)')}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => removeEntry(KEY(selected), e.id)}
                    hitSlop={8}
                    accessibilityLabel={t('calendar.removeNote')}
                  >
                    <Ionicons name="close" size={16} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ))}

              <View style={styles.addRow}>
                <TextInput
                  style={styles.input}
                  placeholder={t('calendar.addPlaceholder')}
                  placeholderTextColor="rgba(236,231,222,0.4)"
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={addEntry}
                  returnKeyType="done"
                  maxLength={200}
                />
                <TextInput
                  style={styles.timeInput}
                  placeholder="09:00"
                  placeholderTextColor="rgba(236,231,222,0.35)"
                  value={draftTime}
                  onChangeText={setDraftTime}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
                <TouchableOpacity
                  style={[styles.addBtn, !draft.trim() && styles.addBtnOff]}
                  onPress={addEntry}
                  disabled={!draft.trim()}
                  accessibilityLabel={t('calendar.addNote')}
                >
                  <Ionicons name="add" size={22} color={INK} />
                </TouchableOpacity>
              </View>

              <View style={styles.remindRow}>
                <Ionicons
                  name="notifications-outline"
                  size={15}
                  color={draftTime.trim() ? GOLD_SOFT : MUTED}
                />
                <Text style={styles.remindText}>
                  {draftTime.trim() ? t('calendar.remindMe') : t('calendar.remindNeedsTime')}
                </Text>
                <Switch
                  value={draftRemind && !!draftTime.trim()}
                  onValueChange={setDraftRemind}
                  disabled={!draftTime.trim()}
                  trackColor={{ false: 'rgba(236,231,222,0.18)', true: GOLD }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          )}

          <Text style={styles.footnote}>{t('calendar.localOnly')}</Text>
        </ScrollView>
      </SafeAreaView>

      {/* Month and year, picked rather than paged to. */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.sheetBack} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('calendar.jumpTo')}</Text>

            <View style={styles.yearRow}>
              <TouchableOpacity onPress={() => setMonth((m) => setYear(m, m.getFullYear() - 1))} hitSlop={12}>
                <Ionicons name="chevron-back" size={20} color={GOLD_SOFT} />
              </TouchableOpacity>
              <Text style={styles.yearValue}>{fmt(month, 'yyyy')}</Text>
              <TouchableOpacity onPress={() => setMonth((m) => setYear(m, m.getFullYear() + 1))} hitSlop={12}>
                <Ionicons name="chevron-forward" size={20} color={GOLD_SOFT} />
              </TouchableOpacity>
            </View>

            <View style={styles.monthGrid}>
              {Array.from({ length: 12 }, (_, idx) => setMonthOf(month, idx)).map((m, idx) => {
                const on = month.getMonth() === idx;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.monthChip, on && styles.monthChipOn]}
                    onPress={() => { setMonth(startOfMonth(m)); setPickerOpen(false); }}
                  >
                    <Text style={[styles.monthChipText, on && styles.monthChipTextOn]}>
                      {fmt(m, 'MMM')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );

  // ── helpers that need the component's state ────────────────────────────
  function step(direction) {
    if (view === 'year') setMonth((m) => setYear(m, m.getFullYear() + direction));
    else if (view === 'week') setSelected((d) => addWeeks(d, direction));
    else if (view === 'day') setSelected((d) => addDays(d, direction));
    else setMonth((m) => addMonths(m, direction));
  }
};

const i = (d) => d.toISOString();
const pad = (value) => {
  const [h, m] = value.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${m}`;
};
const countIn = (entries, monthDate) => {
  const prefix = fmt(monthDate, 'yyyy-MM');
  return Object.entries(entries)
    .filter(([date]) => date.startsWith(prefix))
    .reduce((n, [, list]) => n + (list?.length || 0), 0);
};

// On black these read as charcoal plates. The same values over the old slate
// ground read as almost nothing, which is why the cards had no edges.
const PANEL = 'rgba(255,255,255,0.06)';
const HAIRLINE = 'rgba(201,162,39,0.22)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  back: { paddingVertical: 4 },
  title: {
    flex: 1, fontFamily: DISPLAY, fontSize: 15, letterSpacing: 1.2,
    color: PARCHMENT, textTransform: 'uppercase',
  },
  todayBtn: { fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 0.8, color: GOLD_SOFT },

  tabs: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tab: {
    paddingHorizontal: 13, paddingVertical: 6, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  tabOn: { backgroundColor: GOLD, borderColor: GOLD },
  tabText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.6, color: MUTED },
  tabTextOn: { color: INK },

  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },

  monthBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  monthLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  monthLabel: { fontFamily: DISPLAY, fontSize: 17, letterSpacing: 0.8, color: PARCHMENT },
  rule: { height: 1, opacity: 0.55, marginBottom: 6 },

  weekRow: { flexDirection: 'row' },
  weekday: {
    textAlign: 'center', fontFamily: DISPLAY_MID, fontSize: 10,
    letterSpacing: 0.8, color: MUTED, paddingBottom: 4,
  },
  weekdaySabbath: { color: GOLD_SOFT },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  disc: { alignItems: 'center', justifyContent: 'center' },
  discSabbath: { backgroundColor: 'rgba(201,162,39,0.13)' },
  discToday: { borderWidth: 1, borderColor: GOLD_SOFT },
  discSelected: { backgroundColor: GOLD },
  cellText: { fontSize: 14.5, color: PARCHMENT },
  cellTextSabbath: { color: GOLD_SOFT },
  cellTextOutside: { opacity: 0.35 },
  cellTextSelected: { color: INK, fontWeight: '700' },
  // One dot per entry, up to three — a day with a reminder shows it in gold.
  marks: { position: 'absolute', bottom: 3, flexDirection: 'row', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: MUTED },
  dotRemind: { backgroundColor: GOLD },
  dotSelected: { backgroundColor: INK },

  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  yearCell: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, backgroundColor: PANEL, gap: 3,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  yearCellNow: { borderColor: GOLD_SOFT },
  yearMonth: { fontFamily: DISPLAY_MID, fontSize: 14, color: PARCHMENT },
  yearCount: { fontSize: 11, color: GOLD_SOFT },

  sabbathCard: {
    padding: 14, borderRadius: 16, backgroundColor: PANEL,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, gap: 10,
  },
  sabbathHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sabbathTitle: {
    fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.4,
    textTransform: 'uppercase', color: GOLD_SOFT,
  },
  sabbathTimes: { flexDirection: 'row', alignItems: 'center' },
  sabbathSlot: { flex: 1, alignItems: 'center', gap: 2 },
  sabbathDivider: { width: StyleSheet.hairlineWidth, height: 38, backgroundColor: HAIRLINE },
  sabbathLabel: { fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: MUTED },
  sabbathValue: { fontFamily: DISPLAY, fontSize: 21, color: PARCHMENT },
  sabbathDay: { fontSize: 11.5, color: MUTED },
  sabbathEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  sabbathEmptyText: { flex: 1, fontSize: 13, lineHeight: 19, color: 'rgba(236,231,222,0.75)' },

  agenda: { gap: 8 },
  agendaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    borderRadius: 14, backgroundColor: PANEL,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  agendaWhen: { width: 62 },
  agendaDate: { fontFamily: DISPLAY_MID, fontSize: 13, color: PARCHMENT },
  agendaTime: { fontSize: 11.5, color: MUTED },
  agendaText: { flex: 1, fontSize: 14, color: PARCHMENT, lineHeight: 19 },

  dayPanel: {
    padding: 14, borderRadius: 16, backgroundColor: PANEL, gap: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  dayTitle: { fontFamily: DISPLAY_MID, fontSize: 14, letterSpacing: 0.5, color: PARCHMENT },
  dayEmpty: { fontSize: 13, color: MUTED },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteTime: { width: 44, fontFamily: DISPLAY_MID, fontSize: 12, color: GOLD_SOFT },
  noteText: { flex: 1, fontSize: 14.5, color: PARCHMENT, lineHeight: 20 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  input: {
    flex: 1, height: 42, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.28)', color: PARCHMENT, fontSize: 14.5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  timeInput: {
    width: 62, height: 42, paddingHorizontal: 8, borderRadius: 12, textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)', color: GOLD_SOFT, fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  addBtn: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: GOLD,
  },
  addBtnOff: { opacity: 0.4 },
  remindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remindText: { flex: 1, fontSize: 12.5, color: MUTED },

  sheetBack: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 360, padding: 18, borderRadius: 20, gap: 14,
    backgroundColor: '#0C1119',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  sheetTitle: {
    fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', color: GOLD_SOFT, textAlign: 'center',
  },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  yearValue: { fontFamily: DISPLAY, fontSize: 20, color: PARCHMENT, minWidth: 74, textAlign: 'center' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  monthChip: {
    width: '30%', paddingVertical: 10, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  monthChipOn: { backgroundColor: GOLD },
  monthChipText: { fontFamily: DISPLAY_MID, fontSize: 13, color: PARCHMENT },
  monthChipTextOn: { color: INK },

  footnote: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 2 },
});

export default Calendar;
