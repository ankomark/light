// Media uploads — Cloudflare R2 via backend-presigned PUT URLs.
// (Filename kept from the Cloudinary era so the 7 importers don't churn;
// rename to uploads.js in a quiet moment.)
//
// Flow: ask the backend for a presigned ticket (/upload/r2-sign/), then PUT
// the raw bytes straight to R2. No secrets on the client, and the backend
// controls the key layout + content-type allowlist.
import * as FileSystem from 'expo-file-system';
import { getR2UploadTicket } from './api';

// App-level upload types → backend `type` vocabulary.
const SIGN_TYPES = {
  audio: 'audio',
  'social-image': 'image',
  'social-video': 'video',
  'story-video': 'story_video',
  'chat-image': 'chat_image',
  'chat-audio': 'chat_audio',
  'chat-file': 'chat_file',
  'profile-image': 'profile',
  cover: 'cover',
  avatar: 'avatar',
};

const DEFAULT_MIME = (type) =>
  type === 'audio' || type === 'chat-audio'
    ? 'audio/mpeg'
    : type.includes('video')
      ? 'video/mp4'
      : type === 'chat-file'
        ? 'application/octet-stream'
        : 'image/jpeg';

/**
 * Upload a file to R2 using a backend-presigned PUT URL.
 *
 * Returns { publicId, url, key, resourceType, width, height, duration }.
 * `publicId` and `url` are BOTH the public R2 URL — callers historically sent
 * `result.publicId` to the API, and the backend now stores absolute URLs, so
 * everything lines up without touching each call site.
 *
 * NOTE: R2 stores bytes verbatim — any trim/compression must happen on-device
 * BEFORE calling this (there is no ingest transformation anymore). Trim
 * windows in `opts` are ignored here; the post's start/end fields still drive
 * player-side trimming.
 */
export const uploadMedia = async (file, type, onProgress, opts = {}) => {
  const signType = SIGN_TYPES[type];
  if (!signType) throw new Error(`Unknown upload type: ${type}`);

  const mimeType = (file.mimeType ?? file.type ?? DEFAULT_MIME(type)).toLowerCase();

  // 1. Presigned ticket from our backend (credentials never leave the server).
  const ticket = await getR2UploadTicket(signType, mimeType, file.name);
  if (!ticket?.upload_url) throw new Error('Upload ticket request failed');

  // 2. PUT the raw bytes. expo-file-system streams from disk (no base64/blob
  //    in JS memory) and reports native upload progress.
  const task = FileSystem.createUploadTask(
    ticket.upload_url,
    file.uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      // Content-Type is part of the presigned signature — must match exactly.
      headers: { 'Content-Type': ticket.content_type },
    },
    onProgress
      ? ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (totalBytesExpectedToSend > 0) {
            onProgress(totalBytesSent / totalBytesExpectedToSend);
          }
        }
      : undefined,
  );
  const res = await task.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) {
    throw new Error(`Upload failed (${res?.status ?? 'network error'})`);
  }
  onProgress?.(1);

  return {
    publicId: ticket.public_url,
    url: ticket.public_url,
    key: ticket.key,
    resourceType: signType,
    // R2 doesn't inspect media; dimensions/duration come from the picker/
    // trimmer when the caller knows them.
    width: opts.width,
    height: opts.height,
    duration: opts.duration,
  };
};

// Stored references are absolute URLs now — served as-is. (Edge transforms
// arrive with the custom media domain later.)
export const getOptimizedUrl = (urlOrId) =>
  typeof urlOrId === 'string' && urlOrId.startsWith('http') ? urlOrId : null;
