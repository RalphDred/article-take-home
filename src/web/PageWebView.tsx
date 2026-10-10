import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewSource,
} from 'react-native-webview/lib/WebViewTypes';

import { APP_CONTEXT } from '../config';
import { assertNever } from '../util/assertNever';
import { beforeContentScript } from './injected';
import { type LoadFailure, sameDocument } from './loadState';
import { type Insets, type PageKind, type PageMessage, parseInbound, PROTOCOL_VERSION, type TrackerCommand } from './protocol';
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
  /** Once per loaded document, on its first `ready`. */
  onReady?: (loadId: number) => void;
  onPageMessage?: (message: PageEvent) => void;
  onTrackerMessage?: (raw: string, command: TrackerCommand) => void;
  /** The page tried to navigate to another document. The web view stays where it is; the caller decides. */
  onLeavePage: (url: string) => void;
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
export function PageWebView({ page, url, insets, onReady, onPageMessage, onTrackerMessage, onLeavePage, style, ref }: Props) {
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

  const handlers = useRef({ onReady, onPageMessage, onTrackerMessage, onLeavePage });
  handlers.current = { onReady, onPageMessage, onTrackerMessage, onLeavePage };

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

  // A new document starts at the top.
  useEffect(() => {
    scrollY.current = 0;
  }, [loadId]);

  // After the app state, which can change the layout (font size): back to where the reader was before the rebuild.
  // Content that arrives after `ready` (photos, the ask box) can still move the text a little.
  useEffect(() => {
    if (readyLoadId === null) return;

    const y = restoreScrollY.current;
    restoreScrollY.current = null;
    if (y !== null && y > 0) inject(`window.scrollTo(0, ${Math.round(y)});true;`);
  }, [readyLoadId, inject]);

  // Typed by the one field it reads: the library's own scroll event types disagree with each other.
  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

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
          handlers.current.onTrackerMessage?.(inbound.raw, inbound.command);
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
      // The app-started load itself, and in-page `#hash` navigation.
      if (sameDocument(request.url, documentUrl)) return true;

      handlers.current.onLeavePage(request.url);

      return false;
    },
    [documentUrl],
  );

  const injected = useMemo(
    () => beforeContentScript(insets ? { appContext: APP_CONTEXT, appInsets: insets } : { appContext: APP_CONTEXT }),
    [insets],
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

  return (
    <View style={[styles.container, style]}>
      {source !== null && state.status !== 'waitingForConsent' && (
        <WebView
          key={state.loadId}
          ref={webView}
          source={source}
          style={state.status === 'ready' ? styles.page : styles.hidden}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={injected}
          onMessage={handleMessage}
          onError={handleError}
          onHttpError={handleHttpError}
          onShouldStartLoadWithRequest={handleShouldStart}
          onScroll={handleScroll}
          onContentProcessDidTerminate={rebuild}
          onRenderProcessGone={rebuild}
          // The error state below replaces the library's own error view, which would otherwise draw through it.
          renderError={renderNothing}
        />
      )}
      {state.status === 'error' ? (
        <View style={styles.overlay}>
          <Text style={styles.title}>This page could not be loaded</Text>
          <Text style={styles.detail}>{describeFailure(state.failure)}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : state.status !== 'ready' ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" />
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
    // Opaque, so neither a half-loaded page nor the platform's error page shows through.
    backgroundColor: '#f2f2f2',
    gap: 12,
  },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: 14, color: '#666', textAlign: 'center' },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1a1a1a' },
  retryLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
