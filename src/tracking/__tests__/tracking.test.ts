// Q15 test 3: the tracking buffer. A mistake here either loses events or sends them before consent, and neither shows
// on the screen.

import type { Tracker, TrackerConfig, WebViewMessage } from '../../../sdk/tracker';
import { parseInbound, type TrackerCommand } from '../../web/protocol';
import { BUFFER_LIMIT, createTracking, READ_EVENT_SCHEMA, type TrackerSdk } from '../tracking';

const CONFIG: TrackerConfig = {
  namespace: 'news-app',
  endpoint: 'http://10.0.2.2:8787',
  appVersion: '1.0.0',
  platform: 'android',
};

/** A page's web tracker message, as the page posts it, and as the app's parser classifies it. */
function webMessage(pageUrl: string): { raw: string; command: TrackerCommand } {
  const raw = JSON.stringify({
    command: 'trackPageView',
    event: { pageUrl },
    context: [{ schema: 'iglu:com.example.news/app/jsonschema/1-0-0', data: { os: 'android' } }],
    extra: 'kept',
  });
  const inbound = parseInbound(raw);
  if (inbound.kind !== 'tracker') throw new Error('not a tracker message');

  return { raw, command: inbound.command };
}

/** Stands in for the SDK and records, in one list, everything that reaches it. */
function fakeSdk() {
  const received: string[] = [];
  const trackers = new Map<string, Tracker>();
  const created: TrackerConfig[] = [];

  const sdk: TrackerSdk = {
    newTracker: config => {
      if (trackers.has(config.namespace)) throw new Error('exists');
      created.push(config);
      const tracker: Tracker = {
        namespace: config.namespace,
        trackScreenViewEvent: event => received.push(`screen ${event.name}${event.id ? ` ${event.id}` : ''}`),
        trackSelfDescribingEvent: event => received.push(`${event.schema} ${JSON.stringify(event.data)}`),
        trackPageViewEvent: event => received.push(`app page ${event.pageUrl}`),
      };
      trackers.set(config.namespace, tracker);
      return tracker;
    },
    getTracker: namespace => trackers.get(namespace),
    // Like the SDK: web events go to the trackers that exist, and are dropped when there is none.
    getWebViewCallback: () => (message: WebViewMessage) => {
      if (trackers.size > 0) received.push(`web ${message.nativeEvent.data}`);
    },
  };

  return { sdk, received, created, trackers };
}

describe('createTracking', () => {
  it('sends nothing before consent, then everything once, in the order it happened', () => {
    const { sdk, received } = fakeSdk();
    const tracking = createTracking(sdk, CONFIG);
    const page = webMessage('http://10.0.2.2:8787/front');

    tracking.trackWebMessage(page.raw, page.command);
    tracking.trackScreenView({ name: 'front' });
    tracking.trackScreenView({ name: 'article', id: '2' });
    tracking.trackArticleRead('2');
    expect(received).toEqual([]);

    tracking.start();
    expect(received).toEqual([
      `web ${page.raw}`,
      'screen front',
      'screen article 2',
      `${READ_EVENT_SCHEMA} {"articleId":"2"}`,
    ]);
  });

  it("hands the SDK the page's original string, unknown fields included", () => {
    const { sdk, received } = fakeSdk();
    const tracking = createTracking(sdk, CONFIG);
    const page = webMessage('http://10.0.2.2:8787/article/2');

    tracking.trackWebMessage(page.raw, page.command);
    tracking.start();

    expect(received).toEqual([`web ${page.raw}`]);
    expect(received[0]).toContain('"extra":"kept"');
  });

  it('creates one tracker, with the namespace, endpoint, version and platform, however often it is started', () => {
    const { sdk, created } = fakeSdk();
    const tracking = createTracking(sdk, CONFIG);

    tracking.start();
    tracking.start();

    expect(created).toEqual([CONFIG]);
  });

  it('uses the tracker that already exists after a Fast Refresh instead of creating a second one (which throws)', () => {
    const { sdk, created, received } = fakeSdk();
    createTracking(sdk, CONFIG).start();

    const refreshed = createTracking(sdk, CONFIG);
    refreshed.trackScreenView({ name: 'front' });
    expect(() => refreshed.start()).not.toThrow();

    expect(created).toHaveLength(1);
    expect(received).toEqual(['screen front']);
  });

  it('sends events straight through once the tracker exists', () => {
    const { sdk, received } = fakeSdk();
    const tracking = createTracking(sdk, CONFIG);
    tracking.start();

    tracking.trackScreenView({ name: 'front' });

    expect(received).toEqual(['screen front']);
    expect(tracking.stats()).toEqual({ started: true, buffered: 0, dropped: 0 });
  });

  it('keeps the newest events when the reader never chooses, and counts the dropped ones', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, received } = fakeSdk();
    const tracking = createTracking(sdk, CONFIG);

    for (let index = 0; index < BUFFER_LIMIT + 3; index += 1) tracking.trackScreenView({ name: `s${index}` });
    expect(tracking.stats()).toEqual({ started: false, buffered: BUFFER_LIMIT, dropped: 3 });

    tracking.start();
    expect(received).toHaveLength(BUFFER_LIMIT);
    expect(received[0]).toBe('screen s3');
    expect(received.at(-1)).toBe(`screen s${BUFFER_LIMIT + 2}`);
  });
});

describe('createTracking with the vendor SDK', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  it('reaches the collector only after the start, in order, with web events marked as from the web view', async () => {
    jest.useFakeTimers();
    const batches: { namespace: string; events: { e: string; source: string; event: unknown }[] }[] = [];
    const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
      batches.push(JSON.parse(init.body));
      return { ok: true } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // A fresh copy of the SDK: its trackers live in a module-level map.
    let sdk!: TrackerSdk;
    jest.isolateModules(() => {
      sdk = require('../../../sdk/tracker');
    });
    const tracking = createTracking(sdk, CONFIG);
    const page = webMessage('http://10.0.2.2:8787/front');

    tracking.trackScreenView({ name: 'front' });
    tracking.trackWebMessage(page.raw, page.command);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).not.toHaveBeenCalled();

    tracking.start();
    tracking.trackArticleRead('7');
    await jest.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://10.0.2.2:8787/collect');
    expect(batches[0]?.namespace).toBe('news-app');
    expect(batches[0]?.events.map(({ e, source }) => `${source} ${e}`)).toEqual([
      'app screen_view',
      'webview page_view',
      'app self_describing',
    ]);
    expect(batches[0]?.events[2]?.event).toEqual({ schema: READ_EVENT_SCHEMA, data: { articleId: '7' } });
  });
});
