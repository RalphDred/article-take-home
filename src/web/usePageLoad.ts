import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { loadToStart } from '../consent/consent';
import {
  initialLoadState,
  type LoadFailure,
  loadReducer,
  type LoadState,
  READY_TIMEOUT_MS,
  shouldRetryOnReconnect,
} from './loadState';

const isOnline = (net: NetInfoState): boolean => net.isConnected === true && net.isInternetReachable !== false;

export type PageLoad = {
  state: LoadState;
  /** An app-started load of the newest URL: pull to refresh, Retry, and the consent reload. */
  reload: () => void;
  ready: (loadId: number) => void;
  fail: (loadId: number, failure: LoadFailure) => void;
};

/**
 * Drives `loadReducer` for one web view. `url` is null while the app waits for consent; the first non-null value
 * starts the first load. A later change of `url` does not reload by itself (consent that changes while a page is
 * open applies to the next load), except the one reload of a page loaded without any consent string. Every load
 * uses the newest value.
 */
export function usePageLoad(url: string | null): PageLoad {
  const [state, dispatch] = useReducer(loadReducer, initialLoadState);

  const latest = useRef({ url, state });
  latest.current = { url, state };

  const reload = useCallback(() => {
    const { url: newest } = latest.current;
    if (newest !== null) dispatch({ type: 'load', url: newest });
  }, []);

  const ready = useCallback((loadId: number) => dispatch({ type: 'ready', loadId }), []);
  const fail = useCallback((loadId: number, failure: LoadFailure) => dispatch({ type: 'failed', loadId, failure }), []);

  // The first load, as soon as the URL is known. And the one reload for consent: a document loaded with no consent
  // string reloads once when one is available (`needsConsentReload`). After that it has one, so it never reloads again.
  useEffect(() => {
    const next = loadToStart(state, url);
    if (next === null) return;

    if (state.status !== 'waitingForConsent') console.info(`[page] loaded without consent, loading again with it: ${next}`);
    dispatch({ type: 'load', url: next });
  }, [url, state]);

  // A page that never sends `ready` ends on the error state, not on an endless spinner. The time only counts in the
  // foreground: Android does not start a web view's renderer while the app is in the background, so a load started
  // there (a rebuild after the content process was killed) would otherwise time out before the reader comes back.
  // A load still going on return gets the whole timeout again.
  const loadingId = state.status === 'loading' ? state.loadId : null;
  const inForeground = useInForeground();
  useEffect(() => {
    if (loadingId === null || !inForeground) return;

    const timer = setTimeout(() => fail(loadingId, { kind: 'timeout' }), READY_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [loadingId, inForeground, fail]);

  // Back online after being offline, while on the error state: retry by itself.
  useEffect(() => {
    let wasOnline: boolean | undefined;

    return NetInfo.addEventListener(net => {
      const online = isOnline(net);
      if (shouldRetryOnReconnect(wasOnline, online, latest.current.state)) reload();
      wasOnline = online;
    });
  }, [reload]);

  return { state, reload, ready, fail };
}

const subscribeToAppState = (onChange: () => void) => {
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
};
const isAppActive = () => AppState.currentState === 'active';

function useInForeground(): boolean {
  return useSyncExternalStore(subscribeToAppState, isAppActive);
}
