// Scripts that run in a page before its own scripts.
//
// iOS runs `injectedJavaScriptBeforeContentLoaded` as a WKUserScript at document start. Android (react-native-webview
// 13.16, the version Expo Go ships) runs it from `onPageStarted` with `evaluateJavascript`, which races the page's
// own inline scripts and loses on a real device: the article's status box shows "at start: no", and the web
// tracker's first page view goes out without the app context. On Android the script is therefore written into the
// document itself, at the top of <head> (`injectIntoHtml`).

import type { AppContext } from '../config';
import type { Insets } from './protocol';

export type PageGlobals = {
  /** The web tracker adds it to every event. Both pages. */
  appContext: AppContext;
  /** The space the app's chrome covers. Articles only: the page reserves it from its first paint. */
  appInsets?: Insets;
};

// JSON is valid JavaScript, so values are embedded as literals. `<` is escaped so a value can never close the
// <script> element it is written into.
const literal = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Sets the globals the pages read when they start. With `nativeAnchors`, also adds `NATIVE_ANCHOR_SCRIPT`, for a page
 * that does not scroll itself.
 */
export function beforeContentScript({ appContext, appInsets }: PageGlobals, { nativeAnchors = false } = {}): string {
  const lines = [`window.appContext = ${literal(appContext)};`];
  if (appInsets) lines.push(`window.appInsets = ${literal(appInsets)};`);
  if (nativeAnchors) lines.push(NATIVE_ANCHOR_SCRIPT);
  lines.push('true;');

  return lines.join('\n');
}

/**
 * For the front page, which is exactly as tall as its content and does not scroll: an in-page `#section` link there
 * has nothing to scroll, so the native scroll view has to. The protocol has no message for it (NOTES.md), so this
 * script reports where the target element is (`app:anchor`) and the app scrolls.
 *
 * A tap on a `#section` link is taken over (`preventDefault`), so the URL keeps its `#consent=…` fragment and the web
 * view sees no navigation. A script that sets `location.hash` itself is caught by `hashchange`. A link whose target
 * does not exist (the partner link's placeholder `#`) is left to the page. ES5, for older web views.
 */
export const NATIVE_ANCHOR_SCRIPT = `(function () {
  function reportAnchor(hash) {
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (error) { return false; }
    var target = id ? document.getElementById(id) : null;
    if (!target || !window.ReactNativeWebView) return false;

    var top = Math.max(0, target.getBoundingClientRect().top + (window.pageYOffset || 0));
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'app:anchor', id: id, top: top }));
    return true;
  }

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    var href = link ? link.getAttribute('href') : null;
    if (!href || href.charAt(0) !== '#' || link.target === '_blank') return;

    if (reportAnchor(href)) event.preventDefault();
  }, true);

  window.addEventListener('hashchange', function () { reportAnchor(location.hash); });
})();`;

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;

/** Puts `script` first in the document's <head>, so it runs before any of the page's own scripts. */
export function injectIntoHtml(html: string, script: string): string {
  const tag = `<script>${script}</script>`;
  const head = HEAD_OPEN.exec(html);
  if (!head) return tag + html;

  const end = head.index + head[0].length;

  return html.slice(0, end) + tag + html.slice(end);
}
