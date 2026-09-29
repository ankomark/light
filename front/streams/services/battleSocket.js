// A Live Bible Battle's room, live: `ws/battle/<code>/`. The server decides
// every step over REST (songs/battle.py) and tells the room here — who joined,
// the question and its clock, how many have answered, the answer and the
// ranking, the end. Screens also re-read the battle when the socket drops.
import { createSocket } from './groupSocket';

/** Listen to one battle: fn({type, ...}) and {type: 'status', open}.
 *  Returns the unsubscribe. */
export function subscribeBattle(code, fn) {
  const socket = createSocket(`ws/battle/${code}/`, {
    onEvent: (evt) => { try { fn(evt); } catch { /* a screen's bug is its own */ } },
    onStatus: (s) => { try { fn({ type: 'status', open: s === 'open' }); } catch { /* ignore */ } },
  });
  return () => socket.close();
}
