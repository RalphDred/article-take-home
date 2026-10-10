import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { injectIntoHtml } from './injected';
import { documentOf, type LoadFailure, type LoadState } from './loadState';

/** See `injected.ts`: Android cannot run a script before the page's own unless it is part of the document. */
export const LOADS_DOCUMENT_ITSELF = Platform.OS === 'android';

export type DocumentHtml = { loadId: number; html: string };

/**
 * Android only: fetches the document of each app-started load and writes `script` into its <head>. The web view is
 * then given the HTML with the page's URL as its base, so the page keeps its own origin, query string and fragment.
 *
 * Fetch failures end the load the same way `onError` / `onHttpError` do for a URL load. The ready timeout keeps
 * running during the fetch, so a server that never answers still ends on the error state.
 */
export function useDocumentHtml(
  state: LoadState,
  script: string,
  fail: (loadId: number, failure: LoadFailure) => void,
): DocumentHtml | null {
  const [loaded, setLoaded] = useState<DocumentHtml | null>(null);

  // The script as it was when the load started; a later change applies to the next load.
  const latestScript = useRef(script);
  latestScript.current = script;

  const loadId = state.status === 'loading' ? state.loadId : null;
  const url = state.status === 'loading' ? state.url : null;

  useEffect(() => {
    if (!LOADS_DOCUMENT_ITSELF || loadId === null || url === null) return;

    const abort = new AbortController();
    const script = latestScript.current;

    fetch(documentOf(url), { signal: abort.signal, headers: { 'cache-control': 'no-cache' } })
      .then(async response => {
        if (!response.ok) return fail(loadId, { kind: 'http', status: response.status });

        const html = await response.text();
        if (!abort.signal.aborted) setLoaded({ loadId, html: injectIntoHtml(html, script) });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) fail(loadId, { kind: 'network', description: String(error) });
      });

    return () => abort.abort();
  }, [loadId, url, fail]);

  return loaded;
}
