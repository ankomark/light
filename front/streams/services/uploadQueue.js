// Background uploads.
//
// Posting used to hold the create screen hostage: a modal progress bar the
// user had to stare at until every byte reached R2, which for a video meant
// on-device transcoding plus the upload — easily a minute. Now the screen hands
// the work to this queue and closes at once; the user keeps browsing, a small
// pill shows progress, and a notification says when it's live.
//
// This module is plain JS on purpose: it must outlive whichever screen queued
// the job. React reads it through useUploads() (useSyncExternalStore).
//
// Jobs run one at a time. Uploads are bandwidth-bound, so running two at once
// makes both finish later and neither sooner.
//
// Limit worth knowing: the queue lives in memory. Switching apps is fine — the
// byte transfer itself is a native task — but if the OS kills the app mid-job,
// that job is gone and the user posts again.
import { useSyncExternalStore } from 'react';

let jobs = [];
const subscribers = new Set();
let seq = 0;
let running = false;

// Hooks for side effects (notifications, events), injected so this module
// stays testable without native modules.
let hooks = { onDone: null, onFailed: null };
export const configureUploadQueue = (next) => { hooks = { ...hooks, ...next }; };

const publish = () => {
  jobs = jobs.slice(); // new identity so useSyncExternalStore re-renders
  subscribers.forEach((fn) => fn());
};

const patch = (id, changes) => {
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  jobs[i] = { ...jobs[i], ...changes };
  publish();
};

export const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};
export const getJobs = () => jobs;

// Progress arrives as fast as the native upload reports it (many times a
// second). Re-rendering the pill that often is wasted work on a screen the
// user is actively scrolling, so only whole-percent changes are published.
const progressReporter = (id) => {
  let last = -1;
  return (fraction) => {
    const pct = Math.max(0, Math.min(100, Math.floor((fraction || 0) * 100)));
    if (pct === last) return;
    last = pct;
    patch(id, { progress: pct / 100 });
  };
};

const pump = async () => {
  if (running) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  running = true;
  const { id } = job;
  patch(id, { status: 'working', progress: 0, error: null });
  try {
    const result = await job.run({
      progress: progressReporter(id),
      // A job can say what it's doing ("Optimizing video…") and swap in a
      // better thumbnail once it has one (a video's poster frame).
      stage: (label) => patch(id, { stage: label }),
      thumbnail: (uri) => patch(id, { thumbUri: uri }),
    });
    patch(id, { status: 'done', progress: 1, result, finishedAt: Date.now() });
    try { hooks.onDone?.(getJob(id), result); } catch (e) { console.error('[uploadQueue] onDone', e); }
  } catch (error) {
    patch(id, { status: 'failed', error: error?.message || String(error) });
    try { hooks.onFailed?.(getJob(id), error); } catch (e) { console.error('[uploadQueue] onFailed', e); }
  } finally {
    running = false;
    pump();
  }
};

const getJob = (id) => jobs.find((j) => j.id === id);

/**
 * Queue an upload. `run` receives { progress(0..1), stage(label),
 * thumbnail(uri) } and resolves with whatever the job produced (the created
 * post, the created track). Returns the job id.
 */
export const enqueueUpload = ({ kind, title, thumbUri = null, run }) => {
  const id = `up_${Date.now()}_${seq++}`;
  jobs.push({
    id, kind, title, thumbUri, run,
    status: 'queued', stage: null, progress: 0, error: null, result: null,
    createdAt: Date.now(),
  });
  publish();
  pump();
  return id;
};

/** Run a failed job again, from the start. */
export const retryUpload = (id) => {
  const job = getJob(id);
  if (!job || job.status !== 'failed') return;
  patch(id, { status: 'queued', progress: 0, error: null, stage: null });
  pump();
};

/** Remove a finished or failed job from the list. */
export const dismissUpload = (id) => {
  const job = getJob(id);
  if (!job || job.status === 'working' || job.status === 'queued') return;
  jobs = jobs.filter((j) => j.id !== id);
  publish();
};

export const useUploads = () => useSyncExternalStore(subscribe, getJobs, getJobs);

// Test-only reset.
export const __resetUploadQueue = () => {
  jobs = [];
  running = false;
  hooks = { onDone: null, onFailed: null };
  publish();
};
