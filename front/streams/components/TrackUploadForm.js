

// // import React, { useState } from 'react';
// // import { View, TextInput, Button, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
// // import * as DocumentPicker from 'expo-document-picker'; // For file uploads
// // import * as ImagePicker from 'expo-image-picker'; // For image uploads
// // import { useNavigation } from '@react-navigation/native';
// // import { createTrack } from '../services/api';

// // const TrackUploadForm = () => {
// //     const [title, setTitle] = useState('');
// //     const [album, setAlbum] = useState('');
// //     const [audioFile, setAudioFile] = useState(null);
// //     const [coverImage, setCoverImage] = useState(null);
// //     const [lyrics, setLyrics] = useState('');
// //     const [audioFileMessage, setAudioFileMessage] = useState('');
// //     const [coverImageMessage, setCoverImageMessage] = useState('');
// //     const navigation = useNavigation();

// //     const handleAudioFileChange = async () => {
// //         try {
// //             const result = await DocumentPicker.getDocumentAsync({
// //                 type: 'audio/*', // Allow only audio files
// //             });

// //             if (result.canceled) {
// //                 setAudioFile(null);
// //                 setAudioFileMessage('Please select a valid audio file.');
// //                 return;
// //             }

// //             if (result.assets && result.assets[0]) {
// //                 const file = result.assets[0];
// //                 if (file.mimeType.startsWith('audio/')) {
// //                     setAudioFile(file);
// //                     setAudioFileMessage(`Audio file selected: ${file.name}`);
// //                 } else {
// //                     setAudioFile(null);
// //                     setAudioFileMessage('Please select a valid audio file.');
// //                 }
// //             } else {
// //                 setAudioFile(null);
// //                 setAudioFileMessage('Failed to select audio file.');
// //             }
// //         } catch (error) {
// //             console.error('Error selecting audio file:', error);
// //             setAudioFileMessage('Failed to select audio file.');
// //         }
// //     };

// //     const handleCoverImageChange = async () => {
// //         try {
// //             const result = await ImagePicker.launchImageLibraryAsync({
// //                 mediaTypes: ImagePicker.MediaTypeOptions.Images,
// //                 allowsEditing: true,
// //                 quality: 1,
// //             });

// //             if (!result.canceled && result.assets && result.assets[0]) {
// //                 setCoverImage(result.assets[0]);
// //                 setCoverImageMessage(`Cover image selected: ${result.assets[0].fileName}`);
// //             } else {
// //                 setCoverImage(null);
// //                 setCoverImageMessage('Please select a valid image file.');
// //             }
// //         } catch (error) {
// //             console.error('Error selecting image:', error);
// //             setCoverImageMessage('Failed to select image.');
// //         }
// //     };

// //     const handleSubmit = async () => {
// //         if (!title || !audioFile) {
// //             Alert.alert('Error', 'Please fill out all required fields.');
// //             return;
// //         }
    
// //         const formData = new FormData();
// //         formData.append('title', title);
// //         formData.append('album', album);
    
// //         if (audioFile) {
// //             formData.append('audio_file', {
// //               uri: audioFile.uri,
// //               name: audioFile.name || 'audio.mp3',
// //               type: audioFile.mimeType || 'audio/mpeg',
// //             });
// //           }
          
// //           if (coverImage) {
// //             formData.append('cover_image', {
// //               uri: coverImage.uri,
// //               name: coverImage.fileName || 'cover.jpg',
// //               type: coverImage.mimeType || 'image/jpeg',
// //             });
// //           }
    
// //         formData.append('lyrics', lyrics);
    
// //         // Log the FormData for debugging
// //         for (let [key, value] of formData.entries()) {
// //             console.log(key, value);
// //         }
    
