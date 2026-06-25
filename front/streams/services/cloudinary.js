import { getCloudinarySignature } from './api';

const RESOURCE_TYPES = {
  audio: 'video',   // Cloudinary treats audio as video resource type
  'social-image': 'image',
  'social-video': 'video',
  'story-video': 'video',
  'profile-image': 'image',
  cover: 'image',
  avatar: 'image',
};

const SIGN_TYPES = {
  audio: 'audio',
  'social-image': 'image',
  'social-video': 'video',
  'story-video': 'story_video',
  'profile-image': 'profile',
  cover: 'cover',
  avatar: 'avatar',
};

/**
 * Upload a file to Cloudinary using a backend-generated signature.
 * No API secrets or upload presets are sent from the client.
 *
 * Uses XMLHttpRequest (not fetch) so upload progress can be reported via the
 * optional `onProgress(fraction)` callback (0..1).
 */
export const uploadMedia = async (file, type, onProgress) => {
  const resourceType = RESOURCE_TYPES[type];
  if (!resourceType) throw new Error(`Unknown upload type: ${type}`);

  // 1. Get a fresh signature from our backend (api_secret never leaves the server)
  const { signature, timestamp, api_key, cloud_name, folder, transformation } =
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
  // Incoming transformation (signed server-side) — must be sent verbatim so the
  // signature matches. Shrinks the stored asset, e.g. for story videos.
  if (transformation) formData.append('transformation', transformation);

  // 3. Upload directly to Cloudinary — signed, no upload_preset. XHR exposes
  //    upload progress (fetch does not). Don't set Content-Type: the engine adds
  //    the multipart boundary automatically.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloud_name}/${resourceType}/upload`);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          onProgress?.(1);
          resolve({
            publicId: data.public_id,
            url: data.secure_url,
            resourceType,
            width: data.width,
            height: data.height,
            duration: data.duration,
          });
        } catch {
          reject(new Error('Invalid response from Cloudinary'));
        }
      } else {
        let message = `Cloudinary upload failed: ${xhr.status}`;
        try { message = JSON.parse(xhr.responseText)?.error?.message ?? message; } catch {}
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
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
