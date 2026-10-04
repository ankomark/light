/**
 * Open an event or a fundraiser. First, which. An event: the banner, title
 * and description; when and where; the ticket levels (Regular, VIP, VVIP…
 * each with a price and how many). A fundraiser: the banner, story and cause;
 * the goal and the amounts offered as one tap; a supporting document for
 * Skylink's review (never public). Then for both: the M-Pesa till the money
 * goes to, who may see the supporters list and the total, and a review that
 * shows it as the public will see it.
 *
 * Every event is reviewed by Skylink's staff before it sells. Creating it asks
 * for it to go on sale; it does so by itself once it is approved and its till
 * is active, in whichever order those happen (the server's events/review.py).
 *
 * Venue, start time and till are not optional: the server will not take an
 * event without them, and an event with no till can never be paid for.
 *
 * Saving is several calls — the event (a draft), its banner and document,
 * each ticket level, then asking for it to go on sale — and any of them can
 * fail on a phone. What has been saved is remembered in the draft (`saved`:
 * the event, the fields as sent, which files went up, which levels), so
 * trying again carries on from there instead of making the event twice. Once
 * a level is on the server it is locked here; the rest can still change.
 *
 * The whole draft is kept on the phone as it is typed, so leaving halfway —
 * or being signed out and back in — loses nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Share, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import {
  fetchTills, createTill, createEvent, updateEvent, uploadEventFiles, addTicketType, publishEvent,
} from '../../services/ticketsOrganiser';
import { formatKes, formatWhen, dateTile } from '../../services/tickets';
import {
  T, F, tap, Kicker, DateTile, Pill, GoldButton, GhostButton,
} from '../../components/tickets/TicketKit';
import DateTimeField from '../../components/tickets/DateTimeField';
import { pickBanner as chooseBanner, BannerPermissionError } from '../../components/tickets/pickBanner';
import {
  MAX_LEVELS, TITLE_MAX, NAME_MAX, emptyDraft, newLevel, validateStep, firstInvalidStep, stepsFor,
  serverErrorsByStep, levelPayloads, priceRange, wholeNumber, suggestedPayload, upgradeDraft,
} from './eventDraft';
import {
  TypeStep, CategoryPicker, GoalStep, DocumentStep, VisibilityStep, pickDocument,
} from './HostSteps';
import { ticketErrorText } from './ticketText';

const DRAFT_KEY = 'tix:hostDraft';
const SAVE_WAIT_MS = 400;
const PRESETS = ['regular', 'vip', 'vvip', 'earlyBird', 'couple', 'group'];
const BANNER_RATIO = 4 / 5;     // as the Events list shows posters

// The fields the server keeps (no files), and as a string to tell whether
// they changed after the event was first saved (and so need sending again).
const eventFields = (d) => ({
  kind: d.kind, title: d.title, description: d.description, venue: d.venue, city: d.city,
  startsAt: d.kind === 'fundraiser' ? null : d.startsAt, endsAt: d.endsAt, salesEndAt: d.salesEndAt, till: d.till,
  category: d.category, goal: d.goal, suggested: suggestedPayload(d.suggested),
  showSupporters: d.showSupporters, showTotal: d.showTotal,
});
const fieldsSignature = (d) => JSON.stringify(eventFields(d));

const TILL_KIND = { active: 'paid', pending: 'pending', submitted: 'pending', rejected: 'failed' };

const Input = ({ label, error, hint, style, ...props }) => (
  <View>
    {!!label && <Text style={styles.label}>{label}</Text>}
    <TextInput
      placeholderTextColor={T.faint}
      style={[styles.input, !!error && styles.inputBad, style]}
      accessibilityLabel={label}
      {...props}
    />
    {error ? <Text style={styles.bad}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
);

const TicketCreateEvent = ({ navigation }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const months = t('tix.months').split(',');
  const weekdays = t('tix.weekdays').split(',');
  const when = (iso) => (iso ? formatWhen(iso, { months, weekdays }) : '');

  // ── The draft, kept on the phone ──────────────────────────────────────
  const [draft, setDraft] = useState(null);
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        const kept = raw ? JSON.parse(raw) : null;
        if (kept?.levels) { setDraft(kept.kind ? kept : upgradeDraft(kept)); setResumed(!!(kept.title || kept.saved)); } else setDraft(emptyDraft());
      })
      .catch(() => setDraft(emptyDraft()));
  }, []);
  // The pending save is held here, not only in the effect's cleanup: saving
  // the event clears it at once (React may not have re-rendered yet), so an
  // older draft can never land on top of what the server now has — or bring
  // a finished event back as a draft.
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!draft) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {}); }, SAVE_WAIT_MS);
    return () => clearTimeout(saveTimer.current);
  }, [draft]);
  const update = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);
  const startOver = () => {
    tap();
    setDraft(emptyDraft());
    setResumed(false);
    setStep(0);
    setErrors({});
  };

  // ── Steps ─────────────────────────────────────────────────────────────
  const steps = stepsFor(draft?.kind);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const scroll = useRef(null);
  const go = (i) => { setStep(i); setErrors({}); scroll.current?.scrollTo?.({ y: 0, animated: false }); };
  const next = () => {
    const e = validateStep(steps[step], draft);
    if (Object.keys(e).length) { setErrors(e); return; }
    tap();
    go(step + 1);
  };
  const back = () => { tap(); go(step - 1); };
  const err = (k) => (errors[k] ? (errors[k].startsWith('tix.') ? t(errors[k]) : errors[k]) : '');

  // ── Banner ────────────────────────────────────────────────────────────
  // ── A fundraiser's supporting document ────────────────────────────────
  const [docBusy, setDocBusy] = useState(false);
  const [docNotice, setDocNotice] = useState('');
  const chooseDocument = async () => {
    tap();
    setDocNotice('');
    setDocBusy(true);
    try {
      const doc = await pickDocument();
      if (doc === 'too_big') setDocNotice(t('tix.host.docTooBig'));
      else if (doc) { update({ document: doc }); setErrors((e) => ({ ...e, document: undefined })); }
    } catch {
      setDocNotice(t('tix.host.docFailed'));
    } finally {
      setDocBusy(false);
    }
  };

  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const pickBanner = async () => {
    tap();
    setBannerError('');
    try {
      setBannerBusy(true);
      const poster = await chooseBanner();
      if (poster) update({ poster });
    } catch (err) {
      setBannerError(err instanceof BannerPermissionError ? t('tix.host.photoPermission') : t('tix.host.photoFailed'));
    } finally {
      setBannerBusy(false);
    }
  };

  // ── Tills ─────────────────────────────────────────────────────────────
  const [tills, setTills] = useState(null);
  const [tillsError, setTillsError] = useState(null);
  const loadTills = useCallback(async () => {
    setTillsError(null);
    try {
      const list = await fetchTills();
      setTills(list);
      // The only usable till is chosen for them.
      const usable = list.filter((x) => x.status !== 'rejected');
      setDraft((d) => (d && !d.till && usable.length === 1 ? { ...d, till: usable[0].id } : d));
    } catch (e) {
      if (e?.code === 'signed_out') navigation.replace('TicketHost');
      else setTillsError(e);
    }
  }, [navigation]);
  useEffect(() => { loadTills(); }, [loadTills]);
  const [adding, setAdding] = useState(false);
  const [tillNumber, setTillNumber] = useState('');
  const [business, setBusiness] = useState('');
  const [tillBusy, setTillBusy] = useState(false);
  const [tillErrors, setTillErrors] = useState({});
  const addTill = async () => {
    const e = {};
    // As the server checks it: a Buy Goods till is 5 to 8 digits.
    if (!/^\d{5,8}$/.test(tillNumber.replace(/\s/g, ''))) e.till_number = t('tix.host.err.tillNumber');
    if (!business.trim()) e.business_name = t('tix.host.err.business');
    setTillErrors(e);
    if (Object.keys(e).length || tillBusy) return;
    setTillBusy(true);
    try {
      const till = await createTill({ tillNumber, businessName: business });
      setTills((list) => [till, ...(list || [])]);
      update({ till: till.id });
      setAdding(false);
      setTillNumber('');
      setBusiness('');
    } catch (x) {
      if (x?.code === 'signed_out') { navigation.replace('TicketHost'); return; }
      setTillErrors({ ...(x?.fields || {}), form: x?.fields && Object.keys(x.fields).length ? '' : ticketErrorText(x, t) });
    } finally {
      setTillBusy(false);
    }
  };
  const chosenTill = tills?.find((x) => x.id === draft?.till) || null;
  const tillActive = chosenTill?.status === 'active';

  // ── Levels ────────────────────────────────────────────────────────────
  const savedLevels = draft?.saved?.levels || {};
  const setLevel = (key, patch) => setDraft((d) => ({ ...d, levels: d.levels.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLevel = (name = '') => {
    tap();
    setDraft((d) => (d.levels.length >= MAX_LEVELS ? d : { ...d, levels: [...d.levels, newLevel(name)] }));
  };
  const removeLevel = (key) => { tap(); setDraft((d) => ({ ...d, levels: d.levels.filter((l) => l.key !== key) })); };
  const presetName = (p) => t(`tix.host.preset.${p}`);
  const hasName = (name) => draft?.levels.some((l) => l.name.trim().toLowerCase() === name.toLowerCase());

  // ── Saving ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null);

  const submit = async () => {
    const bad = firstInvalidStep(draft);
    if (bad) { go(steps.indexOf(bad)); setErrors(validateStep(bad, draft)); return; }
    setBusy(true);
    setSubmitError('');
    let d = draft;
    // What the server now has is written to the phone at once, not on the
    // usual delay: if this screen is left a moment later (signed out, say),
    // the next try must know the event already exists, or it makes it twice.
    const keep = (saved) => {
      d = { ...d, saved };
      clearTimeout(saveTimer.current);
      setDraft(d);
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => {});
    };
    try {
      // The event: made once; its fields sent again only if they changed.
      let event = d.saved?.event;
      if (!event) {
        setProgress(t('tix.host.savingEvent'));
        event = await createEvent(eventFields(d));
        keep({ event, fields: fieldsSignature(d), poster: null, document: null, levels: {} });
      } else if (d.saved.fields !== fieldsSignature(d)) {
        setProgress(t('tix.host.savingEvent'));
        event = await updateEvent(event.id, eventFields(d));
        keep({ ...d.saved, event, fields: fieldsSignature(d) });
      }

      // The banner and the document: each sent once, and again only if
      // another was chosen since.
      const poster = d.poster?.uri && d.poster.uri !== d.saved.poster ? d.poster : null;
      const doc = d.kind === 'fundraiser' && d.document?.uri && d.document.uri !== d.saved.document ? d.document : null;
      if (poster || doc) {
        setProgress(t('tix.host.uploading'));
        event = await uploadEventFiles(event.id, { poster, document: doc });
        keep({ ...d.saved, event, poster: d.poster?.uri || d.saved.poster, document: d.document?.uri || d.saved.document });
      }

      // An event's levels, each once. A fundraiser has none.
      const levels = d.kind === 'fundraiser' ? [] : d.levels;
      const payloads = levelPayloads(levels);
      for (let i = 0; i < levels.length; i += 1) {
        const level = levels[i];
        if (d.saved.levels[level.key]) continue;
        setProgress(t('tix.host.savingLevels', { i: i + 1, n: levels.length }));
        const made = await addTicketType(event.id, payloads[i]);
        keep({ ...d.saved, levels: { ...d.saved.levels, [level.key]: made.id } });
      }

      // Ask for it to go on sale: to review first, then on sale by itself
      // once approved with an active till. The event and its levels are
      // saved whatever this says, so a refusal is told, not retried.
      let publishNote = '';
      setProgress(t('tix.host.submitting'));
      try {
        event = await publishEvent(event.id);
      } catch (x) {
        if (x?.code === 'signed_out') throw x;
        publishNote = ticketErrorText(x, t);
      }
      const published = event.status === 'published';
      // Finished: the draft goes, and with it any save still waiting to run
      // (it would bring the finished event back as a draft next time).
      clearTimeout(saveTimer.current);
      setDraft(null);
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      setDone({ event, published, publishNote, till: chosenTill, tillActive });
    } catch (x) {
      if (x?.code === 'signed_out') { navigation.replace('TicketHost'); return; }
      const { step: where, errors: fieldErrors } = serverErrorsByStep(x?.fields, d.kind);
      if (where && where !== 'tickets') { go(steps.indexOf(where)); setErrors(fieldErrors); }
      setSubmitError(ticketErrorText(x, t));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  // ── Done ──────────────────────────────────────────────────────────────
  if (done) {
    const { event, published, publishNote, till } = done;
    const title = published ? t('tix.host.liveTitle') : publishNote ? t('tix.host.draftTitle') : t('tix.host.sentTitle');
    const body = published ? t('tix.host.liveBody')
      : publishNote || (done.tillActive ? t('tix.host.sentBody')
        : t('tix.host.sentBodyTill', { till: till?.till_number || '' }));
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.doneScroll}>
          <View style={[styles.doneIcon, published && styles.doneIconLive]}>
            <Ionicons name={published ? 'sparkles' : publishNote ? 'bookmark' : 'hourglass-outline'} size={34}
                      color={published ? T.paperInk : T.champagne} />
          </View>
          <Text style={styles.doneTitle} accessibilityRole="header">{title}</Text>
          <Text style={styles.doneBody}>{body}</Text>
          <Text style={styles.doneEvent}>{event.title}</Text>
        </ScrollView>
        <View style={styles.bar}>
          {published ? (
            <GoldButton label={t('tix.host.viewEvent')} onPress={() => navigation.replace('TicketEvent', { slug: event.slug })}
                        testID="host-view-event" />
          ) : (
            <GoldButton label={t('tix.mine.manage')} onPress={() => navigation.replace('TicketManageEvent', { id: event.id })}
                        testID="host-manage" />
          )}
          <View style={styles.barRow}>
            {published && !!event.share_url && (
              <GhostButton label={t('tix.host.share')} style={styles.flex}
                           onPress={() => Share.share({ message: `${event.title}\n${event.share_url}` }).catch(() => {})} />
            )}
            <GhostButton label={t('tix.mine.title')} style={styles.flex} onPress={() => navigation.replace('TicketMyEvents')}
                         testID="host-done" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!draft) {
    return <View style={[styles.root, styles.centre]}><ActivityIndicator color={T.gold} size="large" /></View>;
  }

  const name = steps[step];
  const fund = draft.kind === 'fundraiser';
  const range = priceRange(draft.levels);
  const previewWidth = Math.min(width, 620) - 40;

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardLift scrollRef={scroll}>
        {/* Where they are: five bars, the current one gold. */}
        <View style={styles.progress}>
          <View style={styles.bars}>
            {steps.map((s, i) => <View key={s} style={[styles.barSeg, i <= step && styles.barSegOn]} />)}
          </View>
          <Text style={styles.stepLabel}>
            {t('tix.host.stepOf', { i: step + 1, n: steps.length })}  ·  {t(`tix.host.step.${name}`)}
          </Text>
        </View>

        <ScrollView ref={scroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {resumed && step === 0 && (
            <View style={styles.resumed}>
              <Ionicons name="time-outline" size={17} color={T.champagne} />
              <Text style={styles.resumedText}>{t('tix.host.resumed')}</Text>
              <TouchableOpacity onPress={startOver} hitSlop={8} accessibilityRole="button" testID="host-start-over">
                <Text style={styles.link}>{t('tix.host.startOver')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {name === 'type' && (
            <TypeStep t={t} kind={draft.kind} error={err('kind')}
                      onPick={(k) => { update({ kind: k, showSupporters: draft.kind ? draft.showSupporters : k === 'fundraiser', showTotal: draft.kind ? draft.showTotal : k === 'fundraiser' }); setErrors({}); }} />
          )}

          {name === 'goal' && <GoalStep t={t} draft={draft} update={update} err={err} when={when} />}

          {name === 'document' && (
            <DocumentStep t={t} document={draft.document} err={err} busy={docBusy} notice={docNotice}
                          onPick={chooseDocument} onRemove={() => { tap(); update({ document: null }); }} />
          )}

          {name === 'visibility' && <VisibilityStep t={t} draft={draft} update={update} />}

          {name === 'details' && (
            <>
              <Text style={styles.heading} accessibilityRole="header">
                {fund ? t('tix.host.fundDetailsTitle') : t('tix.host.detailsTitle')}
              </Text>
              {fund && <CategoryPicker t={t} value={draft.category} onPick={(c) => update({ category: c })} error={err('category')} />}
              <TouchableOpacity
                onPress={pickBanner}
                activeOpacity={0.85}
                style={[styles.banner, { width: previewWidth * 0.62, height: (previewWidth * 0.62) / BANNER_RATIO }]}
                accessibilityRole="button"
                accessibilityLabel={draft.poster ? t('tix.host.changeBanner') : t('tix.host.addBanner')}
                testID="host-banner"
              >
                {draft.poster ? (
                  <>
                    <Image source={{ uri: draft.poster.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={styles.bannerEdit}>
                      <Ionicons name="image-outline" size={14} color={T.paperInk} />
                      <Text style={styles.bannerEditText}>{t('tix.host.changeBanner')}</Text>
                    </View>
                  </>
                ) : bannerBusy ? (
                  <ActivityIndicator color={T.gold} />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={30} color={T.champagne} />
                    <Text style={styles.bannerAdd}>{t('tix.host.addBanner')}</Text>
                    <Text style={styles.bannerHint}>{t('tix.host.bannerHint')}</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!bannerError && <Text style={[styles.bad, styles.centerText]}>{bannerError}</Text>}
              {!!draft.poster && (
                <TouchableOpacity onPress={() => { tap(); update({ poster: null }); }} style={styles.removeBanner}
                                  accessibilityRole="button">
                  <Text style={styles.link}>{t('tix.host.removeBanner')}</Text>
                </TouchableOpacity>
              )}

              <Input label={t('tix.host.title')} value={draft.title} onChangeText={(v) => update({ title: v })}
                     placeholder={t('tix.host.titlePlaceholder')} maxLength={TITLE_MAX} error={err('title')}
                     testID="host-title" />
              <Input label={t('tix.host.description')} value={draft.description}
                     onChangeText={(v) => update({ description: v })} placeholder={t('tix.host.descriptionPlaceholder')}
                     multiline textAlignVertical="top" style={styles.multiline} maxLength={5000}
                     error={err('description')} hint={t('tix.host.descriptionHint')} testID="host-description" />
            </>
          )}

          {name === 'when' && (
            <>
              <Text style={styles.heading} accessibilityRole="header">{t('tix.host.whenTitle')}</Text>
              <Input label={t('tix.host.venue')} value={draft.venue} onChangeText={(v) => update({ venue: v })}
                     placeholder={t('tix.host.venuePlaceholder')} maxLength={200} error={err('venue')} testID="host-venue" />
              <Input label={t('tix.host.city')} value={draft.city} onChangeText={(v) => update({ city: v })}
                     placeholder={t('tix.host.cityPlaceholder')} maxLength={80} error={err('city')} testID="host-city" />
              <DateTimeField label={t('tix.host.starts')} value={draft.startsAt} display={when(draft.startsAt)}
                             onChange={(v) => update({ startsAt: v })} placeholder={t('tix.host.pickDate')}
                             minimumDate={new Date()} doneLabel={t('tix.host.doneShort')} error={err('startsAt')}
                             testID="host-starts" />
              <DateTimeField label={t('tix.host.ends')} value={draft.endsAt} display={when(draft.endsAt)}
                             onChange={(v) => update({ endsAt: v })} placeholder={t('tix.host.optional')} clearable
                             clearLabel={t('tix.host.clear')} minimumDate={draft.startsAt ? new Date(draft.startsAt) : new Date()}
                             doneLabel={t('tix.host.doneShort')} error={err('endsAt')} testID="host-ends" />
              <DateTimeField label={t('tix.host.salesEnd')} value={draft.salesEndAt} display={when(draft.salesEndAt)}
                             onChange={(v) => update({ salesEndAt: v })} placeholder={t('tix.host.salesEndPlaceholder')}
                             clearable clearLabel={t('tix.host.clear')} minimumDate={new Date()}
                             doneLabel={t('tix.host.doneShort')} error={err('salesEndAt')} testID="host-sales-end" />
            </>
          )}

          {name === 'tickets' && (
            <>
              <Text style={styles.heading} accessibilityRole="header">{t('tix.host.ticketsTitle')}</Text>
              <Text style={styles.body}>{t('tix.host.ticketsBody')}</Text>
              <View style={styles.presets}>
                {PRESETS.map((p) => {
                  const taken = hasName(presetName(p));
                  return (
                    <TouchableOpacity
                      key={p}
                      disabled={taken || draft.levels.length >= MAX_LEVELS}
                      onPress={() => addLevel(presetName(p))}
                      style={[styles.preset, taken && styles.presetTaken]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: taken }}
                      testID={`host-preset-${p}`}
                    >
                      <Ionicons name={taken ? 'checkmark' : 'add'} size={14} color={taken ? T.faint : T.champagne} />
                      <Text style={[styles.presetText, taken && styles.presetTextTaken]}>{presetName(p)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!!err('levels') && <Text style={styles.bad}>{err('levels')}</Text>}

              {draft.levels.map((l, i) => {
                const locked = !!savedLevels[l.key];
                return (
                  <View key={l.key} style={styles.level} testID={`host-level-${i}`}>
                    <View style={styles.levelHead}>
                      <Text style={styles.levelNo}>{t('tix.host.level', { n: i + 1 })}</Text>
                      {locked ? (
                        <Pill kind="paid" label={t('tix.host.levelSaved')} />
                      ) : draft.levels.length > 1 ? (
                        <TouchableOpacity onPress={() => removeLevel(l.key)} hitSlop={10} accessibilityRole="button"
                                          accessibilityLabel={t('tix.host.removeLevel')} testID={`host-remove-${i}`}>
                          <Ionicons name="trash-outline" size={18} color={T.faint} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Input label={t('tix.host.levelName')} value={l.name} editable={!locked}
                           onChangeText={(v) => setLevel(l.key, { name: v })} placeholder={t('tix.host.levelNamePlaceholder')}
                           maxLength={NAME_MAX} error={err(`levels.${l.key}.name`)} testID={`host-level-name-${i}`} />
                    <View style={styles.levelRow}>
                      <View style={styles.flex}>
                        <Input label={t('tix.host.price')} value={l.price} editable={!locked}
                               onChangeText={(v) => setLevel(l.key, { price: v.replace(/[^\d]/g, '') })}
                               placeholder="1500" keyboardType="number-pad" maxLength={9}
                               error={err(`levels.${l.key}.price`)} testID={`host-level-price-${i}`} />
                      </View>
                      <View style={styles.flex}>
                        <Input label={t('tix.host.quantity')} value={l.quantity} editable={!locked}
                               onChangeText={(v) => setLevel(l.key, { quantity: v.replace(/[^\d]/g, '') })}
                               placeholder="100" keyboardType="number-pad" maxLength={7}
                               error={err(`levels.${l.key}.quantity`)} testID={`host-level-quantity-${i}`} />
                      </View>
                    </View>
                    {wholeNumber(l.price) >= 1 && (
                      <Text style={styles.levelPrice}>{formatKes(wholeNumber(l.price))}</Text>
                    )}
                  </View>
                );
              })}
              {draft.levels.length < MAX_LEVELS && (
                <TouchableOpacity onPress={() => addLevel('')} style={styles.addLevel} accessibilityRole="button"
                                  testID="host-add-level">
                  <Ionicons name="add-circle-outline" size={20} color={T.champagne} />
                  <Text style={styles.addLevelText}>{t('tix.host.addLevel')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {name === 'payout' && (
            <>
              <Text style={styles.heading} accessibilityRole="header">{t('tix.host.payoutTitle')}</Text>
              <Text style={styles.body}>{t('tix.host.payoutBody')}</Text>
              {!!err('till') && <Text style={styles.bad}>{err('till')}</Text>}

              {tills === null && !tillsError && <ActivityIndicator style={styles.loading} color={T.gold} />}
              {!!tillsError && (
                <View style={styles.inlineError}>
                  <Text style={styles.errorText}>{ticketErrorText(tillsError, t)}</Text>
                  <TouchableOpacity onPress={loadTills} accessibilityRole="button"><Text style={styles.link}>{t('common.retry')}</Text></TouchableOpacity>
                </View>
              )}
              {(tills || []).map((till) => {
                const on = draft.till === till.id;
                const rejected = till.status === 'rejected';
                return (
                  <TouchableOpacity
                    key={till.id}
                    disabled={rejected}
                    onPress={() => { tap(); update({ till: till.id }); }}
                    style={[styles.till, on && styles.tillOn, rejected && styles.tillOff]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: rejected }}
                    testID={`host-till-${till.id}`}
                  >
                    <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                    <View style={styles.flex}>
                      <Text style={styles.tillName}>{till.business_name}</Text>
                      <Text style={styles.tillNumber}>{t('tix.host.tillNo', { n: till.till_number })}</Text>
                      {rejected && !!till.note && <Text style={styles.tillNote}>{till.note}</Text>}
                    </View>
                    <Pill kind={TILL_KIND[till.status] || 'closed'} label={till.status_label || till.status} />
                  </TouchableOpacity>
                );
              })}

              {adding || (tills && !tills.length) ? (
                <View style={styles.addTill}>
                  <Text style={styles.addTillTitle}>{t('tix.host.addTill')}</Text>
                  <Input label={t('tix.host.tillNumber')} value={tillNumber} onChangeText={(v) => setTillNumber(v.replace(/[^\d]/g, ''))}
                         keyboardType="number-pad" maxLength={10} placeholder="5123456"
                         error={tillErrors.till_number} testID="host-till-number" />
                  <Input label={t('tix.host.businessName')} value={business} onChangeText={setBusiness}
                         maxLength={120} placeholder={t('tix.host.businessPlaceholder')}
                         error={tillErrors.business_name} testID="host-business" />
                  {!!tillErrors.form && <Text style={styles.bad}>{tillErrors.form}</Text>}
                  <Text style={styles.hint}>{t('tix.host.tillHint')}</Text>
                  <GhostButton label={tillBusy ? t('tix.host.addingTill') : t('tix.host.saveTill')} onPress={addTill}
                               style={styles.saveTill} testID="host-save-till" />
                </View>
              ) : tills ? (
                <TouchableOpacity onPress={() => { tap(); setAdding(true); }} style={styles.addLevel} accessibilityRole="button"
                                  testID="host-add-till">
                  <Ionicons name="add-circle-outline" size={20} color={T.champagne} />
                  <Text style={styles.addLevelText}>{t('tix.host.addTill')}</Text>
                </TouchableOpacity>
              ) : null}

              {!!chosenTill && !tillActive && (
                <View style={styles.notice}>
                  <Ionicons name="information-circle" size={18} color={T.champagne} />
                  <Text style={styles.noticeText}>{t('tix.host.tillNotActive')}</Text>
                </View>
              )}
            </>
          )}

          {name === 'review' && (
            <>
              <Text style={styles.heading} accessibilityRole="header">{t('tix.host.reviewTitle')}</Text>
              <Text style={styles.body}>{t('tix.host.reviewBody')}</Text>

              {/* As it will stand at the top of Events. */}
              <View style={[styles.preview, { width: previewWidth, height: previewWidth * 1.18 }]}>
                {draft.poster ? (
                  <Image source={{ uri: draft.poster.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <LinearGradient colors={['#2A2418', '#141210']} style={StyleSheet.absoluteFill} />
                )}
                <LinearGradient colors={['rgba(10,10,13,0)', 'rgba(10,10,13,0.35)', 'rgba(10,10,13,0.96)']}
                                locations={[0.25, 0.55, 1]} style={StyleSheet.absoluteFill} />
                {!fund && !!draft.startsAt && <DateTile {...dateTile(draft.startsAt, months)} style={styles.previewTile} />}
                <View style={styles.previewText}>
                  {fund ? (!!draft.category && <Kicker>{t(`tix.cat.${draft.category}`)}</Kicker>)
                    : (!!draft.city && <Kicker>{draft.city}</Kicker>)}
                  <Text style={styles.previewTitle} numberOfLines={3}>{draft.title}</Text>
                  {!fund && <Text style={styles.previewMeta} numberOfLines={1}>{when(draft.startsAt)}  ·  {draft.venue}</Text>}
                  {fund ? (
                    <Text style={styles.previewPrice}>
                      {wholeNumber(draft.goal) >= 1 ? t('tix.host.goalOf', { goal: formatKes(wholeNumber(draft.goal)) }) : t('tix.fund.giveMpesa')}
                    </Text>
                  ) : (!!range && <Text style={styles.previewPrice}>{t('tix.from', { price: formatKes(range[0]) })}</Text>)}
                </View>
              </View>

              <ReviewBlock title={t('tix.host.step.details')} onEdit={() => go(steps.indexOf('details'))} editLabel={t('tix.host.edit')}>
                <Text style={styles.reviewLine} numberOfLines={4}>{draft.description || t('tix.host.noDescription')}</Text>
              </ReviewBlock>
              {fund ? (
                <>
                  <ReviewBlock title={t('tix.host.step.goal')} onEdit={() => go(steps.indexOf('goal'))} editLabel={t('tix.host.edit')}>
                    <Text style={styles.reviewLine}>
                      {wholeNumber(draft.goal) >= 1 ? t('tix.host.goalOf', { goal: formatKes(wholeNumber(draft.goal)) }) : t('tix.host.noGoal')}
                    </Text>
                    <Text style={styles.reviewMuted}>
                      {draft.endsAt ? t('tix.fund.ends', { when: when(draft.endsAt) }) : t('tix.host.openEnded')}
                    </Text>
                    <Text style={styles.reviewMuted}>{suggestedPayload(draft.suggested).map((n) => formatKes(n)).join('  ·  ')}</Text>
                  </ReviewBlock>
                  <ReviewBlock title={t('tix.host.step.document')} onEdit={() => go(steps.indexOf('document'))} editLabel={t('tix.host.edit')}>
                    <Text style={styles.reviewLine} numberOfLines={1}>{draft.document?.name}</Text>
                    <Text style={styles.reviewMuted}>{t('tix.host.docPrivate')}</Text>
                  </ReviewBlock>
                </>
              ) : (
                <>
                  <ReviewBlock title={t('tix.host.step.when')} onEdit={() => go(steps.indexOf('when'))} editLabel={t('tix.host.edit')}>
                    <Text style={styles.reviewLine}>{[draft.venue, draft.city].filter(Boolean).join(', ')}</Text>
                    <Text style={styles.reviewLine}>{when(draft.startsAt)}{draft.endsAt ? `  →  ${when(draft.endsAt)}` : ''}</Text>
                    {!!draft.salesEndAt && <Text style={styles.reviewMuted}>{t('tix.salesEnd', { when: when(draft.salesEndAt) })}</Text>}
                  </ReviewBlock>
                  <ReviewBlock title={t('tix.host.step.tickets')} onEdit={() => go(steps.indexOf('tickets'))} editLabel={t('tix.host.edit')}>
                    {draft.levels.map((l) => (
                      <View key={l.key} style={styles.reviewLevel}>
                        <Text style={styles.reviewLine}>{l.name}</Text>
                        <Text style={styles.reviewMuted}>{wholeNumber(l.quantity)} × {formatKes(wholeNumber(l.price))}</Text>
                      </View>
                    ))}
                  </ReviewBlock>
                </>
              )}
              <ReviewBlock title={t('tix.host.step.visibility')} onEdit={() => go(steps.indexOf('visibility'))} editLabel={t('tix.host.edit')}>
                <Text style={styles.reviewLine}>{draft.showSupporters ? t('tix.vis.listOn') : t('tix.vis.listOff')}</Text>
                <Text style={styles.reviewLine}>{draft.showTotal ? t('tix.vis.totalOn') : t('tix.vis.totalOff')}</Text>
              </ReviewBlock>
              <ReviewBlock title={t('tix.host.step.payout')} onEdit={() => go(steps.indexOf('payout'))} editLabel={t('tix.host.edit')}>
                <Text style={styles.reviewLine}>
                  {chosenTill ? `${chosenTill.business_name} · ${t('tix.host.tillNo', { n: chosenTill.till_number })}` : ''}
                </Text>
                <Text style={styles.reviewMuted}>{tillActive ? t('tix.host.willReview') : t('tix.host.willReviewTill')}</Text>
              </ReviewBlock>

              {!!submitError && (
                <View style={styles.error} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle" size={18} color={T.danger} />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.bar}>
          {!!progress && <Text style={styles.progressText} accessibilityLiveRegion="polite">{progress}</Text>}
          <View style={styles.barRow}>
            {step > 0 && <GhostButton label={t('tix.host.back')} onPress={back} style={styles.backBtn} testID="host-back" />}
            {name === 'review' ? (
              <GoldButton label={t('tix.host.createSubmit')}
                          onPress={submit} busy={busy} style={styles.flex} testID="host-create" />
            ) : (
              <GoldButton label={t('tix.host.next')} onPress={next} style={styles.flex} testID="host-next" />
            )}
          </View>
        </View>
      </KeyboardLift>
    </SafeAreaView>
  );
};

const ReviewBlock = ({ title, onEdit, editLabel, children }) => (
  <View style={styles.reviewBlock}>
    <View style={styles.reviewHead}>
      <Kicker>{title}</Kicker>
      <TouchableOpacity onPress={() => { tap(); onEdit(); }} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>{editLabel}</Text>
      </TouchableOpacity>
    </View>
    {children}
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  centerText: { textAlign: 'center' },

  progress: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, width: '100%', maxWidth: 620, alignSelf: 'center' },
  bars: { flexDirection: 'row', gap: 6 },
  barSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: T.line },
  barSegOn: { backgroundColor: T.gold },
  stepLabel: { fontFamily: F.uiBold, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.champagne, marginTop: 10 },

  scroll: { paddingHorizontal: 20, paddingBottom: 32, width: '100%', maxWidth: 620, alignSelf: 'center' },
  heading: { fontFamily: F.display, fontSize: 30, lineHeight: 34, color: T.ivory, marginTop: 8 },
  body: { fontFamily: F.ui, fontSize: 14.5, lineHeight: 22, color: T.muted, marginTop: 8 },

  resumed: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 12, borderRadius: 14,
    backgroundColor: 'rgba(232,212,170,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  resumedText: { flex: 1, fontFamily: F.uiSemi, fontSize: 13.5, color: T.ivory },
  link: { fontFamily: F.uiBold, fontSize: 13.5, color: T.champagne },

  banner: {
    alignSelf: 'center', marginTop: 20, borderRadius: 20, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  bannerAdd: { fontFamily: F.uiBold, fontSize: 14.5, color: T.ivory },
  bannerHint: { fontFamily: F.ui, fontSize: 12, color: T.faint, textAlign: 'center', paddingHorizontal: 18 },
  bannerEdit: {
    position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(251,247,238,0.92)',
  },
  bannerEditText: { fontFamily: F.uiBold, fontSize: 12, color: T.paperInk },
  removeBanner: { alignSelf: 'center', marginTop: 10 },

  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 22, marginBottom: 8 },
  input: {
    minHeight: 54, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: F.uiSemi, fontSize: 16, color: T.ivory,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  inputBad: { borderColor: T.danger },
  multiline: { minHeight: 140 },
  bad: { fontFamily: F.ui, fontSize: 13, color: T.danger, marginTop: 8, marginLeft: 4 },
  hint: { fontFamily: F.ui, fontSize: 13, color: T.faint, marginTop: 8, marginLeft: 4 },

  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  preset: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 16,
    borderWidth: 1, borderColor: T.lineStrong,
  },
  presetTaken: { borderColor: T.line },
  presetText: { fontFamily: F.uiBold, fontSize: 13, color: T.champagne },
  presetTextTaken: { color: T.faint },
  level: {
    marginTop: 16, padding: 16, paddingTop: 14, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelNo: { fontFamily: F.display, fontSize: 20, color: T.champagne },
  levelRow: { flexDirection: 'row', gap: 12 },
  levelPrice: { fontFamily: F.uiHeavy, fontSize: 13, color: T.champagne, marginTop: 10, marginLeft: 4 },
  addLevel: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, height: 52,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: T.lineStrong,
  },
  addLevelText: { fontFamily: F.uiBold, fontSize: 14.5, color: T.champagne },

  loading: { marginTop: 24 },
  till: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 14, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  tillOn: { borderColor: T.gold, backgroundColor: 'rgba(201,164,92,0.08)' },
  tillOff: { opacity: 0.5 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: T.lineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: T.gold },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: T.gold },
  tillName: { fontFamily: F.uiBold, fontSize: 15, color: T.ivory },
  tillNumber: { fontFamily: F.uiSemi, fontSize: 12.5, color: T.muted, marginTop: 3 },
  tillNote: { fontFamily: F.ui, fontSize: 12.5, color: T.danger, marginTop: 4 },
  addTill: {
    marginTop: 16, padding: 16, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  addTillTitle: { fontFamily: F.display, fontSize: 21, color: T.ivory },
  saveTill: { marginTop: 16 },

  notice: {
    flexDirection: 'row', gap: 10, marginTop: 18, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(232,212,170,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: T.lineStrong,
  },
  noticeText: { flex: 1, fontFamily: F.uiSemi, fontSize: 13.5, lineHeight: 20, color: T.ivory },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },

  preview: { alignSelf: 'center', marginTop: 20, borderRadius: 26, overflow: 'hidden', backgroundColor: T.surface },
  previewTile: { position: 'absolute', top: 14, left: 14 },
  previewText: { position: 'absolute', left: 20, right: 20, bottom: 20 },
  previewTitle: { fontFamily: F.display, fontSize: 32, lineHeight: 35, color: T.ivory, marginTop: 6 },
  previewMeta: { fontFamily: F.uiSemi, fontSize: 13, color: T.muted, marginTop: 8 },
  previewPrice: { fontFamily: F.uiHeavy, fontSize: 15, color: T.champagne, marginTop: 10 },

  reviewBlock: {
    marginTop: 14, padding: 16, borderRadius: 18,
    backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  reviewLine: { fontFamily: F.uiSemi, fontSize: 14.5, lineHeight: 21, color: T.ivory },
  reviewMuted: { fontFamily: F.ui, fontSize: 13.5, color: T.muted, marginTop: 2 },
  reviewLevel: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },

  error: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  errorText: { flex: 1, fontFamily: F.uiSemi, fontSize: 14, lineHeight: 20, color: T.ivory },

  bar: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 10,
    backgroundColor: T.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.lineStrong,
  },
  barRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  backBtn: { height: 54, borderRadius: 27 },
  progressText: { fontFamily: F.uiSemi, fontSize: 13, color: T.champagne, textAlign: 'center' },

  doneScroll: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 70 },
  doneIcon: {
    width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: T.lineStrong, backgroundColor: T.surface,
  },
  doneIconLive: { backgroundColor: T.champagne, borderColor: T.champagne },
  doneTitle: { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: T.ivory, textAlign: 'center', marginTop: 24 },
  doneBody: { fontFamily: F.ui, fontSize: 15, lineHeight: 23, color: T.muted, textAlign: 'center', marginTop: 12, maxWidth: 380 },
  doneEvent: { fontFamily: F.display, fontSize: 22, color: T.champagne, textAlign: 'center', marginTop: 26 },
});

export default TicketCreateEvent;
