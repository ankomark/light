// AI in books: whether the server offers it (kept on the phone, asked again
// at most hourly, so the buttons show at once and stay away when it's off),
// answers already had this session (reopening one is instant), and what to
// say when an answer can't come.
import { useEffect, useState } from 'react';
import { fetchAiStatus } from './api';
import { peekCache, readCache, writeCache } from '../utils/screenCache';

const STATUS_KEY = 'ai:status';
const HOUR = 60 * 60 * 1000;
let asking = null;

const refresh = () => {
  if (!asking) {
    asking = Promise.resolve().then(() => fetchAiStatus())
      .then((s) => { writeCache(STATUS_KEY, s); return s; })
      .catch(() => null)
      .finally(() => { asking = null; });
  }
  return asking;
};

/** True when the AI tools should be offered. */
export const useAiEnabled = () => {
  const [on, setOn] = useState(() => !!peekCache(STATUS_KEY)?.enabled);
  useEffect(() => {
    let live = true;
    (async () => {
      const fresh = await readCache(STATUS_KEY, HOUR);
      if (fresh) { if (live) setOn(!!fresh.enabled); return; }
      const kept = peekCache(STATUS_KEY) || await readCache(STATUS_KEY, 30 * 24 * HOUR);
      if (live && kept) setOn(!!kept.enabled);
      const s = await refresh();
      if (live && s) setOn(!!s.enabled);
    })();
    return () => { live = false; };
  }, []);
  return on;
};

const answers = new Map();       // request → answer, for this session

/** An answer: the one had already, or asked for and kept. */
export const askOnce = async (key, ask) => {
  if (answers.has(key)) return answers.get(key);
  const a = await ask();
  answers.set(key, a);
  return a;
};
export const hadAnswer = (key) => answers.get(key) || null;

/** What to tell the person when no answer came (an i18n key). */
export const aiErrorKey = (err) => {
  const code = err?.data?.code;
  if (code === 'ai_off') return 'ai.off';
  if (code === 'ai_limit') return 'ai.limit';
  if (!err?.status) return 'ai.offline';
  return 'ai.failed';
};

export const __resetBookAi = () => { answers.clear(); asking = null; };
