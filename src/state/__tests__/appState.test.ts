import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  FONT_SCALE,
  hydrateAppState,
  recentlyRead,
  savedAppState,
  steppedFontScale,
  toggledId,
  useAppState,
  withMostRecent,
} from '../appState';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('steppedFontScale', () => {
  it('steps in tenths without drifting', () => {
    let scale = 1;
    for (let i = 0; i < 3; i += 1) scale = steppedFontScale(scale, 1);

    expect(scale).toBe(1.3);
  });

  it('stays within the limits, so a tap at the limit is no change', () => {
    expect(steppedFontScale(FONT_SCALE.max, 1)).toBe(FONT_SCALE.max);
    expect(steppedFontScale(FONT_SCALE.min, -1)).toBe(FONT_SCALE.min);
  });
});

describe('id lists', () => {
  it('toggles a bookmark: two taps end where they started', () => {
    const once = toggledId(['1'], '2');

    expect(once).toEqual(['2', '1']);
    expect(toggledId(once, '2')).toEqual(['1']);
  });

  it('keeps read articles most recent first, without duplicates', () => {
    expect(withMostRecent(['2', '1'], '1')).toEqual(['1', '2']);
    expect(withMostRecent(['2', '1'], '3')).toEqual(['3', '2', '1']);
  });

  it('returns the same list when the article is already the most recent, so nothing is sent', () => {
    const ids = ['2', '1'];

    expect(withMostRecent(ids, '2')).toBe(ids);
  });

  it('lists at most five recently read articles, most recent first', () => {
    expect(recentlyRead(['7', '6', '5', '4', '3', '2', '1'])).toEqual(['7', '6', '5', '4', '3']);
    expect(recentlyRead([])).toEqual([]);
  });
});

describe('savedAppState', () => {
  it('keeps valid fields and drops invalid ones, which then fall back to their defaults', () => {
    expect(savedAppState({ fontScale: 'big', theme: 'dark', bookmarks: [1, 2], readIds: ['4'] })).toEqual({
      theme: 'dark',
      readIds: ['4'],
    });
    expect(savedAppState({ fontScale: 99 })).toEqual({});
    expect(savedAppState(null)).toEqual({});
  });
});

describe('the store', () => {
  it('loads the saved state, and saves only the data', async () => {
    await AsyncStorage.setItem(
      'app-state',
      JSON.stringify({ state: { fontScale: 1.2, theme: 'dark', bookmarks: ['5'], readIds: [] }, version: 1 }),
    );

    await hydrateAppState();

    expect(useAppState.getState()).toMatchObject({ fontScale: 1.2, theme: 'dark', bookmarks: ['5'], readIds: [] });

    useAppState.getState().markRead('7');
    useAppState.getState().toggleBookmark('5');

    const saved: unknown = JSON.parse((await AsyncStorage.getItem('app-state')) ?? 'null');
    expect(saved).toEqual({
      state: { fontScale: 1.2, theme: 'dark', bookmarks: [], readIds: ['7'] },
      version: 1,
    });
  });
});
