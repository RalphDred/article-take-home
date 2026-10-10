import {
  beforeContentScript,
  injectIntoHtml,
  NATIVE_ANCHOR_SCRIPT,
  READ_DETECTOR_SCRIPT,
  START_READ_DETECTOR_SCRIPT,
} from '../injected';

const appContext = { appVersion: '1.0.0', appBuild: '1', os: 'android', deviceType: 'phone' } as const;

describe('beforeContentScript', () => {
  it('sets appContext, and appInsets only when given', () => {
    const run = (script: string) => new Function('window', script);

    const front: Record<string, unknown> = {};
    run(beforeContentScript({ appContext }))(front);
    expect(front).toEqual({ appContext });

    const article: Record<string, unknown> = {};
    run(beforeContentScript({ appContext, appInsets: { top: 96, bottom: 34 } }))(article);
    expect(article).toEqual({ appContext, appInsets: { top: 96, bottom: 34 } });
  });

  it('adds the anchor script only for a page that does not scroll itself', () => {
    expect(beforeContentScript({ appContext })).not.toContain(NATIVE_ANCHOR_SCRIPT);
    expect(beforeContentScript({ appContext }, { nativeAnchors: true })).toContain(NATIVE_ANCHOR_SCRIPT);
  });

  it('cannot close the script element it is written into', () => {
    const script = beforeContentScript({ appContext: { ...appContext, appVersion: '</script><b>' } });

    expect(script).not.toContain('</script>');
  });
});

describe('NATIVE_ANCHOR_SCRIPT', () => {
  type Listener = (event: unknown) => void;

  /** Just enough of a front page: three headings, the window and the message bridge. */
  function frontPage() {
    const posted: unknown[] = [];
    const listeners: Record<string, Listener> = {};
    const headings: Record<string, number> = { 'top-stories': 420, 'more-stories': 1810.5 };
    const fakeWindow = {
      pageYOffset: 0,
      ReactNativeWebView: { postMessage: (message: string) => posted.push(JSON.parse(message)) },
      addEventListener: (name: string, listener: Listener) => (listeners[`window:${name}`] = listener),
    };
    const fakeDocument = {
      getElementById: (id: string) => {
        const top = headings[id];
        return top === undefined ? null : { getBoundingClientRect: () => ({ top }) };
      },
      addEventListener: (name: string, listener: Listener) => (listeners[`document:${name}`] = listener),
    };
    const fakeLocation = { hash: '#consent=abc' };

    new Function('window', 'document', 'location', NATIVE_ANCHOR_SCRIPT)(fakeWindow, fakeDocument, fakeLocation);

    const tap = (href: string, target = '') => {
      const link = { target, getAttribute: () => href };
      const event = { target: { closest: () => link }, defaultPrevented: false, preventDefault: () => {} };
      event.preventDefault = () => (event.defaultPrevented = true);
      listeners['document:click']?.(event);
      return event.defaultPrevented;
    };
    const changeHash = (hash: string) => {
      fakeLocation.hash = hash;
      listeners['window:hashchange']?.({});
    };

    return { posted, tap, changeHash };
  }

  it('reports a tapped section link and keeps the web view from navigating', () => {
    const page = frontPage();

    expect(page.tap('#more-stories')).toBe(true);
    expect(page.posted).toEqual([{ type: 'app:anchor', id: 'more-stories', top: 1810.5 }]);
  });

  it('reports a hash set by a script', () => {
    const page = frontPage();

    page.changeHash('#top-stories');
    expect(page.posted).toEqual([{ type: 'app:anchor', id: 'top-stories', top: 420 }]);
  });

  it('leaves other links to the page and the web view', () => {
    const page = frontPage();

    expect(page.tap('#')).toBe(false);
    expect(page.tap('#no-such-section')).toBe(false);
    expect(page.tap('/article/2?ref=front')).toBe(false);
    expect(page.tap('#top-stories', '_blank')).toBe(false);
    page.changeHash('#consent=xyz');
    expect(page.posted).toEqual([]);
  });
});

describe('injectIntoHtml', () => {
  it('puts the script first in <head>, before the page scripts', () => {
    const html = '<!doctype html><html lang="en"><head>\n<meta charset="utf-8" /><script>page()</script></head></html>';

    expect(injectIntoHtml(html, 'app()')).toBe(
      '<!doctype html><html lang="en"><head><script>app()</script>\n<meta charset="utf-8" /><script>page()</script></head></html>',
    );
  });

  it('handles a <head> with attributes and does not mistake <header> for it', () => {
    expect(injectIntoHtml('<html><header>x</header><HEAD data-x="1"></HEAD>', 'app()')).toBe(
      '<html><header>x</header><HEAD data-x="1"><script>app()</script></HEAD>',
    );
  });

  it('puts the script at the very start when there is no <head>', () => {
    expect(injectIntoHtml('<p>hi</p>', 'app()')).toBe('<script>app()</script><p>hi</p>');
  });
});

