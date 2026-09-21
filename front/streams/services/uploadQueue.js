// Background uploads.
//
// Posting used to hold the create screen hostage: a modal progress bar the
// user had to stare at until every byte reached R2. Now the screen hands the
// work to this queue and closes at once; the user keeps browsing, a pill (and
// a card at the top of the feed) shows progress, and a notification says when
// it's live.
//
// Jobs run one at a time. Uploads are bandwidth-bound, so running two at once
// makes both finish later and neither sooner.
//
// Surviving the app being killed: a job is described by a plain, serialisable
// `snap` (what the user chose) plus its `kind`, and is persisted as soon as
// its media has been copied somewhere the OS won't purge. On the next launch
// restoreUploads() rebuilds each job from its snap and carries on. The job's
// id doubles as the server-side idempotency key (client_id), so a job that
// had in fact reached the server before the app died comes back as the post
// it already made — never a duplicate. Resuming restarts the upload from the
// beginning; it doesn't continue a half-sent file.
//
// This module is plain JS, and everything native (file copying, storage, the
// actual upload code) is injected through configureUploadQueue(), so it stays
// testable and outlives whichever screen queued the job.
import { useSyncExternalStore } from 'react';

let jobs = [];
const subscribers = new Set();
let seq = 0;
let running = false;

const noop = () => {};
let config = {
  onDone: null,
  onFailed: null,
  // kind -> (snap) => run({progress, stage, thumbnail})
  builders: {},
  // (jobId, snap) => Promise<snap with media in durable storage>
  stage: null,
  // (jobId) => void — delete the job's staged media
  cleanup: noop,
  // { load(): Promise<records[]>, save(records): Promise } — null = no persistence
  storage: null,
};
export const configureUploadQueue = (next) => { config = { ...config, ...next }; };

const publish = () => {
  jobs = jobs.slice(); // new identity so useSyncExternalStore re-renders
  subscribers.forEach((fn) => fn());
};

const getJob = (id) => jobs.find((j) => j.id === id);

// Staging rewrites a snap's file uris; this pairs each old string with its
// replacement at the same place, so display fields that point at the same
// files (the pill's thumbnail, the feed card's preview) can follow them.
const uriMap = (before, after, map = new Map()) => {
  if (typeof before === 'string' && typeof after === 'string') {
    if (before !== after) map.set(before, after);
  } else if (before && after && typeof before === 'object') {
    Object.keys(before).forEach((k) => uriMap(before[k], after[k], map));
  }
  return map;
};

// Only what's needed to rebuild a job survives a restart.
const persist = () => {
  if (!config.storage) return;
  const records = jobs
    .filter((j) => j.persistable && j.status !== 'done')
    .map((j) => ({
      id: j.id, kind: j.kind, title: j.title, thumbUri: j.thumbUri, preview: j.preview,
      snap: j.snap, status: j.status === 'failed' ? 'failed' : 'queued',
      error: j.error, createdAt: j.createdAt,
    }));
  Promise.resolve(config.storage.save(records)).catch(noop);
};

const patch = (id, changes, { save = true } = {}) => {
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  jobs[i] = { ...jobs[i], ...changes };
  publish();
  if (save) persist();
};

export const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
export const getJobs = () => jobs;

// Progress arrives as fast as the native upload reports it (many times a
// second). Re-rendering the pill that often is wasted work on a screen the
// user is actively scrolling, so only whole-percent changes are published —
// and never written to storage.
const progressReporter = (id) => {
  let last = -1;
  return (fraction) => {
    const pct = Math.max(0, Math.min(100, Math.floor((fraction || 0) * 100)));
    if (pct === last) return;
    last = pct;
    patch(id, { progress: pct / 100 }, { save: false });
  };
};

const resolveRun = (job) => {
  if (job.run) return job.run;
  const build = config.builders[job.kind];
  if (!build) throw new Error(`No upload builder for "${job.kind}"`);
  // The job id is the idempotency key the server dedupes on.
  return build({ ...job.snap, clientId: job.id });
};

