import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
  WebViewSource,
} from 'react-native-webview/lib/WebViewTypes';

import { APP_CONTEXT } from '../config';
import { useAppState } from '../state/appState';
import { tracking } from '../tracking/appTracking';
import { paletteOf } from '../ui/palette';
import { assertNever } from '../util/assertNever';
import { beforeContentScript, START_READ_DETECTOR_SCRIPT } from './injected';
import { isFileUrl, type LoadFailure, type LoadState, sameDocument } from './loadState';
import { type Insets, type PageKind, type PageMessage, parseInbound, PROTOCOL_VERSION } from './protocol';
import { useAppStateSync, useInsetsSync } from './useAppStateSync';
import { LOADS_DOCUMENT_ITSELF, useDocumentHtml } from './useDocumentHtml';
import { usePageLoad } from './usePageLoad';

export type PageWebViewHandle = {
  /** Loads the page again with the newest URL. Shows the loading state. */
  reload: () => void;
};

/** Every page message except `ready`, which the web view handles itself. */
export type PageEvent = Exclude<PageMessage, { type: 'ready' }>;

type Props = {
  page: PageKind;
  /** Null while the app waits for consent. See `usePageLoad` for when a change of URL loads. */
  url: string | null;
  /** Articles only: set as `window.appInsets` before the page starts. */
  insets?: Insets;
  /** For a saved copy (a `file:` URL): the folder its page may read files from. Nothing on disk otherwise. */
  fileAccessUrl?: string;
  /** Once per loaded document, on its first `ready`. */
  onReady?: (loadId: number) => void;
  onPageMessage?: (message: PageEvent) => void;
  /** The page tried to navigate to another document. The web view stays where it is; the caller decides. */
  onLeavePage: (url: string) => void;
  /** Each new load state: a new load, ready, or an error. */
  onLoadStateChange?: (state: LoadState) => void;
  /**
   * False for the front page: it is as tall as its content, and the native scroll view scrolls it. In-page anchors
   * then arrive as `app:anchor` messages for the caller to scroll to.
   */
  scrollEnabled?: boolean;
  /**
   * For a page that scrolls itself (the article): pulling down at its top reloads it, as an app-started load with the
   * loading state. `refreshIndicatorOffset` moves Android's spinner below a header that floats over the page.
   */
  pullToRefresh?: boolean;
  /**
   * Articles: report when the last line of the text has been on screen (`READ_DETECTOR_SCRIPT`), as
   * `app:endOfText` through `onPageMessage`. Watching starts once the page is ready and shown.
   */
  readDetection?: boolean;
  refreshIndicatorOffset?: number;
  /**
   * How much of the web view, from its top, the loading and error states cover. All of it by default. The front
   * page is taller than the screen, so its states are drawn in the part the reader can see.
   */
  statusAreaHeight?: number;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<PageWebViewHandle>;
};

/**
 * The web view both screens use. It owns the load state machine (`loadState.ts`): a native loading state until the
 * page sends `ready`, an error state with Retry when it never does or cannot be fetched, and it never leaves the page
 * it was opened for.
 *
 * Every app-started load mounts a new native web view (`key={loadId}`), so each load is a fresh document even when
 * only the URL's hash differs (the consent reload adds `#consent=...`), a failed first load can be retried on iOS,
 * and a late message from the previous document cannot reach the new load.
 *
 * App state reaches only the ready document (`useAppStateSync`). The web view is keyed on the load alone, never on
 * app state, so a change of theme or font size is an event on the open page, not a reload.
 */