// //         try {
// //             const response = await createTrack(formData);
// //             console.log('Upload response:', response); // Log the response
// //             navigation.navigate('Home'); // Navigate to Home after successful upload
// //         } catch (error) {
// //             console.error('Error uploading track:', error);
// //             if (error.response) {
// //                 // The request was made and the server responded with a status code
// //                 Alert.alert('Error', `Server error: ${error.response.data.message || error.response.status}`);
// //             } else if (error.request) {
// //                 // The request was made but no response was received
// //                 Alert.alert('Error', 'No response from the server. Please check your network connection.');
// //             } else {
// //                 // Something happened in setting up the request
// //                 Alert.alert('Error', 'Failed to upload track. Please try again.');
// //             }
// //         }
// //     };

// //     return (
// //         <View style={styles.formContainer}>
// //             <TextInput
// //                 style={styles.input}
// //                 placeholder="Track Title"
// //                 value={title}
// //                 onChangeText={setTitle}
// //                 required
// //             />
// //             <TextInput
// //                 style={styles.input}
// //                 placeholder="Album Name"
// //                 value={album}
// //                 onChangeText={setAlbum}
// //             />
// //             <TouchableOpacity style={styles.button} onPress={handleAudioFileChange}>
// //                 <Text style={styles.buttonText}>Select Audio File</Text>
// //             </TouchableOpacity>
// //             <Text style={styles.message}>{audioFileMessage}</Text>
// //             <TouchableOpacity style={styles.button} onPress={handleCoverImageChange}>
// //                 <Text style={styles.buttonText}>Select Cover Image</Text>
// //             </TouchableOpacity>
// //             <Text style={styles.message}>{coverImageMessage}</Text>
// //             <TextInput
// //                 style={styles.textArea}
// //                 placeholder="Lyrics"
// //                 value={lyrics}
// //                 onChangeText={setLyrics}
// //                 multiline
// //             />
// //             <TouchableOpacity style={styles.uploadButton} onPress={handleSubmit}>
// //                 <Text style={styles.uploadButtonText}>Upload Track</Text>
// //             </TouchableOpacity>
// //         </View>
// //     );
// // };

// import React, { useState } from 'react';
// import {
//   View,

//   TextInput,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   Alert,
//   ActivityIndicator,
//   ScrollView,
//   KeyboardAvoidingView,
//   Platform
// } from 'react-native';
// import * as DocumentPicker from 'expo-document-picker';
// import * as ImagePicker from 'expo-image-picker';
// import * as FileSystem from 'expo-file-system';
// import { useNavigation } from '@react-navigation/native';
// import { createTrack } from '../services/api';
// import { v4 as uuidv4 } from 'uuid';

// // Constants for better maintainability
// const CLOUDINARY_CONFIG = {
//   CLOUD_NAME: 'dxdmo9j4v',
//   AUDIO_UPLOAD_PRESET: 'audio_uploads',
//   IMAGE_UPLOAD_PRESET: 'cover_images_preset',
//   AUDIO_FOLDER: 'audio_uploads',
//   IMAGE_FOLDER: 'cover_images',
//   MAX_AUDIO_SIZE_MB: 20,
//   MAX_IMAGE_SIZE_MB: 5,
// };
// const TrackUploadForm = () => {
//   const [formData, setFormData] = useState({
//     title: '',
//     album: '',
//     lyrics: ''
//   });
//   const [audioFile, setAudioFile] = useState(null);
//   const [coverImage, setCoverImage] = useState(null);
//   const [isUploading, setIsUploading] = useState(false);
//   const [statusMessages, setStatusMessages] = useState({
//     audio: '',
//     image: ''
//   });
//   const navigation = useNavigation();

//   /**
//    * Handles input changes for form fields
//    * @param {string} field - Field name to update
//    * @param {string} value - New value for the field
//    */
//   const handleInputChange = (field, value) => {
//     setFormData(prev => ({ ...prev, [field]: value }));
//   };

//   /**
//    * Uploads a file to Cloudinary
//    * @param {object} file - File object to upload
//    * @param {string} resourceType - 'video' for audio or 'image' for images
//    * @param {string} folder - Cloudinary folder to upload to
//    * @returns {Promise<string>} - Secure URL of the uploaded file
//    */
//   const uploadToCloudinary = async (file, resourceType, folder) => {
//     const isAudio = resourceType === 'video';
//     const uploadPreset = isAudio 
//       ? CLOUDINARY_CONFIG.AUDIO_UPLOAD_PRESET 
//       : CLOUDINARY_CONFIG.IMAGE_UPLOAD_PRESET;

