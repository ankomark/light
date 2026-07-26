/**
 * Web-only styled confirmation modal for admin actions.
 *
 * Mounted once at the web app root (App.web.js). On mount it registers a shower
 * function with utils/adminConfirm; confirmAction() calls it and awaits the
 * Promise this resolves when the user picks a button. Keeps the admin screens'
 * `await confirmAction({...})` call sites unchanged while giving web a themed
 * dialog instead of the browser's plain window.confirm. (Native never mounts
 * this — it uses the OS Alert.)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { registerConfirmHost } from '../../utils/adminConfirm';
import { colors } from '../../constants/theme';

export default function ConfirmHost() {
  const [cfg, setCfg] = useState(null);
  const resolverRef = useRef(null);

  useEffect(() => {
    registerConfirmHost((next) => new Promise((resolve) => {
      // If a prompt is somehow still open, cancel it before showing the new one
      // so its awaiter never hangs.
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setCfg(next);
    }));
    return () => registerConfirmHost(null);
  }, []);

  const finish = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setCfg(null);
    if (resolve) resolve(result);
  }, []);

  if (!cfg) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => finish(false)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => finish(false)}>
        {/* Inner card swallows presses so tapping it doesn't dismiss. */}
        <TouchableOpacity activeOpacity={1} style={styles.card}>
          <Text style={styles.title}>{cfg.title}</Text>
          {cfg.message ? <Text style={styles.message}>{cfg.message}</Text> : null}
          <View style={styles.actions}>
            {/* A notice is informational — a single dismiss button, no Cancel. */}
            {cfg.variant !== 'notice' && (
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => finish(false)} activeOpacity={0.85}>
                <Text style={styles.btnCancelText}>{cfg.cancelLabel || 'Cancel'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btn, cfg.destructive ? styles.btnDanger : styles.btnConfirm]}
              onPress={() => finish(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.btnConfirmText, cfg.destructive && styles.btnDangerText]}>
                {cfg.confirmLabel || 'OK'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
    backgroundColor: 'rgba(5,12,24,0.6)',
  },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: '#102E50', borderRadius: 16, padding: 24,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', gap: 10,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  message: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, minWidth: 96, alignItems: 'center' },
  btnCancel: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnCancelText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 15 },
  btnConfirm: { backgroundColor: colors.accent },
  btnConfirmText: { color: '#0A1628', fontWeight: '800', fontSize: 15 },
  btnDanger: { backgroundColor: colors.error },
  btnDangerText: { color: '#fff' },
});
