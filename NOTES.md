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

_To do (Phases 5 and 7)._

## Finding the end of the article text

_To do (Phase 8)._

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

_To do._

## Where AI helped, and where it was corrected

_To do._
