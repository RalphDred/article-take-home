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

/** Sets the globals the pages read when they start. */
export function beforeContentScript({ appContext, appInsets }: PageGlobals): string {
  const lines = [`window.appContext = ${literal(appContext)};`];
  if (appInsets) lines.push(`window.appInsets = ${literal(appInsets)};`);
  lines.push('true;');

  return lines.join('\n');
}

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;

/** Puts `script` first in the document's <head>, so it runs before any of the page's own scripts. */
export function injectIntoHtml(html: string, script: string): string {
  const tag = `<script>${script}</script>`;
  const head = HEAD_OPEN.exec(html);
  if (!head) return tag + html;

  const end = head.index + head[0].length;

  return html.slice(0, end) + tag + html.slice(end);
}
