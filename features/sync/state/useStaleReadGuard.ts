import { useState } from "react";

/**
 * Keeps a re-read of storage from replacing an edit made while the read was in flight.
 *
 * A sync that changes local storage makes a screen's state re-read it. A read that STARTED before the person's edit is out of
 * date when it finishes, and putting it on screen undoes the edit (and the next save then writes the old data back). So:
 *
 *   - every edit goes through `track`, which counts it and remembers it until it has finished;
 *   - `readFresh` waits for those to finish before reading, and throws a read away when an edit happened during it, reading
 *     again (up to three times; after that the next change signal reads once more).
 */
export interface StaleReadGuard {
  /** Registers an edit's work (its save, and the state update that follows it) and returns it unchanged. */
  track<T>(work: Promise<T>): Promise<T>;
  /** Null when cancelled, or when edits kept overtaking the read. */
  readFresh<T>(load: () => Promise<T>, isCancelled: () => boolean): Promise<{ value: T } | null>;
}

const MAX_ATTEMPTS = 3;

function createGuard(): StaleReadGuard {
  let revision = 0;
  const inFlight = new Set<Promise<unknown>>();

  return {
    track(work) {
      revision++;
      inFlight.add(work);
      const finished = () => {
        inFlight.delete(work);
      };
      work.then(finished, finished);
      return work;
    },

    async readFresh(load, isCancelled) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await Promise.allSettled([...inFlight]);
        const started = revision;
        const value = await load();
        if (isCancelled()) return null;
        if (started !== revision) continue;
        return { value };
      }
      return null;
    },
  };
}

export function useStaleReadGuard(): StaleReadGuard {
  // Created once per hook instance. (State rather than a ref: refs must not be read while rendering.)
  const [guard] = useState(createGuard);
  return guard;
}
