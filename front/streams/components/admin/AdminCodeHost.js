// The authenticator-code box, for the whole app (mounted once in App.js).
// When the server wants a code from an admin (the admin session has ended,
// or a dangerous action wants a fresh code), this opens over whatever screen
// they are on (admin tools, the notice board, the notes to admins) and the
// action goes on once a code is given (services/api.js, utils/adminSession.js).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { verifyAdminCode } from '../../services/api';
import { setAdminSession, setCodeAsker } from '../../utils/adminSession';
import { CodeBox } from './AdminGate';

const errorOf = (e, fallback) => e?.data?.error || e?.response?.data?.error || fallback;

export default function AdminCodeHost() {
  const { t } = useI18n();
  const [ask, setAsk] = useState(null);      // { reason, resolve }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setCodeAsker((reason) => new Promise((resolve) => { setError(''); setAsk({ reason, resolve }); }));
    return () => setCodeAsker(null);
  }, []);

  const done = (ok) => {
    ask?.resolve(ok);
    setAsk(null);
    setError('');
  };

  const verify = async (entry) => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyAdminCode(entry);
      if (res?.admin_session) await setAdminSession(res.admin_session, res.expires_at);
      done(true);
    } catch (e) {
      const code = e?.data?.code || e?.response?.data?.code;
      setError(e?.status === 429 ? errorOf(e, t('admin.gate.tooMany'))
        : code === 'not_enabled' ? t('admin.gate.setupFirst')
          : errorOf(e, t('admin.gate.wrong')));
    } finally {
      setBusy(false);
    }
  };

  const fresh = ask?.reason === 'reauth_required';
  return (
    <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => done(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="admin-reauth">
          <Ionicons name="shield-checkmark-outline" size={30} color="#FFC46B" />
          <Text style={styles.title}>{fresh ? t('admin.gate.confirmTitle') : t('admin.gate.codeTitle')}</Text>
          <Text style={styles.body}>{fresh ? t('admin.gate.confirmBody') : t('admin.gate.codeBody')}</Text>
          {!!ask && <CodeBox t={t} busy={busy} error={error} testID="admin-reauth-code" onSubmit={verify} />}
          <TouchableOpacity onPress={() => done(false)} style={styles.cancel} testID="admin-reauth-cancel">
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center', gap: 12,
    backgroundColor: '#13233B', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: '#1E3150',
  },
  title: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  body: { color: '#9FB0C8', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  cancel: { paddingVertical: 8 },
  cancelText: { color: '#9FB0C8', fontSize: 13, fontWeight: '700' },
});
