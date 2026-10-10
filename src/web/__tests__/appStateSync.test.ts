import { createStore } from 'zustand/vanilla';

import type { AppStateData } from '../../state/appState';
import { appStateEvents, sameIds, startAppStateSync } from '../appStateSync';
import type { AppEvent, AppEventName, PageKind } from '../protocol';

const initial: AppStateData = { fontScale: 1, theme: 'light', bookmarks: ['3'], readIds: ['2', '1'] };

const names = (events: readonly AppEvent[]): AppEventName[] => events.map(event => event.name);

/** A store, and a page that records every event it was sent. */
function setup() {
  const store = createStore<AppStateData>()(() => initial);
  const open = (page: PageKind) => {
    const received: AppEvent[] = [];
    const stop = startAppStateSync(page, store, event => received.push(event));

    return { received, stop };
  };

  return { store, open };
}

describe('appStateEvents', () => {
  it('sends a ready front page the whole state, read articles included', () => {
    expect(appStateEvents('front', null, initial)).toEqual([
      { name: 'app:fontScale', detail: { value: 1 } },
      { name: 'app:theme', detail: { value: 'light' } },
      { name: 'app:bookmarks', detail: { ids: ['3'] } },
      { name: 'app:read', detail: { ids: ['2', '1'] } },
    ]);
  });

  it('never sends app:read to an article', () => {
    expect(names(appStateEvents('article', null, initial))).toEqual(['app:fontScale', 'app:theme', 'app:bookmarks']);
    expect(appStateEvents('article', initial, { ...initial, readIds: ['4', '2', '1'] })).toEqual([]);
  });

  it('sends only the fields that changed', () => {
    expect(appStateEvents('front', initial, { ...initial, theme: 'dark' })).toEqual([
      { name: 'app:theme', detail: { value: 'dark' } },
    ]);
    expect(appStateEvents('front', initial, { ...initial })).toEqual([]);
  });

  it('treats the id lists as sets: a new order alone is not a change for the page', () => {
    expect(appStateEvents('front', initial, { ...initial, readIds: ['1', '2'] })).toEqual([]);
    expect(appStateEvents('front', initial, { ...initial, bookmarks: [] })).toEqual([
      { name: 'app:bookmarks', detail: { ids: [] } },
    ]);
  });
});

describe('sameIds', () => {
  it('compares ids regardless of order', () => {
    expect(sameIds(['1', '2'], ['2', '1'])).toBe(true);
    expect(sameIds(['1', '2'], ['1', '3'])).toBe(false);
    expect(sameIds(['1'], ['1', '1'])).toBe(false);
  });
});

describe('startAppStateSync', () => {
  it('sends the state once on ready, then each real change once', () => {
    const { store, open } = setup();
    const front = open('front');

    expect(names(front.received)).toEqual(['app:fontScale', 'app:theme', 'app:bookmarks', 'app:read']);

    store.setState({ theme: 'dark' });
    store.setState({ theme: 'dark' }); // no change
    store.setState({ fontScale: 1.1 });
    store.setState({ readIds: ['1', '2'] }); // reading article 1 again: same set

    expect(names(front.received.slice(4))).toEqual(['app:theme', 'app:fontScale']);
  });

  it('sends nothing more once the document stopped listening (a new load, or the screen went away)', () => {
    const { store, open } = setup();
    const page = open('article');
    page.stop();

    store.setState({ theme: 'dark', bookmarks: [] });

    expect(page.received).toHaveLength(3);
  });

  // Plan Q7: an article is open and ready; back, change the theme on the front page, open the same article again.
  it('gives each page exactly one theme event when the theme changes between two openings of an article', () => {
    const { store, open } = setup();
    const front = open('front');
    const firstArticle = open('article');

    firstArticle.stop(); // back: the article screen is gone
    store.setState({ theme: 'dark' });
    const secondArticle = open('article'); // the same article, opened again: a new document

    const themes = (page: { received: AppEvent[] }) => page.received.filter(event => event.name === 'app:theme');

    expect(themes(front)).toEqual([
      { name: 'app:theme', detail: { value: 'light' } },
      { name: 'app:theme', detail: { value: 'dark' } },
    ]);
    expect(themes(firstArticle)).toEqual([{ name: 'app:theme', detail: { value: 'light' } }]);
    expect(themes(secondArticle)).toEqual([{ name: 'app:theme', detail: { value: 'dark' } }]);
  });

  it('starts over for a reloaded document, which has forgotten everything', () => {
    const { store, open } = setup();
    const firstLoad = open('front');
    store.setState({ bookmarks: ['3', '5'] });
    firstLoad.stop();

    const reload = open('front');

    expect(reload.received).toContainEqual({ name: 'app:bookmarks', detail: { ids: ['3', '5'] } });
    expect(reload.received).toHaveLength(4);
  });
});
