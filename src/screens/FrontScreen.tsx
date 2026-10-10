import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, type LayoutChangeEvent, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RecentlyReadStrip } from '../components/RecentlyReadStrip';
import { APP_BUILD, APP_VERSION, pageUrl } from '../config';
import type { ScreenProps } from '../navigation/types';
import { useOpenLinks } from '../navigation/useOpenLinks';
import { recentlyRead, useAppState } from '../state/appState';
import { useFrontCache } from '../state/frontCache';
import { paletteOf } from '../ui/palette';
import { assertNever } from '../util/assertNever';
import { anchorScrollY } from '../web/anchorScroll';
import type { LoadState } from '../web/loadState';
import { nextPageHeight } from '../web/pageHeight';
import { type PageEvent, PageWebView, type PageWebViewHandle } from '../web/PageWebView';

const FRONT_URL = pageUrl('/front');

/** The smallest area the loading and error states get, however tall the strip above them is. */
const MIN_STATUS_AREA = 240;

/**
 * One native vertical scroll view: the Recently read strip, the front page exactly as tall as its content (it does
 * not scroll itself), and a footer directly below it. Pulling down reloads the page.
 *
 * The page's height comes from its `height` messages (`nextPageHeight`). A load starts from the last height the page
 * reported, saved across launches, so the footer and the scroll position do not jump while the page loads again.
 *
 * The "Jump to" links scroll this scroll view: the page reports where the heading is (`app:anchor`), and the heading
 * goes to the top of the visible area (`anchorScrollY`).
 */
export function FrontScreen({ navigation }: ScreenProps<'Front'>) {
  const { openArticle, openUrl, openArticleMessage } = useOpenLinks();
  const page = useRef<PageWebViewHandle>(null);
  const scrollView = useRef<ScrollView>(null);

  const theme = useAppState(state => state.theme);
  const readIds = useAppState(state => state.readIds);
  const recent = useMemo(() => recentlyRead(readIds), [readIds]);
  const palette = paletteOf(theme);

  // The header lives outside the page, so the Saved button works on the error state too.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={showSavedPlaceholder}>
          <Text style={styles.headerButton}>Saved</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  // --- Height -----------------------------------------------------------------------------------------------------

  const [pageHeight, setPageHeight] = useState(() => useFrontCache.getState().frontHeight);
  const appliedHeight = useRef(pageHeight);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredStripHeight, setStripHeight] = useState(0);
  const stripHeight = recent.length === 0 ? 0 : measuredStripHeight;
  const contentHeight = useRef(0);

  const applyHeight = useCallback((reported: number) => {
    const next = nextPageHeight(appliedHeight.current, reported);
    if (next === null) return;

    appliedHeight.current = next;
    setPageHeight(next);
    useFrontCache.getState().setFrontHeight(next);
  }, []);

  // The loading and error states sit in the part of the page the reader can see below the strip.
  const statusAreaHeight = Math.max(MIN_STATUS_AREA, viewportHeight - stripHeight);

  // --- Load state and pull to refresh -------------------------------------------------------------------------------

  const [loadStatus, setLoadStatus] = useState<LoadState['status']>('waitingForConsent');
  const [refreshing, setRefreshing] = useState(false);

  // The pull hands over to the page's own loading state as soon as the new load starts. (The refresh control has to
  // go back to `false` itself: iOS keeps spinning when the prop never changes.)
  const handleLoadState = useCallback((state: LoadState) => {
    setLoadStatus(state.status);
    if (state.status !== 'ready') setRefreshing(false);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    page.current?.reload();
  }, []);

  // Ready: exactly as tall as the content. Loading: the last known height, so nothing below moves. Error: the
  // visible area only, so the footer is not pushed far below an error message.
  const frameHeight =
    loadStatus === 'error'
      ? statusAreaHeight
      : loadStatus === 'ready'
        ? (pageHeight ?? statusAreaHeight)
        : Math.max(pageHeight ?? 0, statusAreaHeight);

  // --- Page messages -----------------------------------------------------------------------------------------------

  const handlePageMessage = useCallback(
    (message: PageEvent) => {
      switch (message.type) {
        case 'height':
          applyHeight(message.value);
          return;
        case 'openArticle':
          openArticleMessage(message.path);
          return;
        case 'app:anchor': {
          // The web view sits directly below the strip.
          const layout = { pageTop: stripHeight, contentHeight: contentHeight.current, viewportHeight };
          scrollView.current?.scrollTo({ y: anchorScrollY(message.top, layout), animated: true });
          return;
        }
        case 'toggleBookmark':
          // Only articles have a bookmark button.
          console.warn(`[front] ignored toggleBookmark for ${message.articleId}`);
          return;
        default:
          assertNever(message, 'page message');
      }
    },
    [applyHeight, openArticleMessage, stripHeight, viewportHeight],
  );

  const openRecent = useCallback((articleId: string) => openArticle(`/article/${articleId}?ref=recently-read`), [openArticle]);

  return (
    <ScrollView
      ref={scrollView}
      style={{ backgroundColor: palette.background }}
      onLayout={(event: LayoutChangeEvent) => setViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <RecentlyReadStrip
        articleIds={recent}
        palette={palette}
        onOpen={openRecent}
        onLayout={event => setStripHeight(event.nativeEvent.layout.height)}
      />
      <PageWebView
        ref={page}
        page="front"
        url={FRONT_URL}
        scrollEnabled={false}
        statusAreaHeight={statusAreaHeight}
        style={{ flex: 0, height: frameHeight }}
        onLoadStateChange={handleLoadState}
        onLeavePage={openUrl}
        onPageMessage={handlePageMessage}
      />
      <View style={[styles.footer, { borderTopColor: palette.rule }]}>
        <Text style={[styles.footerTitle, { color: palette.text }]}>NZZ</Text>
        <Text style={[styles.footerText, { color: palette.muted }]}>
          App {APP_VERSION} ({APP_BUILD}) · Pull down to refresh
        </Text>
      </View>
    </ScrollView>
  );
}

function showSavedPlaceholder() {
  Alert.alert('Saved articles', 'Reading offline is not built yet.');
}

const styles = StyleSheet.create({
  headerButton: { fontSize: 16, fontWeight: '600', color: '#2c32bd' },
  footer: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  footerTitle: { fontSize: 18, fontWeight: '700' },
  footerText: { fontSize: 13 },
});
