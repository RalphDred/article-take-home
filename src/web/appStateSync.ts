// Which app events a page needs, and when (README, "App state on the pages").
//
// A page drops app events sent before its `ready` (its status box counts them as "ignored"), and counts every one it
// applies. So each document gets the whole state once, on its `ready`, and after that one event per field that
// really changed, compared with what that document was last sent. Nothing is sent on a re-render or a remount.

import type { AppStateData } from '../state/appState';
import type { AppEvent, Insets, PageKind } from './protocol';

/** Same ids, in any order. The pages treat the lists as sets; the order only matters to the app's own strip. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  const ids = new Set(a);

  return b.every(id => ids.has(id));
}

export const sameInsets = (a: Insets | undefined, b: Insets | undefined): boolean =>
  a?.top === b?.top && a?.bottom === b?.bottom;

/**
 * The events that bring a page from `sent` to `next`. With `sent` null (a document that just became ready), every
 * event the page kind understands. `app:read` is for the front page only.
 */
export function appStateEvents(page: PageKind, sent: AppStateData | null, next: AppStateData): AppEvent[] {
  const events: AppEvent[] = [];

  if (sent === null || sent.fontScale !== next.fontScale) {
    events.push({ name: 'app:fontScale', detail: { value: next.fontScale } });
  }
  if (sent === null || sent.theme !== next.theme) {
    events.push({ name: 'app:theme', detail: { value: next.theme } });
  }
  if (sent === null || !sameIds(sent.bookmarks, next.bookmarks)) {
    events.push({ name: 'app:bookmarks', detail: { ids: next.bookmarks } });
  }
  if (page === 'front' && (sent === null || !sameIds(sent.readIds, next.readIds))) {
    events.push({ name: 'app:read', detail: { ids: next.readIds } });
  }

  return events;
}

/** The part of a Zustand store this needs, so it can be tested with a plain store. */
export type AppStateSource = {
  getState: () => AppStateData;
  subscribe: (listener: (state: AppStateData) => void) => () => void;
};

/**
 * For a document that just became ready: sends the current state, then each change. Returns the unsubscribe, which
 * must run as soon as the document is no longer the ready one (a new load, or the screen goes away).
 *
 * The snapshot and the subscription happen in one synchronous step, so no change can fall between them.
 */
export function startAppStateSync(page: PageKind, source: AppStateSource, send: (event: AppEvent) => void): () => void {
  let sent = source.getState();
  appStateEvents(page, null, sent).forEach(send);

  return source.subscribe(next => {
    const events = appStateEvents(page, sent, next);
    sent = next;
    events.forEach(send);
  });
}
