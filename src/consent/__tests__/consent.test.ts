// The consent rule (README, "The reader's consent"). The hardest rules to check by hand and the easiest to break:
// when a page may load, with which URL, and when (exactly once) it reloads because consent arrived late.

import { initialLoadState, type LoadEvent, loadReducer, type LoadState } from '../../web/loadState';
import {
  CONSENT_GATE_MS,
  CONSENT_REQUEST_TIMEOUT_MS,
  consentInUrl,
  consentReducer,
  type ConsentState,
  consentStringOf,
  initialConsentState,
  loadToStart,
  pageConsentOf,
  withConsent,
} from '../consent';
import { type AskConsent, createConsentRequests } from '../consentService';

const FRONT = 'http://10.0.2.2:8787/front';
const ARTICLE = 'http://10.0.2.2:8787/article/2?ref=front';

type Pending = { resolve: (value: string | null) => void; reject: (error: Error) => void; signal: AbortSignal };

/** A consent service whose answers the test gives, one per request, in any order. */
function fakeService() {
  const pending: Pending[] = [];
  const ask: AskConsent = signal =>
    new Promise((resolve, reject) => {
      pending.push({ resolve, reject, signal });
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

  const request = (index: number): Pending => {
    const found = pending[index];
    if (!found) throw new Error(`no request ${index}`);
    return found;
  };

  return { ask, request };
}

/**
 * The app as far as consent goes: the consent state, and one page whose loads follow `usePageLoad`'s rule
 * (`loadToStart`). `loads` lists every load the page started, in order.
 */
function launch(pageUrl = FRONT) {
  const service = fakeService();
  let consent: ConsentState = initialConsentState;
  let page: LoadState = initialLoadState;
  const loads: string[] = [];

  const sync = () => {
    const known = pageConsentOf(consent);
    const next = loadToStart(page, known.known ? withConsent(pageUrl, known.value) : null);
    if (next === null) return;

    page = loadReducer(page, { type: 'load', url: next });
    loads.push(next);
  };

  const requests = createConsentRequests(service.ask, event => {
    consent = consentReducer(consent, event);
    sync();
  });
  requests.start();

  return {
    requests,
    answer: (index: number, value: string | null) => service.request(index).resolve(value),
    fail: (index: number) => service.request(index).reject(new Error('HTTP 500')),
    signal: (index: number) => service.request(index).signal,
    loads,
    consent: () => consent,
    page: () => page,
    pageEvent: (event: LoadEvent) => {
      page = loadReducer(page, event);
      sync();
    },
    /** The page sends `ready` for its current load. */
    ready: () => {
      if (page.status === 'loading') page = loadReducer(page, { type: 'ready', loadId: page.loadId });
    },
  };
}

/** Lets settled promises run their callbacks. */
const settle = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the five-second gate', () => {
  it('waits for an answer, and loads with the consent string when it comes in time', async () => {
    const app = launch();

    await jest.advanceTimersByTimeAsync(3_000);
    expect(app.loads).toEqual([]);

    app.answer(0, 'cs1-ab');
    await settle();
    expect(app.loads).toEqual([`${FRONT}#consent=cs1-ab`]);

    // The gate closing later changes nothing.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(app.loads).toHaveLength(1);
  });

  it('loads without a fragment at five seconds, then reloads exactly once for a string at 7 s', async () => {
    const app = launch();

    await jest.advanceTimersByTimeAsync(CONSENT_GATE_MS - 1);
    expect(app.loads).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(app.loads).toEqual([FRONT]);
    expect(app.consent()).toEqual({ status: 'timedOut' });

    app.ready();
    await jest.advanceTimersByTimeAsync(2_000);
    app.answer(0, 'cs1-ab');
    await settle();

    expect(app.loads).toEqual([FRONT, `${FRONT}#consent=cs1-ab`]);
    expect(consentStringOf(app.consent())).toBe('cs1-ab');
  });

  it('does not reload for a null at 7 s, and gives the tracker no consent string', async () => {
    const app = launch();
    await jest.advanceTimersByTimeAsync(7_000);
    app.ready();

    app.answer(0, null);
    await settle();

    expect(app.loads).toEqual([FRONT]);
    expect(app.consent()).toEqual({ status: 'none' });
    expect(consentStringOf(app.consent())).toBeNull();
  });

  it('loads without consent at once when the request fails within the five seconds', async () => {
    const app = launch();

    await jest.advanceTimersByTimeAsync(1_000);
    app.fail(0);
    await settle();

    expect(app.loads).toEqual([FRONT]);
    expect(app.consent()).toEqual({ status: 'failed' });
  });

  it('gives up on a request that never answers after 30 s, without reloading the page', async () => {
    const app = launch();

    await jest.advanceTimersByTimeAsync(CONSENT_REQUEST_TIMEOUT_MS);

    expect(app.signal(0).aborted).toBe(true);
    expect(app.consent()).toEqual({ status: 'failed' });
    expect(app.loads).toEqual([FRONT]);
  });
});

