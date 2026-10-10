# Notes

Expo SDK 57 (Expo Go), React Native 0.86, `react-native-webview` 13.16, strict TypeScript, Zustand, Zod. Parts 1–3 built.

## How events reach the collector

App events (a screen view on every document's `ready`, and `article_read` once per article screen) and page messages
go through one pipeline (`src/tracking/tracking.ts`), with the SDK unchanged. Only the web tracker's three commands
are handed to `getWebViewCallback()`, as the page's original string. **Before consent**
nothing reaches the SDK. Its callback drops web events while no tracker exists, so the app keeps its own buffer: app
and web events, in order, the newest 500. Only a consent *string* creates the tracker (never a failure, `null` or the
timeout), and the buffer is then flushed once.

## Loading state and the consent rule

Each web view has one state, `waitingForConsent → loading → ready | error` (a pure reducer in `loadState.ts`). It is
a union rather than flags, so "ready and failed" cannot be written. Only the
app starts loads, so a `#hash` jump never shows a spinner. The first `ready` per load counts. No `ready` within 15 s
of foreground time, or a load error, shows the error state, which retries by itself when the device is back online.

Consent is `asking → timedOut | failed | none | given(value)`. `failed` and `none` behave alike but are logged apart.
The app asks at launch and on every return to the foreground. Pages wait while `asking`, at most 5 s, and every load
uses the newest value. A late answer still counts. A document loaded without a string reloads once when one arrives,
and after that it has one, so "never again" needs no flag. **Why:** always waiting turns a hanging consent service
into a blank app. Always loading at once gives nearly every cold start an empty ad slot and then a reload. Five
seconds covers most answers, so most pages load once with consent, and the one reload hits a page with no ads that
the reader has barely started. A *changed* string waits, because reloading mid-read costs more than it gains.

## How the two page layouts share code

One `PageWebView` handles loading, the injected globals, parsing, link routing and app state. On `ready` it sends a
snapshot, then one event per change. Nothing is sent on mount, and screens below stay mounted, so going back shows
the change with no reload. **Front page:** a native `ScrollView` (strip, web view, footer). The web view does not
scroll and is as tall as `height` says. Identical heights are skipped, so a resize cannot loop. **Article:** a
self-scrolling web view under a translucent header, with `appInsets` set before the page starts. **Protocol gap:** the
front page cannot scroll, so its "Jump to" links have nothing to move. An injected script reports the target's offset
(`app:anchor`) and the app scrolls the native view. Proposal: a `{ type: 'scrollTo', top }` message.

## Finding the end of the article text

An injected script tracks the bottom edge of the last `p` in `.articlecomponent.text`, the web team's own analytics
anchor. The ask box, the related links and "More" are outside it. The article counts as read once that edge has been
between the header and the bottom inset. The script checks on scroll, resize and `ResizeObserver(body)` (late
content, font size), finds the paragraph again each time, and logs an error if there is none. A read counts once per
screen: a refresh is the same screen, reopening is a new one. On Android it lands within 50 ms of the page's own "end
of text seen". **Ask the web team for** an `{ type: 'endOfText' }` message, or a `data-article-text-end` marker.

## Part 3: saved copies (built)

`saved/` in the app's documents holds complete copies only, one folder each. Downloads go to the job's own folder in
`saved-tmp/`, the record (`.copy.json`) is written last, and one rename moves the folder into `saved/`. A failure, a
cancel or a crash leaves nothing there, and `saved-tmp/` is wiped at launch. **The truth is the file system:** a
folder in `saved/` with a valid record is saved, and nothing else is. A sixth
save evicts the copy saved longest ago. Updates download as a new copy, and a banner offers "Show it".

## iOS and Android: what was verified

| Platform | Device | OS |
| --- | --- | --- |
| Android | Galaxy S24 Ultra (physical, Expo Go over Wi-Fi) | Android 16 (One UI 8.5) |
| Android | Pixel 8 emulator (API 36) | Android 16 |
| iOS | **not run** | — |

On Android I checked Parts 1–3 against every control-panel case (the limit of five and cancel in unit
tests only). **iOS is not verified.** The iOS-only paths are written but have never run: document-start globals, pull
to refresh, `onContentProcessDidTerminate`, file-URL access. **A difference found:** on Android,
`injectedJavaScriptBeforeContentLoaded` lost the race against the page's inline scripts (`at start: no`), so Android fetches the document and writes the script first in `<head>`.

## Content process killed in the background

Both screens rebuild their web view: a new load and `ready`, the app state sent once more, then the old scroll
position. The stack and the app state live in the app and are untouched. Checking it on the emulator (renderer
killed in the background) **found a bug**. Android starts no renderer while the app is hidden, so the 15 s timeout
ran out and the reader came back to an error. The timeout now counts only foreground time. **What should happen**
goes further: the page's own state is lost, and the article came back a third of a screen off.

## Tests, and why these

Pure modules only: the consent rule (fake timers), the message parser (untrusted input), the buffer (nothing before
consent, order kept), app state sent exactly once, a read once per screen, the double-opening teaser, and downloads
against an in-memory disk with injected failures. These rules are hard to see on screen and easy to break.

## What I left out, and known bugs

**SDK bugs (not fixed):** `command in WEB_VIEW_COMMANDS` lets `"toString"` through. The collector then rejects the
batch, and the SDK retries it forever, blocking all later events. Buffered events are timestamped at consent, and a
tracker cannot be removed. **Left out:** iOS verification, withdrawn consent, exact scroll restoration after a rebuild.

## Where AI helped, and where it was corrected

Claude Code wrote most of the code, tests and notes from my answers to its plan, and ran the emulator checks. It
was corrected where platforms differ from their docs (`injectedJavaScriptBeforeContentLoaded`, `IntersectionObserver`),
on an eviction rule the README contradicts, and on calling the rebuild done untested.
