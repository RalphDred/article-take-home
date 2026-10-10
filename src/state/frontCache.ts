// What the front screen remembers so it can draw itself before the server answers: the last height of the front
// page (the starting height of the next load, see `pageHeight.ts`) and the titles of read articles (the Recently
// read strip).
//
// Unlike the app state, none of this belongs to the reader or reaches a page. Losing it costs a jump in the layout
// or a placeholder title, nothing more, so a bad saved value is simply dropped.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { pageUrl } from '../config';
import { MAX_PAGE_HEIGHT } from '../web/pageHeight';

export type FrontCacheData = {
  /** The last height the front page reported, or null before it ever did. */
  frontHeight: number | null;
  /** Article titles by id, from the article's manifest. */
  titles: Readonly<Record<string, string>>;
};

type FrontCache = FrontCacheData & {
  setFrontHeight: (height: number) => void;
  setTitle: (articleId: string, title: string) => void;
};

export const useFrontCache = create<FrontCache>()(
  persist(
    set => ({
      frontHeight: null,
      titles: {},
      setFrontHeight: height => set({ frontHeight: height }),
      setTitle: (articleId, title) => set(state => ({ titles: { ...state.titles, [articleId]: title } })),
    }),
    {
      name: 'front-cache',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ frontHeight, titles }): FrontCacheData => ({ frontHeight, titles }),
      merge: (saved, current) => ({ ...current, ...savedFrontCache(saved) }),
      skipHydration: true,
    },
  ),
);

const savedSchema = z.object({
  frontHeight: z.number().int().positive().max(MAX_PAGE_HEIGHT).nullable().optional().catch(undefined),
  titles: z.record(z.string(), z.string()).optional().catch(undefined),
});

/** The valid fields of a saved cache. Anything else is dropped. */
export function savedFrontCache(saved: unknown): Partial<FrontCacheData> {
  const parsed = savedSchema.safeParse(saved);
  if (!parsed.success) return {};

  const valid: Partial<FrontCacheData> = {};
  const { frontHeight, titles } = parsed.data;
  if (frontHeight !== undefined) valid.frontHeight = frontHeight;
  if (titles !== undefined) valid.titles = titles;

  return valid;
}

let hydration: Promise<void> | null = null;

/** Loads the saved cache once. Resolves also when it cannot be read. */
export function hydrateFrontCache(): Promise<void> {
  hydration ??= Promise.resolve(useFrontCache.persist.rehydrate()).catch((error: unknown) => {
    console.warn('[frontCache] could not read the saved cache, starting empty', error);
  });

  return hydration;
}

// ---------------------------------------------------------------------------------------------------------------
// Titles. The app only knows article ids (the protocol never sends a title), so it asks the article's manifest,
// the one documented endpoint that names an article. A title that cannot be fetched is asked for again the next
// time the strip needs it; until then the strip shows a placeholder.

const manifestTitleSchema = z.object({ title: z.string().min(1) });

const inFlight = new Set<string>();

/** Fetches and caches the title of each id that has none yet. At most one request per id at a time. */
export function requestTitles(articleIds: readonly string[], fetchJson: (url: string) => Promise<unknown> = getJson): void {
  const { titles, setTitle } = useFrontCache.getState();

  articleIds
    .filter(id => titles[id] === undefined && !inFlight.has(id))
    .forEach(id => {
      inFlight.add(id);
      fetchJson(pageUrl(`/bundle/${encodeURIComponent(id)}/manifest.json`))
        .then(json => {
          const manifest = manifestTitleSchema.safeParse(json);
          if (manifest.success) setTitle(id, manifest.data.title);
          else console.warn(`[frontCache] the manifest of article ${id} has no title`);
        })
        .catch((error: unknown) => console.warn(`[frontCache] no title for article ${id} yet`, error))
        .finally(() => inFlight.delete(id));
    });
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return response.json();
}
