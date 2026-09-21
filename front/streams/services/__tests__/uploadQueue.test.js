/**
 * The background upload queue.
 *
 * Once the create screen hands off a job it has closed, so nothing on screen
 * can recover a job the queue mishandles: it must run each job exactly once,
 * one at a time, report failure instead of swallowing it, and retry cleanly.
 */
import {
  enqueueUpload, retryUpload, dismissUpload, getJobs, subscribe,
  configureUploadQueue, restoreUploads, __resetUploadQueue,
} from '../uploadQueue';

const flush = () => new Promise((r) => setTimeout(r, 0));

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => __resetUploadQueue());

it('runs a job and records its result', async () => {
  const onDone = jest.fn();
  configureUploadQueue({ onDone });
  const id = enqueueUpload({ kind: 'post', title: 'p', run: async () => ({ id: 7 }) });
  await flush();
  const job = getJobs().find((j) => j.id === id);
  expect(job.status).toBe('done');
  expect(job.result).toEqual({ id: 7 });
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id }), { id: 7 });
});

it('runs jobs one at a time, in order', async () => {
  const a = deferred();
  const order = [];
  enqueueUpload({ kind: 'post', title: 'a', run: async () => { order.push('a:start'); await a.promise; order.push('a:end'); } });
  enqueueUpload({ kind: 'post', title: 'b', run: async () => { order.push('b:start'); } });
  await flush();
  expect(order).toEqual(['a:start']);                 // b waits for a
  expect(getJobs().map((j) => j.status)).toEqual(['working', 'queued']);
  a.resolve();
  await flush(); await flush();
  expect(order).toEqual(['a:start', 'a:end', 'b:start']);
});

it('marks a failed job failed and keeps the queue moving', async () => {
  const onFailed = jest.fn();
  configureUploadQueue({ onFailed });
  enqueueUpload({ kind: 'post', title: 'bad', run: async () => { throw new Error('network down'); } });
  enqueueUpload({ kind: 'post', title: 'good', run: async () => 'ok' });
  await flush(); await flush();
  const [bad, good] = getJobs();
  expect(bad.status).toBe('failed');
  expect(bad.error).toBe('network down');
  expect(onFailed).toHaveBeenCalledTimes(1);
  expect(good.status).toBe('done');
});

it('retries a failed job from the start', async () => {
  let attempts = 0;
  const id = enqueueUpload({
    kind: 'post', title: 'flaky',
    run: async () => { attempts += 1; if (attempts === 1) throw new Error('x'); return 'ok'; },
  });
  await flush();
  expect(getJobs()[0].status).toBe('failed');
  retryUpload(id);
  await flush();
  expect(attempts).toBe(2);
  expect(getJobs()[0]).toMatchObject({ status: 'done', error: null, result: 'ok' });
});

it('publishes only whole-percent progress changes', async () => {
  const gate = deferred();
  let report;
  enqueueUpload({ kind: 'post', title: 'p', run: async ({ progress }) => { report = progress; await gate.promise; } });
  await flush();
  const seen = jest.fn();
  const unsub = subscribe(seen);
  report(0.101); report(0.104); report(0.109); // all 10%
  report(0.2);
  unsub();
  expect(seen).toHaveBeenCalledTimes(2);
  expect(getJobs()[0].progress).toBe(0.2);
  gate.resolve();
});

it('lets a job update its stage and thumbnail', async () => {
  const gate = deferred();
  enqueueUpload({
    kind: 'post', title: 'v',
    run: async ({ stage, thumbnail }) => { stage('Optimizing'); thumbnail('file://poster.jpg'); await gate.promise; },
  });
  await flush();
  expect(getJobs()[0]).toMatchObject({ stage: 'Optimizing', thumbUri: 'file://poster.jpg' });
  gate.resolve();
});

