import {
  documentOf,
  initialLoadState,
  type LoadEvent,
  loadReducer,
  type LoadState,
  sameDocument,
  shouldRetryOnReconnect,
} from '../loadState';

const FRONT = 'http://10.0.2.2:8787/front';

const run = (...events: LoadEvent[]): LoadState => events.reduce(loadReducer, initialLoadState);

describe('loadReducer', () => {
  it('waits for consent until the app starts a load', () => {
    expect(initialLoadState).toEqual({ status: 'waitingForConsent' });
    expect(run({ type: 'load', url: FRONT })).toEqual({ status: 'loading', loadId: 1, url: FRONT });
  });

  it('becomes ready on the first ready of the load in progress', () => {
    expect(run({ type: 'load', url: FRONT }, { type: 'ready', loadId: 1 })).toEqual({
      status: 'ready',
      loadId: 1,
      url: FRONT,
    });
  });

  it('ignores a second ready from the same document (the "ready twice" page)', () => {
    const ready = run({ type: 'load', url: FRONT }, { type: 'ready', loadId: 1 });

    expect(loadReducer(ready, { type: 'ready', loadId: 1 })).toBe(ready);
  });

  it('ends on the error state when the page never becomes ready, and ignores a ready after that', () => {
    const timedOut = run({ type: 'load', url: FRONT }, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } });

    expect(timedOut).toEqual({ status: 'error', loadId: 1, url: FRONT, failure: { kind: 'timeout' } });
    expect(loadReducer(timedOut, { type: 'ready', loadId: 1 })).toBe(timedOut);
  });

  it('ends on the same error state when the server is unreachable or answers an HTTP error', () => {
    const unreachable = { kind: 'network', description: 'net::ERR_CONNECTION_REFUSED' } as const;

    expect(run({ type: 'load', url: FRONT }, { type: 'failed', loadId: 1, failure: unreachable })).toMatchObject({
      status: 'error',
      failure: unreachable,
    });
    expect(
      run({ type: 'load', url: FRONT }, { type: 'failed', loadId: 1, failure: { kind: 'http', status: 503 } }),
    ).toMatchObject({ status: 'error', failure: { kind: 'http', status: 503 } });
  });

  it('keeps a ready page ready when a late failure or timeout arrives', () => {
    const ready = run({ type: 'load', url: FRONT }, { type: 'ready', loadId: 1 });

    expect(loadReducer(ready, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } })).toBe(ready);
  });

  it('starts a new load with a new id on retry or reload, from any state', () => {
    const failed = run({ type: 'load', url: FRONT }, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } });
    const retried = loadReducer(failed, { type: 'load', url: FRONT });

    expect(retried).toEqual({ status: 'loading', loadId: 2, url: FRONT });

    const ready = loadReducer(retried, { type: 'ready', loadId: 2 });
    expect(loadReducer(ready, { type: 'load', url: `${FRONT}#consent=abc` })).toEqual({
      status: 'loading',
      loadId: 3,
      url: `${FRONT}#consent=abc`,
    });
  });

  it('ignores events that belong to an older load', () => {
    const reloading = run({ type: 'load', url: FRONT }, { type: 'load', url: FRONT });

    expect(loadReducer(reloading, { type: 'ready', loadId: 1 })).toBe(reloading);
    expect(loadReducer(reloading, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } })).toBe(reloading);
  });
});

describe('sameDocument', () => {
  it('treats a hash change as the same document', () => {
    expect(sameDocument(`${FRONT}#top`, FRONT)).toBe(true);
    expect(sameDocument('http://h/article/1?ref=front#related', 'http://h/article/1?ref=front#summary')).toBe(true);
    expect(documentOf('http://h/article/1?ref=front#related')).toBe('http://h/article/1?ref=front');
  });

  it('treats another path or another query string as another document', () => {
    expect(sameDocument('http://h/article/1', 'http://h/article/2')).toBe(false);
    expect(sameDocument('http://h/article/1?ref=front', 'http://h/article/1?ref=related')).toBe(false);
  });
});

describe('shouldRetryOnReconnect', () => {
  const failed = run({ type: 'load', url: FRONT }, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } });
  const ready = run({ type: 'load', url: FRONT }, { type: 'ready', loadId: 1 });

  it('retries a failed page when the device comes back online', () => {
    expect(shouldRetryOnReconnect(false, true, failed)).toBe(true);
  });

  it('does not retry on the first report, or on reports while already online (unreachable server)', () => {
    expect(shouldRetryOnReconnect(undefined, true, failed)).toBe(false);
    expect(shouldRetryOnReconnect(true, true, failed)).toBe(false);
  });

  it('does not touch a page that is not on its error state', () => {
    expect(shouldRetryOnReconnect(false, true, ready)).toBe(false);
  });
});
