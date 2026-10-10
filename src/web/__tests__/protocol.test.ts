import { createDispatcher, eventScript, parseInbound } from '../protocol';

const json = (value: unknown) => JSON.stringify(value);

describe('parseInbound', () => {
  describe('protocol messages', () => {
    it('parses ready from the front page', () => {
      expect(parseInbound(json({ type: 'ready', protocol: 1, page: 'front' }))).toEqual({
        kind: 'page',
        message: { type: 'ready', protocol: 1, page: 'front' },
      });
    });

    it('parses ready from an article, with its id', () => {
      expect(parseInbound(json({ type: 'ready', protocol: 1, page: 'article', articleId: '2' }))).toEqual({
        kind: 'page',
        message: { type: 'ready', protocol: 1, page: 'article', articleId: '2' },
      });
    });

    it('rejects an article ready without an article id', () => {
      expect(parseInbound(json({ type: 'ready', protocol: 1, page: 'article' }))).toMatchObject({
        kind: 'ignored',
        reason: 'invalid-fields',
      });
    });

    it('parses numeric heights, toggleBookmark and openArticle with a query string', () => {
      expect(parseInbound(json({ type: 'height', value: 2140 }))).toEqual({
        kind: 'page',
        message: { type: 'height', value: 2140 },
      });
      expect(parseInbound(json({ type: 'toggleBookmark', articleId: '4' }))).toEqual({
        kind: 'page',
        message: { type: 'toggleBookmark', articleId: '4' },
      });
      expect(parseInbound(json({ type: 'openArticle', path: '/article/2?ref=related' }))).toEqual({
        kind: 'page',
        message: { type: 'openArticle', path: '/article/2?ref=related' },
      });
    });

    it("parses the app's own anchor message, and rejects one without a position", () => {
      expect(parseInbound(json({ type: 'app:anchor', id: 'more-stories', top: 1210.5 }))).toEqual({
        kind: 'page',
        message: { type: 'app:anchor', id: 'more-stories', top: 1210.5 },
      });
      expect(parseInbound(json({ type: 'app:anchor', id: 'more-stories' }))).toMatchObject({
        kind: 'ignored',
        reason: 'invalid-fields',
      });
    });

    it('drops unknown fields from protocol messages', () => {
      expect(parseInbound(json({ type: 'height', value: 10, extra: true }))).toEqual({
        kind: 'page',
        message: { type: 'height', value: 10 },
      });
    });
  });

  describe('noise on the channel (sent by the fixtures)', () => {
    it.each([
      ['a plain string heartbeat', 'tp:heartbeat', 'not-json'],
      ['an empty string', '', 'not-json'],
      ['a JSON array', '[1,2]', 'not-object'],
      ['JSON null', 'null', 'not-object'],
      ['a metrics object without a type', json({ event: 'metrics', at: 1 }), 'no-type'],
      ['an ad message', json({ type: 'ad:viewable', slot: 'top' }), 'unknown-type'],
      ['height "auto"', json({ type: 'height', value: 'auto' }), 'invalid-fields'],
      ['a negative height', json({ type: 'height', value: -1 }), 'invalid-fields'],
      ['openArticle with a full URL', json({ type: 'openArticle', path: 'https://evil.example/' }), 'invalid-fields'],
      ['toggleBookmark without an id', json({ type: 'toggleBookmark' }), 'invalid-fields'],
    ])('ignores %s', (_name, raw, reason) => {
      expect(parseInbound(raw)).toEqual({ kind: 'ignored', reason, raw });
    });
  });

  describe('web tracker commands', () => {
    const command = {
      command: 'trackSelfDescribingEvent',
      event: { schema: 'iglu:com.example.news/teaser_click/jsonschema/1-0-0', data: { articleId: '1', position: 0 } },
      context: [{ schema: 'iglu:com.example.news/page/jsonschema/1-0-0', data: { page: 'front', document: 'ab12' } }],
      unknownField: 'kept in raw',
    };

    it('gets its own branch and keeps the raw string untouched', () => {
      const raw = json(command);
      const result = parseInbound(raw);

      expect(result).toMatchObject({ kind: 'tracker', raw, command: { command: 'trackSelfDescribingEvent' } });
      if (result.kind === 'tracker') expect(JSON.parse(result.raw)).toHaveProperty('unknownField');
    });

    it('accepts a command without context', () => {
      expect(parseInbound(json({ command: 'trackPageView', event: { pageUrl: '/front' } }))).toMatchObject({
        kind: 'tracker',
      });
    });

    it('ignores commands the SDK does not understand, and commands without an event', () => {
      expect(parseInbound(json({ command: 'enableActivityTracking', event: {} }))).toMatchObject({
        kind: 'ignored',
        reason: 'unknown-command',
      });
      expect(parseInbound(json({ command: 'trackPageView' }))).toMatchObject({
        kind: 'ignored',
        reason: 'unknown-command',
      });
    });
  });
});

describe('outbound events', () => {
  it('builds a CustomEvent dispatch script', () => {
    expect(eventScript('app:theme', { value: 'dark' })).toBe(
      'window.dispatchEvent(new CustomEvent("app:theme", { detail: {"value":"dark"} }));true;',
    );
  });

  it('dispatches the event on window when the script runs', () => {
    const received: unknown[] = [];
    const target = new EventTarget();
    const fakeWindow = { dispatchEvent: (event: Event) => target.dispatchEvent(event) };
    target.addEventListener('app:bookmarks', event => received.push((event as CustomEvent).detail));

    new Function('window', eventScript('app:bookmarks', { ids: ['1', "it's \"quoted\""] }))(fakeWindow);

    expect(received).toEqual([{ ids: ['1', "it's \"quoted\""] }]);
  });

  it('only lets a page receive the events it understands (checked by tsc)', () => {
    const scripts: string[] = [];
    const front = createDispatcher<'front'>(script => scripts.push(script));
    const article = createDispatcher<'article'>(script => scripts.push(script));

    front('app:read', { ids: ['1'] });
    article('app:insets', { top: 100, bottom: 34 });
    // @ts-expect-error: articles do not listen to app:read
    article('app:read', { ids: [] });
    // @ts-expect-error: the front page does not listen to app:insets
    front('app:insets', { top: 0, bottom: 0 });
    // @ts-expect-error: the detail shape is bound to the event name
    front('app:theme', { value: 'sepia' });

    expect(scripts).toHaveLength(5);
  });
});
