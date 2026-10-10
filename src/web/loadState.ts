// The loading state of one page web view, as a state machine (README, "Loading").
//
// Only the app starts loads: the first load, a reload, a retry, and later the consent reload. Each one gets a new
// `loadId`, and the web view is rebuilt for it, so a message from an older document can never reach a newer load.
// In-page navigation (a `#hash` change) is not an event here at all, so it can never show the loading state.

import { assertNever } from '../util/assertNever';

/** No `ready` within this long and the reader gets the error state, not an endless spinner. */
export const READY_TIMEOUT_MS = 15_000;

export type LoadFailure =
  | { kind: 'timeout' } // the page never sent `ready`
  | { kind: 'network'; description: string } // the document could not be fetched (server or device offline)
  | { kind: 'http'; status: number }
  | { kind: 'savedCopy'; description: string }; // a saved copy's page could not be read from disk

export type LoadState =
  /** No URL yet: the app does not know the consent string (or that there is none). */
  | { status: 'waitingForConsent' }
  | { status: 'loading'; loadId: number; url: string }
  | { status: 'ready'; loadId: number; url: string }
  | { status: 'error'; loadId: number; url: string; failure: LoadFailure };

export type LoadEvent =
  /** An app-started load. Allowed from every state: a reload while loading simply replaces the older load. */
  | { type: 'load'; url: string }
  | { type: 'ready'; loadId: number }
  | { type: 'failed'; loadId: number; failure: LoadFailure };

export const initialLoadState: LoadState = { status: 'waitingForConsent' };

/**
 * Pure transition function. Returns the same object when an event is ignored, so React skips the render.
 *
 * - `ready` counts only for the load in progress: a second `ready` from the same document is ignored, and so is a
 *   late `ready` after the timeout already ended on the error state.
 * - `failed` (timeout, network, HTTP) also counts only while loading. Once a page is ready it stays ready.
 */
export function loadReducer(state: LoadState, event: LoadEvent): LoadState {
  switch (event.type) {
    case 'load':
      return {
        status: 'loading',
        loadId: state.status === 'waitingForConsent' ? 1 : state.loadId + 1,
        url: event.url,
      };

    case 'ready':
      if (state.status !== 'loading' || state.loadId !== event.loadId) return state;

      return { status: 'ready', loadId: state.loadId, url: state.url };

    case 'failed':
      if (state.status !== 'loading' || state.loadId !== event.loadId) return state;

      return { status: 'error', loadId: state.loadId, url: state.url, failure: event.failure };

    default:
      return assertNever(event, 'load event');
  }
}

/** The document a URL loads: everything before the `#`. Two URLs that differ only in their hash are one document. */
export const documentOf = (url: string): string => {
  const hash = url.indexOf('#');

  return hash === -1 ? url : url.slice(0, hash);
};

export const sameDocument = (a: string, b: string): boolean => documentOf(a) === documentOf(b);

/** A saved copy's page, on the device, rather than a page on the server. */
export const isFileUrl = (url: string): boolean => /^file:/i.test(url);

/**
 * Whether a network change should retry a page on its error state: only when the device comes back online, not
 * on every report while it is online. Otherwise an unreachable server (device online) would retry in a loop.
 */
export const shouldRetryOnReconnect = (
  wasOnline: boolean | undefined,
  isOnline: boolean,
  state: LoadState,
): boolean => wasOnline === false && isOnline && state.status === 'error';
