import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import TrackUploadForm from './TrackUploadForm';

const UploadTrackPage = () => {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Upload a New Track</Text>
            <TrackUploadForm />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#fff',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
});

export default UploadTrackPage;
