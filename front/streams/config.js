// src/config.js
export default {
  // Cloudinary Config
  cloudinary: {
    cloudName: 'dxdmo9j4v',
    presets: {
      unsigned: 'your_unsigned_preset', // For client-side uploads
      audio: 'audio_uploads', // Your existing audio preset
      profileImages: 'profile_images_preset',
      socialImages: 'social_images_preset', // New
      socialVideos: 'social_videos_preset' // New
    },
    folders: {
      audio: 'audio_uploads',
      profileImages: 'profile_images',
      socialMedia: 'social_media' // Will contain /images and /videos subfolders
    }
  },

  // API Config
  api: {
    baseUrl: process.env.NODE_ENV === 'production' 
      ? 'https://your-production-api.com' 
      : 'http://192.168.1.126:8000',
    timeout: 30000,
  },

  // Media Settings
  media: {
    optimizations: {
      image: 'w_1080,h_1080,c_limit,q_auto,f_auto', // Constrained to 1080px
      profileImage: 'w_300,h_300,c_fill,q_auto,f_auto', // Square crop
      video: 'q_auto,f_auto',
      audio: 'q_auto'
    },
    limits: {
      imageSizeMB: 5,
      videoSizeMB: 50,
      audioSizeMB: 20
    }
  }
};