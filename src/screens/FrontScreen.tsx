import { useCallback } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { pageUrl } from '../config';
import { articlePathOf } from '../navigation/links';
import type { ScreenProps } from '../navigation/types';
import { type PageEvent, PageWebView } from '../web/PageWebView';

const FRONT_URL = pageUrl('/front');

// Phase 2: the front page fills the screen. The scroll view, strip, footer and height come in Phase 5.
export function FrontScreen({ navigation }: ScreenProps<'Front'>) {
  const openUrl = useCallback(
    (url: string) => {
      const path = articlePathOf(url);
      if (path !== null) navigation.push('Article', { path });
      else void Linking.openURL(url);
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
      <PageWebView page="front" url={FRONT_URL} onLeavePage={openUrl} onPageMessage={handlePageMessage} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
