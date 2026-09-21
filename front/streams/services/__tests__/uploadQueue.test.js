/**
 * The background upload queue.
 *
 * Once the create screen hands off a job it has closed, so nothing on screen
 * can recover a job the queue mishandles: it must run each job exactly once,
 * one at a time, report failure instead of swallowing it, and retry cleanly.
 */
import {
  enqueueUpload, retryUpload, dismissUpload, getJobs, subscribe,
  configureUploadQueue, __resetUploadQueue,
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
