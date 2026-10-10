import { Alert } from 'react-native';
import { useStore } from 'zustand';

import { pageUrl } from '../config';
import { expoSavedFs } from './expoSavedFs';
import { createSavedLibrary, type SavedState } from './library';
import { type Manifest, parseManifest } from './manifest';

/** A manifest that has not arrived by then counts as failed (and is tried again). */
const MANIFEST_TIMEOUT_MS = 10_000;

async function fetchManifest(articleId: string, signal: AbortSignal): Promise<Manifest> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), MANIFEST_TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(pageUrl(`/bundle/${encodeURIComponent(articleId)}/manifest.json`), {
      signal: timeout.signal,
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);

    return parseManifest(await response.json(), articleId);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** The app's saved copies. Hydrated at launch, before any screen (`App.tsx`). */
export const savedLibrary = createSavedLibrary({
  fs: expoSavedFs,
  fetchManifest,
  onSaveFailed: (articleId, error) => {
    console.warn(`[saved] article ${articleId} could not be saved`, error);
    const title = savedLibrary.store.getState().downloads[articleId]?.title;
    Alert.alert(
      'Not saved',
      `${title ? `"${title}"` : 'The article'} could not be saved, even after a few tries. Nothing of it was kept.`,
    );
  },
});

export const useSaved = <T>(selector: (state: SavedState) => T): T => useStore(savedLibrary.store, selector);
