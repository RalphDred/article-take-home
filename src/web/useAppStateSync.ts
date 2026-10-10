import { useEffect, useRef } from 'react';

import { useAppState } from '../state/appState';
import { sameInsets, startAppStateSync } from './appStateSync';
import { appEventScript, type Insets, type PageKind } from './protocol';

/**
 * Sends the app state to the ready document of one web view: everything once on its `ready`, then each change once.
 * `readyLoadId` is the load that is ready, or null; when it changes or the web view goes away, the old document stops
 * listening. `inject` must be stable.
 */
export function useAppStateSync(page: PageKind, readyLoadId: number | null, inject: (script: string) => void): void {
  useEffect(() => {
    if (readyLoadId === null) return;

    return startAppStateSync(page, useAppState, event => inject(appEventScript(event)));
  }, [page, readyLoadId, inject]);
}

/**
 * Articles: keeps the page's insets current. A document starts with the insets of the moment its load started
 * (`window.appInsets`), so `app:insets` is sent only when the insets differ from what that document already has:
 * on `ready` if they changed while it loaded, and after that on each change.
 */
export function useInsetsSync(
  loadId: number | null,
  isReady: boolean,
  insets: Insets | undefined,
  inject: (script: string) => void,
): void {
  // What the current document knows: its start-up insets, then each `app:insets` it was sent.
  const known = useRef<{ loadId: number; insets: Insets | undefined } | null>(null);
  const latest = useRef(insets);
  latest.current = insets;

  // Runs in the same commit that mounts the new document with `window.appInsets` set from these insets.
  useEffect(() => {
    if (loadId !== null) known.current = { loadId, insets: latest.current };
  }, [loadId]);

  useEffect(() => {
    if (!isReady || loadId === null || insets === undefined) return;

    const current = known.current;
    if (current?.loadId === loadId && sameInsets(current.insets, insets)) return;

    inject(appEventScript({ name: 'app:insets', detail: insets }));
    known.current = { loadId, insets };
  }, [loadId, isReady, insets, inject]);
}
