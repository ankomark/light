import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, StatusBar,Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const Conferences = () => {
  const [selectedConference, setSelectedConference] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const conferences = [
    {
      id: 1,
      name: "General Conference Headquarters",
      subtitle: "Global Administrative Center",
      detail: `**Global Headquarters:**\nSilver Spring, Maryland, USA\n\n**Leadership:**\n- President: Ted N.C. Wilson\n- Secretary: Erton Köhler\n- Treasurer: Paul Douglas\n\n**Governance:**\n- Highest governing body of the Seventh-day Adventist Church\n- Organized into 13 world divisions\n- Quadrennial World Session with delegates from 213 countries\n\n**Key Functions:**\n1. Coordinates global church operations\n2. Maintains doctrinal unity\n3. Oversees 9,500+ institutions worldwide\n4. Manages global humanitarian work through ADRA\n5. Organizes worldwide evangelistic initiatives`
    },
    {
      id: 2,
      name: "Africa-Indian Ocean Division",
      subtitle: "Largest Regional Membership",
      detail: `**Territory:**\n54 countries including Nigeria, Kenya, Congo\n\n**Statistics:**\n- Churches: 28,000+\n- Membership: 8.5 million\n- Unions: 40\n- Conferences: 180\n- Institutions: 1,800+\n\n**Headquarters:**\nNairobi, Kenya\n\n**Unique Ministries:**\n- Rapid church planting initiatives\n- Mobile health clinics\n- Radio broadcasting in 40+ languages\n- Largest network of Adventist schools globally`
    },
    {
      id: 3,
      name: "Southern Asia-Pacific Division",
      subtitle: "Fastest Growing Region",
      detail: `**Territory:**\n14 countries including Philippines, India, Pakistan\n\n**Statistics:**\n- Churches: 11,000+\n- Membership: 2.3 million\n- Unions: 15\n- Conferences: 90\n- Institutions: 700+\n\n**Headquarters:**\nCavite, Philippines\n\n**Growth Factors:**\n- 5,000+ new congregations annually\n- Medical missionary programs\n- Comprehensive education system\n- Urban evangelism centers in 25+ megacities`
    },
    {
      id: 4,
      name: "Inter-American Division",
      subtitle: "Pioneer Mission Region",
      detail: `**Territory:**\n42 countries including Mexico, Jamaica, Haiti\n\n**Statistics:**\n- Churches: 15,000+\n- Membership: 4.2 million\n- Unions: 24\n- Conferences: 110\n- Institutions: 1,200+\n\n**Headquarters:**\nMiami, Florida, USA\n\n**Historical Significance:**\n- First division established (1922)\n- Operates largest Adventist university (UNAD, Colombia)\n- Pioneered Global Mission projects\n- Leads in media evangelism (Hope Channel Español)`
    },
    {
      id: 5,
      name: "Adventist Development and Relief Agency (ADRA)",
      subtitle: "Global Humanitarian Arm",
      detail: `**Operations:**\n- Active in 118 countries\n- $250M+ annual humanitarian aid\n- 5,000+ staff worldwide\n\n**Key Initiatives:**\n1. Disaster Response: 300+ emergencies annually\n2. Food Security: Feeds 1.5M+ people yearly\n3. Health Programs: Maternal care, disease prevention\n4. Economic Development: Microfinance, vocational training\n\n**Core Principle:**\n"Changing the world through compassionate service" - Integrating practical help with spiritual care`
    },
    {
      id: 6,
      name: "Adventist Education System",
      subtitle: "World's Largest Protestant School System",
      detail: `**Global Network:**\n- 8,500+ schools\n- 100+ universities/colleges\n- 2.5 million students\n- 175,000 teachers\n\n**Educational Philosophy:**\n"Redemptive education" focusing on:\n- Spiritual development\n- Academic excellence\n- Service-oriented mindset\n- Healthful living\n\n**Notable Institutions:**\n1. Loma Linda University (USA)\n2. Helderberg College (South Africa)\n3. Babcock University (Nigeria)\n4. Adventist University of the Philippines`
    },
    {
      id: 7,
      name: "Global Mission Centers",
      subtitle: "Frontier Evangelism",
      detail: `**Strategic Focus:**\nReaching Unentered People Groups\n\n**Structure:**\n- 12 Global Mission Centers worldwide\n- 1,000+ pioneer missionaries\n- Specialized focus on:\n  - Urban centers (100+ megacities)\n  - Non-Christian religious groups\n  - Remote tribal communities\n\n**Approach:**\n1. Contextualized ministry methods\n2. House church planting\n3. Medical missionary work\n4. Literacy programs\n\n**Impact:**\nEstablished 50,000+ new congregations in past decade`
    }
  ];

  const openConferenceDetail = (conference) => {
    setSelectedConference(conference);
    setModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor="#0f172a" barStyle="light-content" />
      <ScrollView 
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>SEVENTH-DAY ADVENTIST STRUCTURE</Text>
        <Text style={styles.subtitle}>Global Organization & Regional Divisions</Text>
        
        {conferences.map((conference) => (
          <TouchableOpacity 
            key={conference.id}
            style={styles.conferenceItem}
            onPress={() => openConferenceDetail(conference)}
            activeOpacity={0.7}
          >
            <Text style={styles.conferenceName}>{conference.name}</Text>
            <Text style={styles.conferenceSubtitle}>{conference.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
        statusBarTranslucent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <ScrollView 
              style={styles.modalScrollView}
              contentContainerStyle={styles.modalContent}
            >
              <Text style={styles.modalTitle}>{selectedConference?.name}</Text>
              <Text style={styles.modalSubtitle}>{selectedConference?.subtitle}</Text>
              
              <Text style={styles.modalText}>
                {selectedConference?.detail.split('\n').map((line, index) => {
                  if (line.startsWith('**')) {
                    return (
                      <Text key={index} style={styles.boldText}>
                        {line.replace(/\*\*/g, '')}
                        {'\n\n'}
                      </Text>
                    );
                  }
                  return (
                    <Text key={index}>
                      {line}
                      {'\n\n'}
                    </Text>
                  );
                })}
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: 'aliceblue',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 25,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  conferenceItem: {
    marginBottom: 18,
    padding: 18,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderLeftWidth: 5,
    borderLeftColor: '#ca8a04',
    elevation: 3,
  },
  conferenceName: {
    fontSize: 18,
    fontWeight: '700',
    color: 'aliceblue',
  },
  conferenceSubtitle: {
    fontSize: 14,
    color: '#e2e8f0',
    marginTop: 6,
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
     paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  modalContainer: {
    width: '90%',
    maxHeight: '85%',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderColor: '#ca8a04',
    borderWidth: 2,
    overflow: 'hidden',
  },
  modalScrollView: {
    width: '100%',
  },
  modalContent: {
    padding: 25,
    paddingBottom: 15,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fef08a',
    textAlign: 'center',
    marginBottom: 5,
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#e2e8f0',
    textAlign: 'center',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  modalText: {
    fontSize: 16,
    color: 'aliceblue',
    lineHeight: 24,
  },
  boldText: {
    fontWeight: 'bold',
    color: '#fef08a',
  },
  closeButton: {
    backgroundColor: '#ca8a04',
    padding: 14,
    alignItems: 'center',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  closeButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
});

export default Conferences;