describe('consent that arrives or changes later', () => {
  it('reloads a page loaded after a failure once, when the next foreground answers with a string', async () => {
    const app = launch(ARTICLE);
    app.fail(0);
    await settle();
    app.ready();

    app.requests.request(); // back in the foreground
    app.answer(1, 'cs1-ab');
    await settle();

    expect(app.loads).toEqual([ARTICLE, `${ARTICLE}#consent=cs1-ab`]);
  });

  it('never reloads again: a changed string waits for the next load, which carries the newest one', async () => {
    const app = launch();
    await jest.advanceTimersByTimeAsync(CONSENT_GATE_MS);
    app.answer(0, 'cs1-ab');
    await settle();
    app.ready();

    app.requests.request();
    app.answer(1, 'cs2-cd');
    await settle();
    expect(app.loads).toEqual([FRONT, `${FRONT}#consent=cs1-ab`]);

    // The reader pulls to refresh: a new load, with the newest string.
    app.pageEvent({ type: 'load', url: withConsent(FRONT, consentStringOf(app.consent())) });
    expect(app.page()).toMatchObject({ status: 'loading', url: `${FRONT}#consent=cs2-cd` });
  });

  it('does not reload a page that has a string when it is withdrawn and given again', async () => {
    const app = launch();
    app.answer(0, 'cs1-ab');
    await settle();
    app.ready();

    app.requests.request();
    app.answer(1, null);
    await settle();
    app.requests.request();
    app.answer(2, 'cs2-cd');
    await settle();

    expect(app.loads).toEqual([`${FRONT}#consent=cs1-ab`]);
  });

  it('drops an answer that is older than one already applied', async () => {
    const app = launch();
    app.requests.request();

    app.answer(1, 'cs2-new');
    await settle();
    app.answer(0, 'cs1-old');
    await settle();

    expect(consentStringOf(app.consent())).toBe('cs2-new');
  });

  it('keeps the last answer when a later request fails', () => {
    const given: ConsentState = { status: 'given', value: 'cs1-ab' };

    expect(consentReducer(given, { type: 'failed' })).toBe(given);
    expect(consentReducer({ status: 'none' }, { type: 'failed' })).toEqual({ status: 'none' });
  });

  it('leaves a page on its error state alone: its retry uses the newest URL', () => {
    const loading = loadReducer(initialLoadState, { type: 'load', url: FRONT });
    const failed = loadReducer(loading, { type: 'failed', loadId: 1, failure: { kind: 'timeout' } });

    expect(loadToStart(failed, `${FRONT}#consent=cs1-ab`)).toBeNull();
  });
});

describe('the consent fragment', () => {
  it('is added, encoded, only when there is a string, and replaces any fragment', () => {
    expect(withConsent(FRONT, null)).toBe(FRONT);
    expect(withConsent(`${FRONT}#consent=old`, 'a b&c')).toBe(`${FRONT}#consent=a%20b%26c`);
    expect(withConsent(ARTICLE, 'cs1')).toBe(`${ARTICLE}#consent=cs1`);
  });

  it('is read back from a page URL', () => {
    expect(consentInUrl(`${FRONT}#consent=a%20b%26c`)).toBe('a b&c');
    expect(consentInUrl(FRONT)).toBeNull();
    expect(consentInUrl(`${FRONT}#related`)).toBeNull();
    expect(consentInUrl(`${FRONT}#consent=`)).toBeNull();
  });
});
