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
 * that does not scroll itself. With `readDetector`, adds `READ_DETECTOR_SCRIPT` (articles), after `appInsets`.
 */
export function beforeContentScript(
  { appContext, appInsets }: PageGlobals,
  { nativeAnchors = false, readDetector = false } = {},
): string {
  const lines = [`window.appContext = ${literal(appContext)};`];
  if (appInsets) lines.push(`window.appInsets = ${literal(appInsets)};`);
  if (nativeAnchors) lines.push(NATIVE_ANCHOR_SCRIPT);
  if (readDetector) lines.push(READ_DETECTOR_SCRIPT);
  lines.push('true;');

  return lines.join('\n');
}

/**
 * Finds when the last line of an article's text has been on screen, clear of the app's chrome (README, "Reading").
 * The page does not say where its text ends, so this depends on its DOM: the last paragraph of
 * `.articlecomponent.text`, the selector the web team's own end-of-text analytics uses. The ask box, the related links
 * and "More from the newsroom" sit outside that element, and so does the status box. NOTES.md asks the web team for
 * a real contract instead.
 *
 * Installed before the page starts, but only watching once the app calls `start()` (`START_READ_DETECTOR_SCRIPT`),
 * when the page is ready and shown: until then the reader cannot see it. Then it checks on every scroll, resize and
 * change of the page's size (late photos, the ask box, "More", a font size change), at most once a frame, and reports
 * `{ type: 'app:endOfText' }` once per document. The paragraph is looked up again each time, so text that changes
 * after the start still counts. No match at all is reported once as `app:endOfTextMissing`, so it cannot fail
 * silently. ES5, for older web views. On Android the script can run twice (written into the document and injected),
 * so it installs itself once.
 */
export const READ_DETECTOR_SCRIPT = `(function () {
  if (window.__newsAppReadDetector) return;

  var insets = { top: 0, bottom: 0 };
  var started = false;
  var reported = false;
  var missingReported = false;
  var pending = false;

  function useInsets(value) {
    if (value && typeof value.top === 'number' && typeof value.bottom === 'number') {
      insets = { top: value.top, bottom: value.bottom };
    }
  }

  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function lastTextLine() {
    var paragraphs = document.querySelectorAll('.articlecomponent.text p');
    return paragraphs.length ? paragraphs[paragraphs.length - 1] : null;
  }

  function check() {
    pending = false;
    if (!started || reported) return;

    var last = lastTextLine();
    if (!last) {
      if (!missingReported) post({ type: 'app:endOfTextMissing' });
      missingReported = true;
      return;
    }

    // The bottom of the last paragraph is its last line: on screen between the header and the bottom inset.
    var bounds = last.getBoundingClientRect();
    var visibleBottom = window.innerHeight - insets.bottom;
    if (bounds.height <= 0 || bounds.bottom > visibleBottom + 1 || bounds.bottom < insets.top) return;

    reported = true;
    post({ type: 'app:endOfText' });
  }

  function schedule() {
    if (pending || !started || reported) return;
    pending = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(check);
    else setTimeout(check, 16);
  }

  useInsets(window.appInsets);
  window.addEventListener('app:insets', function (event) {
    useInsets(event.detail);
    schedule();
  });

  window.__newsAppReadDetector = {
    start: function () {
      if (started) return;
      started = true;
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      if (window.ResizeObserver && document.body) new window.ResizeObserver(schedule).observe(document.body);
      check();
    },
  };
})();`;

/** Starts `READ_DETECTOR_SCRIPT` on the ready, visible page. Does nothing on a page without it. */
export const START_READ_DETECTOR_SCRIPT =
  'if (window.__newsAppReadDetector) window.__newsAppReadDetector.start();true;';

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
