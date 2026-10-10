import { SERVER_URL } from '../../config';
import { articleIdOf, articlePathOf, createOpenGate, REPEAT_OPEN_WINDOW_MS, routeOf } from '../links';

// The fixture's partner link: our host name with `.example.org` appended, same port, an article path.
const partnerHost = SERVER_URL.replace(/^(https?:\/\/)([^/:]+)/, '$1$2.example.org');

describe('routeOf', () => {
  it('opens an article on our server as a screen, query string kept and hash dropped', () => {
    expect(routeOf(`${SERVER_URL}/article/3?ref=teaser`)).toEqual({ kind: 'article', path: '/article/3?ref=teaser' });
    expect(routeOf(`${SERVER_URL}/article/2#middle`)).toEqual({ kind: 'article', path: '/article/2' });
  });

  it('hands everything else to the operating system', () => {
    for (const url of [
      `${partnerHost}/article/9`, // looks like an article, but another host
      'https://partner.example.org/article/9',
      'https://example.org/',
      'mailto:newsdesk@example.org',
      `${SERVER_URL}/front`,
      `${SERVER_URL}/article/`,
    ]) {
      expect(routeOf(url)).toEqual({ kind: 'external', url });
    }
  });
});

describe('articlePathOf / articleIdOf', () => {
  it('reads an untrusted openArticle path only when it is an article on our server', () => {
    expect(articlePathOf(`${SERVER_URL}/article/2?ref=related`)).toBe('/article/2?ref=related');
    expect(articlePathOf(`${SERVER_URL}//evil.example/article/2`)).toBeNull();
  });

  it('takes the id from an article path', () => {
    expect(articleIdOf('/article/2?ref=front')).toBe('2');
    expect(articleIdOf('/front')).toBeNull();
  });
});

describe('createOpenGate', () => {
  const gateAt = () => {
    let now = 0;
    const mayOpen = createOpenGate(REPEAT_OPEN_WINDOW_MS, () => now);

    return { mayOpen, advance: (ms: number) => void (now += ms) };
  };

  it('lets one open of the "Link + message" teaser through, whichever way arrives first', () => {
    const { mayOpen, advance } = gateAt();

    expect(mayOpen('/article/3?ref=teaser')).toBe(true); // openArticle
    advance(40);
    expect(mayOpen('/article/3?ref=teaser')).toBe(false); // the link it also follows
  });

  it('treats the same article with another query string as the same open', () => {
    const { mayOpen } = gateAt();

    expect(mayOpen('/article/3?ref=front')).toBe(true);
    expect(mayOpen('/article/3')).toBe(false);
  });

  it('opens the same article again after the window, measured from the open that went through', () => {
    const { mayOpen, advance } = gateAt();

    expect(mayOpen('/article/3')).toBe(true);
    advance(REPEAT_OPEN_WINDOW_MS - 1);
    expect(mayOpen('/article/3')).toBe(false);
    advance(1);
    expect(mayOpen('/article/3')).toBe(true);
  });

  it('never holds back a different article', () => {
    const { mayOpen } = gateAt();

    expect(mayOpen('/article/2')).toBe(true);
    expect(mayOpen('/article/3')).toBe(true);
    expect(mayOpen('/article/2')).toBe(true);
  });
});
