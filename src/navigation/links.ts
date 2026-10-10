import { SERVER_URL } from '../config';

// React Native's `URL` does not implement `pathname` or `search`, so URLs are split by hand.
const ARTICLE_URL = /^(https?:\/\/[^/?#]+)(\/article\/[^/?#]+(?:\?[^#]*)?)(?:#.*)?$/i;

/** The path (with its query string) of an article on our server, or null for any other URL. */
export function articlePathOf(url: string): string | null {
  const match = ARTICLE_URL.exec(url);
  if (!match || match[1]?.toLowerCase() !== SERVER_URL.toLowerCase()) return null;

  return match[2] ?? null;
}

const ARTICLE_PATH = /^\/article\/([^/?#]+)/;

/** The article id in an article path (`/article/2?ref=front` → `2`), or null for any other path. */
export function articleIdOf(path: string): string | null {
  return ARTICLE_PATH.exec(path)?.[1] ?? null;
}

/** Where a link that leaves its page goes (README, "Links"). In-page `#hash` links never get here: the web view keeps them. */
export type LinkRoute =
  /** An article on our server, from either page: a new article screen, query string included. */
  | { kind: 'article'; path: string }
  /** Everything else (other sites, the partner's look-alike host, `mailto:`): handed to the operating system. */
  | { kind: 'external'; url: string };

export function routeOf(url: string): LinkRoute {
  const path = articlePathOf(url);

  return path === null ? { kind: 'external', url } : { kind: 'article', path };
}

/** A second open of the same article within this long is the same tap arriving twice (README, "Links"). */
export const REPEAT_OPEN_WINDOW_MS = 1_000;

/**
 * The older "Link + message" teaser posts `openArticle` and also stays an ordinary link, so one tap arrives twice, in
 * either order. The returned gate says whether an open may go ahead: not when the same article (by id, so the query
 * string does not matter) was opened less than `windowMs` ago. A refused open does not extend the window.
 */
export function createOpenGate(
  windowMs: number = REPEAT_OPEN_WINDOW_MS,
  now: () => number = Date.now,
): (path: string) => boolean {
  let last: { id: string; at: number } | null = null;

  return path => {
    const id = articleIdOf(path) ?? path;
    const at = now();
    if (last !== null && last.id === id && at - last.at < windowMs) return false;

    last = { id, at };
    return true;
  };
}
