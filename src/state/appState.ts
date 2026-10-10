// The app state the pages show (README, "App state on the pages"): font scale, theme, bookmarks and read articles.
// It belongs to the app, applies to both pages and survives a restart.
//
// A Zustand store rather than React context: `subscribe` works outside React, so each web view can listen for
// changes itself and send each one exactly once, whatever React re-renders or remounts (`useAppStateSync`).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Theme } from '../web/protocol';

export type AppStateData = {
  fontScale: number;
  theme: Theme;
  /** Bookmarked article ids, most recently bookmarked first. */
  bookmarks: readonly string[];
  /** Read article ids, most recently read first. The Recently read strip shows the first few. */
  readIds: readonly string[];
};

export type AppStateActions = {
  /** One step smaller (-1) or larger (+1), within the limits. */
  stepFontScale: (direction: -1 | 1) => void;
  toggleTheme: () => void;
  /** Flips the bookmark: both stars (page and header) send a tap, not a value, so two taps cancel out. */
  toggleBookmark: (articleId: string) => void;
  markRead: (articleId: string) => void;
};

export type AppStore = AppStateData & AppStateActions;

export const FONT_SCALE = { min: 0.8, max: 1.6, step: 0.1 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Pure updates. Each returns its input unchanged when nothing changes, so a no-op never reaches a page.

/** Steps in tenths, rounded so repeated steps never drift (`1.1 + 0.1` is `1.2000000000000002`). */
export function steppedFontScale(scale: number, direction: -1 | 1): number {
  const next = Math.round((scale + direction * FONT_SCALE.step) * 10) / 10;

  return Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, next));
}

export const toggledId = (ids: readonly string[], id: string): readonly string[] =>
  ids.includes(id) ? ids.filter(other => other !== id) : [id, ...ids];

/** Moves `id` to the front. Reading an article again makes it the most recent one. */
export const withMostRecent = (ids: readonly string[], id: string): readonly string[] =>
  ids[0] === id ? ids : [id, ...ids.filter(other => other !== id)];

export const RECENTLY_READ_LIMIT = 5;

/** The Recently read strip: the most recently read articles, most recent first. */
export const recentlyRead = (readIds: readonly string[]): readonly string[] => readIds.slice(0, RECENTLY_READ_LIMIT);

// ---------------------------------------------------------------------------------------------------------------

export const defaultAppState = (): AppStateData => ({
  fontScale: 1,
  // The reader's system setting on the first launch. After that, the app's own choice.
  theme: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  bookmarks: [],
  readIds: [],
});

export const useAppState = create<AppStore>()(
  persist(
    set => ({
      ...defaultAppState(),
      stepFontScale: direction => set(state => ({ fontScale: steppedFontScale(state.fontScale, direction) })),
      toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      toggleBookmark: articleId => set(state => ({ bookmarks: toggledId(state.bookmarks, articleId) })),
      markRead: articleId => set(state => ({ readIds: withMostRecent(state.readIds, articleId) })),
    }),
    {
      name: 'app-state',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ fontScale, theme, bookmarks, readIds }): AppStateData => ({ fontScale, theme, bookmarks, readIds }),
      merge: (saved, current) => ({ ...current, ...savedAppState(saved) }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[appState] could not read the saved state, starting from the defaults', error);
      },
      // Hydrated by `hydrateAppState`, so the app can wait for it (and does not wait forever when storage fails).
      skipHydration: true,
    },
  ),
);

// What comes back from storage goes straight to the pages, so it is checked like any other input. Each field is
// kept on its own: one bad value falls back to its default without losing the others.
const savedSchema = z.object({
  fontScale: z.number().min(FONT_SCALE.min).max(FONT_SCALE.max).optional().catch(undefined),
  theme: z.enum(['light', 'dark']).optional().catch(undefined),
  bookmarks: z.array(z.string()).optional().catch(undefined),
  readIds: z.array(z.string()).optional().catch(undefined),
});

/** The valid fields of a saved state. Missing or invalid fields are left out, so the defaults apply. */
export function savedAppState(saved: unknown): Partial<AppStateData> {
  const parsed = savedSchema.safeParse(saved);
  if (!parsed.success) return {};

  const valid: Partial<AppStateData> = {};
  const { fontScale, theme, bookmarks, readIds } = parsed.data;
  if (fontScale !== undefined) valid.fontScale = fontScale;
  if (theme !== undefined) valid.theme = theme;
  if (bookmarks !== undefined) valid.bookmarks = bookmarks;
  if (readIds !== undefined) valid.readIds = readIds;

  return valid;
}

let hydration: Promise<void> | null = null;

/**
 * Loads the saved state once. Resolves when it is loaded, and also when it cannot be read (the app then starts from
 * the defaults). No page may load before this: a page that got the defaults on `ready` would then get every saved
 * value as a second, made-up change.
 */
export function hydrateAppState(): Promise<void> {
  hydration ??= Promise.resolve(useAppState.persist.rehydrate());

  return hydration;
}