describe('READ_DETECTOR_SCRIPT', () => {
  type Listener = (event: { detail?: unknown }) => void;

  /**
   * Just enough of an article in a web view 800 px tall, with the app's header covering 100 px at the top and 30 px
   * at the bottom. `lastLine` is the bottom of the text's last paragraph, relative to the viewport; null means the page
   * has no `.articlecomponent.text p` at all.
   */
  function articlePage({ installTwice = false } = {}) {
    const posted: unknown[] = [];
    const listeners: Record<string, Listener[]> = {};
    const resizeCallbacks: (() => void)[] = [];
    const page = { lastLine: 2400 as number | null };

    const fakeWindow: Record<string, unknown> = {
      innerHeight: 800,
      appInsets: { top: 100, bottom: 30 },
      ReactNativeWebView: { postMessage: (message: string) => posted.push(JSON.parse(message)) },
      addEventListener: (name: string, listener: Listener) => (listeners[name] ??= []).push(listener),
      requestAnimationFrame: (callback: () => void) => callback(),
      ResizeObserver: class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
      },
    };
    const paragraph = () => ({ getBoundingClientRect: () => ({ bottom: page.lastLine, height: 56 }) });
    const fakeDocument = {
      body: {},
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('.articlecomponent.text p');
        return page.lastLine === null ? [] : [paragraph(), paragraph()];
      },
    };

    const install = () => new Function('window', 'document', READ_DETECTOR_SCRIPT)(fakeWindow, fakeDocument);
    install();
    if (installTwice) install();

    const fire = (name: string, event: { detail?: unknown } = {}) => listeners[name]?.forEach(listener => listener(event));
    const start = () => new Function('window', START_READ_DETECTOR_SCRIPT)(fakeWindow);
    const scrollTo = (lastLine: number) => {
      page.lastLine = lastLine;
      fire('scroll');
    };
    const layoutMoves = (lastLine: number) => {
      page.lastLine = lastLine;
      resizeCallbacks.forEach(callback => callback());
    };

    return { posted, page, fire, start, scrollTo, layoutMoves, listeners };
  }

  it('does not watch before the app starts it: the page is not shown until ready', () => {
    const page = articlePage();

    page.scrollTo(700);
    expect(page.posted).toEqual([]);

    page.start();
    expect(page.posted).toEqual([{ type: 'app:endOfText' }]);
  });

  it('reports once, when the last line has been on screen above the bottom inset', () => {
    const page = articlePage();
    page.start();

    page.scrollTo(790); // behind the bottom inset (800 - 30)
    expect(page.posted).toEqual([]);

    page.scrollTo(760);
    page.scrollTo(500);
    page.scrollTo(-200);
    expect(page.posted).toEqual([{ type: 'app:endOfText' }]);
  });

  it('does not count a last line that is only ever under the header', () => {
    const page = articlePage();
    page.start();

    page.scrollTo(90);
    page.scrollTo(-400);
    expect(page.posted).toEqual([]);
  });

  it('notices the text moving without a scroll (late photos, the ask box, a font size change)', () => {
    const page = articlePage();
    page.start();

    page.layoutMoves(600);
    expect(page.posted).toEqual([{ type: 'app:endOfText' }]);
  });

  it('uses the insets the app sends after the start', () => {
    const page = articlePage();
    page.start();

    page.fire('app:insets', { detail: { top: 100, bottom: 200 } });
    page.scrollTo(650);
    expect(page.posted).toEqual([]);

    page.scrollTo(590);
    expect(page.posted).toEqual([{ type: 'app:endOfText' }]);
  });

  it('reports a page without the text element once, and still counts if the text turns up', () => {
    const page = articlePage();
    page.page.lastLine = null;
    page.start();
    page.fire('scroll');

    expect(page.posted).toEqual([{ type: 'app:endOfTextMissing' }]);

    page.layoutMoves(400);
    expect(page.posted).toEqual([{ type: 'app:endOfTextMissing' }, { type: 'app:endOfText' }]);
  });

  it('installs itself once when it runs twice (Android)', () => {
    const page = articlePage({ installTwice: true });
    page.start();
    page.scrollTo(400);

    expect(page.listeners['app:insets']).toHaveLength(1);
    expect(page.posted).toEqual([{ type: 'app:endOfText' }]);
  });

  it('is added to the article script after the insets it reads', () => {
    const script = beforeContentScript({ appContext, appInsets: { top: 96, bottom: 34 } }, { readDetector: true });

    expect(script.indexOf('window.appInsets')).toBeLessThan(script.indexOf(READ_DETECTOR_SCRIPT));
    expect(beforeContentScript({ appContext })).not.toContain(READ_DETECTOR_SCRIPT);
  });
});