//     const formData = new FormData();
//     formData.append('file', {
//       uri: file.uri,
//       name: file.name || `${uuidv4()}.${isAudio ? 'mp3' : 'jpg'}`,
//       type: file.mimeType || (isAudio ? 'audio/mpeg' : 'image/jpeg')
//     });
//     formData.append('upload_preset', uploadPreset);
//     formData.append('folder', folder);
//     formData.append('cloud_name', CLOUDINARY_CONFIG.CLOUD_NAME);

//     try {
//       const response = await fetch(
//         `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.CLOUD_NAME}/${resourceType}/upload`,
//         {
//           method: 'POST',
//           body: formData,
//           headers: {
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );

//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.message || 'Upload failed');
//       }

//       return (await response.json()).secure_url;
//     } catch (error) {
//       console.error(`Cloudinary ${resourceType} upload error:`, error);
//       throw new Error(`Failed to upload ${isAudio ? 'audio' : 'image'}: ${error.message}`);
//     }
//   };

//   /**
//    * Handles audio file selection with validation
//    */
//   const handleAudioFileChange = async () => {
//     try {
//       const result = await DocumentPicker.getDocumentAsync({
//         type: 'audio/*',
//         copyToCacheDirectory: true
//       });

//       if (result.canceled || !result.assets?.[0]) {
//         setStatusMessages(prev => ({ ...prev, audio: 'No file selected' }));
//         return;
//       }

//       const file = result.assets[0];
      
//       // Validate file type
//       if (!file.mimeType?.startsWith('audio/')) {
//         setStatusMessages(prev => ({ ...prev, audio: 'Invalid audio format' }));
//         return;
//       }

//       // Validate file size
//       const fileInfo = await FileSystem.getInfoAsync(file.uri);
//       const fileSizeMB = fileInfo.size / (1024 * 1024);
      
//       if (fileSizeMB > CLOUDINARY_CONFIG.MAX_AUDIO_SIZE_MB) {
//         setStatusMessages(prev => ({ 
//           ...prev, 
//           audio: `File too large (max ${CLOUDINARY_CONFIG.MAX_AUDIO_SIZE_MB}MB)` 
//         }));
//         return;
//       }

//       setAudioFile(file);
//       setStatusMessages(prev => ({ 
//         ...prev, 
//         audio: `Selected: ${file.name} (${fileSizeMB.toFixed(1)}MB)` 
//       }));
//     } catch (error) {
//       console.error('Audio selection error:', error);
//       setStatusMessages(prev => ({ 
//         ...prev, 
//         audio: 'Failed to select audio' 
//       }));
//     }
//   };

//   /**
//    * Handles cover image selection with validation
//    */
//   const handleCoverImageChange = async () => {
//     try {
//       const result = await ImagePicker.launchImageLibraryAsync({
//         mediaTypes: ImagePicker.MediaTypeOptions.Images,
//         allowsEditing: true,
//         aspect: [1, 1],
//         quality: 0.8,
//       });

//       if (result.canceled || !result.assets?.[0]) {
//         setStatusMessages(prev => ({ ...prev, image: 'No image selected' }));
//         return;
//       }

//       const image = result.assets[0];
      
//       // Validate image size
//       const fileInfo = await FileSystem.getInfoAsync(image.uri);
//       const fileSizeMB = fileInfo.size / (1024 * 1024);
      
//       if (fileSizeMB > CLOUDINARY_CONFIG.MAX_IMAGE_SIZE_MB) {
//         setStatusMessages(prev => ({ 
//           ...prev, 
//           image: `Image too large (max ${CLOUDINARY_CONFIG.MAX_IMAGE_SIZE_MB}MB)` 
//         }));
//         return;
//       }

