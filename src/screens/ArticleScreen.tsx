import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ARTICLE_HEADER_BAR_HEIGHT, ArticleHeader } from '../components/ArticleHeader';
import { useConsentedUrl } from '../consent/useConsentedUrl';
import { pageUrl } from '../config';
import { articleIdOf } from '../navigation/links';
import type { ScreenProps } from '../navigation/types';
import { useOpenLinks } from '../navigation/useOpenLinks';
import { createReadCounter } from '../reading/readCounter';
import { useAppState } from '../state/appState';
import { tracking } from '../tracking/appTracking';
import { paletteOf } from '../ui/palette';
import { assertNever } from '../util/assertNever';
import { type PageEvent, PageWebView } from '../web/PageWebView';
import type { Insets } from '../web/protocol';

/**
 * The article fills the screen and scrolls itself. A native header floats over its top; the page reserves the space
 * the header and the safe areas cover (`window.appInsets` before it starts, `app:insets` after), so its title starts
 * just below the header, its anchors land below it, and its last line can be scrolled clear of the bottom edge.
 */
export function ArticleScreen({ navigation, route }: ScreenProps<'Article'>) {
  const { path } = route.params;
  const safeArea = useSafeAreaInsets();
  const theme = useAppState(state => state.theme);
  const palette = paletteOf(theme);

  // Null while the app waits for consent, then with the newest consent string.
  const url = useConsentedUrl(useMemo(() => pageUrl(path), [path]));
  const articleId = useMemo(() => articleIdOf(path), [path]);
  const insets = useMemo<Insets>(
    // Whole CSS pixels, rounded up so nothing hides under a fraction of the header.
    () => ({ top: Math.ceil(safeArea.top + ARTICLE_HEADER_BAR_HEIGHT), bottom: Math.ceil(safeArea.bottom) }),
    [safeArea.top, safeArea.bottom],
  );

  const { openUrl, openArticleMessage } = useOpenLinks();

  // One counter per screen: a refresh of this screen does not count again, a new screen does.
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
        page="article"
        url={url}
        insets={insets}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
});
