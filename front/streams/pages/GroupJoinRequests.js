import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchGroupJoinRequests, approveJoinRequest, rejectJoinRequest } from '../services/api';
import GroupRequestItem from './GroupRequestItem';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const GroupJoinRequests = ({ route, navigation, groupSlug: groupSlugProp, onClose: onCloseProp }) => {
  const { t } = useI18n();
  // This screen is reached via React Navigation (props are route/navigation) but
  // can also be rendered directly with groupSlug/onClose props. Support both.
  const groupSlug = groupSlugProp ?? route?.params?.groupSlug;
  const onClose = onCloseProp ?? (() => navigation?.goBack());

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!groupSlug) {
      setLoading(false);
      return;
    }
    let active = true;
    const loadRequests = async () => {
      try {
        setLoading(true);
        const data = await fetchGroupJoinRequests(groupSlug);
        if (active) setRequests(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to load requests:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRequests();
    return () => { active = false; };
  }, [groupSlug]);

  const handleApprove = async (requestId) => {
    setBusyId(requestId);
    try {
      await approveJoinRequest(requestId);
      setRequests((prev) => prev.filter((req) => req.id !== requestId));
    } catch (error) {
      console.error('Failed to approve request:', error);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (requestId) => {
    setBusyId(requestId);
    try {
      await rejectJoinRequest(requestId);
      setRequests((prev) => prev.filter((req) => req.id !== requestId));
    } catch (error) {
      console.error('Failed to reject request:', error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal animationType="slide" transparent={false} visible onRequestClose={onClose}>
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.72)" />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>{t('groupReq.title')}</Text>
              {!loading && (
                <Text style={styles.subtitle}>
                  {requests.length > 0
                    ? t('groupReq.pending', { count: requests.length })
                    : t('groupReq.allClear')}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loader}><ActivityIndicator size="large" color={colors.accent} /></View>
          ) : (
            <FlatList
              data={requests}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <GroupRequestItem
                  request={item}
                  busy={busyId === item.id}
                  onApprove={() => handleApprove(item.id)}
                  onReject={() => handleReject(item.id)}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyText}>{t('groupReq.none')}</Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerTitleWrap: { flex: 1 },
  title: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
});

export default GroupJoinRequests;
