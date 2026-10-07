// When the server refuses a write because this account is suspended
// (songs/account_limits.py), say so plainly — why, until when, and the way to
// appeal — instead of each screen's "something went wrong". Once in a while,
// not on every refused tap.
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { on, EVENTS } from '../utils/appEvents';
import { navigate } from '../services/navigationRef';
import { useI18n } from '../context/I18nContext';

const QUIET_MS = 5 * 60 * 1000;

export default function SuspendedNotice() {
  const { t } = useI18n();
  const last = useRef(0);

  useEffect(() => on(EVENTS.ACCOUNT_SUSPENDED, (data) => {
    if (Date.now() - last.current < QUIET_MS) return;
    last.current = Date.now();
    const lines = [t('suspended.body')];
    if (data?.until) lines.push(t('suspended.until', { date: new Date(data.until).toLocaleDateString() }));
    if (data?.reason) lines.push(t('suspended.reason', { reason: data.reason }));
    Alert.alert(t('suspended.title'), lines.join('\n\n'), [
      { text: t('common.close'), style: 'cancel' },
      { text: t('suspended.appeal'), onPress: () => navigate('Appeal') },
    ]);
  }), [t]);

  return null;
}
