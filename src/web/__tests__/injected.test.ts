import { beforeContentScript, injectIntoHtml, NATIVE_ANCHOR_SCRIPT } from '../injected';

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
