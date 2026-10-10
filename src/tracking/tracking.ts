// How events reach the collector (README, "Tracking").
//
// One tracker, `news-app`, created through the vendor SDK only once `/consent` has answered with a consent string.
// Before that, nothing may reach the collector, but nothing may be lost either: the app's own events and the pages'
// tracker messages wait here, in one buffer, in the order they happened, and go to the SDK once, in that order, when
// the tracker is created. The SDK's own web view callback cannot do this: it drops web events while no tracker exists.

import type { SelfDescribingJson, ScreenViewEvent, Tracker, TrackerConfig, WebViewMessage } from '../../sdk/tracker';
import { assertNever } from '../util/assertNever';
import type { TrackerCommand } from '../web/protocol';

export const READ_EVENT_SCHEMA = 'iglu:com.example.news/article_read/jsonschema/1-0-0';

/**
 * At most this many events wait for consent; beyond that the oldest go. Only a reader who never chooses gets near it.
 * The SDK keeps the same number per tracker, so a full buffer still fits its queue once the tracker exists.
 */
export const BUFFER_LIMIT = 500;

/** One event in arrival order. Web events keep the page's original string, which is what the SDK wants. */
export type BufferedEvent =
  | { kind: 'web'; raw: string; command: TrackerCommand }
  | { kind: 'screenView'; event: ScreenViewEvent }
  | { kind: 'selfDescribing'; event: SelfDescribingJson };

/** The part of the vendor SDK this needs, so tests can stand in for it. */
export type TrackerSdk = {
  newTracker: (config: TrackerConfig) => Tracker;
  getTracker: (namespace: string) => Tracker | undefined;
  getWebViewCallback: () => (message: WebViewMessage) => void;
};

export type Tracking = {
  /** A page was shown: once per loaded document. */
  trackScreenView: (event: ScreenViewEvent) => void;
  /** The article's text was read (once per article screen, see `readCounter.ts`). */
  trackArticleRead: (articleId: string) => void;
  /** A message from a page's web tracker, as the page sent it. */
  trackWebMessage: (raw: string, command: TrackerCommand) => void;
  /**
   * The reader has given consent: creates the tracker (once) and sends everything that waited, in order. Later calls
   * do nothing.
   */
  start: () => void;
  /** For logs and tests. */
  stats: () => { started: boolean; buffered: number; dropped: number };
};

export function createTracking(sdk: TrackerSdk, config: TrackerConfig): Tracking {
  let tracker: Tracker | null = null;
  let buffer: BufferedEvent[] = [];
  let dropped = 0;
  const webViewCallback = sdk.getWebViewCallback();

  const deliver = (item: BufferedEvent, to: Tracker) => {
    switch (item.kind) {
      case 'web':
        // The SDK reads the page's own string, unknown fields included, and adds it to every tracker it has (ours).
        webViewCallback({ nativeEvent: { data: item.raw } });
        return;
      case 'screenView':
        to.trackScreenViewEvent(item.event);
        return;
      case 'selfDescribing':
        to.trackSelfDescribingEvent(item.event);
        return;
      default:
        assertNever(item, 'tracking event');
    }
  };

  const record = (item: BufferedEvent) => {
    if (tracker !== null) {
      deliver(item, tracker);
      return;
    }

    buffer.push(item);
    if (buffer.length > BUFFER_LIMIT) {
      buffer.shift();
      dropped += 1;
      if (dropped === 1 || dropped % 100 === 0) {
        console.warn(`[tracking] no consent yet: ${dropped} event(s) dropped, keeping the newest ${BUFFER_LIMIT}`);
      }
    }
  };

  return {
    trackScreenView: event => record({ kind: 'screenView', event }),
    trackArticleRead: articleId =>
      record({ kind: 'selfDescribing', event: { schema: READ_EVENT_SCHEMA, data: { articleId } } }),
    trackWebMessage: (raw, command) => record({ kind: 'web', raw, command }),

    start: () => {
      if (tracker !== null) return;

      // `newTracker` throws for a namespace that exists. After a Fast Refresh this module is new but the SDK's is not,
      // so the existing tracker is used instead of a second one.
      const created = sdk.getTracker(config.namespace) ?? sdk.newTracker(config);
      const waiting = buffer;
      buffer = [];
      tracker = created;

      console.info(`[tracking] tracker created, sending ${waiting.length} event(s) from before consent`);
      waiting.forEach(item => deliver(item, created));
    },

    stats: () => ({ started: tracker !== null, buffered: buffer.length, dropped }),
  };
}
