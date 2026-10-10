import { beforeContentScript, injectIntoHtml } from '../injected';

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

  it('cannot close the script element it is written into', () => {
    const script = beforeContentScript({ appContext: { ...appContext, appVersion: '</script><b>' } });

    expect(script).not.toContain('</script>');
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
