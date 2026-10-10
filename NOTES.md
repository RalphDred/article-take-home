# Notes

<!-- Draft. Sections are filled in as the phases land. At most two pages in the end. -->

## How events reach the collector

_To do (Phase 10)._

## Loading state and the consent rule

Each web view has one state: `waitingForConsent → loading → ready | error` (`src/web/loadState.ts`, a pure reducer
with tests). A union rather than `isLoading`/`hasError` flags, so impossible mixes (ready *and* failed) cannot be
written, and every event says which load it belongs to (`loadId`). Events for an older load are dropped.

- **Only the app starts loads** (first load, pull to refresh, Retry, later the consent reload). `onLoadStart` is not
  used, so a `#hash` change (the "Jump" buttons) never shows the spinner. Navigation to another document is blocked
  in `onShouldStartLoadWithRequest`, so the app is the only one that can change the document.
- **Every load mounts a fresh native web view** (`key={loadId}`). A reload to a URL that differs only in its hash
  (`/front` → `/front#consent=…`) would otherwise be an in-page jump, not a load; a failed first load on iOS has no URL
  for `reload()` to repeat; and a message from the old document cannot be counted for the new one.
- **The first `ready` per load** moves to `ready`; the "ready twice" page's second one is ignored, so app state is
  sent once. No `ready` within 15 s ("never ready") → error with Retry. `onError` / `onHttpError` (server unreachable,
  HTTP errors) → the same error state.
- **Back online** (NetInfo reports offline, then online) while on the error state → retry by itself. Only that
  transition retries: an unreachable server while the device is online would otherwise retry in a loop.

_Consent: to do (Phase 9)._

## How the two page layouts share code

Both screens use one `PageWebView` (load state machine, injected globals, message parsing, app state sync, link
routing). The screens only decide the layout around it.

- **Front page:** one native `ScrollView` with the Recently read strip, the web view and a footer. The web view does
  not scroll (`scrollEnabled={false}`) and is exactly as tall as the page's `height` messages say. An identical height
  is skipped, so a page that posts its height again after the resize cannot loop, and heights are capped at 50 000 px
  with a warning, for a page sized by its own viewport (`src/web/pageHeight.ts`). The fixture measures its
  `.container`, not the viewport, so it does not loop by itself. A load starts from the last reported height, saved
  across launches, so a reload does not move the footer or the scroll position. While loading, the spinner sits in
  the visible part of that tall frame; on the error state the frame shrinks to the visible area.
- **"Jump to" links (protocol gap).** The front page cannot scroll, so a `#section` link there has nothing to move,
  and the protocol has no message for "scroll the app to here". Workaround: on a web view that does not scroll, the
  app injects a script (`NATIVE_ANCHOR_SCRIPT` in `src/web/injected.ts`) that takes over taps on `#section` links
  (and catches `hashchange` from scripts), measures the target element and posts a private
  `{ type: 'app:anchor', id, top }`. The app scrolls the native view to strip height + `top`, never past the end
  (`src/web/anchorScroll.ts`). It depends on the page's DOM and on links being plain `<a href="#id">`. **Proposal:**
  a protocol message from the page, e.g. `{ type: 'scrollTo', top }` in CSS pixels, sent by the page's own anchor
  handling whenever it runs inside the app.
- **Recently read titles:** the protocol only carries ids, so the strip asks `/bundle/<id>/manifest.json` (the one
  endpoint that names an article) and caches the title. Until it arrives the card says "Article <id>".

- **Article:** the web view fills the screen and scrolls itself; a native header (back, A−/A+, light/dark, star)
  floats over it, translucent. The page reserves the space itself: `window.appInsets` before it starts, `app:insets`
  only if the insets change after `ready`. Top = safe area + the header's fixed 52 pt, bottom = safe area, rounded up
  to whole CSS pixels. The title starts below the header, and the contents links and "Jump" land below it through
  the page's own `scroll-margin-top`. A jump in the first two seconds can land a little off, because the late map
  is still moving the text.
- **Pull to refresh on the article** has to differ per platform. iOS has the web view's own refresh control, but it
  calls the native `reload`, which the app did not start. That would give no loading state, and the new document's
  `ready` would be ignored, so it would never get the app state. So `onShouldStartLoadWithRequest` turns any
  `navigationType: 'reload'` into an app-started load. Android's web view has no refresh control, so a scroll view
  that cannot scroll carries one, and it is switched on only while the page is at its top.

## Finding the end of the article text

The app injects its own detector (`READ_DETECTOR_SCRIPT` in `src/web/injected.ts`). It does not read the status box
or the page's own analytics.

- **The end** is the bottom edge of the last `p` in `.articlecomponent.text`, the same anchor the web team's own
  end-of-text analytics uses. The ask box, related links, "More from the newsroom" and the status box are all outside
  that element, so none of them can count.
- **Read** = that edge has been between the top inset (header) and the bottom inset (safe area). That is the last
  line on screen and clear of the app's chrome. A last line that only ever sat under the header does not count, so
  jumping to "Related" does not count either.
- **When it checks:** only once the page is ready and shown (the app calls `start()`), then on scroll, on resize and
  when the page's size changes (`ResizeObserver` on `body`: the late map, the ask box, "More", a font size change),
  at most once a frame. The paragraph is looked up again on every check, so text that moves or changes still
  counts. It reports `app:endOfText` once per document. I planned an `IntersectionObserver` first, but it fires on
  ratio thresholds, which cannot express "the bottom edge is visible" for a paragraph taller than the screen (large
  font). So it measures instead.
