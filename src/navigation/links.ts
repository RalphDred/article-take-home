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
