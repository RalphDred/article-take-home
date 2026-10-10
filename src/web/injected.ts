// Scripts that run in a page before its own scripts (`injectedJavaScriptBeforeContentLoaded`).

import type { AppContext } from '../config';
import type { Insets } from './protocol';

export type PageGlobals = {
  /** The web tracker adds it to every event. Both pages. */
  appContext: AppContext;
  /** The space the app's chrome covers. Articles only: the page reserves it from its first paint. */
  appInsets?: Insets;
};

/** Sets the globals the pages read when they start. JSON is valid JavaScript, so the values are embedded as literals. */
export function beforeContentScript({ appContext, appInsets }: PageGlobals): string {
  const lines = [`window.appContext = ${JSON.stringify(appContext)};`];
  if (appInsets) lines.push(`window.appInsets = ${JSON.stringify(appInsets)};`);
  lines.push('true;');

  return lines.join('\n');
}
