import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ARTICLE_HEADER_BAR_HEIGHT, ArticleHeader } from '../components/ArticleHeader';
import { useConsentedUrl } from '../consent/useConsentedUrl';
import { pageUrl } from '../config';
import { articleIdOf } from '../navigation/links';
import type { ScreenProps } from '../navigation/types';
import { useOpenLinks } from '../navigation/useOpenLinks';
import { SAVED_ROOT_URI } from '../offline/expoSavedFs';
import type { SavedCopy } from '../offline/library';
import { indexUrlOf } from '../offline/savedFs';
import { savedLibrary, useSaved } from '../offline/savedLibrary';
import { createReadCounter } from '../reading/readCounter';
import { useAppState } from '../state/appState';
import { tracking } from '../tracking/appTracking';
import { paletteOf } from '../ui/palette';
import { assertNever } from '../util/assertNever';
import { type PageEvent, PageWebView, type PageWebViewHandle } from '../web/PageWebView';
import type { Insets } from '../web/protocol';

/**
 * The article fills the screen and scrolls itself. A native header floats over its top; the page reserves the space
 * the header and the safe areas cover (`window.appInsets` before it starts, `app:insets` after), so its title starts
 * just below the header, its anchors land below it, and its last line can be scrolled clear of the bottom edge.
 *
 * A saved article opens from its saved copy, online or not, without waiting for consent (README, "Part 3"). The
 * screen keeps the copy it opened with: a newer version saved in the background is offered, never swapped in.
 */
export function ArticleScreen({ navigation, route }: ScreenProps<'Article'>) {
  const { path } = route.params;
  const safeArea = useSafeAreaInsets();
  const theme = useAppState(state => state.theme);
  const palette = paletteOf(theme);
  const page = useRef<PageWebViewHandle>(null);

  const articleId = useMemo(() => articleIdOf(path), [path]);
  const insets = useMemo<Insets>(
    // Whole CSS pixels, rounded up so nothing hides under a fraction of the header.
    () => ({ top: Math.ceil(safeArea.top + ARTICLE_HEADER_BAR_HEIGHT), bottom: Math.ceil(safeArea.bottom) }),
    [safeArea.top, safeArea.bottom],
  );

  // --- Online page or saved copy -----------------------------------------------------------------------------------

  // Chosen when the screen opens. Its folder stays on disk while this screen shows it, even if it is removed.
  const [shownCopy, setShownCopy] = useState<SavedCopy | null>(() =>
    articleId === null ? null : (savedLibrary.store.getState().copies[articleId] ?? null),
  );
  useEffect(() => (shownCopy === null ? undefined : savedLibrary.hold(shownCopy.uri)), [shownCopy]);

  // Opening a saved copy checks for a newer version, once per screen. Offline, the check just fails quietly.
  const openedSaved = useRef(shownCopy !== null);
  useEffect(() => {
    if (openedSaved.current && articleId !== null) void savedLibrary.checkForUpdate(articleId);
  }, [articleId]);

  const currentCopy = useSaved(state => (articleId === null ? undefined : state.copies[articleId]));
  const newerCopy =
    shownCopy !== null && currentCopy !== undefined && currentCopy.uri !== shownCopy.uri ? currentCopy : null;

  // Null while the app waits for consent, then with the newest consent string. A saved copy needs neither.
  const onlineUrl = useConsentedUrl(useMemo(() => pageUrl(path), [path]));
  const url = shownCopy === null ? onlineUrl : `${indexUrlOf(shownCopy.uri)}${queryOf(path)}`;

  // The reader asked for the newer version: once the web view has the new URL, it loads it.
  const switching = useRef(false);
  useEffect(() => {
    if (!switching.current) return;
    switching.current = false;
    page.current?.reload();
  }, [url]);

  const showNewerCopy = useCallback(() => {
    if (newerCopy === null) return;
    switching.current = true;
    setShownCopy(newerCopy);
  }, [newerCopy]);

  // --- Page messages -----------------------------------------------------------------------------------------------

  const { openUrl, openArticleMessage } = useOpenLinks();

  // One counter per screen: a refresh of this screen does not count again, a new screen does. Saved copies too.
  const [countRead] = useState(() =>
    createReadCounter(id => {
      useAppState.getState().markRead(id);
      tracking.trackArticleRead(id);
    }),
  );

  // One screen view per loaded document: a reload, a retry or a rebuild is a new one.
  const trackScreenView = useCallback(() => {
    if (articleId !== null) tracking.trackScreenView({ name: 'article', id: articleId });
  }, [articleId]);

  const handlePageMessage = useCallback(
    (message: PageEvent) => {
      switch (message.type) {
        case 'openArticle':
          openArticleMessage(message.path);
          return;
        case 'toggleBookmark':
          // The page's star sends a tap, like the header's. The page redraws its star from `app:bookmarks`.
          useAppState.getState().toggleBookmark(message.articleId);
          return;
        case 'height':
          return;
        case 'app:anchor':
          // Only sent where the page does not scroll itself. An article scrolls itself, so its anchors just work.
          console.warn(`[article] ignored app:anchor for #${message.id}`);
          return;
        case 'app:endOfText':
          if (articleId !== null) countRead(articleId);
          return;
        case 'app:endOfTextMissing':
          // Loud on purpose: the web team changed the markup the read detection depends on, and no read is counted.
          console.error(`[article] ${path}: no .articlecomponent.text p found, reads cannot be detected`);
          return;
        default:
          assertNever(message, 'page message');
      }
    },
    [openArticleMessage, articleId, countRead, path],
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <PageWebView
        ref={page}
        page="article"
        url={url}
        insets={insets}
        {...(shownCopy === null ? {} : { fileAccessUrl: SAVED_ROOT_URI })}
        pullToRefresh
        readDetection
        onReady={trackScreenView}
        refreshIndicatorOffset={insets.top}
        onLeavePage={openUrl}
        onPageMessage={handlePageMessage}
      />
      <ArticleHeader
        articleId={articleId}
        palette={palette}
        safeTop={safeArea.top}
        onBack={() => navigation.goBack()}
        style={styles.header}
      />
      {newerCopy !== null && (
        <View
          style={[
            styles.banner,
            { bottom: safeArea.bottom + 12, backgroundColor: palette.chrome, borderColor: palette.rule },
          ]}
        >
          <Text style={[styles.bannerText, { color: palette.text }]}>A newer version of this article is ready.</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={showNewerCopy}>
            <Text style={[styles.bannerAction, { color: palette.action }]}>Show it</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** The query string of an article path (`?ref=related`). It travels to a saved copy too. */
const queryOf = (path: string): string => /\?[^#]*/.exec(path)?.[0] ?? '';

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, fontSize: 14 },
  bannerAction: { fontSize: 15, fontWeight: '600' },
});