//       setCoverImage(image);
//       setStatusMessages(prev => ({ 
//         ...prev, 
//         image: `Selected: ${image.fileName || 'cover'} (${fileSizeMB.toFixed(1)}MB)` 
//       }));
//     } catch (error) {
//       console.error('Image selection error:', error);
//       setStatusMessages(prev => ({ 
//         ...prev, 
//         image: 'Failed to select image' 
//       }));
//     }
//   };

//   /**
//    * Handles form submission with validation and upload process
//    */
//   const handleSubmit = async () => {
//     if (!formData.title) {
//       Alert.alert('Error', 'Track title is required');
//       return;
//     }

//     if (!audioFile) {
//       Alert.alert('Error', 'Audio file is required');
//       return;
//     }

//     setIsUploading(true);

//     try {
//       // Upload files sequentially
//       setStatusMessages(prev => ({ ...prev, audio: 'Uploading audio...' }));
//       const audioUrl = await uploadToCloudinary(
//         audioFile, 
//         'video', 
//         CLOUDINARY_CONFIG.AUDIO_FOLDER
//       );
      
//       let coverUrl = null;
//       if (coverImage) {
//         setStatusMessages(prev => ({ ...prev, image: 'Uploading cover...' }));
//         coverUrl = await uploadToCloudinary(
//           coverImage, 
//           'image', 
//           CLOUDINARY_CONFIG.IMAGE_FOLDER
//         );
//       }

//       // Submit to backend
//       await createTrack({
//         ...formData,
//         audio_file: audioUrl,
//         cover_image: coverUrl
//       });

//       Alert.alert('Success', 'Track uploaded successfully');
//       navigation.navigate('Home');
//     } catch (error) {
//       console.error('Upload error:', error);
//       Alert.alert(
//         'Upload Failed', 
//         error.message || 'An error occurred during upload'
//       );
//     } finally {
//       setIsUploading(false);
//       setStatusMessages({ audio: '', image: '' });
//     }
//   };

//   return (
//     <KeyboardAvoidingView
//       behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
//       style={styles.container}
//       keyboardVerticalOffset={Platform.OS === 'ios' ? 85 : 0}
//     >
//       <ScrollView 
//         contentContainerStyle={styles.scrollContainer}
//         keyboardShouldPersistTaps="handled"
//         showsVerticalScrollIndicator={false}
//       >
//         <View style={styles.card}>
//           <Text style={styles.header}>Upload New Track</Text>
          
//           <View style={styles.section}>
//             <Text style={styles.sectionTitle}>Basic Information</Text>
//             <TextInput
//               style={styles.input}
//               placeholder="Track Title *"
//               placeholderTextColor="#999"
//               value={formData.title}
//               onChangeText={(text) => handleInputChange('title', text)}
//               editable={!isUploading}
//             />
            
//             <TextInput
//               style={styles.input}
//               placeholder="Album Name"
//               placeholderTextColor="#999"
//               value={formData.album}
//               onChangeText={(text) => handleInputChange('album', text)}
//               editable={!isUploading}
//             />
//           </View>

//           <View style={styles.section}>
//             <Text style={styles.sectionTitle}>Media Files</Text>
            
//             <FileSelectorButton
//               icon="🎵"
//               label={audioFile ? 'Change Audio File' : 'Select Audio File *'}
//               onPress={handleAudioFileChange}
//               disabled={isUploading}
//               message={statusMessages.audio}
//             />
            
//             <FileSelectorButton
//               icon="🖼️"
//               label={coverImage ? 'Change Cover Image' : 'Select Cover Image'}
//               onPress={handleCoverImageChange}
//               disabled={isUploading}
//               message={statusMessages.image}
//             />
//           </View>

//           <View style={styles.section}>
//             <Text style={styles.sectionTitle}>Lyrics (Optional)</Text>
//             <TextInput
//               style={styles.textArea}
//               placeholder="Enter lyrics here..."
//               placeholderTextColor="#999"
//               value={formData.lyrics}
//               onChangeText={(text) => handleInputChange('lyrics', text)}
//               multiline
//               numberOfLines={6}
//               editable={!isUploading}
//             />
//           </View>

