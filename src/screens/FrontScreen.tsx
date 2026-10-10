import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { pageUrl } from '../config';
import { useOpenLinks } from '../navigation/useOpenLinks';
import { type PageEvent, PageWebView } from '../web/PageWebView';

const FRONT_URL = pageUrl('/front');

// Phase 2: the front page fills the screen. The scroll view, strip, footer and height come in Phase 5.
export function FrontScreen() {
  const { openUrl, openArticleMessage } = useOpenLinks();

  const handlePageMessage = useCallback(
    (message: PageEvent) => {
      if (message.type === 'openArticle') openArticleMessage(message.path);
    },
    [openArticleMessage],
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