const pump = async () => {
  if (running) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  running = true;
  const { id } = job;
  patch(id, { status: 'working', progress: 0, error: null }, { save: false });
  try {
    if (job.staging) await job.staging;
    const result = await resolveRun(getJob(id))({
      progress: progressReporter(id),
      // A job can say what it's doing ("Optimizing video…") and swap in a
      // better thumbnail once it has one (a video's poster frame).
      stage: (label) => patch(id, { stage: label }, { save: false }),
      thumbnail: (uri) => patch(id, { thumbUri: uri }, { save: false }),
    });
    patch(id, { status: 'done', progress: 1, result, finishedAt: Date.now() });
    try { config.cleanup(id); } catch { /* best effort */ }
    try { config.onDone?.(getJob(id), result); } catch (e) { console.error('[uploadQueue] onDone', e); }
  } catch (error) {
    patch(id, { status: 'failed', error: error?.message || String(error) });
    try { config.onFailed?.(getJob(id), error); } catch (e) { console.error('[uploadQueue] onFailed', e); }
  } finally {
    running = false;
    pump();
  }
};

/**
 * Queue an upload. Either:
 *   - { kind, snap, ... }: rebuilt from `snap` by the registered builder, and
 *     persisted so it survives the app being killed; or
 *   - { run, ... }: a one-off function, not persisted.
 * `preview` is display data for the feed's pending card. Returns the job id.
 */
export const enqueueUpload = ({ kind, title = '', thumbUri = null, preview = null, snap = null, run = null }) => {
  const id = `up_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id, kind, title, thumbUri, preview, snap, run,
    status: 'queued', stage: null, progress: 0, error: null, result: null,
    createdAt: Date.now(), persistable: false, staging: null,
  };
  if (snap && !run) {
    // Copy the media somewhere durable first; only then is the job worth
    // persisting (a record pointing at purged cache files resumes nothing).
    const staging = (config.stage ? Promise.resolve(config.stage(id, snap)) : Promise.resolve(snap))
      .then((staged) => {
        const moved = uriMap(snap, staged);
        const current = getJob(id);
        const follow = (u) => (u && moved.has(u) ? moved.get(u) : u);
        patch(id, {
          snap: staged, persistable: true, staging: null,
          thumbUri: follow(current?.thumbUri),
          preview: current?.preview ? { ...current.preview, uri: follow(current.preview.uri) } : current?.preview,
        });
      })
      .catch(() => patch(id, { staging: null }, { save: false })); // upload from the originals
    job.staging = staging;
  }
  jobs.push(job);
  publish();
  pump();
  return id;
};

/** Run a failed job again, from the start (same idempotency key). */
export const retryUpload = (id) => {
  const job = getJob(id);
  if (!job || job.status !== 'failed') return;
  patch(id, { status: 'queued', progress: 0, error: null, stage: null });
  pump();
};

/** Remove a finished or failed job (and its staged media). */
export const dismissUpload = (id) => {
  const job = getJob(id);
  if (!job || job.status === 'working' || job.status === 'queued') return;
  jobs = jobs.filter((j) => j.id !== id);
  publish();
  persist();
  if (job.status === 'failed') {
    try { config.cleanup(id); } catch { /* best effort */ }
  }
};

/**
 * Bring back jobs persisted by a previous run of the app. Interrupted jobs
 * resume on their own; failed ones come back failed, waiting for a retry.
 */
export const restoreUploads = async () => {
  if (!config.storage) return 0;
  let records = [];
  try { records = (await config.storage.load()) || []; } catch { return 0; }
  let restored = 0;
  for (const r of records) {
    if (!r?.id || getJob(r.id) || !config.builders[r.kind]) continue;
    jobs.push({
      id: r.id, kind: r.kind, title: r.title || '', thumbUri: r.thumbUri || null,
      preview: r.preview || null, snap: r.snap, run: null,
      status: r.status === 'failed' ? 'failed' : 'queued',
      stage: null, progress: 0, error: r.error || null, result: null,
      createdAt: r.createdAt || Date.now(), persistable: true, staging: null,
    });
    restored += 1;
  }
  if (restored) { publish(); pump(); }
  return restored;
};

export const useUploads = () => useSyncExternalStore(subscribe, getJobs, getJobs);

// Test-only reset.
export const __resetUploadQueue = () => {
  jobs = [];
  running = false;
  config = { onDone: null, onFailed: null, builders: {}, stage: null, cleanup: noop, storage: null };
  publish();
};
