import { getCloudinarySignature } from './api';

const RESOURCE_TYPES = {
  audio: 'video',   // Cloudinary treats audio as video resource type
  'social-image': 'image',
  'social-video': 'video',
  'profile-image': 'image',
  cover: 'image',
  avatar: 'image',
};

const SIGN_TYPES = {
  audio: 'audio',
  'social-image': 'image',
  'social-video': 'video',
  'profile-image': 'profile',
  cover: 'cover',
  avatar: 'avatar',
};

/**
 * Upload a file to Cloudinary using a backend-generated signature.
 * No API secrets or upload presets are sent from the client.
 */
export const uploadMedia = async (file, type) => {
  const resourceType = RESOURCE_TYPES[type];
  if (!resourceType) throw new Error(`Unknown upload type: ${type}`);

  // 1. Get a fresh signature from our backend (api_secret never leaves the server)
  const { signature, timestamp, api_key, cloud_name, folder } =
    await getCloudinarySignature(SIGN_TYPES[type] ?? 'image');

  // 2. Build multipart form
  const mimeType =
    file.mimeType ??
    (type === 'audio' ? 'audio/mpeg' : type.includes('video') ? 'video/mp4' : 'image/jpeg');

  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name ?? `upload_${Date.now()}`,
    type: mimeType,
  });
  formData.append('signature', signature);
  formData.append('timestamp', String(timestamp));
  formData.append('api_key', api_key);
  formData.append('folder', folder);

  // 3. Upload directly to Cloudinary — signed, no upload_preset
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud_name}/${resourceType}/upload`,
    {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Cloudinary upload failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    publicId: data.public_id,
    url: data.secure_url,
    resourceType,
    width: data.width,
    height: data.height,
    duration: data.duration,
  };
};

export const getOptimizedUrl = (publicId, type, cloudName) => {
  const base = `https://res.cloudinary.com/${cloudName}`;
  const transforms = {
    image: 'w_1080,h_1080,c_limit,q_auto,f_auto',
    'profile-image': 'w_300,h_300,c_fill,q_auto,f_auto',
    video: 'q_auto,f_auto',
    audio: 'q_auto',
  };
  const t = transforms[type] ?? transforms.image;
  const res = type === 'audio' || type === 'video' ? 'video' : 'image';
  return `${base}/${res}/upload/${t}/${publicId}`;
};
