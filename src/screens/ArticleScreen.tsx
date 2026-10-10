import { useCallback, useMemo } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pageUrl } from '../config';
import { articlePathOf } from '../navigation/links';
import type { ScreenProps } from '../navigation/types';
import { type PageEvent, PageWebView } from '../web/PageWebView';
import type { Insets } from '../web/protocol';

// Phase 2: the article sits below the stack's own header. The floating header and its insets come in Phase 7.
export function ArticleScreen({ navigation, route }: ScreenProps<'Article'>) {
  const { path } = route.params;
  const safeArea = useSafeAreaInsets();

  const url = useMemo(() => pageUrl(path), [path]);
  const insets = useMemo<Insets>(() => ({ top: 0, bottom: safeArea.bottom }), [safeArea.bottom]);

  const openUrl = useCallback(
    (target: string) => {
      const articlePath = articlePathOf(target);
      if (articlePath !== null) navigation.push('Article', { path: articlePath });
      else void Linking.openURL(target);
    },
    [navigation],
  );

  const handlePageMessage = useCallback(
    (message: PageEvent) => {
      if (message.type === 'openArticle') navigation.push('Article', { path: message.path });
    },
    [navigation],
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