describe('surviving an app restart', () => {
  const memoryStorage = () => {
    let saved = [];
    return {
      load: jest.fn(async () => saved),
      save: jest.fn(async (records) => { saved = JSON.parse(JSON.stringify(records)); }),
      get saved() { return saved; },
    };
  };

  it('persists a snap job once its media is staged, with the id as client key', async () => {
    const storage = memoryStorage();
    const gate = deferred();
    const seen = [];
    configureUploadQueue({
      storage,
      stage: async (id, snap) => ({ ...snap, uri: `durable/${id}.jpg` }),
      builders: { post: (snap) => async () => { seen.push(snap); await gate.promise; return { id: 1 }; } },
    });
    const id = enqueueUpload({ kind: 'post', title: 't', snap: { uri: 'cache/a.jpg' } });
    await flush(); await flush();
    expect(storage.saved).toEqual([expect.objectContaining({
      id, kind: 'post', status: 'queued', snap: { uri: `durable/${id}.jpg` },
    })]);
    expect(seen[0]).toEqual({ uri: `durable/${id}.jpg`, clientId: id });
    gate.resolve();
    await flush();
    expect(storage.saved).toEqual([]); // done jobs are forgotten
  });

  it('points the thumbnail and preview at the staged copies', async () => {
    configureUploadQueue({
      stage: async (id, snap) => ({ ...snap, images: [{ uri: `durable/${id}.jpg` }] }),
      builders: { post: () => () => new Promise(() => {}) },
    });
    const id = enqueueUpload({
      kind: 'post', thumbUri: 'cache/a.jpg',
      preview: { uri: 'cache/a.jpg', caption: 'c' },
      snap: { images: [{ uri: 'cache/a.jpg' }] },
    });
    await flush(); await flush();
    const job = getJobs().find((j) => j.id === id);
    expect(job.thumbUri).toBe(`durable/${id}.jpg`);
    expect(job.preview).toEqual({ uri: `durable/${id}.jpg`, caption: 'c' });
  });

  it('restores interrupted jobs and resumes them with the same key', async () => {
    const storage = memoryStorage();
    await storage.save([
      { id: 'up_old', kind: 'post', title: 'resumed', snap: { uri: 'durable/x.jpg' }, status: 'queued' },
      { id: 'up_bad', kind: 'post', title: 'failed', snap: { uri: 'durable/y.jpg' }, status: 'failed', error: 'offline' },
    ]);
    const runs = [];
    configureUploadQueue({
      storage,
      builders: { post: (snap) => async () => { runs.push(snap.clientId); return { id: 2 }; } },
    });
    expect(await restoreUploads()).toBe(2);
    await flush(); await flush();
    expect(runs).toEqual(['up_old']);                      // failed one waits for a tap
    const failed = getJobs().find((j) => j.id === 'up_bad');
    expect(failed).toMatchObject({ status: 'failed', error: 'offline' });
    retryUpload('up_bad');
    await flush(); await flush();
    expect(runs).toEqual(['up_old', 'up_bad']);
  });

  it('does not restore the same job twice', async () => {
    const storage = memoryStorage();
    await storage.save([{ id: 'up_1', kind: 'post', snap: {}, status: 'failed' }]);
    configureUploadQueue({ storage, builders: { post: () => async () => ({}) } });
    await restoreUploads();
    await restoreUploads();
    expect(getJobs()).toHaveLength(1);
  });

  it('cleans up staged media when a job finishes or a failed one is dismissed', async () => {
    const cleanup = jest.fn();
    configureUploadQueue({
      cleanup,
      builders: { post: (snap) => async () => { if (snap.fail) throw new Error('x'); return {}; } },
    });
    const ok = enqueueUpload({ kind: 'post', snap: {} });
    const bad = enqueueUpload({ kind: 'post', snap: { fail: true } });
    await flush(); await flush(); await flush();
    expect(cleanup).toHaveBeenCalledWith(ok);
    expect(cleanup).not.toHaveBeenCalledWith(bad);        // kept for a retry
    dismissUpload(bad);
    expect(cleanup).toHaveBeenCalledWith(bad);
  });

  it('still uploads from the originals if staging fails', async () => {
    const seen = [];
    configureUploadQueue({
      stage: async () => { throw new Error('disk full'); },
      builders: { post: (snap) => async () => { seen.push(snap.uri); return {}; } },
    });
    enqueueUpload({ kind: 'post', snap: { uri: 'cache/a.jpg' } });
    await flush(); await flush();
    expect(seen).toEqual(['cache/a.jpg']);
  });
});

it('will not dismiss a job that is still running', async () => {
  const gate = deferred();
  const id = enqueueUpload({ kind: 'post', title: 'p', run: () => gate.promise });
  await flush();
  dismissUpload(id);
  expect(getJobs()).toHaveLength(1);
  gate.resolve();
  await flush();
  dismissUpload(id);
  expect(getJobs()).toHaveLength(0);
});