//           <TouchableOpacity 
//             style={[
//               styles.submitButton,
//               isUploading && styles.submitButtonDisabled
//             ]}
//             onPress={handleSubmit}
//             disabled={isUploading}
//           >
//             {isUploading ? (
//               <ActivityIndicator color="#fff" size="small" />
//             ) : (
//               <Text style={styles.submitButtonText}>Upload Track</Text>
//             )}
//           </TouchableOpacity>
//         </View>
//       </ScrollView>
//     </KeyboardAvoidingView>
//   );
// };

// const FileSelectorButton = ({ icon, label, onPress, disabled, message }) => (
//   <View style={styles.fileSelector}>
//     <TouchableOpacity
//       style={[
//         styles.fileButton,
//         disabled && styles.fileButtonDisabled
//       ]}
//       onPress={onPress}
//       disabled={disabled}
//     >
//       <Text style={styles.fileButtonIcon}>{icon}</Text>
//       <Text style={styles.fileButtonText}>{label}</Text>
//     </TouchableOpacity>
//     {message && (
//       <Text style={[
//         styles.fileStatus,
//         message.includes('Selected:') ? styles.fileStatusSuccess : styles.fileStatusInfo
//       ]}>
//         {message}
//       </Text>
//     )}
//   </View>
// );

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#f5f7fa',
//   },
//   scrollContainer: {
//     padding: 12,
//     paddingBottom: 28,
//   },
//   card: {
//     backgroundColor: '#fff',
//     borderRadius: 12,
//     padding: 20,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 6,
//     elevation: 3,
//   },
//   header: {
//     fontSize: 20,
//     fontWeight: '700',
//     color: '#2c3e50',
//     marginBottom: 20,
//     textAlign: 'center',
//   },
//   section: {
//     marginBottom: 20,
//   },
//   sectionTitle: {
//     fontSize: 16,
//     fontWeight: '600',
//     color: '#34495e',
//     marginBottom: 12,
//     paddingLeft: 4,
//   },
//   input: {
//     height: 50,
//     borderWidth: 1,
//     borderColor: '#e0e6ed',
//     borderRadius: 8,
//     paddingHorizontal: 16,
//     marginBottom: 16,
//     fontSize: 15,
//     color: '#2c3e50',
//     backgroundColor: '#f8fafc',
//   },
//   textArea: {
//     height: 150,
//     borderWidth: 1,
//     borderColor: '#e0e6ed',
//     borderRadius: 8,
//     padding: 16,
//     fontSize: 15,
//     color: '#2c3e50',
//     backgroundColor: '#f8fafc',
//     textAlignVertical: 'top',
//   },
//   fileSelector: {
//     marginBottom: 16,
//   },
//   fileButton: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#4a6da7',
//     paddingVertical: 14,
//     paddingHorizontal: 16,
//     borderRadius: 8,
//   },
//   fileButtonDisabled: {
//     backgroundColor: '#b5c4e3',
//   },
//   fileButtonIcon: {
//     marginRight: 10,
//     fontSize: 18,
//   },
//   fileButtonText: {
//     color: '#fff',
//     fontSize: 15,
//     fontWeight: '500',
//   },
//   fileStatus: {
//     fontSize: 13,
//     marginTop: 6,
//     paddingHorizontal: 4,
//   },
//   fileStatusInfo: {
//     color: '#7f8c8d',
//   },
//   fileStatusSuccess: {
//     color: '#27ae60',
//   },
//   submitButton: {
//     backgroundColor: '#27ae60',
//     padding: 16,
//     borderRadius: 8,
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginTop: 8,
//   },
//   submitButtonDisabled: {
//     backgroundColor: '#7fdcb5',
//   },
//   submitButtonText: {
//     color: '#fff',
//     fontSize: 16,
//     fontWeight: '600',
//   },
// });

// export default TrackUploadForm;