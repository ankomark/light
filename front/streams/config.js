// src/config.js
export default {
  // Cloudinary Config (for direct uploads from frontend if needed)
  cloudinary: {
    cloudName: 'dxdmo9j4v',
    uploadPreset: 'your_unsigned_preset', // Create this in Cloudinary console
    apiKey: '646695939138698', // Only needed for signed uploads
  },

  // API Config
  api: {
    baseUrl: 'https://192.168.1.126:8000',
    timeout: 30000,
  },

  // Media Settings
  media: {
    imageOptimization: 'w_500,h_500,c_fill,q_auto,f_auto',
    audioOptimization: 'q_auto',
  }
};