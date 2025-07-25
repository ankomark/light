// src/services/cloudinary.js
import config from '../config';

export const uploadMedia = async (file, type) => {
  const { cloudinary } = config;
  let uploadPreset, folder, resourceType, optimization;

  switch (type) {
    case 'audio':
      uploadPreset = cloudinary.presets.audio;
      folder = cloudinary.folders.audio;
      resourceType = 'video'; // Cloudinary treats audio as video
      optimization = config.media.optimizations.audio;
      break;
    case 'social-image':
      uploadPreset = cloudinary.presets.socialImages;
      folder = `${cloudinary.folders.socialMedia}/images`;
      resourceType = 'image';
      optimization = config.media.optimizations.image;
      break;
    case 'social-video':
      uploadPreset = cloudinary.presets.socialVideos;
      folder = `${cloudinary.folders.socialMedia}/videos`;
      resourceType = 'video';
      optimization = config.media.optimizations.video;
      break;
    case 'profile-image':
      uploadPreset = cloudinary.presets.profileImages;
      folder = cloudinary.folders.profileImages;
      resourceType = 'image';
      optimization = config.media.optimizations.profileImage;
      break;
    default:
      throw new Error('Invalid media type');
  }

  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name || `${Date.now()}`,
    type: file.mimeType || `${resourceType}/${type === 'audio' ? 'mp3' : (type.includes('image') ? 'jpeg' : 'mp4')}`
  });
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', folder);
  formData.append('cloud_name', cloudinary.cloudName);

  // Add transformations if needed
  if (optimization && resourceType === 'image') {
    formData.append('transformation', optimization);
  }

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/${resourceType}/upload`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      publicId: data.public_id,
      url: data.secure_url,
      resourceType,
      width: data.width,
      height: data.height,
      duration: data.duration
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
};

export const getOptimizedUrl = (publicId, type) => {
  const { cloudinary, media } = config;
  const baseUrl = `https://res.cloudinary.com/${cloudinary.cloudName}`;
  
  switch (type) {
    case 'image':
      return `${baseUrl}/image/upload/${media.optimizations.image}/${publicId}`;
    case 'profile-image':
      return `${baseUrl}/image/upload/${media.optimizations.profileImage}/${publicId}`;
    case 'video':
      return `${baseUrl}/video/upload/${media.optimizations.video}/${publicId}`;
    case 'audio':
      return `${baseUrl}/video/upload/${media.optimizations.audio}/${publicId}`;
    default:
      return `${baseUrl}/image/upload/${publicId}`;
  }
};