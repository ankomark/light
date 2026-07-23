import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Modal, TouchableOpacity } from 'react-native';
import { fetchGroupJoinRequests, approveJoinRequest, rejectJoinRequest } from '../services/api';
import GroupRequestItem from './GroupRequestItem';
import { useI18n } from '../context/I18nContext';

const GroupJoinRequests = ({ route, navigation, groupSlug: groupSlugProp, onClose: onCloseProp }) => {
  const { t } = useI18n();
  // This screen is reached via React Navigation (props are route/navigation) but
  // can also be rendered directly with groupSlug/onClose props. Support both.
  const groupSlug = groupSlugProp ?? route?.params?.groupSlug;
  const onClose = onCloseProp ?? (() => navigation?.goBack());

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

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
    try {
      await approveJoinRequest(requestId);
      setRequests(requests.filter(req => req.id !== requestId));
    } catch (error) {
      console.error('Failed to approve request:', error);
    }
  };

  const handleReject = async (requestId) => {
    try {
      await rejectJoinRequest(requestId);
      setRequests(requests.filter(req => req.id !== requestId));
    } catch (error) {
      console.error('Failed to reject request:', error);
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={true}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('groupReq.title')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeButton}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
        
        {loading ? (
          <ActivityIndicator size="large" style={styles.loader} />
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <GroupRequestItem 
                request={item}
                onApprove={() => handleApprove(item.id)}
                onReject={() => handleReject(item.id)}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('groupReq.none')}</Text>
            }
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: 'white',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    color: '#1e88e5',
    fontSize: 16,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
    color: '#666',
  },
});

export default GroupJoinRequests;