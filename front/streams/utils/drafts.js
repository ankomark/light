// Post drafts: an unfinished post saved on this device, TikTok-style.
//
// A draft is the create screen's state (media, caption, song, trim, cover,
// privacy) with its media copied into drafts/<id>/ so the OS can't purge it.
// The index lives in AsyncStorage, per account — two people sharing a phone
// never see each other's drafts. Drafts never leave the device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { copySnapMedia, draftsDir, removeDir } from './mediaStore';

const MAX_DRAFTS = 20;
const key = (userId) => `@drafts:v1:u${userId ?? 'anon'}`;

export const listDrafts = async (userId) => {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const writeIndex = (userId, list) =>
  AsyncStorage.setItem(key(userId), JSON.stringify(list)).catch(() => {});

/**
 * Save (or overwrite, when `draft.id` is given) a draft. `draft.state` is
 * the create screen's snapshot. Returns the stored entry.
 */
export const saveDraft = async (userId, { id, state }) => {
  const draftId = id || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const stored = await copySnapMedia(draftsDir(draftId), state);
  const entry = {
    id: draftId,
    savedAt: Date.now(),
    state: stored,
    thumbUri: stored.contentType === 'image'
      ? stored.images?.[0]?.uri || null
      : stored.thumbUri || null,
    caption: (stored.caption || '').slice(0, 120),
    contentType: stored.contentType,
  };
  const list = (await listDrafts(userId)).filter((d) => d.id !== draftId);
  const next = [entry, ...list];
  // Past the cap, the oldest drafts go — with their files.
  next.slice(MAX_DRAFTS).forEach((d) => removeDir(draftsDir(d.id)));
  await writeIndex(userId, next.slice(0, MAX_DRAFTS));
  return entry;
};

/** Forget a draft. `keepFiles` when its media has been moved to an upload. */
export const deleteDraft = async (userId, draftId, { keepFiles = false } = {}) => {
  const list = await listDrafts(userId);
  await writeIndex(userId, list.filter((d) => d.id !== draftId));
  if (!keepFiles) removeDir(draftsDir(draftId));
};