export function PageWebView({
  page,
  url,
  insets,
  fileAccessUrl,
  onReady,
  onPageMessage,
  onLeavePage,
  onLoadStateChange,
  scrollEnabled = true,
  pullToRefresh = false,
  readDetection = false,
  refreshIndicatorOffset,
  statusAreaHeight,
  style,
  ref,
}: Props) {
  const { state, reload, ready, fail } = usePageLoad(url);

  // The scroll position of the current document, and the one to restore after the content process was rebuilt.
  const scrollY = useRef(0);
  const restoreScrollY = useRef<number | null>(null);

  // Pull to refresh starts over at the top. (Retry keeps the position: it may be retrying a rebuild.)
  const reloadByReader = useCallback(() => {
    restoreScrollY.current = null;
    reload();
  }, [reload]);

  useImperativeHandle(ref, () => ({ reload: reloadByReader }), [reloadByReader]);

  const handlers = useRef({ onReady, onPageMessage, onLeavePage, onLoadStateChange });
  handlers.current = { onReady, onPageMessage, onLeavePage, onLoadStateChange };

  useEffect(() => {
    handlers.current.onLoadStateChange?.(state);
  }, [state]);

  // Only one native web view exists at a time (keyed on the load), so this is always the current document.
  const webView = useRef<WebView>(null);
  const inject = useCallback((script: string) => webView.current?.injectJavaScript(script), []);

  // Exactly once per load: the reducer moves to `ready` once per loadId, whatever the page sends.
  const readyLoadId = state.status === 'ready' ? state.loadId : null;
  useEffect(() => {
    if (readyLoadId !== null) handlers.current.onReady?.(readyLoadId);
  }, [readyLoadId]);

  const loadId = state.status === 'waitingForConsent' ? null : state.loadId;
  const documentUrl = state.status === 'waitingForConsent' ? null : state.url;

  useAppStateSync(page, readyLoadId, inject);
  useInsetsSync(loadId, readyLoadId !== null, insets, inject);

  // Whether the page is scrolled to its top, where a pull down reloads it (Android; see `refreshControl` below).
  // State, because it switches the pull on and off, but only set when it flips, not on every scroll event.
  const [atTop, setAtTop] = useState(true);
  const atTopNow = useRef(true);
  const trackTop = useCallback((y: number) => {
    const top = y <= 0;
    if (top === atTopNow.current) return;

    atTopNow.current = top;
    setAtTop(top);
  }, []);

  // A new document starts at the top.
  useEffect(() => {
    scrollY.current = 0;
    trackTop(0);
  }, [loadId, trackTop]);

  // After the app state, which can change the layout (font size): back to where the reader was before the rebuild.
  // Content that arrives after `ready` (photos, the ask box) can still move the text a little.
  useEffect(() => {
    if (readyLoadId === null) return;

    const y = restoreScrollY.current;
    restoreScrollY.current = null;
    if (y !== null && y > 0) inject(`window.scrollTo(0, ${Math.round(y)});true;`);
  }, [readyLoadId, inject]);

  // The page is shown from `ready` on, so only from then can the reader see the end of its text.
  useEffect(() => {
    if (readyLoadId !== null && readDetection) inject(START_READ_DETECTOR_SCRIPT);
  }, [readyLoadId, readDetection, inject]);

  // Typed by the one field it reads: the library's own scroll event types disagree with each other.
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
      trackTop(scrollY.current);
    },
    [trackTop],
  );

  // The pull's own spinner hands over to the loading state as soon as the new load starts. (It has to go back to
  // `false` itself: a refresh control whose prop never changes keeps spinning.)
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (state.status !== 'ready') setRefreshing(false);
  }, [state.status]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reloadByReader();
  }, [reloadByReader]);

  // The OS killed the page's content process (usually while the app was in the background). The native web view is
  // blank and cannot be used again, so the page is loaded again in a new one: the loading state, the page's own
  // `ready`, the app state sent again to the new document, then the old scroll position.
  const rebuild = useCallback(() => {
    console.warn(`[${page}] the web view's content process is gone, loading the page again`);
    restoreScrollY.current = scrollY.current;
    reload();
  }, [page, reload]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (loadId === null) return;

      const inbound = parseInbound(event.nativeEvent.data);
      switch (inbound.kind) {
        case 'ignored':
          return;
        case 'tracker':
          // Every page hands its web tracker's events to the app's tracker; they wait there until consent.
          tracking.trackWebMessage(inbound.raw, inbound.command);
          return;
        case 'page': {
          const { message } = inbound;
          if (message.type !== 'ready') {
            handlers.current.onPageMessage?.(message);
            return;
          }
          if (message.page !== page) {
            console.warn(`[${page}] ignored ready from a ${message.page} page`);
            return;
          }
          if (message.protocol !== PROTOCOL_VERSION) {
            console.warn(`[${page}] page speaks protocol ${message.protocol}, the app ${PROTOCOL_VERSION}`);
          }
          ready(loadId);
          return;
        }
        default:
          assertNever(inbound, 'inbound message');
      }
    },
    [loadId, page, ready],
  );

  const failWith = useCallback(
    (failure: LoadFailure) => {
      if (loadId !== null) fail(loadId, failure);
    },
    [loadId, fail],
  );

  // Only the main document reports here (both platforms filter subresources), and navigation away is blocked below,
  // so a failure here is always the app-started load. (On Android the fetch in `useDocumentHtml` reports instead.)
  const handleError = useCallback(
    (event: WebViewErrorEvent) => failWith({ kind: 'network', description: event.nativeEvent.description }),
    [failWith],
  );
  const handleHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => failWith({ kind: 'http', status: event.nativeEvent.statusCode }),
    [failWith],
  );

  const handleShouldStart = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (documentUrl === null) return false;
      // iOS asks for subframes too; they do not move the page. (Android only asks for the top frame.)
      if (request.isTopFrame === false) return true;
      // iOS: the web view reloading by itself (its own pull to refresh, or the page's `location.reload()`). That would
      // be a new document the app did not start: no loading state, and its `ready` would be ignored as a second one
      // for this load, so it would never get the app state. It becomes an app-started load instead.
      if (request.navigationType === 'reload') {
        reloadByReader();
        return false;
      }
      // The app-started load itself, and in-page `#hash` navigation.
      if (sameDocument(request.url, documentUrl)) return true;

      handlers.current.onLeavePage(request.url);

      return false;
    },
    [documentUrl, reloadByReader],
  );

  // `target="_blank"` and `window.open`. Without this handler Android loads the link into an invisible second web view
  // (the tap does nothing), and iOS loads it in this one, asking `handleShouldStart` twice (two browser opens).
  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    handlers.current.onLeavePage(event.nativeEvent.targetUrl);
  }, []);

  // A page that does not scroll itself reports its in-page anchors (`app:anchor`) for the native scroll view.
  const injected = useMemo(
    () =>
      beforeContentScript(insets ? { appContext: APP_CONTEXT, appInsets: insets } : { appContext: APP_CONTEXT }, {
        nativeAnchors: !scrollEnabled,
        readDetector: readDetection,
      }),
    [insets, scrollEnabled, readDetection],
  );

  // Android: the document with the script written into it (see `injected.ts`). iOS: the URL itself.
  // Memoized per load: Android reloads an HTML source on every new `source` object, even an identical one.
  const documentHtml = useDocumentHtml(state, injected, fail);
  const html = documentHtml !== null && documentHtml.loadId === loadId ? documentHtml.html : null;
  const source = useMemo((): WebViewSource | null => {
    if (documentUrl === null) return null;
    if (!LOADS_DOCUMENT_ITSELF) return { uri: documentUrl };

    return html === null ? null : { html, baseUrl: documentUrl };
  }, [documentUrl, html]);

  // A saved copy loads its photos and map from its folder: Android needs file access switched on, iOS the folder.
  const fileAccess =
    documentUrl !== null && isFileUrl(documentUrl) && fileAccessUrl !== undefined
      ? { allowFileAccess: true, allowingReadAccessToURL: fileAccessUrl }
      : {};

  // The loading and error states follow the app's theme, like the screen around them.
  const palette = paletteOf(useAppState(appState => appState.theme));
  const overlayStyle = [
    styles.overlay,
    { backgroundColor: palette.background },
    statusAreaHeight === undefined ? null : [styles.overlayAtTop, { height: statusAreaHeight }],
  ];

  const webViewElement = source !== null && state.status !== 'waitingForConsent' && (
    <WebView
      key={state.loadId}
      ref={webView}
      source={source}
      style={state.status === 'ready' ? styles.page : styles.hidden}
      originWhitelist={['*']}
      {...fileAccess}
      injectedJavaScriptBeforeContentLoaded={injected}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleHttpError}
      onShouldStartLoadWithRequest={handleShouldStart}
      onOpenWindow={handleOpenWindow}
      // iOS previews a link on a long press, loading it outside the app's rules. (On by default in the library.)
      allowsLinkPreview={false}
      scrollEnabled={scrollEnabled}
      onScroll={handleScroll}
      // iOS: the web view's own refresh control. Its reload is turned into an app-started load (`handleShouldStart`).
      pullToRefreshEnabled={pullToRefresh}
      onContentProcessDidTerminate={rebuild}
      onRenderProcessGone={rebuild}
      // The error state below replaces the library's own error view, which would otherwise draw through it.
      renderError={renderNothing}
    />
  );

  return (
    <View style={[styles.container, style]}>
      {pullToRefresh && Platform.OS === 'android' ? (
        // Android's web view has no pull to refresh. A scroll view that cannot scroll itself carries the refresh
        // control, switched on only while the page is at its top, so every other drag still scrolls the page.
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.page}
          scrollEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              enabled={atTop && state.status === 'ready'}
              {...(refreshIndicatorOffset === undefined ? {} : { progressViewOffset: refreshIndicatorOffset })}
            />
          }
        >
          {webViewElement}
        </ScrollView>
      ) : (
        webViewElement
      )}
      {state.status === 'error' ? (
        <View style={overlayStyle}>
          <Text style={[styles.title, { color: palette.text }]}>This page could not be loaded</Text>
          <Text style={[styles.detail, { color: palette.muted }]}>{describeFailure(state.failure)}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={[styles.retry, { backgroundColor: palette.text }]}>
            <Text style={[styles.retryLabel, { color: palette.background }]}>Retry</Text>
          </Pressable>
        </View>
      ) : state.status !== 'ready' ? (
        <View style={overlayStyle}>
          <ActivityIndicator size="large" color={palette.muted} />
        </View>
      ) : null}
    </View>
  );
}

const renderNothing = () => <View />;

function describeFailure(failure: LoadFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return 'The page did not finish loading.';
    case 'network':
      return 'The server could not be reached. It retries by itself when the device is back online.';
    case 'http':
      return `The server answered with an error (${failure.status}).`;
    case 'savedCopy':
      return 'The saved copy could not be opened.';
    default:
      return assertNever(failure, 'load failure');
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  page: { flex: 1 },
  // Mounted so it can load, but not shown until `ready` (and never with the platform's own error page).
  hidden: { flex: 1, opacity: 0 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    // Opaque (the theme's background), so neither a half-loaded page nor the platform's error page shows through.
    gap: 12,
  },
  // Below the status area the web view is still hidden, so only the screen's background shows there.
  overlayAtTop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: undefined },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryLabel: { fontSize: 15, fontWeight: '600' },
});
