// The reader's consent (README, "The reader's consent").
//
// The app asks `GET /consent` at launch and on each return to the foreground. An answer arrives after a delay nobody
// can predict, or fails, or never comes. Pages wait for it, but for five seconds at most: after that they load without
// it, and the request keeps running. A string that arrives later is consent arriving later: a page that was loaded
// without any consent string reloads once with it, and the tracker may now be created (`tracking.ts`).
//
// A state machine rather than flags: "failed" (we do not know) and "none" (the reader has not chosen) behave the same
// for pages and the tracker, but the logs and NOTES.md keep them apart, and nothing can be both "given" and "asking".

import { assertNever } from '../util/assertNever';
import { documentOf, type LoadState } from '../web/loadState';

/** Pages wait this long for the first answer, then load without consent. */
export const CONSENT_GATE_MS = 5_000;
/** A request that has not answered by then is given up. Until then a late answer still counts. */
export const CONSENT_REQUEST_TIMEOUT_MS = 30_000;

export type ConsentState =
  /** Launch: no answer yet, within the five seconds. Pages wait. */
  | { status: 'asking' }
  /** Still no answer after five seconds. Pages load without consent; the request keeps running. */
  | { status: 'timedOut' }
  /** The request failed (or gave up) before any answer: we do not know. Pages load without consent. */
  | { status: 'failed' }
  /** The service answered `null`: the reader has not chosen yet. Pages load without consent, nothing is tracked. */
  | { status: 'none' }
  /** The reader's consent string. Pages load with it, and the tracker may exist. */
  | { status: 'given'; value: string };

export type ConsentEvent =
  | { type: 'answered'; value: string | null }
  | { type: 'failed' }
  /** The five seconds are over. */
  | { type: 'gateClosed' };

export const initialConsentState: ConsentState = { status: 'asking' };

/**
 * Pure transition function. Returns the same object when nothing changes.
 *
 * - The newest answer wins, a string or `null`: `null` after a string means the reader withdrew it, so later loads
 *   carry none. (A tracker that already exists stays: the SDK cannot remove one. See NOTES.md.)
 * - A failure only matters while nothing is known. After an answer, the last answer stays the truth.
 */
export function consentReducer(state: ConsentState, event: ConsentEvent): ConsentState {
  switch (event.type) {
    case 'answered':
      if (event.value === null) return state.status === 'none' ? state : { status: 'none' };
      if (state.status === 'given' && state.value === event.value) return state;

      return { status: 'given', value: event.value };

    case 'failed':
      return state.status === 'asking' || state.status === 'timedOut' ? { status: 'failed' } : state;

    case 'gateClosed':
      return state.status === 'asking' ? { status: 'timedOut' } : state;

    default:
      return assertNever(event, 'consent event');
  }
}

/** What a page load needs: whether it may start yet, and with which consent string (null: none). */
export type PageConsent = { known: false } | { known: true; value: string | null };

export function pageConsentOf(state: ConsentState): PageConsent {
  switch (state.status) {
    case 'asking':
      return { known: false };
    case 'timedOut':
    case 'failed':
    case 'none':
      return { known: true, value: null };
    case 'given':
      return { known: true, value: state.value };
    default:
      return assertNever(state, 'consent state');
  }
}

/** The consent string, only when the reader has given one. The tracker is created from this and nothing else. */
export const consentStringOf = (state: ConsentState): string | null => (state.status === 'given' ? state.value : null);

// ---------------------------------------------------------------------------------------------------------------
// The consent string travels in the page URL's fragment, the only place a page reads it from, once, at its start.

const CONSENT_FRAGMENT = /^#consent=(.*)$/;

/** The URL a page loads with: its own URL, plus `#consent=<value>` when there is a consent string. */
export function withConsent(url: string, consent: string | null): string {
  const document = documentOf(url);

  return consent === null ? document : `${document}#consent=${encodeURIComponent(consent)}`;
}

/** The consent string a page URL carries, or null when it was loaded without one. */
export function consentInUrl(url: string): string | null {
  const hash = url.indexOf('#');
  const match = hash === -1 ? null : CONSENT_FRAGMENT.exec(url.slice(hash));
  if (!match) return null;

  try {
    return decodeURIComponent(match[1] ?? '') || null;
  } catch {
    return null;
  }
}

/**
 * The one exception to "consent that arrives while a page is open does not reload it": a page whose current document
 * was loaded with no consent string at all reloads once when one is available (`newestUrl` carries it), so its ads
 * can load. A page that already has a string, even an older one, keeps it until its next load. A page on the error
 * state is left alone: its next retry uses the newest URL anyway.
 */
export function needsConsentReload(state: LoadState, newestUrl: string | null): boolean {
  if (newestUrl === null || consentInUrl(newestUrl) === null) return false;
  if (state.status !== 'loading' && state.status !== 'ready') return false;

  return consentInUrl(state.url) === null;
}

/**
 * Which load, if any, the app starts when a page's newest URL is `url` (`usePageLoad`): the first load once consent is
 * known, the one consent reload, or nothing. Every other change of URL waits for the page's next load.
 */
export function loadToStart(state: LoadState, url: string | null): string | null {
  if (url === null) return null;
  if (state.status === 'waitingForConsent') return url;

  return needsConsentReload(state, url) ? url : null;
}
