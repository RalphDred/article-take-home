import { AppState, type AppStateStatus } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';

import { pageUrl } from '../config';
import {
  CONSENT_GATE_MS,
  CONSENT_REQUEST_TIMEOUT_MS,
  type ConsentEvent,
  consentReducer,
  type ConsentState,
  initialConsentState,
} from './consent';

/** Asks the consent service once. Resolves with the consent string or null; rejects when the request fails. */
export type AskConsent = (signal: AbortSignal) => Promise<string | null>;

export type ConsentRequests = {
  /** Launch: asks, and closes the five-second gate for the pages. */
  start: () => void;
  /** Back in the foreground: asks again. Pages that are open are not held up by it. */
  request: () => void;
  /** Stops the gate timer and forgets every request in flight. */
  stop: () => void;
};

/**
 * The requests behind the consent state, separate from React Native so the timing rules can be tested.
 *
 * Requests can overlap (a hanging one at launch, another on the next foreground), and answers can arrive out of
 * order. An answer older than one already applied is stale and dropped. A request that has not answered after
 * `CONSENT_REQUEST_TIMEOUT_MS` is aborted and counts as failed; until then its answer still counts, however late.
 */
export function createConsentRequests(ask: AskConsent, dispatch: (event: ConsentEvent) => void): ConsentRequests {
  let requested = 0;
  let lastAnswered = 0;
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);

    return timer;
  };

  const request = () => {
    const id = ++requested;
    const abort = new AbortController();
    const giveUp = later(CONSENT_REQUEST_TIMEOUT_MS, () => abort.abort());

    ask(abort.signal)
      .then(
        value => {
          if (stopped || id < lastAnswered) return;
          lastAnswered = id;
          dispatch({ type: 'answered', value });
        },
        (error: unknown) => {
          if (stopped) return;
          console.warn(`[consent] request ${id} failed`, error);
          dispatch({ type: 'failed' });
        },
      )
      .finally(() => {
        clearTimeout(giveUp);
        timers.delete(giveUp);
      });
  };

  return {
    start: () => {
      later(CONSENT_GATE_MS, () => dispatch({ type: 'gateClosed' }));
      request();
    },
    request,
    stop: () => {
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------

type ConsentStore = { state: ConsentState; dispatch: (event: ConsentEvent) => void };

/** The app's consent state. Pages read `pageConsentOf(state)`, the tracker `consentStringOf(state)`. */
export const useConsent = create<ConsentStore>()(set => ({
  state: initialConsentState,
  dispatch: event =>
    set(store => {
      const next = consentReducer(store.state, event);
      if (next !== store.state) console.info(`[consent] ${event.type} → ${describe(next)}`);

      return next === store.state ? store : { state: next };
    }),
}));

const describe = (state: ConsentState): string => (state.status === 'given' ? `given (${state.value})` : state.status);

// An empty string is not a consent string: a page would read `#consent=` as consent given with no value.
const answerSchema = z.object({ consent: z.string().min(1).nullable() });

const askServer: AskConsent = async signal => {
  const response = await fetch(pageUrl('/consent'), { signal, headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const answer = answerSchema.safeParse(await response.json());
  if (!answer.success) throw new Error('not a consent answer');

  return answer.data.consent;
};

/**
 * Asks at launch and each time the app comes back to the foreground. Returns the cleanup. Call once, at launch: the
 * five-second gate starts now.
 */
export function startConsent(): () => void {
  const requests = createConsentRequests(askServer, useConsent.getState().dispatch);
  requests.start();

  let current: AppStateStatus = AppState.currentState;
  const subscription = AppState.addEventListener('change', next => {
    if (next === 'active' && current !== 'active') requests.request();
    current = next;
  });

  return () => {
    subscription.remove();
    requests.stop();
  };
}