- **Fails loudly:** a page with no matching element posts `app:endOfTextMissing` once, and the app logs it as an
  error (a red box in development).
- **Once per screen** (`src/reading/readCounter.ts`): each article screen has its own counter. A pull to refresh or
  a rebuild is the same screen and does not count again. Opening the article again is a new screen and counts again.
- **Verified on Android (Pixel 8 emulator):** the app's read and the page's own "end of text seen" arrive in the same
  50 ms, and the front page gets `app:read` once and shows the article in the strip.

**What I would ask the web team for:** a protocol message, `{ type: 'endOfText' }`, posted by the page when its own
check fires (it already has that check), or at least a stable `data-article-text-end` marker on the last element of
the text. Then the app would not depend on the page's class names.

## Part 3: saved copies

_To do (Phase 11, or a description if it is cut)._

## iOS and Android: what was verified

**Stack:** Expo SDK 57 in Expo Go (no custom native build), React Native 0.86.3, `react-native-webview` 13.16.1.
The app reaches the fixture server over Wi-Fi at the dev machine's LAN address. A Windows PC served both Metro and
the fixture server.

| Platform | Device | OS | How it ran |
| --- | --- | --- | --- |
| Android | Samsung Galaxy S24 Ultra (SM-S928B), physical | Android 16, One UI 8.5 (build `BP4A.251205.006.S928BXXS6DZI1`) | Expo Go over Wi-Fi |
| iOS | iPad | _not yet verified_ | Expo Go over Wi-Fi (planned) |

**Verified so far on Android:**

- `/front` and the articles render in the web view. Each load shows the native spinner until `ready`.
- Loading states from the control panel. "Slow" ends on the page. "Unreachable" ends on the error state with Retry,
  and airplane mode off retries by itself. Article 4 ("never ready") ends on the error state after 15 s. Article 5
  ("ready twice") is ready once in the app while its status box shows `ready sent ×2`. Article 6 ("ready after 3 s")
  loads.
- "Jump (script)" and the Contents links scroll inside the article with no spinner.
- Globals before the page starts: the article's status box shows `insets 0 / 48 · at start: yes` and the app
  context. A first attempt on the S24 showed `at start: no` (see the platform differences below). The `app context`
  line alone did not prove it, because the status box draws after the page has started.

- App state survives an app reload (bookmarks, theme, font scale), and a newly loaded page gets it once on `ready`:
  each status box counter shows `applied ×1`, with `0 before ready`. After that, each tap on the article's controls
  raises one counter by one on the article, and by the same amount on the front page, which shows it on going back
  without a reload.

- Links. The front page's "Link + message" teaser (it posts `openArticle` *and* follows its link) opens exactly one
  article screen. The "Syndication partner" link opens the browser, and so does the article's "Tide tables" link
  (`target="_blank"`) once. "Jump" and the contents links still scroll in place with no spinner.

- Front page "Jump to" links (on the S24, and on an Android 16 Pixel 8 emulator): "More stories" puts its heading at
  the top of the visible area, "Test pages" stops at the end of the scroll view with the footer in view, no spinner either way.
  Not yet checked with the Recently read strip showing (nothing is marked read before Phase 8).

**Not yet verified on iOS.** This changes when the iPad runs the app.

**Differences between the platforms:**

- **Globals before the page starts.** On Android, `react-native-webview` 13.16 (the version Expo Go ships) runs
  `injectedJavaScriptBeforeContentLoaded` from `onPageStarted` with `evaluateJavascript`. That races the page's inline
  scripts, and on the S24 it lost: the article's status box showed `insets 0 / 0 · at start: no`. The web tracker's
  first page view would also have gone out without `appContext` (the control panel flags that). So on Android the app
  fetches the document itself, writes the script first in `<head>`, and loads it as HTML with the page's URL as its
  base (`useDocumentHtml.ts`). iOS keeps the URL load, where the script is a WKUserScript at document start. With a
  development build, a newer web view or `WebViewCompat.addDocumentStartJavaScript` would make the fetch unnecessary.

## What I left out, and known bugs

- The tracker SDK (`sdk/tracker.ts`) does not compile under `noUncheckedIndexedAccess`
  (`WEB_VIEW_COMMANDS[command]` is `EventKind | undefined`). It is used unchanged: it builds as its own TypeScript
  project (`sdk/tsconfig.json`), and the app type-checks against its emitted declarations, so the app keeps the
  stricter flags. Run the type check with `npm run typecheck` (`tsc -b`).

## Content process killed in the background

_Draft, built but not yet verified on a device._ Without handling, the reader comes back to a blank page (iOS) or
a crash (Android, if `onRenderProcessGone` is not handled). The web view now rebuilds itself on
`onContentProcessDidTerminate` / `onRenderProcessGone`: a new app-started load (spinner, then the page's own `ready`),
the app state sent again to the new document, then the last scroll position. The screens themselves, the stack and the
app state are untouched, because they live in the app, not in the page. What is lost is the page's own state (an open
"More" list, late content), so the restored position can be a little off.

## Where AI helped, and where it was corrected

_To do._
