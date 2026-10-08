/**
 * Who is in the room, and what can be done about one of them.
 *
 *  - list mode (the viewer count tapped): everyone, on stage first;
 *  - person mode (a name in chat, or a row of the list tapped): view their
 *    profile; for the host / a co-host also pin that comment, mute or unmute
 *    them in chat, remove them from the broadcast.
 *
 * Presentation only: the room passes the people and the handlers.
 */
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, FlatList,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { live } from '../../constants/liveTheme';
import { useI18n } from '../../context/I18nContext';

const Action = ({ icon, label, onPress, danger, testID }) => (
  <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button" testID={testID}>
    <MaterialCommunityIcons name={icon} size={20} color={danger ? live.live : live.gold} />
    <Text style={[styles.actionText, danger && { color: live.live }]}>{label}</Text>
  </TouchableOpacity>
);

const PeopleSheet = ({
  visible, mode, people, person, message, canModerate, isMuted, onPick, onClose,
  onProfile, onPin, onMute, onRemove,
}) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <View style={styles.handle} />
          {mode === 'list' ? (
            <>
              <Text style={styles.title}>{t('live.people')} · {people.length}</Text>
              <FlatList
                data={people}
                keyExtractor={(p) => p.identity}
                style={{ maxHeight: 420 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.row} onPress={() => onPick(item)} testID={`person-${item.identity}`}>
                    <Ionicons name="person-circle-outline" size={28} color={live.inkDim} />
                    <Text style={styles.rowName} numberOfLines={1}>@{item.name}</Text>
                    {item.onStage && <Text style={styles.badge}>{t('live.onStageLabel')}</Text>}
                    {item.host && <Text style={styles.badge}>{t('live.hostBadge')}</Text>}
                  </TouchableOpacity>
                )}
              />
            </>
          ) : person ? (
            <>
              <Text style={styles.title} numberOfLines={1}>@{person.name}</Text>
              {!!message?.text && <Text style={styles.quote} numberOfLines={3}>“{message.text}”</Text>}
              <Action icon="account-outline" label={t('live.viewProfile')} onPress={onProfile} testID="person-profile" />
              {canModerate && !person.host && (
                <>
                  {!!message?.text && (
                    <Action icon="pin-outline" label={t('live.pin')} onPress={onPin} testID="person-pin" />
                  )}
                  <Action
                    icon={isMuted ? 'message-text-outline' : 'message-off-outline'}
                    label={isMuted ? t('live.unmuteChat') : t('live.muteChat')}
                    onPress={onMute}
                    testID="person-mute"
                  />
                  <Action icon="account-remove-outline" label={t('live.remove')} onPress={onRemove} danger
                    testID="person-remove" />
                </>
              )}
            </>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,12,24,0.55)' },
  sheet: {
    backgroundColor: '#0A1B33', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 18, borderTopWidth: 1, borderColor: live.hair, gap: 4,
  },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 6 },
  quote: { color: live.inkDim, fontSize: 14, fontStyle: 'italic', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 48 },
  rowName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  badge: {
    color: live.onGold, backgroundColor: live.gold, fontSize: 10, fontWeight: '900', overflow: 'hidden',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 48 },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default PeopleSheet;
