import { useCallback, useLayoutEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleControls } from '../components/ArticleControls';
import { pageUrl } from '../config';
import { articleIdOf } from '../navigation/links';
import type { ScreenProps } from '../navigation/types';
import { useOpenLinks } from '../navigation/useOpenLinks';
import { useAppState } from '../state/appState';
import { assertNever } from '../util/assertNever';
import { type PageEvent, PageWebView } from '../web/PageWebView';
import type { Insets } from '../web/protocol';

// Phase 3: the article sits below the stack's own header, which carries the controls. The floating header and its
// insets come in Phase 7.
export function ArticleScreen({ navigation, route }: ScreenProps<'Article'>) {
  const { path } = route.params;
  const safeArea = useSafeAreaInsets();

  const url = useMemo(() => pageUrl(path), [path]);
  const articleId = useMemo(() => articleIdOf(path), [path]);
  const insets = useMemo<Insets>(() => ({ top: 0, bottom: safeArea.bottom }), [safeArea.bottom]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => <ArticleControls articleId={articleId} /> });
  }, [navigation, articleId]);

  const { openUrl, openArticleMessage } = useOpenLinks();

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
        default:
          assertNever(message, 'page message');
      }
    },
    [openArticleMessage],
  );

  return (
    <View style={styles.screen}>
      <PageWebView page="article" url={url} insets={insets} onLeavePage={openUrl} onPageMessage={handlePageMessage} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
